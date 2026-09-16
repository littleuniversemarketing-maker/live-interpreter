// ---------------------------------------------------------------------------
// Provider-agnostic interfaces (section 17 of the spec).
// A real "speech-to-speech" provider like OpenAI Realtime implements all of
// these behind one connection. A classic STT -> LLM -> TTS stack would
// implement each one separately and a small orchestrator would chain them.
// Swapping providers means writing a new class that implements these
// interfaces under providers/ — nothing else in the app needs to change.
// ---------------------------------------------------------------------------

export type LanguageCode =
  | "ja" | "en" | "es" | "zh" | "ko" | "fr" | "de" | "it" | "pt";

export interface TranscriptEvent {
  speaker: "A" | "B";
  sourceLang: LanguageCode;
  text: string;
  isFinal: boolean;
}

export interface TranslationEvent {
  speaker: "A" | "B";
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  sourceText: string;
  translatedText: string;
  isFinal: boolean;
}

export interface AudioChunkEvent {
  speaker: "A" | "B";
  /** base64-encoded PCM16 audio at 24kHz mono (OpenAI Realtime default) */
  audioBase64: string;
}

export interface SpeechLifecycleEvent {
  speaker: "A" | "B";
  type: "speech_started" | "speech_stopped" | "response_started" | "response_done" | "interrupted";
}

export interface ProviderError {
  stage: "connect" | "stt" | "translate" | "tts" | "network" | "auth" | "rate_limit" | "unsupported_language";
  message: string;
  recoverable: boolean;
}

/**
 * A single live interpreter turn: one active speaker, one direction.
 * Two-way conversation mode runs two of these (or reconfigures one on
 * speaker switch) — see SessionManager.
 */
export interface InterpreterSession {
  configure(opts: {
    speaker: "A" | "B";
    sourceLang: LanguageCode;
    targetLang: LanguageCode;
    voice: string;
    silenceTimeoutMs: number;
  }): Promise<void>;

  /** Push a chunk of raw mic audio (PCM16 base64) into the pipeline. */
  sendAudio(chunkBase64: string): void;

  /** Tell the provider the user is manually flushing early (rare; VAD normally handles this). */
  commit(): void;

  on(event: "transcript", cb: (e: TranscriptEvent) => void): void;
  on(event: "translation", cb: (e: TranslationEvent) => void): void;
  on(event: "audio", cb: (e: AudioChunkEvent) => void): void;
  on(event: "lifecycle", cb: (e: SpeechLifecycleEvent) => void): void;
  on(event: "error", cb: (e: ProviderError) => void): void;

  close(): void;
}

// Narrower single-purpose interfaces, kept for providers that are NOT
// natively speech-to-speech (e.g. Google STT + DeepL + Azure TTS pipeline).
// The OpenAI Realtime provider in this build satisfies InterpreterSession
// directly and doesn't need these broken out, but a future non-realtime
// provider would implement each of these and a small adapter would compose
// them into an InterpreterSession.
export interface SpeechRecognizer {
  start(lang: LanguageCode): void;
  sendAudio(chunk: Buffer): void;
  onPartial(cb: (text: string) => void): void;
  onFinal(cb: (text: string) => void): void;
  stop(): void;
}

export interface TranslationEngine {
  translate(text: string, from: LanguageCode, to: LanguageCode, context: string[]): Promise<string>;
}

export interface SpeechSynthesizer {
  synthesize(text: string, lang: LanguageCode, voice: string): AsyncIterable<Buffer>;
}

export interface AudioInput {
  start(): void;
  onChunk(cb: (chunk: Buffer) => void): void;
  stop(): void;
}

export interface AudioOutput {
  enqueue(chunk: Buffer): void;
  interrupt(): void;
}

export interface VoiceActivityDetector {
  feed(chunk: Buffer): void;
  onSpeechStart(cb: () => void): void;
  onSpeechEnd(cb: () => void): void;
  setSilenceTimeoutMs(ms: number): void;
}

// ---------------------------------------------------------------------------
// Client <-> our backend WebSocket protocol (JSON control messages;
// binary frames are used only for raw audio in both directions).
// ---------------------------------------------------------------------------

export type ClientToServerMessage =
  | { type: "start"; mode: "one-way" | "two-way"; speakerA: LanguageCode; speakerB: LanguageCode; voiceA: string; voiceB: string; silenceTimeoutMs: number; autoDetect: boolean }
  | { type: "stop" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "switch_speaker"; speaker: "A" | "B" }
  | { type: "mute_output"; muted: boolean }
  | { type: "clear" }
  | { type: "audio_chunk"; speaker: "A" | "B"; audioBase64: string };

export type ServerToClientMessage =
  | { type: "status"; state: InterpreterState }
  | { type: "transcript"; event: TranscriptEvent }
  | { type: "translation"; event: TranslationEvent }
  | { type: "audio"; event: AudioChunkEvent }
  | { type: "lifecycle"; event: SpeechLifecycleEvent }
  | { type: "error"; event: ProviderError }
  | { type: "latency"; stage: string; ms: number };

export type InterpreterState =
  | "IDLE"
  | "LISTENING"
  | "SPEECH_DETECTED"
  | "TRANSCRIBING"
  | "TRANSLATING"
  | "SYNTHESIZING"
  | "PLAYING"
  | "INTERRUPTED"
  | "PAUSED"
  | "ERROR";
