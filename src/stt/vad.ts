/**
 * Energy-based voice-activity detector / segmenter. Pure + deterministic so it
 * can be unit-tested without audio hardware. Feed fixed-size PCM frames; it
 * emits an utterance boundary after enough trailing silence following speech.
 *
 * This is intentionally simple (RMS threshold + hangover). The native capture
 * layer delivers 16-bit mono frames; a real build may swap in a WebRTC/Silero
 * VAD behind the same interface.
 */
export interface VadConfig {
  sampleRate: number;
  /** Frame size in samples (e.g. 320 = 20ms @ 16kHz). */
  frameSamples: number;
  /** RMS (0..1) above which a frame counts as speech. */
  speechThreshold: number;
  /** Trailing silence (ms) that closes an utterance. */
  silenceMs: number;
  /** Minimum utterance length (ms) to emit (drops blips). */
  minUtteranceMs: number;
  /** Max utterance length (ms) before a forced cut. */
  maxUtteranceMs: number;
}

export const DEFAULT_VAD: VadConfig = {
  sampleRate: 16_000,
  frameSamples: 320,
  speechThreshold: 0.02,
  silenceMs: 800,
  minUtteranceMs: 400,
  maxUtteranceMs: 20_000,
};

export interface VadUtterance {
  pcm: Int16Array;
  startedAt: number;
}

export function rms(frame: Int16Array): number {
  if (frame.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) {
    const s = frame[i] / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / frame.length);
}

export class VadSegmenter {
  private readonly cfg: VadConfig;
  private buf: number[] = [];
  private speaking = false;
  private silenceRun = 0; // ms of trailing silence
  private startedAt = 0;

  constructor(cfg: Partial<VadConfig> = {}) {
    this.cfg = { ...DEFAULT_VAD, ...cfg };
  }

  private frameMs(): number {
    return (this.cfg.frameSamples / this.cfg.sampleRate) * 1000;
  }

  private currentMs(): number {
    return (this.buf.length / this.cfg.sampleRate) * 1000;
  }

  /**
   * Pushes one frame. `nowTs` is the UTC epoch ms for the frame start. Returns a
   * finalized utterance when a boundary is reached, else null.
   */
  push(frame: Int16Array, nowTs: number): VadUtterance | null {
    const isSpeech = rms(frame) >= this.cfg.speechThreshold;

    if (!this.speaking) {
      if (isSpeech) {
        this.speaking = true;
        this.silenceRun = 0;
        this.startedAt = nowTs;
        for (let i = 0; i < frame.length; i++) this.buf.push(frame[i]);
      }
      return null;
    }

    for (let i = 0; i < frame.length; i++) this.buf.push(frame[i]);
    this.silenceRun = isSpeech ? 0 : this.silenceRun + this.frameMs();

    const longEnough = this.currentMs() >= this.cfg.maxUtteranceMs;
    const settled = this.silenceRun >= this.cfg.silenceMs;
    if (settled || longEnough) return this.flush();
    return null;
  }

  /** Forces emission of the buffered utterance (e.g. on stop). */
  flush(): VadUtterance | null {
    if (!this.speaking) return null;
    const pcm = Int16Array.from(this.buf);
    const startedAt = this.startedAt;
    const durationMs = (pcm.length / this.cfg.sampleRate) * 1000;
    this.reset();
    if (durationMs < this.cfg.minUtteranceMs) return null;
    return { pcm, startedAt };
  }

  reset(): void {
    this.buf = [];
    this.speaking = false;
    this.silenceRun = 0;
    this.startedAt = 0;
  }
}
