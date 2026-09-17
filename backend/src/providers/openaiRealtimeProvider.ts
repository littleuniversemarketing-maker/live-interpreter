import WebSocket from "ws";
import { config } from "../config.js";
import { LANGUAGES } from "../languages.js";
import type {
  AudioChunkEvent,
  InterpreterSession,
  LanguageCode,
  ProviderError,
  SpeechLifecycleEvent,
  TranscriptEvent,
  TranslationEvent,
} from "../types.js";

type Listener<T> = (e: T) => void;

/**
 * OpenAI retired the Realtime "beta" API shape on 2026-05-12. This file
 * targets the current GA interface: no OpenAI-Beta header, session config
 * nested under session.audio.input / session.audio.output, and renamed
 * server events (response.output_audio.delta instead of response.audio.delta,
 * etc). If OpenAI changes this again, this is the one file to update —
 * verify against https://platform.openai.com/docs/guides/realtime-conversations
 * before assuming this is still current.
 */
export class OpenAIRealtimeInterpreterSession implements InterpreterSession {
  private ws: WebSocket | null = null;
  private speaker: "A" | "B" = "A";
  private sourceLang: LanguageCode = "ja";
  private targetLang: LanguageCode = "en";
  private ready = false;
  private pendingAudioQueue: string[] = [];
  private rollingContext: string[] = [];
  private rollingContextTurns = config.rollingContextTurns;

  private listeners: {
    transcript: Listener<TranscriptEvent>[];
    translation: Listener<TranslationEvent>[];
    audio: Listener<AudioChunkEvent>[];
    lifecycle: Listener<SpeechLifecycleEvent>[];
    error: Listener<ProviderError>[];
  } = { transcript: [], translation: [], audio: [], lifecycle: [], error: [] };

  on(event: "transcript", cb: Listener<TranscriptEvent>): void;
  on(event: "translation", cb: Listener<TranslationEvent>): void;
  on(event: "audio", cb: Listener<AudioChunkEvent>): void;
  on(event: "lifecycle", cb: Listener<SpeechLifecycleEvent>): void;
  on(event: "error", cb: Listener<ProviderError>): void;
  on(event: string, cb: any): void {
    (this.listeners as any)[event].push(cb);
  }

  private emit<K extends keyof typeof this.listeners>(event: K, payload: any) {
    for (const cb of this.listeners[event]) cb(payload);
  }

  async configure(opts: {
    speaker: "A" | "B";
    sourceLang: LanguageCode;
    targetLang: LanguageCode;
    voice: string;
    silenceTimeoutMs: number;
  }): Promise<void> {
    this.speaker = opts.speaker;
    this.sourceLang = opts.sourceLang;
    this.targetLang = opts.targetLang;

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    const instructions = this.buildInterpreterInstructions(opts.sourceLang, opts.targetLang);

    this.send({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        instructions,
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            turn_detection: {
              type: "server_vad",
              silence_duration_ms: opts.silenceTimeoutMs,
              prefix_padding_ms: 300,
              threshold: 0.5,
            },
            transcription: { model: "whisper-1" },
          },
          output: {
            format: { type: "audio/pcm", rate: 24000 },
            voice: opts.voice || LANGUAGES[opts.targetLang].defaultVoice,
          },
        },
      },
    });
  }

  private buildInterpreterInstructions(source: LanguageCode, target: LanguageCode): string {
    const sourceLabel = LANGUAGES[source].label;
    const targetLabel = LANGUAGES[target].label;
    const context = this.rollingContext.length
      ? `\n\nRecent conversation context (most recent last), use it only to resolve pronouns, short replies like "yes/no", and ellipsis — do not repeat it back:\n${this.rollingContext.join("\n")}`
      : "";
    return [
      `You are a live simultaneous interpreter, not a conversational assistant.`,
      `The speaker will say something in ${sourceLabel}. Your ONLY job is to speak the equivalent meaning aloud in natural, fluent ${targetLabel}.`,
      `Rules:`,
      `- Never answer, comment on, or add to what was said. Only translate it.`,
      `- Preserve names, numbers, dates, addresses, currency amounts, and technical terms exactly.`,
      `- Preserve the speaker's tone and register (casual stays casual, formal stays formal).`,
      `- Keep it natural and concise — do not pad the translation with explanation.`,
      `- If the input is incomplete or unclear, translate the clear part rather than asking for clarification.`,
      context,
    ].join("\n");
  }

  private async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(config.openaiRealtimeModel)}`;
      this.ws = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${config.openaiApiKey}`,
        },
      });

      this.ws.on("open", () => {
        this.ready = true;
        for (const chunk of this.pendingAudioQueue) this.sendAudio(chunk);
        this.pendingAudioQueue = [];
        resolve();
      });

      this.ws.on("message", (data) => this.handleMessage(data.toString()));

      this.ws.on("error", (err) => {
        this.emit("error", {
          stage: "connect",
          message: `OpenAI Realtime connection error: ${err.message}`,
          recoverable: true,
        } satisfies ProviderError);
        reject(err);
      });

      this.ws.on("close", (code, reason) => {
        this.ready = false;
        if (code !== 1000) {
          this.emit("error", {
            stage: "network",
            message: `Realtime connection closed unexpectedly (${code}): ${reason || "no reason given"}`,
            recoverable: true,
          } satisfies ProviderError);
        }
      });
    });
  }

  private handleMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "input_audio_buffer.speech_started":
        this.emit("lifecycle", { speaker: this.speaker, type: "speech_started" });
        break;

      case "input_audio_buffer.speech_stopped":
        this.emit("lifecycle", { speaker: this.speaker, type: "speech_stopped" });
        break;

      case "conversation.item.input_audio_transcription.completed":
        this.emit("transcript", {
          speaker: this.speaker,
          sourceLang: this.sourceLang,
          text: msg.transcript ?? "",
          isFinal: true,
        });
        this.pushContext(`Speaker ${this.speaker} (${LANGUAGES[this.sourceLang].label}): ${msg.transcript ?? ""}`);
        break;

      case "conversation.item.input_audio_transcription.failed":
        this.emit("error", {
          stage: "stt",
          message: msg.error?.message ?? "Speech recognition failed for this turn.",
          recoverable: true,
        });
        break;

      case "response.created":
        this.emit("lifecycle", { speaker: this.speaker, type: "response_started" });
        break;

      case "response.output_audio_transcript.delta":
        this.emit("translation", {
          speaker: this.speaker,
          sourceLang: this.sourceLang,
          targetLang: this.targetLang,
          sourceText: "",
          translatedText: msg.delta ?? "",
          isFinal: false,
        });
        break;

      case "response.output_audio_transcript.done":
        this.emit("translation", {
          speaker: this.speaker,
          sourceLang: this.sourceLang,
          targetLang: this.targetLang,
          sourceText: "",
          translatedText: msg.transcript ?? "",
          isFinal: true,
        });
        this.pushContext(`Translated to ${LANGUAGES[this.targetLang].label}: ${msg.transcript ?? ""}`);
        break;

      case "response.output_audio.delta":
        this.emit("audio", { speaker: this.speaker, audioBase64: msg.delta ?? "" });
        break;

      case "response.done":
        this.emit("lifecycle", { speaker: this.speaker, type: "response_done" });
        break;

      case "error":
        this.emit("error", {
          stage: this.classifyError(msg.error?.code),
          message: msg.error?.message ?? "Unknown realtime API error.",
          recoverable: msg.error?.code !== "invalid_api_key",
        });
        break;

      default:
        break;
    }
  }

  private classifyError(code?: string): ProviderError["stage"] {
    if (!code) return "network";
    if (code.includes("rate_limit")) return "rate_limit";
    if (code.includes("auth") || code.includes("api_key")) return "auth";
    return "network";
  }

  private pushContext(line: string) {
    this.rollingContext.push(line);
    if (this.rollingContext.length > this.rollingContextTurns) {
      this.rollingContext.shift();
    }
  }

  sendAudio(chunkBase64: string): void {
    if (!this.ready || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingAudioQueue.push(chunkBase64);
      return;
    }
    this.send({ type: "input_audio_buffer.append", audio: chunkBase64 });
  }

  commit(): void {
    this.send({ type: "input_audio_buffer.commit" });
    this.send({ type: "response.create" });
  }

  interruptResponse(): void {
    this.send({ type: "response.cancel" });
    this.emit("lifecycle", { speaker: this.speaker, type: "interrupted" });
  }

  private send(obj: unknown) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  close(): void {
    this.ws?.close(1000, "session ended");
    this.ws = null;
    this.ready = false;
  }
}
