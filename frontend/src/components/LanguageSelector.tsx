import { LANGUAGES, VOICES } from "../languages";
import type { LanguageCode } from "../types";

interface Props {
  label: string;
  accentVar: string;
  lang: LanguageCode;
  voice: string;
  disabled: boolean;
  onLangChange: (lang: LanguageCode) => void;
  onVoiceChange: (voice: string) => void;
}

export function LanguageSelector({ label, accentVar, lang, voice, disabled, onLangChange, onVoiceChange }: Props) {
  return (
    <div className="lang-selector" style={{ ["--accent" as string]: `var(${accentVar})` }}>
      <span className="lang-selector__label">{label}</span>
      <select
        className="lang-selector__select"
        value={lang}
        disabled={disabled}
        onChange={(e) => onLangChange(e.target.value as LanguageCode)}
      >
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.flag} {l.label}
          </option>
        ))}
      </select>
      <select
        className="lang-selector__voice"
        value={voice}
        disabled={disabled}
        onChange={(e) => onVoiceChange(e.target.value)}
        title="Output voice"
      >
        {VOICES.map((v) => (
          <option key={v} value={v}>
            voice: {v}
          </option>
        ))}
      </select>
    </div>
  );
}
