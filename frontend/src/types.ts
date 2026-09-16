export type LanguageCode = "ja" | "en" | "es" | "zh" | "ko" | "fr" | "de" | "it" | "pt";

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
  audioBase64: string;
}

export interface ProviderError {
  stage: string;
  message: string;
  recoverable: boolean;
}

export interface ConversationTurn {
  id: string;
  speaker: "A" | "B";
  sourceLang: LanguageCode;
  targetLang: LanguageCode;
  sourceText: string;
  translatedText: string;
  final: boolean;
  timestamp: number;
}

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
  | { type: "lifecycle"; event: { speaker: "A" | "B"; type: string } }
  | { type: "error"; event: ProviderError }
  | { type: "latency"; stage: string; ms: number };
