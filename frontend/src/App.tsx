import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LanguageSelector } from "./components/LanguageSelector";
import { StatusDisplay } from "./components/StatusDisplay";
import { Transcript } from "./components/Transcript";
import { Controls } from "./components/Controls";
import { SettingsPanel, type Settings } from "./components/SettingsPanel";
import { useAudioPipeline } from "./hooks/useAudioPipeline";
import { useInterpreterSocket } from "./hooks/useInterpreterSocket";
import { useOfflineInterpreter } from "./hooks/useOfflineInterpreter";
import { modelsForPair } from "./offline/offlineModels";
import { langMeta } from "./languages";
import type { ConversationTurn, InterpreterState, LanguageCode, ServerToClientMessage } from "./types";

const DEFAULT_SETTINGS: Settings = {
  mode: "one-way",
  micDeviceId: undefined,
  speakerDeviceId: undefined,
  silenceTimeoutMs: 700,
  outputVolume: 1,
  autoDetect: false,
  showTranscript: true,
  showLatency: false,
  duckMicDuringPlayback: false,
};

// How long the socket can sit in "reconnecting" before we give up on the
// cloud and fall back to the on-device pipeline (user chose: online by
// default, auto-switch to offline if internet drops).
const OFFLINE_FALLBACK_DELAY_MS = 5000;

export default function App() {
  const [langA, setLangA] = useState<LanguageCode>("ja");
  const [langB, setLangB] = useState<LanguageCode>("en");
  const [voiceA, setVoiceA] = useState(langMeta("ja").defaultVoice);
  const [voiceB, setVoiceB] = useState(langMeta("en").defaultVoice);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<"A" | "B">("A");
  const [state, setState] = useState<InterpreterState>("IDLE");
  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [micPermissionError, setMicPermissionError] = useState<string | null>(null);
  const [transport, setTransport] = useState<"online" | "offline">("online");

  const speechEndedAtRef = useRef<number>(0);
  const currentTurnIdRef = useRef<string | null>(null);
  const transportRef = useRef<"online" | "offline">("online");
  const activeSpeakerRef = useRef<"A" | "B">("A");
  const offlineFallbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    activeSpeakerRef.current = activeSpeaker;
  }, [activeSpeaker]);

  const handleServerMessage = useCallback(
    (msg: ServerToClientMessage) => {
      switch (msg.type) {
        case "status":
          setState(msg.state);
          break;

        case "lifecycle":
          if (msg.event.type === "speech_stopped") {
            speechEndedAtRef.current = performance.now();
          }
          if (msg.event.type === "interrupted") {
            audioPipeline.interruptPlayback();
          }
          break;

        case "transcript": {
          const id = `${msg.event.speaker}-${Date.now()}`;
          currentTurnIdRef.current = id;
          setTurns((prev) => [
            ...prev,
            {
              id,
              speaker: msg.event.speaker,
              sourceLang: msg.event.sourceLang,
              targetLang: msg.event.speaker === "A" ? langB : langA,
              sourceText: msg.event.text,
              translatedText: "",
              final: false,
              timestamp: Date.now(),
            },
          ]);
          break;
        }

        case "translation": {
          const id = currentTurnIdRef.current;
          setTurns((prev) => {
            if (prev.length === 0) return prev;
            const idx = id ? prev.findIndex((t) => t.id === id) : prev.length - 1;
            if (idx === -1) return prev;
            const copy = [...prev];
            copy[idx] = {
              ...copy[idx],
              translatedText: msg.event.isFinal
                ? msg.event.translatedText
                : copy[idx].translatedText + msg.event.translatedText,
              final: msg.event.isFinal,
            };
            return copy;
          });
          if (speechEndedAtRef.current) {
            setLatencyMs(performance.now() - speechEndedAtRef.current);
          }
          break;
        }

        case "audio":
          audioPipeline.enqueuePlayback(msg.event.audioBase64, settings.outputVolume);
          break;

        case "error":
          setErrorBanner(msg.event.message);
          if (msg.event.recoverable) {
            setTimeout(() => setErrorBanner(null), 5000);
          }
          break;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [langA, langB, settings.outputVolume]
  );

  const socket = useInterpreterSocket(handleServerMessage);
  const offlineInterpreter = useOfflineInterpreter(handleServerMessage);
  const audioPipeline = useAudioPipeline();

  const switchToOffline = useCallback(
    (reason: string) => {
      if (transportRef.current === "offline") return;
      transportRef.current = "offline";
      setTransport("offline");
      setErrorBanner(reason);
      socket.disconnect();
      offlineInterpreter.start(settings.mode, langA, langB, settings.silenceTimeoutMs);
    },
    [socket, offlineInterpreter, settings.mode, settings.silenceTimeoutMs, langA, langB]
  );

  // Auto-fallback: if the socket sits in "reconnecting" too long while a
  // conversation is running, hand off to the on-device pipeline rather than
  // leaving the app stuck (section 16 + the user's chosen online-first,
  // auto-switch-offline behavior).
  useEffect(() => {
    if (running && transport === "online" && socket.reconnecting) {
      offlineFallbackTimer.current = setTimeout(() => {
        switchToOffline("Connection lost — switched to offline mode running on this device.");
      }, OFFLINE_FALLBACK_DELAY_MS);
    }
    return () => {
      if (offlineFallbackTimer.current) clearTimeout(offlineFallbackTimer.current);
    };
  }, [running, transport, socket.reconnecting, switchToOffline]);

  const handleStart = useCallback(async () => {
    setErrorBanner(null);
    setMicPermissionError(null);

    const startOffline = !navigator.onLine;
    transportRef.current = startOffline ? "offline" : "online";
    setTransport(transportRef.current);

    try {
      // A single persistent onAudioChunk callback, routed by ref so a mid-
      // conversation transport switch (or a speaker switch in two-way mode)
      // doesn't require re-registering the audio worklet's message handler.
      await audioPipeline.start(settings.micDeviceId, {
        duckMicDuringPlayback: settings.duckMicDuringPlayback,
        onAudioChunk: (base64) => {
          if (transportRef.current === "online") {
            socket.send({ type: "audio_chunk", speaker: activeSpeakerRef.current, audioBase64: base64 });
          } else {
            offlineInterpreter.processAudioChunk(activeSpeakerRef.current, base64);
          }
        },
      });

      if (transportRef.current === "online") {
        socket.connect();
        socket.send({
          type: "start",
          mode: settings.mode,
          speakerA: langA,
          speakerB: langB,
          voiceA,
          voiceB,
          silenceTimeoutMs: settings.silenceTimeoutMs,
          autoDetect: settings.autoDetect,
        });
      } else {
        if (!offlineInterpreter.modelsReady) {
          setErrorBanner(
            "You're offline and the on-device models for this language pair aren't downloaded yet. Connect once and download them from Settings."
          );
        }
        offlineInterpreter.start(settings.mode, langA, langB, settings.silenceTimeoutMs);
      }

      setRunning(true);
      setPaused(false);
    } catch (err: any) {
      if (err?.name === "NotAllowedError") {
        setMicPermissionError(
          "Microphone access was denied. Allow microphone access in your browser's site settings and press Start again."
        );
      } else if (err?.name === "NotFoundError") {
        setMicPermissionError("No microphone was found. Connect a microphone and press Start again.");
      } else {
        setMicPermissionError(`Could not start the microphone: ${err?.message ?? err}`);
      }
    }
  }, [socket, audioPipeline, offlineInterpreter, settings, langA, langB, voiceA, voiceB]);

  const handleStop = useCallback(() => {
    socket.send({ type: "stop" });
    socket.disconnect();
    offlineInterpreter.stop();
    audioPipeline.stop();
    audioPipeline.interruptPlayback();
    setRunning(false);
    setPaused(false);
    setState("IDLE");
    setTransport("online");
    transportRef.current = "online";
  }, [socket, audioPipeline, offlineInterpreter]);

  const handlePauseToggle = useCallback(() => {
    socket.send({ type: paused ? "resume" : "pause" });
    setPaused((p) => !p);
  }, [socket, paused]);

  const handleSwitchLanguages = useCallback(() => {
    setLangA(langB);
    setLangB(langA);
    setVoiceA(voiceB);
    setVoiceB(voiceA);
  }, [langA, langB, voiceA, voiceB]);

  const handleSwitchSpeaker = useCallback(() => {
    const next = activeSpeaker === "A" ? "B" : "A";
    setActiveSpeaker(next);
    socket.send({ type: "switch_speaker", speaker: next });
  }, [activeSpeaker, socket]);

  const handleMuteToggle = useCallback(() => {
    setMuted((m) => {
      socket.send({ type: "mute_output", muted: !m });
      return !m;
    });
  }, [socket]);

  const handleClear = useCallback(() => {
    setTurns([]);
    socket.send({ type: "clear" });
  }, [socket]);

  const requiredOfflineModels = useMemo(() => {
    const forward = modelsForPair(langA, langB);
    const backward = settings.mode === "two-way" ? modelsForPair(langB, langA) : [];
    return Array.from(new Set([...forward, ...backward]));
  }, [langA, langB, settings.mode]);

  const handleDownloadOfflineModels = useCallback(() => {
    offlineInterpreter.preload(langA, langB);
    if (settings.mode === "two-way") offlineInterpreter.preload(langB, langA);
  }, [offlineInterpreter, langA, langB, settings.mode]);

  return (
    <div className="app">
      <header className="app__header">
        <h1>Real-Time Interpreter</h1>
        {socket.reconnecting && transport === "online" && (
          <span className="app__reconnect-badge">Reconnecting…</span>
        )}
      </header>

      {running && (
        <span className={`app__transport-badge ${transport === "offline" ? "app__transport-badge--offline" : ""}`}>
          {transport === "offline" ? "Offline — running on-device" : "Online"}
        </span>
      )}

      {micPermissionError && <div className="banner banner--error">{micPermissionError}</div>}
      {errorBanner && <div className="banner banner--warning">{errorBanner}</div>}

      <div className="app__selectors">
        <LanguageSelector
          label="Person A"
          accentVar="--accent-a"
          lang={langA}
          voice={voiceA}
          disabled={running}
          onLangChange={setLangA}
          onVoiceChange={setVoiceA}
        />
        <LanguageSelector
          label="Person B"
          accentVar="--accent-b"
          lang={langB}
          voice={voiceB}
          disabled={running}
          onLangChange={setLangB}
          onVoiceChange={setVoiceB}
        />
      </div>

      <StatusDisplay
        state={state}
        micLevel={audioPipeline.micLevel}
        latencyMs={latencyMs}
        showLatency={settings.showLatency}
      />

      <Controls
        running={running}
        paused={paused}
        muted={muted}
        mode={settings.mode}
        activeSpeaker={activeSpeaker}
        onStart={handleStart}
        onStop={handleStop}
        onPauseToggle={handlePauseToggle}
        onSwitchLanguages={handleSwitchLanguages}
        onSwitchSpeaker={handleSwitchSpeaker}
        onClear={handleClear}
        onMuteToggle={handleMuteToggle}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <Transcript turns={turns} visible={settings.showTranscript} />

      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        onChange={setSettings}
        onClose={() => setSettingsOpen(false)}
        offline={{
          requiredModels: requiredOfflineModels,
          ready: offlineInterpreter.modelsReady,
          downloadProgress: offlineInterpreter.downloadProgress,
          onDownload: handleDownloadOfflineModels,
        }}
      />
    </div>
  );
}
