import { langMeta } from "../languages";
import type { ConversationTurn } from "../types";
import { CoachPanel } from "./CoachPanel";
import { useCoach } from "../hooks/useCoach";

interface Props {
  turns: ConversationTurn[];
  visible: boolean;
}

export function Transcript({ turns, visible }: Props) {
  const { stateByTurn, requestCoach, playSuggestionAudio } = useCoach();

  if (!visible) return null;

  if (turns.length === 0) {
    return The conversation will appear here as you spe...
