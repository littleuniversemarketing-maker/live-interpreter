import type { WebSocket } from "ws";
import { OpenAIRealtimeInterpreterSession } from "./providers/openaiRealtimeProvider.js";
import type {
  ClientToServerMessage,
  InterpreterSession,
  InterpreterState,
  LanguageCode,
  ServerToClientMessage,
} from "./types.js";
import { isSupportedLanguage } from "./languages.js";

interface SpeakerConfig {
  lang: LanguageCode;
  voice: string;
}

/**
 * Owns everything for one connected client: the state machine (section 14),
 * one or two provider sessions (two-way mode needs A->B and B->A configured
 * separately since a single realtime session has one translation direction
 * at a time), and interruption handling.
 */
export class SessionManager {
  private state: InterpreterState = "IDLE";
  private mode: "one-way" | "two-way" = "one-way";
  private speakerA: SpeakerConfig = { lang: "ja", voice: "" };
  private speakerB: SpeakerConfig = { lang: "en", voice: "" };
  private silenceTimeoutMs = 700;
  private activeSpeaker: "A" | "B" = "A";
  private muted = false;
  private paused = false;

  private sessionAtoB: InterpreterSession | null = null;
  private sessionBtoA: InterpreterSession | null = null;
  private currentlyPlaying: "A" | "B" | null = null;

  private lastSpeechStartedAt = 0;
  private lastResponseStartedAt = 0;

  constructor(private socket: WebSocket) {}

  async handleMessage(raw: string) {
    let msg: ClientToServerMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.type) {
      case "start":
        await this.start(msg);
        break;
      case "stop":
        this.stop();
        break;
      case "pause":
        this.paused = true;
        this.setState("PAUSED");
        break;
      case "resume":
        this.paused = false;
        this.setState("LISTENING");
        break;
      case "switch_speaker":
        this.activeSpeaker = msg.speaker;
        break;
      case "mute_output":
        this.muted = msg.muted;
        break;
      case "clear":
        // Transcript is client-side state; nothing to do server-side
        // beyond acknowledging so the client can safely reset its UI.
        break;
      case "audio_chunk":
        this.routeAudio(msg.speaker, msg.audioBase64);
        break;
    }
  }

  private async start(msg: Extract<ClientToServerMessage, { type: "start" }>) {
    if (!isSupportedLanguage(msg.speakerA) || !isSupportedLanguage(msg.speakerB)) {
      this.sendError("unsupported_language", "One of the selected languages is not supported.", false);
      return;
    }

    this.mode = msg.mode;
    this.speakerA = { lang: msg.speakerA, voice: msg.voiceA };
    this.speakerB = { lang: msg.speakerB, voice: msg.voiceB };
    this.silenceTimeoutMs = msg.silenceTimeoutMs;
    this.activeSpeaker = "A";

    try {
      this.sessionAtoB = this.buildSession("A", this.speakerA.lang, this.speakerB.lang, this.speakerB.voice);
      await this.sessionAtoB.configure({
        speaker: "A",
        sourceLang: this.speakerA.lang,
        targetLang: this.speakerB.lang,
        voice: this.speakerB.voice,
        silenceTimeoutMs: this.silenceTimeoutMs,
      });

      if (this.mode === "two-way") {
        this.sessionBtoA = this.buildSession("B", this.speakerB.lang, this.speakerA.lang, this.speakerA.voice);
        await this.sessionBtoA.configure({
          speaker: "B",
          sourceLang: this.speakerB.lang,
          targetLang: this.speakerA.lang,
          voice: this.speakerA.voice,
          silenceTimeoutMs: this.silenceTimeoutMs,
        });
      }

      this.setState("LISTENING");
    } catch (err: any) {
      this.sendError("connect", `Failed to start interpreter session: ${err.message ?? err}`, true);
    }
  }

  private buildSession(
    speaker: "A" | "B",
    source: LanguageCode,
    target: LanguageCode,
    voice: string
  ): InterpreterSession {
    const session = new OpenAIRealtimeInterpreterSession();

    session.on("lifecycle", (e) => {
      this.handleLifecycle(speaker, e.type);
      this.send({ type: "lifecycle", event: e });
    });
    session.on("transcript", (e) => {
      this.setState("TRANSCRIBING");
      this.send({ type: "transcript", event: e });
    });
    session.on("translation", (e) => {
      this.setState("TRANSLATING");
      this.send({ type: "translation", event: e });
    });
    session.on("audio", (e) => {
      if (this.muted) return;
      this.setState("PLAYING");
      this.currentlyPlaying = speaker;
      this.send({ type: "audio", event: e });
    });
    session.on("error", (e) => {
      this.setState("ERROR");
      this.send({ type: "error", event: e });
      // Recoverable errors drop back to listening rather than getting the
      // conversation stuck (section 14 / section 16).
      if (e.recoverable) this.setState("LISTENING");
    });

    return session;
  }

  private handleLifecycle(speaker: "A" | "B", type: string) {
    const now = Date.now();
    switch (type) {
      case "speech_started":
        this.lastSpeechStartedAt = now;
        this.setState("SPEECH_DETECTED");
        // Section 14: if the *other* speaker starts talking while a
        // translation is playing, fade/stop it and free up the pipeline
        // instead of waiting for response.done.
        if (this.currentlyPlaying && this.currentlyPlaying !== speaker) {
          this.interruptCurrentPlayback();
        }
        break;
      case "speech_stopped":
        // VAD (server-side) already applied the configured silence
        // timeout before firing this — the provider then auto-commits
        // and starts a response.
        this.setState("SYNTHESIZING");
        break;
      case "response_started":
        this.lastResponseStartedAt = now;
        break;
      case "response_done":
        this.currentlyPlaying = null;
        this.setState(this.paused ? "PAUSED" : "LISTENING");
        break;
      case "interrupted":
        this.currentlyPlaying = null;
        this.setState("INTERRUPTED");
        break;
    }
  }

  private interruptCurrentPlayback() {
    const playingSession = this.currentlyPlaying === "A" ? this.sessionAtoB : this.sessionBtoA;
    (playingSession as any)?.interruptResponse?.();
    this.currentlyPlaying = null;
  }

  private routeAudio(speaker: "A" | "B", audioBase64: string) {
    if (this.paused) return;

    if (this.mode === "one-way") {
      this.sessionAtoB?.sendAudio(audioBase64);
      return;
    }

    // Two-way: route to whichever direction session matches the tagged
    // speaker. The client tags audio by whichever speaker is currently
    // active (manual toggle, per section 15's fallback for when reliable
    // automatic speaker ID isn't available).
    const target = speaker === "A" ? this.sessionAtoB : this.sessionBtoA;
    target?.sendAudio(audioBase64);
  }

  private stop() {
    this.sessionAtoB?.close();
    this.sessionBtoA?.close();
    this.sessionAtoB = null;
    this.sessionBtoA = null;
    this.setState("IDLE");
  }

  private setState(state: InterpreterState) {
    this.state = state;
    this.send({ type: "status", state });
  }

  private sendError(stage: any, message: string, recoverable: boolean) {
    this.setState("ERROR");
    this.send({ type: "error", event: { stage, message, recoverable } });
  }

  private send(msg: ServerToClientMessage) {
    if (this.socket.readyState === this.socket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  dispose() {
    this.stop();
  }
}
