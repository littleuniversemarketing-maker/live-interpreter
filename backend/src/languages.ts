import type { LanguageCode } from "./types.js";

export interface LanguageMeta {
  code: LanguageCode;
  label: string;
  flag: string;
  /** BCP-47 tag, used for provider transcription hints */
  bcp47: string;
  /** A reasonable default realtime voice for this language */
  defaultVoice: string;
}

// Adding a language later = adding one entry here. Nothing else in the
// backend hardcodes the language list.
export const LANGUAGES: Record<LanguageCode, LanguageMeta> = {
  ja: { code: "ja", label: "Japanese", flag: "🇯🇵", bcp47: "ja-JP", defaultVoice: "shimmer" },
  en: { code: "en", label: "English", flag: "🇺🇸", bcp47: "en-US", defaultVoice: "alloy" },
  es: { code: "es", label: "Spanish", flag: "🇪🇸", bcp47: "es-ES", defaultVoice: "verse" },
  zh: { code: "zh", label: "Chinese", flag: "🇨🇳", bcp47: "zh-CN", defaultVoice: "coral" },
  ko: { code: "ko", label: "Korean", flag: "🇰🇷", bcp47: "ko-KR", defaultVoice: "sage" },
  fr: { code: "fr", label: "French", flag: "🇫🇷", bcp47: "fr-FR", defaultVoice: "verse" },
  de: { code: "de", label: "German", flag: "🇩🇪", bcp47: "de-DE", defaultVoice: "ash" },
  it: { code: "it", label: "Italian", flag: "🇮🇹", bcp47: "it-IT", defaultVoice: "verse" },
  pt: { code: "pt", label: "Portuguese", flag: "🇵🇹", bcp47: "pt-PT", defaultVoice: "coral" },
};

export function isSupportedLanguage(code: string): code is LanguageCode {
  return code in LANGUAGES;
}
