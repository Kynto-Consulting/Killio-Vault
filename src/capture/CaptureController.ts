import * as Native from './native/KillioCapture';
import * as Speech from '../stt/native/KillioSpeech';
import { CaptureMode, isWithinWindows } from './schedule';
import { VadSegmenter } from '../stt/vad';
import { getSttEngine } from '../stt/engines';
import { enqueueSegment, flushOutbox, localDate } from '../db/outbox';

/**
 * Orchestrates the capture pipeline:
 *   native FGS (PCM frames) → VAD segmenter → STT engine → diary outbox → backend
 *
 * The native foreground service keeps running with the screen locked; this
 * controller is the JS brain that turns frames into transcript segments and
 * periodically flushes them. Schedule windows gate whether the mic is active.
 */
export type CaptureStatus = 'idle' | 'listening' | 'paused' | 'error';

export interface CaptureControllerOptions {
  mode: CaptureMode;
  /** Called on status changes for the UI. */
  onStatus?: (s: CaptureStatus) => void;
  /** Flush cadence (ms). */
  flushIntervalMs?: number;
  /** STT language for the native recognizer (default es-ES). */
  language?: string;
}

export class CaptureController {
  private vad = new VadSegmenter();
  private mode: CaptureMode;
  private status: CaptureStatus = 'idle';
  private frameSub: { remove(): void } | null = null;
  private errSub: { remove(): void } | null = null;
  private transcriptSub: { remove(): void } | null = null;
  private windowTimer: ReturnType<typeof setInterval> | null = null;
  /** Local day last uploaded — drives the end-of-day flush on rollover. */
  private lastFlushDay: string | null = null;
  private readonly onStatus?: (s: CaptureStatus) => void;
  private readonly flushIntervalMs: number;
  private readonly language: string;
  /**
   * Default transcription path: Android's free on-device SpeechRecognizer (no
   * credentials, no model download). Falls back to AudioRecord+VAD+engine only
   * when the recognizer isn't present.
   */
  private readonly useSpeech: boolean;
  /** True while TTS is speaking — ducks capture to avoid self-recording. */
  private muted = false;

  constructor(opts: CaptureControllerOptions) {
    this.mode = opts.mode;
    this.onStatus = opts.onStatus;
    this.flushIntervalMs = opts.flushIntervalMs ?? 30_000;
    this.language = opts.language ?? 'es-ES';
    this.useSpeech = Speech.isAvailable() && Speech.isRecognitionAvailable();
  }

  /** Whether any native capture path is usable on this build/device. */
  static nativeReady(): boolean {
    return (
      (Speech.isAvailable() && Speech.isRecognitionAvailable()) ||
      Native.isAvailable()
    );
  }

  getStatus(): CaptureStatus {
    return this.status;
  }

  setMode(mode: CaptureMode): void {
    this.mode = mode;
    this.evaluateWindow();
  }

  /** Duck capture during TTS playback (see plan F). */
  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  private setStatus(s: CaptureStatus): void {
    this.status = s;
    this.onStatus?.(s);
  }

  async start(): Promise<void> {
    if (!CaptureController.nativeReady()) {
      this.setStatus('error');
      throw new Error(
        'Audio capture needs the dev-build APK (foreground service). Expo Go cannot record in background.',
      );
    }

    if (this.useSpeech) {
      this.transcriptSub = Speech.onTranscript((e) => this.handleTranscript(e));
      this.errSub = Speech.onError(() => this.setStatus('error'));
    } else {
      this.frameSub = Native.onAudioFrame((e) => this.handleFrame(e));
      this.errSub = Native.onError(() => this.setStatus('error'));
    }

    // NO continuous upload. Transcripts stay local; they are flushed to the
    // server only (1) right before an agent call (see CaptureController.flushNow
    // / assistant) and (2) on day rollover (end of day). This timer also drives
    // the schedule-window start/stop.
    this.lastFlushDay = localDate(Date.now());
    this.windowTimer = setInterval(() => {
      void this.maybeEndOfDayFlush();
      void this.evaluateWindow();
    }, 60_000);
    await this.evaluateWindow();
  }

  async stop(): Promise<void> {
    if (this.windowTimer) clearInterval(this.windowTimer);
    this.windowTimer = null;
    this.frameSub?.remove();
    this.errSub?.remove();
    this.transcriptSub?.remove();
    this.frameSub = this.errSub = this.transcriptSub = null;
    if (this.useSpeech) {
      await Speech.stop();
    } else {
      this.flushFinalUtterance();
      await Native.stop();
    }
    await flushOutbox();
    this.setStatus('idle');
  }

  /** Starts/stops the native recognizer/mic based on the active schedule window. */
  private async evaluateWindow(): Promise<void> {
    const active = isWithinWindows(this.mode, new Date());
    if (active && this.status !== 'listening') {
      if (this.useSpeech) {
        await Speech.start({ language: this.language });
      } else {
        await Native.start({ notificationText: 'Killio Vault is listening' });
      }
      this.setStatus('listening');
    } else if (!active && this.status === 'listening') {
      if (this.useSpeech) {
        await Speech.stop();
      } else {
        this.flushFinalUtterance();
        await Native.stop();
      }
      this.setStatus('paused');
    }
  }

  /** Native SpeechRecognizer transcript → straight to the diary outbox (local). */
  private handleTranscript(e: Speech.TranscriptEvent): void {
    if (this.muted) return;
    if (e.text?.trim()) {
      enqueueSegment({ text: e.text, ts: e.ts, source: 'android_speech' });
    }
  }

  /**
   * Uploads pending transcripts now. Called (1) before an agent turn so the
   * server diary + tts_search are current, and (2) by stop(). Idempotent.
   */
  async flushNow(): Promise<number> {
    const n = await flushOutbox();
    this.lastFlushDay = localDate(Date.now());
    return n;
  }

  /** Flush once when the local calendar day rolls over (end-of-day finalize). */
  private async maybeEndOfDayFlush(): Promise<void> {
    const today = localDate(Date.now());
    if (this.lastFlushDay && this.lastFlushDay !== today) {
      await flushOutbox(); // uploads the previous day's remaining segments
      this.lastFlushDay = today;
    }
  }

  private handleFrame(e: Native.AudioFrameEvent): void {
    if (this.muted) return;
    const frame = Int16Array.from(e.samples);
    const utt = this.vad.push(frame, e.ts);
    if (utt) void this.transcribeAndQueue(utt.pcm, utt.startedAt, e.sampleRate);
  }

  private flushFinalUtterance(): void {
    const tail = this.vad.flush();
    if (tail) void this.transcribeAndQueue(tail.pcm, tail.startedAt, 16_000);
  }

  private async transcribeAndQueue(
    pcm: Int16Array,
    startedAt: number,
    sampleRate: number,
  ): Promise<void> {
    try {
      const engine = getSttEngine();
      const text = await engine.transcribe({ pcm, sampleRate, startedAt });
      if (text.trim()) {
        enqueueSegment({ text, ts: startedAt, source: engine.name });
      }
    } catch {
      // Drop this utterance; capture continues.
    }
  }
}
