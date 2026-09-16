import type { LanguageCode } from "./types";

export interface LanguageMeta {
  code: LanguageCode;
  label: string;
  flag: string;
  defaultVoice: string;
}

// Add a language here + on the backend (src/languages.ts) to support it
// everywhere in the app — selectors, transcript flags, and default voices
// all read from this one list.
export const LANGUAGES: LanguageMeta[] = [
  { code: "ja", label: "Japanese", flag: "🇯🇵", defaultVoice: "shimmer" },
  { code: "en", label: "English", flag: "🇺🇸", defaultVoice: "alloy" },
  { code: "es", label: "Spanish", flag: "🇪🇸", defaultVoice: "verse" },
  { code: "zh", label: "Chinese", flag: "🇨🇳", defaultVoice: "coral" },
  { code: "ko", label: "Korean", flag: "🇰🇷", defaultVoice: "sage" },
  { code: "fr", label: "French", flag: "🇫🇷", defaultVoice: "verse" },
  { code: "de", label: "German", flag: "🇩🇪", defaultVoice: "ash" },
  { code: "it", label: "Italian", flag: "🇮🇹", defaultVoice: "verse" },
  { code: "pt", label: "Portuguese", flag: "🇵🇹", defaultVoice: "coral" },
];

export const VOICES = ["alloy", "ash", "coral", "sage", "shimmer", "verse"];

export function langMeta(code: LanguageCode): LanguageMeta {
  return LANGUAGES.find((l) => l.code === code)!;
}
