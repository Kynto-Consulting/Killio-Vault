/**
 * Tiny shared-state torch controller.
 *
 * expo-camera 16 dropped the imperative `Camera.setTorchModeAsync` API — the
 * torch is now only controllable via the `enableTorch` prop on <CameraView>.
 * So the `flashlight` client-action toggles this module's state, and a hidden
 * <TorchHost> (mounted once at the app root) re-renders a CameraView with the
 * matching `enableTorch` value.
 */

type Listener = (on: boolean) => void;

let torchOn = false;
const listeners = new Set<Listener>();

export function setTorch(on: boolean): void {
  torchOn = on;
  for (const l of listeners) l(on);
}

export function getTorch(): boolean {
  return torchOn;
}

export function subscribeTorch(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
