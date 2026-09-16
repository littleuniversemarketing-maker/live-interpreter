import type { InterpreterState } from "../types";

const STATE_COPY: Record<InterpreterState, string> = {
  IDLE: "Press Start to begin",
  LISTENING: "Waiting for speech…",
  SPEECH_DETECTED: "Listening…",
  TRANSCRIBING: "Listening…",
  TRANSLATING: "Translating…",
  SYNTHESIZING: "Translating…",
  PLAYING: "Speaking…",
  INTERRUPTED: "Interrupted — listening…",
  PAUSED: "Paused",
  ERROR: "Connection trouble — reconnecting…",
};

interface Props {
  state: InterpreterState;
  micLevel: number;
  latencyMs: number | null;
  showLatency: boolean;
}

export function StatusDisplay({ state, micLevel, latencyMs, showLatency }: Props) {
  const active = state === "SPEECH_DETECTED" || state === "TRANSCRIBING";
  const speaking = state === "PLAYING";

  return (
    <div className="status">
      <div
        className={`status__orb status__orb--${state.toLowerCase()}`}
        style={{ ["--mic-level" as string]: active ? micLevel : 0 }}
      >
        <div className="status__orb-core" />
      </div>
      <p className="status__text">{STATE_COPY[state]}</p>
      {showLatency && latencyMs !== null && (
        <p className="status__latency">latency: {(latencyMs / 1000).toFixed(2)}s</p>
      )}
      {speaking && <p className="status__hint">Start speaking to interrupt</p>}
    </div>
  );
}
