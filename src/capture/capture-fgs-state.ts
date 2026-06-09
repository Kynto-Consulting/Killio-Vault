/**
 * Tiny shared signal: is a CAPTURE foreground service currently running?
 *
 * The CronKeepAlive coordinator reads this (outside React) to decide whether it
 * must start its own non-recording keep-alive FGS — if capture already owns one,
 * the JS runtime is kept alive for free and cron rides on it.
 *
 * Set by CaptureController as it starts/stops the recognizer/mic. Defaults to
 * false (no capture FGS at boot).
 */
let captureFgsActive = false;

/** Called by CaptureController when its capture FGS goes up/down. */
export function setCaptureFgsActive(active: boolean): void {
  captureFgsActive = active;
}

/** True while a capture FGS (mic / Vosk / system audio) is running. */
export function isCaptureFgsActive(): boolean {
  return captureFgsActive;
}
