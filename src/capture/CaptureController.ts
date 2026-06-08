import * as Native from './native/KillioCapture';
import * as ScreenAudio from '../screen/ScreenCapture';
import * as Speech from '../stt/native/KillioSpeech';
import { CaptureMode, isWithinWindows } from './schedule';
import { VadSegmenter } from '../stt/vad';
import { getSttEngine } from '../stt/engines';
import { enqueueSegment, flushOutbox, localDate, pendingCount } from '../db/outbox';
import { matchWake, type WakeMatch } from '../wakeword/WakeWord';
import { listAgents } from '../agents/local-agent.model';
import {
  getVoiceprint,
  matchesVoiceprint,
  DEFAULT_MATCH_THRESHOLD,
} from '../voiceid/voiceprint';

/**
 * Orchestrates the capture pipeline:
 *   native FGS (PCM frames) → VAD segmenter → STT engine → diary outbox → backend
 *
 * The native foreground service keeps running with the screen locked; this
 * controller is the JS brain that turns frames into transcript segments and
 * periodically flushes them. Schedule windows gate whether the mic is active.
 */
export type CaptureStatus =
  | 'idle'
  | 'listening'
  | 'paused'
  | 'error'
  /** No native capture path on this build (Expo Go) — the loop still runs
   *  for outbox + day-rollover flushes; only the mic is dark. */
  | 'degraded';

/**
 * Which audio source(s) feed the pipeline:
 *   'mic'    — microphone only (default; the legacy behavior)
 *   'system' — device PLAYBACK only (the remote call party / meeting / video),
 *              via MediaProjection + AudioPlaybackCapture (Android 10+)
 *   'both'   — mic + system playback, mixed into the same frame stream so both
 *              local and remote voices are transcribed (meeting transcription)
 */
export type AudioSource = 'mic' | 'system' | 'both';

/**
 * Offline STT model status surfaced to the UI. Mirrors the native
 * onModelStatus event so a banner can show first-run download/prepare progress.
 * null = no model activity (idle or already-ready).
 */
export type ModelStatus = Speech.ModelStatusEvent | null;

export interface CaptureControllerOptions {
  mode: CaptureMode;
  /** Audio source: mic-only (default), system-only, or both. */
  source?: AudioSource;
  /** Called on status changes for the UI. */
  onStatus?: (s: CaptureStatus) => void;
  /** Called on offline-model download/prepare progress for the UI banner. */
  onModelStatus?: (s: ModelStatus) => void;
  /** Flush cadence (ms). */
  flushIntervalMs?: number;
  /** STT language for the native recognizer (default es-ES). */
  language?: string;
}

export class CaptureController {
  private vad = new VadSegmenter();
  private mode: CaptureMode;
  private readonly source: AudioSource;
  private status: CaptureStatus = 'idle';
  private frameSub: { remove(): void } | null = null;
  private errSub: { remove(): void } | null = null;
  private transcriptSub: { remove(): void } | null = null;
  private modelStatusSub: { remove(): void } | null = null;
  /** System-audio (playback) frame/error subscriptions, used when source
   *  includes 'system'. Separate from the mic subs above. */
  private sysFrameSub: { remove(): void } | null = null;
  private sysErrSub: { remove(): void } | null = null;
  private windowTimer: ReturnType<typeof setInterval> | null = null;
  /** Local day last uploaded — drives the end-of-day flush on rollover. */
  private lastFlushDay: string | null = null;
  private readonly onStatus?: (s: CaptureStatus) => void;
  private readonly onModelStatus?: (s: ModelStatus) => void;
  private modelStatus: ModelStatus = null;
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
  /** Fired when a wake phrase is detected in a transcript ("Hey Killio …"). */
  private onWakeCb: ((m: WakeMatch) => void) | null = null;
  /**
   * When the WakeListener has been woken with a bare "Hey Killio" (no inline
   * command), it arms this callback so the NEXT spoken utterance(s) are routed
   * to it as the command — implementing "wake → chime → capture what the human
   * says next → send when they stop talking". Cleared by the listener once the
   * turn is sent (or it times out).
   */
  private onCommandUtteranceCb: ((text: string) => void) | null = null;
  /**
   * Cached owner voiceprint (128-dim x-vector) for offline speaker
   * verification. null = none enrolled → open behavior (anyone can wake).
   * Loaded on start() and refreshable via refreshVoiceprint() after the
   * enrollment UI enrolls/clears, so the gate updates without a restart.
   */
  private voiceprint: number[] | null = null;

  constructor(opts: CaptureControllerOptions) {
    this.mode = opts.mode;
    this.source = opts.source ?? 'mic';
    this.onStatus = opts.onStatus;
    this.onModelStatus = opts.onModelStatus;
    this.flushIntervalMs = opts.flushIntervalMs ?? 30_000;
    this.language = opts.language ?? 'es-ES';
    // SpeechRecognizer only reads the MIC, so it can only serve a mic source.
    // For 'system' or 'both' we must use the AudioRecord+VAD frame path.
    this.useSpeech =
      this.source === 'mic' &&
      Speech.isAvailable() &&
      Speech.isRecognitionAvailable();
  }

  /** True when this controller should capture the microphone. */
  private get wantsMic(): boolean {
    return this.source === 'mic' || this.source === 'both';
  }

  /** True when this controller should capture device playback (system audio). */
  private get wantsSystem(): boolean {
    return this.source === 'system' || this.source === 'both';
  }

  /** Whether any native capture path is usable on this build/device.
   *  HISTORICAL NOTE: callers used to gate `start()` on this returning true so
   *  Expo Go users wouldn't crash. The user explicitly asked Vault to TRY to
   *  start capture regardless — so this is now informational only; both
   *  `CaptureContext` and `start()` treat false as "degraded mode" instead of
   *  "blocked". */
  static nativeReady(): boolean {
    return (
      (Speech.isAvailable() && Speech.isRecognitionAvailable()) ||
      Native.isAvailable()
    );
  }

  getStatus(): CaptureStatus {
    return this.status;
  }

  getModelStatus(): ModelStatus {
    return this.modelStatus;
  }

  private setModelStatus(s: ModelStatus): void {
    this.modelStatus = s;
    this.onModelStatus?.(s);
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
    // Per the user's directive: always TRY to start capture, regardless of
    // build flavor. In Expo Go (or any build where neither native module is
    // present) we degrade to a "degraded" status — the windowTimer + outbox
    // flush + maybeEndOfDayFlush still run, so anything the user types into
    // the assistant still gets diary-flushed; we just don't auto-record.
    // No more throw.
    // Load the enrolled owner voiceprint (if any) so the wake gate can verify
    // the speaker offline. Fire-and-forget — handleTranscript treats a null
    // voiceprint as "open" until it lands.
    void this.refreshVoiceprint();

    const speechOk = Speech.isAvailable() && Speech.isRecognitionAvailable();
    const nativeOk = Native.isAvailable();

    // First-start Doze exemption: if a native capture path exists but the app
    // isn't battery-optimization-exempt, prompt the system dialog once. Without
    // this exemption Android can suspend the foreground service with the screen
    // off and 24/7 capture silently dies. Fire-and-forget — never blocks start.
    if ((speechOk || nativeOk) && !Native.isIgnoringBatteryOptimizations()) {
      void Native.requestIgnoreBatteryOptimizations();
    }

    // System-audio (playback) frames flow through the AudioRecord+VAD path
    // regardless of the mic transcription engine. Subscribe whenever the source
    // wants system audio and the native screen module is present.
    if (this.wantsSystem && ScreenAudio.isAvailable()) {
      this.sysFrameSub = ScreenAudio.onAudioFrame((e) => this.handleFrame(e));
      this.sysErrSub = ScreenAudio.onError(() => this.setStatus('error'));
    }

    if (this.wantsMic && speechOk) {
      this.transcriptSub = Speech.onTranscript((e) => this.handleTranscript(e));
      this.errSub = Speech.onError(() => this.setStatus('error'));
      // Offline model download/prepare progress for the first-run banner. Clear
      // it back to null once ready so the banner hides.
      this.modelStatusSub = Speech.onModelStatus((e) => {
        this.setModelStatus(e.state === 'ready' ? null : e);
      });
    } else if (this.wantsMic && nativeOk) {
      this.frameSub = Native.onAudioFrame((e) => this.handleFrame(e));
      this.errSub = Native.onError(() => this.setStatus('error'));
    } else if (this.wantsSystem && ScreenAudio.isAvailable()) {
      // System-only path is fully wired above; nothing more to set up.
    } else {
      // Degraded mode — capture loop runs but mic is dark. Status stays
      // 'degraded' so the UI can tell the user without blocking them.
      this.setStatus('degraded');
    }

    // Periodic diary flush so transcripts actually show up in the diary soon
    // after they're spoken (not only before an agent call / end of day).
    // Every tick (60s) we flush any pending segments — ingest is idempotent +
    // cheap, and this keeps the diary near-live. Also flushed before agent
    // calls (flushNow) and on day rollover (maybeEndOfDayFlush).
    this.lastFlushDay = localDate(Date.now());
    this.windowTimer = setInterval(() => {
      void this.maybeEndOfDayFlush();
      void this.evaluateWindow();
      try {
        if (pendingCount() > 0) void flushOutbox();
      } catch { /* ignore */ }
    }, 60_000);
    await this.evaluateWindow();
  }

  async stop(): Promise<void> {
    if (this.windowTimer) clearInterval(this.windowTimer);
    this.windowTimer = null;
    this.frameSub?.remove();
    this.errSub?.remove();
    this.transcriptSub?.remove();
    this.modelStatusSub?.remove();
    this.sysFrameSub?.remove();
    this.sysErrSub?.remove();
    this.frameSub = this.errSub = this.transcriptSub = null;
    this.modelStatusSub = null;
    this.sysFrameSub = this.sysErrSub = null;
    this.setModelStatus(null);
    if (this.wantsMic) {
      if (this.useSpeech) {
        await Speech.stop();
      } else {
        this.flushFinalUtterance();
        await Native.stop();
      }
    } else {
      // System-only: still flush any VAD tail captured from playback frames.
      this.flushFinalUtterance();
    }
    if (this.wantsSystem && ScreenAudio.isAvailable()) {
      await ScreenAudio.stopSystemAudioCapture();
    }
    await flushOutbox();
    this.setStatus('idle');
  }

  /** Starts/stops the native recognizer/mic based on the active schedule window. */
  private async evaluateWindow(): Promise<void> {
    const active = isWithinWindows(this.mode, new Date());
    if (active && this.status !== 'listening') {
      if (this.wantsMic) {
        if (this.useSpeech) {
          await Speech.start({ language: this.language });
        } else {
          await Native.start({ notificationText: 'Killio Vault is listening' });
        }
      }
      if (this.wantsSystem && ScreenAudio.isAvailable()) {
        // Reuses the MediaProjection consent; prompts once if not yet granted.
        try {
          await ScreenAudio.startSystemAudioCapture({
            sampleRate: 16_000,
            frameSamples: 320,
            notificationText: 'Killio Vault is capturing call audio',
          });
        } catch {
          // Consent denied / unavailable — degrade rather than fail the window.
          if (!this.wantsMic) this.setStatus('degraded');
        }
      }
      if (this.status !== 'degraded') this.setStatus('listening');
    } else if (!active && this.status === 'listening') {
      if (this.wantsMic) {
        if (this.useSpeech) {
          await Speech.stop();
        } else {
          this.flushFinalUtterance();
          await Native.stop();
        }
      }
      if (this.wantsSystem && ScreenAudio.isAvailable()) {
        await ScreenAudio.stopSystemAudioCapture();
      }
      this.setStatus('paused');
    }
  }

  /** Register a wake-phrase handler ("Hey Killio …"). */
  setOnWake(cb: ((m: WakeMatch) => void) | null): void {
    this.onWakeCb = cb;
  }

  /**
   * Reload the cached owner voiceprint from storage. Call after the enrollment
   * UI enrolls or clears a voice so the wake gate updates live (no restart).
   */
  async refreshVoiceprint(): Promise<void> {
    try {
      this.voiceprint = await getVoiceprint();
    } catch {
      this.voiceprint = null;
    }
  }

  /**
   * Arm/disarm capture of the next plain utterance as a wake command. While
   * armed, transcripts that do NOT themselves contain a wake phrase are routed
   * to `cb` (instead of only being diary-enqueued). Pass null to disarm.
   */
  setOnCommandUtterance(cb: ((text: string) => void) | null): void {
    this.onCommandUtteranceCb = cb;
  }

  /** Native SpeechRecognizer transcript → diary outbox + wake-phrase scan. */
  private handleTranscript(e: Speech.TranscriptEvent): void {
    if (this.muted) return;
    const text = e.text?.trim();
    if (!text) return;

    // Offline speaker verification. When an owner voiceprint is enrolled AND
    // this utterance carries an x-vector, decide whether it's the owner.
    //   - voiceprint enrolled + spk present → isOwner = cosine match
    //   - voiceprint enrolled + spk missing → isOwner = false (can't verify →
    //     don't let an unverifiable utterance wake the assistant)
    //   - no voiceprint enrolled            → isOwner = true (open, opt-in)
    const enrolled = !!this.voiceprint;
    let isOwner = true;
    if (enrolled) {
      isOwner =
        Array.isArray(e.spk) && e.spk.length > 0
          ? matchesVoiceprint(e.spk, this.voiceprint!, DEFAULT_MATCH_THRESHOLD)
          : false;
    }

    // Diary captures ALL speech regardless of speaker. We tag non-owner
    // segments via the source suffix so the diary can optionally distinguish
    // them, without changing the outbox schema or upload path.
    enqueueSegment({
      text,
      ts: e.ts,
      source: enrolled && !isOwner ? 'android_speech:guest' : 'android_speech',
    });

    // Wake detection (JS, over the free local transcripts).
    const names = listAgents()
      .map((a) => a.wakePhrase || a.name)
      .filter(Boolean);
    const m = this.onWakeCb ? matchWake(text, names) : null;
    if (m) {
      // Owner-only gate: when a voiceprint is enrolled, only the owner's voice
      // may fire the wake action. With nothing enrolled, isOwner stays true.
      if (!isOwner) {
        console.log(`[KillioWake] suppressed (not owner) phrase="${m.phrase}" from="${text}"`);
      } else {
        console.log(`[KillioWake] matched phrase="${m.phrase}" command="${m.command}" from="${text}"`);
        this.onWakeCb!(m);
      }
      return;
    }

    // Post-wake command capture: when armed (after a bare "Hey Killio"), the
    // next utterance that is NOT itself a wake phrase is the user's command.
    if (this.onCommandUtteranceCb) {
      this.onCommandUtteranceCb(text);
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
