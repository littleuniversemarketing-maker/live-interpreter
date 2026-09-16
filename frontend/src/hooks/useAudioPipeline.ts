import { useCallback, useRef, useState } from "react";

const CAPTURE_SAMPLE_RATE = 24000; // matches OpenAI Realtime's PCM16 24kHz expectation

// Runs off the main thread so audio capture doesn't stall on React renders.
// Downsamples to 24kHz and converts Float32 -> PCM16, then posts base64
// chunks back to the main thread roughly every ~40ms for low latency.
const WORKLET_SOURCE = `
class PcmDownsamplerProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.inputSampleRate = sampleRate;
    this.targetSampleRate = options.processorOptions.targetSampleRate;
    this.ratio = this.inputSampleRate / this.targetSampleRate;
    this.buffer = [];
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    const channel = input[0];
    for (let i = 0; i < channel.length; i += this.ratio) {
      const idx = Math.floor(i);
      this.buffer.push(channel[idx] ?? 0);
    }
    if (this.buffer.length >= 960) { // ~40ms at 24kHz
      const pcm16 = new Int16Array(this.buffer.length);
      for (let i = 0; i < this.buffer.length; i++) {
        const s = Math.max(-1, Math.min(1, this.buffer[i]));
        pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(pcm16.buffer, [pcm16.buffer]);
      this.buffer = [];
    }
    return true;
  }
}
registerProcessor("pcm-downsampler", PcmDownsamplerProcessor);
`;

function base64FromArrayBuffer(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function pcm16Base64ToAudioBuffer(base64: string, ctx: AudioContext): AudioBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const view = new DataView(bytes.buffer);
  const sampleCount = bytes.length / 2;
  const audioBuffer = ctx.createBuffer(1, sampleCount, CAPTURE_SAMPLE_RATE);
  const channel = audioBuffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i++) {
    channel[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return audioBuffer;
}

export interface AudioPipelineOptions {
  onAudioChunk: (base64: string) => void;
  /** Duck (not mute) mic input gain while translated audio is playing —
   *  an extra layer on top of browser echo cancellation, useful mainly
   *  when the user isn't on headphones (section 8). */
  duckMicDuringPlayback: boolean;
}

export function useAudioPipeline() {
  const [isCapturing, setIsCapturing] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const micGainRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const playbackQueueTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const outputGainRef = useRef<GainNode | null>(null);

  const start = useCallback(
    async (deviceId: string | undefined, opts: AudioPipelineOptions) => {
      const ctx = new AudioContext({ sampleRate: 48000 });
      audioContextRef.current = ctx;

      // Section 8: echo cancellation, noise suppression, and automatic
      // gain control are requested directly from the browser's mic
      // constraints — this is the primary defense against the app
      // hearing its own translated voice.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;

      const source = ctx.createMediaStreamSource(stream);
      const micGain = ctx.createGain();
      micGain.gain.value = 1.0;
      micGainRef.current = micGain;

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyserRef.current = analyser;

      const blob = new Blob([WORKLET_SOURCE], { type: "application/javascript" });
      const workletUrl = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(workletUrl);

      const worklet = new AudioWorkletNode(ctx, "pcm-downsampler", {
        processorOptions: { targetSampleRate: CAPTURE_SAMPLE_RATE },
      });
      workletNodeRef.current = worklet;

      worklet.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
        opts.onAudioChunk(base64FromArrayBuffer(event.data));
      };

      source.connect(micGain);
      micGain.connect(analyser);
      analyser.connect(worklet);
      // Deliberately not connected to ctx.destination — we never want to
      // monitor the raw mic locally, which would itself be a feedback path.

      const outputGain = ctx.createGain();
      outputGain.gain.value = 1.0;
      outputGain.connect(ctx.destination);
      outputGainRef.current = outputGain;
      playbackQueueTimeRef.current = ctx.currentTime;

      const levelLoop = () => {
        if (!analyserRef.current) return;
        const data = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        setMicLevel(avg / 255);

        // Playback-aware ducking (section 8): while translated audio is
        // playing, reduce mic sensitivity so the speaker output is less
        // likely to be picked back up as new input.
        if (micGainRef.current) {
          const target = opts.duckMicDuringPlayback && activeSourcesRef.current.length > 0 ? 0.15 : 1.0;
          micGainRef.current.gain.setTargetAtTime(target, ctx.currentTime, 0.05);
        }
        requestAnimationFrame(levelLoop);
      };
      requestAnimationFrame(levelLoop);

      setIsCapturing(true);
    },
    []
  );

  const stop = useCallback(() => {
    workletNodeRef.current?.disconnect();
    micGainRef.current?.disconnect();
    analyserRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    audioContextRef.current?.close();
    audioContextRef.current = null;
    setIsCapturing(false);
  }, []);

  /** Enqueues a base64 PCM16/24kHz chunk for gapless sequential playback (section 7). */
  const enqueuePlayback = useCallback((base64: string, outputVolume: number) => {
    const ctx = audioContextRef.current;
    if (!ctx) return;
    const buffer = pcm16Base64ToAudioBuffer(base64, ctx);
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    if (outputGainRef.current) outputGainRef.current.gain.value = outputVolume;
    src.connect(outputGainRef.current ?? ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now, playbackQueueTimeRef.current);
    src.start(startAt);
    playbackQueueTimeRef.current = startAt + buffer.duration;

    activeSourcesRef.current.push(src);
    setIsPlaying(true);
    src.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== src);
      if (activeSourcesRef.current.length === 0) setIsPlaying(false);
    };
  }, []);

  /** Immediately stops all queued/playing translated audio (interruption, section 14). */
  const interruptPlayback = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
    activeSourcesRef.current = [];
    if (audioContextRef.current) playbackQueueTimeRef.current = audioContextRef.current.currentTime;
    setIsPlaying(false);
  }, []);

  return { start, stop, enqueuePlayback, interruptPlayback, isCapturing, isPlaying, micLevel };
}
