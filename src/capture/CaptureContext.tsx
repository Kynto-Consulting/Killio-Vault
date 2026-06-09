import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { CaptureController, CaptureStatus, ModelStatus } from './CaptureController';
import { CaptureMode } from './schedule';
import {
  getCaptureMode,
  setCaptureMode,
  getSttLanguage,
  setSttLanguage,
  type SttLanguage,
} from '../settings/settings-store';
import { pendingCount, flushOutbox } from '../db/outbox';
import { hasMicrophone, requestCapturePermissions } from './permissions';

interface CaptureState {
  status: CaptureStatus;
  /** Offline STT model download/prepare progress (null = ready/idle). */
  modelStatus: ModelStatus;
  mode: CaptureMode;
  /** Offline STT recognition language (es-ES / en-US). */
  sttLanguage: SttLanguage;
  nativeAvailable: boolean;
  pending: number;
  setMode(mode: CaptureMode): Promise<void>;
  /** Change the STT recognition language; persists + restarts capture so the
   *  matching offline model loads (downloaded on first use of a language). */
  setSttLang(lang: SttLanguage): Promise<void>;
  refreshPending(): void;
  /** Duck capture while TTS speaks. */
  setMuted(muted: boolean): void;
  /** Upload pending transcripts now (call before an agent turn). */
  flushNow(): Promise<void>;
  /** Register a wake-phrase handler ("Hey Killio …"). */
  setOnWake(cb: ((m: import('../wakeword/WakeWord').WakeMatch) => void) | null): void;
  /** Arm capture of the next utterance as a wake command (post-wake). */
  setOnCommandUtterance(cb: ((text: string) => void) | null): void;
  /** Reload the owner voiceprint into the running controller (after enroll/clear). */
  refreshVoiceprint(): void;
  /** Re-push wake keywords to the native spotter after the agent list changes. */
  reloadKeywords(): void;
}

const Ctx = createContext<CaptureState | null>(null);

export function CaptureProvider({ children }: { children: React.ReactNode }) {
  const controllerRef = useRef<CaptureController | null>(null);
  const wakeCbRef = useRef<((m: any) => void) | null>(null);
  const cmdCbRef = useRef<((text: string) => void) | null>(null);
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [modelStatus, setModelStatus] = useState<ModelStatus>(null);
  const [mode, setModeState] = useState<CaptureMode>({ kind: 'off' });
  const [sttLanguage, setSttLanguageState] = useState<SttLanguage>('es-ES');
  /** Live language used when (re)building the controller. Mirrors sttLanguage
   *  but read synchronously inside async closures without a stale-state race. */
  const langRef = useRef<SttLanguage>('es-ES');
  const [pending, setPending] = useState(0);
  const nativeAvailable = CaptureController.nativeReady();

  useEffect(() => {
    (async () => {
      const saved = await getCaptureMode();
      setModeState(saved);
      const lang = await getSttLanguage();
      langRef.current = lang;
      setSttLanguageState(lang);
      const controller = new CaptureController({
        mode: saved,
        language: lang,
        onStatus: setStatus,
        onModelStatus: setModelStatus,
      });
      controllerRef.current = controller;
      controller.setOnWake(wakeCbRef.current); // apply handler registered before creation
      controller.setOnCommandUtterance(cmdCbRef.current);
      // Per user directive: always try to start capture regardless of build
      // flavor. The controller itself drops into a 'degraded' status when no
      // native module is present, so the timer + outbox flush keep running.
      // BUT: a microphone-typed foreground service requires RECORD_AUDIO
      // granted at runtime — starting it without the permission throws a
      // SecurityException that crashes the whole app on a fresh install. So we
      // request the mic permission first and only start the FGS once granted;
      // if denied, start in degraded mode (no service, no crash). The native
      // services also guard defensively (stopSelf if the permission is gone).
      if (saved.kind !== 'off') {
        try {
          const hasMic = await hasMicrophone();
          const granted = hasMic
            ? true
            : (await requestCapturePermissions()).microphone;
          if (granted) {
            await controller.start();
          } else {
            setStatus('degraded');
          }
        } catch {
          setStatus('error');
        }
      }
      setPending(safePending());
    })();
    return () => {
      void controllerRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setMode = async (next: CaptureMode) => {
    setModeState(next);
    await setCaptureMode(next);
    const controller = controllerRef.current;
    if (!controller) return;
    if (next.kind === 'off') {
      await controller.stop();
    } else {
      // Mic permission required before the microphone FGS can start (else
      // SecurityException/crash). Request on activation; degrade if denied.
      const hasMic = await hasMicrophone();
      const granted = hasMic ? true : (await requestCapturePermissions()).microphone;
      if (granted && (controller.getStatus() === 'idle' || controller.getStatus() === 'degraded')) {
        controller.setMode(next);
        await controller.start();
      } else {
        controller.setMode(next);
      }
    }
  };

  /**
   * Switch the offline STT recognition language. Persists the choice, then
   * rebuilds the capture controller so the matching Vosk model is loaded
   * (downloaded on first use of a language, offline thereafter). If capture is
   * currently active it is stopped and restarted on the new language.
   */
  const setSttLang = async (lang: SttLanguage) => {
    if (lang === langRef.current) return;
    langRef.current = lang;
    setSttLanguageState(lang);
    await setSttLanguage(lang);

    const prev = controllerRef.current;
    const wasRunning =
      prev != null &&
      (prev.getStatus() === 'listening' || prev.getStatus() === 'paused');
    await prev?.stop();

    const controller = new CaptureController({
      mode,
      language: lang,
      onStatus: setStatus,
      onModelStatus: setModelStatus,
    });
    controllerRef.current = controller;
    controller.setOnWake(wakeCbRef.current);
    controller.setOnCommandUtterance(cmdCbRef.current);
    if (mode.kind !== 'off' && wasRunning) {
      const hasMic = await hasMicrophone();
      const granted = hasMic ? true : (await requestCapturePermissions()).microphone;
      if (granted) {
        await controller.start();
      } else {
        setStatus('degraded');
      }
    }
  };

  const value = useMemo<CaptureState>(
    () => ({
      status,
      modelStatus,
      mode,
      sttLanguage,
      nativeAvailable,
      pending,
      setMode,
      setSttLang,
      refreshPending: () => setPending(safePending()),
      setMuted: (m) => controllerRef.current?.setMuted(m),
      flushNow: async () => {
        // Works even when capture is off (no controller running): flush the
        // local outbox directly so the agent always gets the latest diary.
        if (controllerRef.current) {
          await controllerRef.current.flushNow();
        } else {
          await flushOutbox();
        }
        setPending(safePending());
      },
      setOnWake: (cb) => {
        wakeCbRef.current = cb;
        controllerRef.current?.setOnWake(cb);
      },
      setOnCommandUtterance: (cb) => {
        cmdCbRef.current = cb;
        controllerRef.current?.setOnCommandUtterance(cb);
      },
      refreshVoiceprint: () => {
        void controllerRef.current?.refreshVoiceprint();
      },
      reloadKeywords: () => {
        controllerRef.current?.reloadKeywords();
      },
    }),
    [status, modelStatus, mode, sttLanguage, nativeAvailable, pending],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function safePending(): number {
  try {
    return pendingCount();
  } catch {
    return 0;
  }
}

export function useCapture(): CaptureState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCapture must be used within CaptureProvider');
  return ctx;
}
