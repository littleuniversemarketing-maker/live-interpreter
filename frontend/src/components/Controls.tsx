interface Props {
  running: boolean;
  paused: boolean;
  muted: boolean;
  mode: "one-way" | "two-way";
  activeSpeaker: "A" | "B";
  onStart: () => void;
  onStop: () => void;
  onPauseToggle: () => void;
  onSwitchLanguages: () => void;
  onSwitchSpeaker: () => void;
  onClear: () => void;
  onMuteToggle: () => void;
  onOpenSettings: () => void;
}

export function Controls({
  running,
  paused,
  muted,
  mode,
  activeSpeaker,
  onStart,
  onStop,
  onPauseToggle,
  onSwitchLanguages,
  onSwitchSpeaker,
  onClear,
  onMuteToggle,
  onOpenSettings,
}: Props) {
  return (
    <div className="controls">
      {!running ? (
        <button className="controls__btn controls__btn--primary" onClick={onStart}>
          Start
        </button>
      ) : (
        <button className="controls__btn controls__btn--danger" onClick={onStop}>
          Stop
        </button>
      )}

      <button className="controls__btn" onClick={onPauseToggle} disabled={!running}>
        {paused ? "Resume" : "Pause"}
      </button>

      {mode === "two-way" && (
        <button className="controls__btn" onClick={onSwitchSpeaker} disabled={!running}>
          Speaking now: {activeSpeaker}
        </button>
      )}

      <button className="controls__btn" onClick={onSwitchLanguages} disabled={running}>
        Switch languages
      </button>

      <button className="controls__btn" onClick={onMuteToggle}>
        {muted ? "Unmute output" : "Mute output"}
      </button>

      <button className="controls__btn" onClick={onClear}>
        Clear conversation
      </button>

      <button className="controls__btn controls__btn--ghost" onClick={onOpenSettings}>
        Settings
      </button>
    </div>
  );
}
