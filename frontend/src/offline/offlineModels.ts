import type { LanguageCode } from "../types";

/**
 * On-device models used when running offline. These download from the
 * Hugging Face CDN the first time a language/pair is used (needs internet
 * for that one-time fetch), then live in the browser's Cache Storage and
 * work with zero network from then on — see Settings > Offline models for
 * the pre-download control.
 *
 * Whisper is multilingual (one model covers all source languages), so
 * there's only one STT entry. Translation is per-language-pair: MarianMT
 * (opus-mt) models are small (~40-90MB) but only cover specific pairs.
 * Where a direct pair isn't mirrored for transformers.js, we pivot through
 * English (source -> en -> target) using two smaller models instead of one
 * big one — slightly lower quality, but keeps every combination working.
 */

export const OFFLINE_STT_MODEL = "Xenova/whisper-tiny";

// Whisper's own language codes (ISO-639-1, matches our LanguageCode values
// directly except where noted).
export const WHISPER_LANGUAGE: Record<LanguageCode, string> = {
  ja: "japanese",
  en: "english",
  es: "spanish",
  zh: "chinese",
  ko: "korean",
  fr: "french",
  de: "german",
  it: "italian",
  pt: "portuguese",
};

interface TranslationPair {
  model: string;
}

// Direct source->target MarianMT (opus-mt) models mirrored for
// transformers.js under the Xenova org. Verify availability for your exact
// pairs before relying on this offline — HF model coverage shifts over
// time and this list was compiled from what's documented as available, not
// exhaustively tested in this build.
const DIRECT_PAIRS: Partial<Record<string, TranslationPair>> = {
  "ja-en": { model: "Xenova/opus-mt-ja-en" },
  "en-ja": { model: "Xenova/opus-mt-en-jap" },
  "es-en": { model: "Xenova/opus-mt-es-en" },
  "en-es": { model: "Xenova/opus-mt-en-es" },
  "zh-en": { model: "Xenova/opus-mt-zh-en" },
  "en-zh": { model: "Xenova/opus-mt-en-zh" },
  "ko-en": { model: "Xenova/opus-mt-ko-en" },
  "en-ko": { model: "Xenova/opus-mt-en-ko" }, // sparse coverage — pivot may be used
  "fr-en": { model: "Xenova/opus-mt-fr-en" },
  "en-fr": { model: "Xenova/opus-mt-en-fr" },
  "de-en": { model: "Xenova/opus-mt-de-en" },
  "en-de": { model: "Xenova/opus-mt-en-de" },
  "it-en": { model: "Xenova/opus-mt-it-en" },
  "en-it": { model: "Xenova/opus-mt-en-it" },
  "pt-en": { model: "Xenova/opus-mt-pt-en" },
  "en-pt": { model: "Xenova/opus-mt-en-pt" },
};

export interface TranslationPlan {
  /** One hop (direct pair) or two hops (source -> en -> target). */
  steps: { model: string; from: LanguageCode; to: LanguageCode }[];
}

export function planOfflineTranslation(from: LanguageCode, to: LanguageCode): TranslationPlan {
  if (from === to) return { steps: [] };

  const direct = DIRECT_PAIRS[`${from}-${to}`];
  if (direct) return { steps: [{ model: direct.model, from, to }] };

  // Pivot through English.
  const toEn = DIRECT_PAIRS[`${from}-en`];
  const fromEn = DIRECT_PAIRS[`en-${to}`];
  if (from !== "en" && to !== "en" && toEn && fromEn) {
    return {
      steps: [
        { model: toEn.model, from, to: "en" },
        { model: fromEn.model, from: "en", to },
      ],
    };
  }

  throw new Error(
    `No offline translation path from ${from} to ${to} yet. Add a model for this pair in offlineModels.ts.`
  );
}

/** All models a given pair needs downloaded — used by the Settings download button. */
export function modelsForPair(from: LanguageCode, to: LanguageCode): string[] {
  const plan = planOfflineTranslation(from, to);
  return [OFFLINE_STT_MODEL, ...plan.steps.map((s) => s.model)];
}
