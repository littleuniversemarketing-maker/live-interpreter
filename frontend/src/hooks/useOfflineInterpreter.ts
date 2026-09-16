import { useCallback, useRef, useState } from "react";
import { EnergyVAD } from "../offline/energyVAD";
import { OfflineTTS } from "../offline/offlineTTS";
import { modelsForPair } from "../offline/offlineModels";
import type { LanguageCode, ServerToClientMessage } from "../types";

interface SpeakerConfig {
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  voice: string; // unused offline (system voice is chosen by language), kept for API symmetry
}

interface PendingRequest {
  resolve: (v: any) => void;
  reject: (e: any) => void;
}

function base64ToInt16(base64: string): Int16Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

function int16ArraysToFloat32(chunks: Int16Array[]): Float32Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) out[offset + i] = chunk[i] / 32768;
    offset += chunk.length;
  }
  return out;
}

/**
 * Mirrors the shape of useInterpreterSocket: takes an onMessage callback and
 * emits the same ServerToClientMessage union the cloud path produces, so
 * App.tsx's existing transcript/state rendering works unmodified regardless
 * of which path is active.
 */
export function useOfflineInterpreter(onMessage: (msg: ServerToClientMessage) => void) {
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [modelsReady, setModelsReady] = useState(false);

  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<string, PendingRequest>());
  const speakerConfigs = useRef(new Map<"A" | "B", SpeakerConfig>());
  const vads = useRef(new Map<"A" | "B", EnergyVAD>());
  const buffers = useRef(new Map<"A" | "B", Int16Array[]>());
  const ttsRef = useRef(new OfflineTTS());
  const silenceTimeoutMs = useRef(700);

  const ensureWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL("../offline/mlWorker.ts", import.meta.url), { type: "module" });
      workerRef.current.onmessage = (e: MessageEvent<any>) => {
        const msg = e.data;
        if (msg.type === "progress") {
          setDownloadProgress(msg.progress ?? 0);
          return;
        }
        const req = pending.current.get(msg.id);
        if (!req) return;
        if (msg.type === "error") {
          req.reject(new Error(msg.message));
        } else {
          req.resolve(msg);
        }
        pending.current.delete(msg.id);
      };
    }
    return workerRef.current;
  }, []);

  const call = useCallback(
    (req: any) => {
      const worker = ensureWorker();
      return new Promise<any>((resolve, reject) => {
        pending.current.set(req.id, { resolve, reject });
        worker.postMessage(req);
      });
    },
    [ensureWorker]
  );

  /** Pre-downloads (or confirms cached) the models needed for a language pair. Call from Settings. */
  const preload = useCallback(
    async (from: LanguageCode, to: LanguageCode) => {
      setDownloadProgress(0);
      setModelsReady(false);
      try {
        await call({ id: `preload-${Date.now()}`, type: "preload", from, to });
        setModelsReady(true);
      } finally {
        setDownloadProgress(null);
      }
    },
    [call]
  );

  const requiredModels = useCallback((from: LanguageCode, to: LanguageCode) => modelsForPair(from, to), []);

  const start = useCallback(
    (mode: "one-way" | "two-way", langA: LanguageCode, langB: LanguageCode, silenceMs: number) => {
      silenceTimeoutMs.current = silenceMs;
      speakerConfigs.current.set("A", { sourceLang: langA, targetLang: langB, voice: "" });
      if (mode === "two-way") {
        speakerConfigs.current.set("B", { sourceLang: langB, targetLang: langA, voice: "" });
      }

      for (const speaker of speakerConfigs.current.keys()) {
        buffers.current.set(speaker, []);
        vads.current.set(
          speaker,
          new EnergyVAD(
            silenceMs,
            () => {
              onMessage({ type: "lifecycle", event: { speaker, type: "speech_started" } });
              onMessage({ type: "status", state: "SPEECH_DETECTED" });
            },
            () => handleSpeechEnd(speaker)
          )
        );
      }
      onMessage({ type: "status", state: "LISTENING" });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [onMessage]
  );

  const handleSpeechEnd = useCallback(
    async (speaker: "A" | "B") => {
      const config = speakerConfigs.current.get(speaker);
      const chunks = buffers.current.get(speaker) ?? [];
      buffers.current.set(speaker, []);
      if (!config || chunks.length === 0) return;

      onMessage({ type: "status", state: "TRANSCRIBING" });
      const audio = int16ArraysToFloat32(chunks);

      try {
        const reqId = `stt-${speaker}-${Date.now()}`;
        const sttResult = await call({ id: reqId, type: "transcribe", audio, lang: config.sourceLang });
        const sourceText: string = sttResult.text;
        if (!sourceText) {
          onMessage({ type: "status", state: "LISTENING" });
          return;
        }
        onMessage({
          type: "transcript",
          event: { speaker, sourceLang: config.sourceLang, text: sourceText, isFinal: true },
        });

        onMessage({ type: "status", state: "TRANSLATING" });
        const translateReqId = `mt-${speaker}-${Date.now()}`;
        const mtResult = await call({
          id: translateReqId,
          type: "translate",
          text: sourceText,
          from: config.sourceLang,
          to: config.targetLang,
        });
        const translatedText: string = mtResult.text;
        onMessage({
          type: "translation",
          event: {
            speaker,
            sourceLang: config.sourceLang,
            targetLang: config.targetLang,
            sourceText,
            translatedText,
            isFinal: true,
          },
        });

        onMessage({ type: "status", state: "PLAYING" });
        const spoken = await ttsRef.current.speak(translatedText, config.targetLang, 1);
        if (!spoken.ok) {
          onMessage({
            type: "error",
            event: { stage: "tts", message: spoken.reason, recoverable: true },
          });
        }
        onMessage({ type: "lifecycle", event: { speaker, type: "response_done" } });
        onMessage({ type: "status", state: "LISTENING" });
      } catch (err: any) {
        onMessage({
          type: "error",
          event: { stage: "network", message: `Offline pipeline error: ${err?.message ?? err}`, recoverable: true },
        });
        onMessage({ type: "status", state: "LISTENING" });
      }
    },
    [call, onMessage]
  );

  /** Feed one base64 PCM16/24kHz chunk — same shape the online path sends over the socket. */
  const processAudioChunk = useCallback((speaker: "A" | "B", base64: string) => {
    const vad = vads.current.get(speaker);
    if (!vad) return;
    const samples = base64ToInt16(base64);
    vad.feed(samples);
    if (vad.isSpeaking()) {
      const list = buffers.current.get(speaker) ?? [];
      list.push(samples);
      buffers.current.set(speaker, list);
    }
  }, []);

  const setSilenceTimeout = useCallback((ms: number) => {
    silenceTimeoutMs.current = ms;
    for (const vad of vads.current.values()) vad.setSilenceTimeoutMs(ms);
  }, []);

  const stop = useCallback(() => {
    ttsRef.current.interrupt();
    vads.current.clear();
    buffers.current.clear();
    speakerConfigs.current.clear();
  }, []);

  const interrupt = useCallback(() => {
    ttsRef.current.interrupt();
  }, []);

  return {
    start,
    stop,
    interrupt,
    preload,
    requiredModels,
    processAudioChunk,
    setSilenceTimeout,
    downloadProgress,
    modelsReady,
  };
}
