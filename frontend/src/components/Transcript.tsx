import { langMeta } from "../languages";
import type { ConversationTurn } from "../types";

interface Props {
  turns: ConversationTurn[];
  visible: boolean;
}

export function Transcript({ turns, visible }: Props) {
  if (!visible) return null;

  if (turns.length === 0) {
    return <div className="transcript transcript--empty">The conversation will appear here as you speak.</div>;
  }

  return (
    <div className="transcript">
      {turns.map((turn) => {
        const source = langMeta(turn.sourceLang);
        const target = langMeta(turn.targetLang);
        return (
          <div key={turn.id} className={`turn turn--speaker-${turn.speaker.toLowerCase()}`}>
            <div className="turn__line">
              <span className="turn__flag">{source.flag}</span>
              <span className="turn__lang-label">{source.label}</span>
              <span className="turn__text turn__text--source">{turn.sourceText || "…"}</span>
            </div>
            <div className="turn__line turn__line--translated">
              <span className="turn__flag">{target.flag}</span>
              <span className="turn__lang-label">{target.label}</span>
              <span className="turn__text">
                {turn.translatedText || "…"}
                {!turn.final && <span className="turn__cursor" />}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
