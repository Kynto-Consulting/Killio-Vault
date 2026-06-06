import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { CaptureController, CaptureStatus } from './CaptureController';
import { CaptureMode } from './schedule';
import { getCaptureMode, setCaptureMode } from '../settings/settings-store';
import { pendingCount, flushOutbox } from '../db/outbox';

interface CaptureState {
  status: CaptureStatus;
  mode: CaptureMode;
  nativeAvailable: boolean;
  pending: number;
  setMode(mode: CaptureMode): Promise<void>;
  refreshPending(): void;
  /** Duck capture while TTS speaks. */
  setMuted(muted: boolean): void;
  /** Upload pending transcripts now (call before an agent turn). */
  flushNow(): Promise<void>;
  /** Register a wake-phrase handler ("Hey Killio …"). */
  setOnWake(cb: ((m: import('../wakeword/WakeWord').WakeMatch) => void) | null): void;
}

const Ctx = createContext<CaptureState | null>(null);

export function CaptureProvider({ children }: { children: React.ReactNode }) {
  const controllerRef = useRef<CaptureController | null>(null);
  const wakeCbRef = useRef<((m: any) => void) | null>(null);
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [mode, setModeState] = useState<CaptureMode>({ kind: 'off' });
  const [pending, setPending] = useState(0);
  const nativeAvailable = CaptureController.nativeReady();

  useEffect(() => {
    (async () => {
      const saved = await getCaptureMode();
      setModeState(saved);
      const controller = new CaptureController({
        mode: saved,
        onStatus: setStatus,
      });
      controllerRef.current = controller;
      controller.setOnWake(wakeCbRef.current); // apply handler registered before creation
      // Per user directive: always try to start capture regardless of build
      // flavor. The controller itself drops into a 'degraded' status when no
      // native module is present, so the timer + outbox flush keep running.
      if (saved.kind !== 'off') {
        try {
          await controller.start();
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
      // Always try — degraded mode is fine, the controller handles it.
      if (controller.getStatus() === 'idle' || controller.getStatus() === 'degraded') {
        controller.setMode(next);
        await controller.start();
      } else {
        controller.setMode(next);
      }
    }
  };

  const value = useMemo<CaptureState>(
    () => ({
      status,
      mode,
      nativeAvailable,
      pending,
      setMode,
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
    }),
    [status, mode, nativeAvailable, pending],
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
