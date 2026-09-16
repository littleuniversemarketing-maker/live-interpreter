import type { LanguageCode } from "../types";

const BCP47: Record<LanguageCode, string> = {
  ja: "ja-JP",
  en: "en-US",
  es: "es-ES",
  zh: "zh-CN",
  ko: "ko-KR",
  fr: "fr-FR",
  de: "de-DE",
  it: "it-IT",
  pt: "pt-PT",
};

/**
 * Browsers already ship on-device TTS voices for most OSes — that's a free
 * offline synthesizer with zero download. The catch (learned the hard way
 * on the earlier LibreTranslate build): generic voice selection fails
 * silently if you don't explicitly match on BCP-47 language tag, especially
 * for Japanese. This does the explicit match and reports clearly when a
 * language has no installed system voice, rather than silently speaking in
 * the wrong language or not at all.
 */
export class OfflineTTS {
  private voicesReady: Promise<SpeechSynthesisVoice[]>;

  constructor() {
    this.voicesReady = new Promise((resolve) => {
      const existing = speechSynthesis.getVoices();
      if (existing.length > 0) {
        resolve(existing);
        return;
      }
      speechSynthesis.onvoiceschanged = () => resolve(speechSynthesis.getVoices());
    });
  }

  async findVoice(lang: LanguageCode): Promise<SpeechSynthesisVoice | null> {
    const tag = BCP47[lang];
    const voices = await this.voicesReady;
    return (
      voices.find((v) => v.lang.toLowerCase() === tag.toLowerCase()) ??
      voices.find((v) => v.lang.toLowerCase().startsWith(tag.split("-")[0].toLowerCase())) ??
      null
    );
  }

  /** Speaks text and resolves when playback finishes (or errors). Sequential calls queue naturally. */
  speak(text: string, lang: LanguageCode, volume: number): Promise<{ ok: true } | { ok: false; reason: string }> {
    return new Promise(async (resolve) => {
      const voice = await this.findVoice(lang);
      if (!voice) {
        resolve({ ok: false, reason: `No installed system voice for ${BCP47[lang]} — text-only fallback.` });
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = BCP47[lang];
      utterance.volume = volume;
      utterance.onend = () => resolve({ ok: true });
      utterance.onerror = (e) => resolve({ ok: false, reason: e.error ?? "speech synthesis error" });
      speechSynthesis.speak(utterance);
    });
  }

  interrupt() {
    speechSynthesis.cancel();
  }
}
