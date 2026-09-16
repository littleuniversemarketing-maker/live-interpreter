import { useEffect, useState } from "react";

export interface Settings {
  mode: "one-way" | "two-way";
  micDeviceId: string | undefined;
  speakerDeviceId: string | undefined;
  silenceTimeoutMs: number;
  outputVolume: number;
  autoDetect: boolean;
  showTranscript: boolean;
  showLatency: boolean;
  duckMicDuringPlayback: boolean;
}

interface OfflineModelsInfo {
  requiredModels: string[];
  ready: boolean;
  downloadProgress: number | null;
  onDownload: () => void;
}

interface Props {
  open: boolean;
  settings: Settings;
  onChange: (settings: Settings) => void;
  onClose: () => void;
  offline: OfflineModelsInfo;
}

export function SettingsPanel({ open, settings, onChange, onClose, offline }: Props) {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (!open) return;
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      setMics(devices.filter((d) => d.kind === "audioinput"));
      setSpeakers(devices.filter((d) => d.kind === "audiooutput"));
    });
  }, [open]);

  if (!open) return null;

  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-panel__header">
          <h2>Settings</h2>
          <button className="settings-panel__close" onClick={onClose} aria-label="Close settings">
            ×
          </button>
        </div>

        <label className="settings-panel__field">
          <span>Conversation mode</span>
          <select value={settings.mode} onChange={(e) => set("mode", e.target.value as Settings["mode"])}>
            <option value="one-way">One-way (A → B)</option>
            <option value="two-way">Two-way conversation</option>
          </select>
        </label>

        <label className="settings-panel__field">
          <span>Microphone</span>
          <select
            value={settings.micDeviceId ?? ""}
            onChange={(e) => set("micDeviceId", e.target.value || undefined)}
          >
            <option value="">System default</option>
            {mics.map((m) => (
              <option key={m.deviceId} value={m.deviceId}>
                {m.label || "Microphone"}
              </option>
            ))}
          </select>
        </label>

        <label className="settings-panel__field">
          <span>Speaker / output</span>
          <select
            value={settings.speakerDeviceId ?? ""}
            onChange={(e) => set("speakerDeviceId", e.target.value || undefined)}
          >
            <option value="">System default</option>
            {speakers.map((s) => (
              <option key={s.deviceId} value={s.deviceId}>
                {s.label || "Speaker"}
              </option>
            ))}
          </select>
          <span className="settings-panel__hint">Headphones strongly recommended — see echo notice below.</span>
        </label>

        <label className="settings-panel__field">
          <span>Response speed ({settings.silenceTimeoutMs}ms silence timeout)</span>
          <input
            type="range"
            min={300}
            max={1200}
            step={50}
            value={settings.silenceTimeoutMs}
            onChange={(e) => set("silenceTimeoutMs", Number(e.target.value))}
          />
          <span className="settings-panel__hint">
            Lower = faster, may cut off brief pauses. Higher = waits longer for a complete thought before
            translating. This also governs silence-detection sensitivity.
          </span>
        </label>

        <label className="settings-panel__field">
          <span>Output volume ({Math.round(settings.outputVolume * 100)}%)</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.outputVolume}
            onChange={(e) => set("outputVolume", Number(e.target.value))}
          />
        </label>

        <label className="settings-panel__toggle">
          <input
            type="checkbox"
            checked={settings.autoDetect}
            onChange={(e) => set("autoDetect", e.target.checked)}
          />
          <span>Automatic language detection (manual selection is more accurate and lower latency)</span>
        </label>

        <label className="settings-panel__toggle">
          <input
            type="checkbox"
            checked={settings.duckMicDuringPlayback}
            onChange={(e) => set("duckMicDuringPlayback", e.target.checked)}
          />
          <span>Reduce mic sensitivity while translated audio is playing (extra echo protection, no headphones)</span>
        </label>

        <label className="settings-panel__toggle">
          <input
            type="checkbox"
            checked={settings.showTranscript}
            onChange={(e) => set("showTranscript", e.target.checked)}
          />
          <span>Show live transcript</span>
        </label>

        <label className="settings-panel__toggle">
          <input
            type="checkbox"
            checked={settings.showLatency}
            onChange={(e) => set("showLatency", e.target.checked)}
          />
          <span>Show latency (development)</span>
        </label>

        <div className="settings-panel__offline">
          <span className="settings-panel__offline-title">Offline models</span>
          <p className="settings-panel__hint">
            Downloads run on-device speech recognition, translation, and voice for your current language
            pair so the app keeps working with no internet. Needs internet once, for this download only.
          </p>
          <ul className="settings-panel__model-list">
            {offline.requiredModels.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          {offline.downloadProgress !== null ? (
            <div className="settings-panel__progress">
              <div className="settings-panel__progress-bar" style={{ width: `${Math.round(offline.downloadProgress * 100)}%` }} />
            </div>
          ) : (
            <button className="controls__btn" onClick={offline.onDownload} disabled={offline.ready}>
              {offline.ready ? "Ready for offline use" : "Download for offline use"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
