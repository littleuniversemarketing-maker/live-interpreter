const SAMPLE_RATE = 24000;

/**
 * The online path gets VAD for free from OpenAI's server_vad. Offline has
 * no server, so this is a simple RMS-threshold detector with hysteresis:
 * cheap, dependency-free, and good enough for a front-desk conversation in
 * a normal room. It will be less robust than a trained VAD model (e.g.
 * Silero VAD) in noisy environments — see README for that as a future
 * upgrade if offline mode gets heavy use somewhere loud.
 */
export class EnergyVAD {
  private speaking = false;
  private silenceMs = 0;
  private speechMs = 0;
  private readonly minSpeechMs = 150; // ignore single-chunk blips
  private threshold = 0.02; // RMS on a -1..1 scale

  constructor(
    private silenceTimeoutMs: number,
    private onSpeechStart: () => void,
    private onSpeechEnd: () => void
  ) {}

  setSilenceTimeoutMs(ms: number) {
    this.silenceTimeoutMs = ms;
  }

  /** Feed one ~40ms chunk of Int16 PCM samples. */
  feed(samples: Int16Array) {
    let sumSquares = 0;
    for (let i = 0; i < samples.length; i++) {
      const norm = samples[i] / 32768;
      sumSquares += norm * norm;
    }
    const rms = Math.sqrt(sumSquares / samples.length);
    const chunkMs = (samples.length / SAMPLE_RATE) * 1000;
    const loud = rms > this.threshold;

    if (loud) {
      this.speechMs += chunkMs;
      this.silenceMs = 0;
      if (!this.speaking && this.speechMs >= this.minSpeechMs) {
        this.speaking = true;
        this.onSpeechStart();
      }
    } else if (this.speaking) {
      this.silenceMs += chunkMs;
      if (this.silenceMs >= this.silenceTimeoutMs) {
        this.speaking = false;
        this.speechMs = 0;
        this.silenceMs = 0;
        this.onSpeechEnd();
      }
    } else {
      this.speechMs = 0;
    }
  }

  isSpeaking() {
    return this.speaking;
  }
}
