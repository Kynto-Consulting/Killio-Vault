import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system';

/**
 * Persistent, FILE-BASED JS diagnostic logger — the JS-side companion to the
 * native `FileLog` (modules/killio-speech/.../FileLog.kt). It captures the JS
 * half of the wake/diary pipeline (native-wake handling, keyword push, capture
 * start/stop, diary enqueue) into a file that survives app restarts and can be
 * pulled/shared WITHOUT adb/logcat.
 *
 * Where it writes:
 *   We want the SAME external folder the native logger uses
 *   (/sdcard/Android/data/<pkg>/files/logs/), but expo-file-system's sandboxed
 *   `documentDirectory` does NOT point at the app's external files dir, and there
 *   is no public expo API to resolve getExternalFilesDir() from JS. So the JS log
 *   is written to:
 *
 *     <FileSystem.documentDirectory>logs/killio-js.log
 *
 *   On Android `documentDirectory` is the app's INTERNAL files dir
 *   (/data/data/dev.killio.vault/files/), which is NOT world-pullable without
 *   root. Two ways to get it off-device:
 *     1. In-app "Exportar logs" button (app/settings.tsx) shares this file via
 *        expo-sharing — works with NO adb. (Primary path.)
 *     2. adb (debuggable build):  adb exec-out run-as dev.killio.vault \
 *          cat files/logs/killio-js.log
 *
 *   The native KWS/capture log (the priority for debugging the wake) DOES land in
 *   the adb-pullable external dir; this JS log complements it.
 *
 * Best-effort everywhere: every call swallows errors and never throws, so a
 * logging failure can never break capture or the app. Writes are serialized
 * through a promise chain (RN JS is single-threaded but async appends could
 * interleave) and the file is size-capped with a simple 2-file rotation.
 */

const LOG_DIR = `${FileSystem.documentDirectory ?? ''}logs/`;
const LOG_FILE = `${LOG_DIR}killio-js.log`;
const ROTATED_FILE = `${LOG_DIR}killio-js.1.log`;
const MAX_BYTES = 2 * 1024 * 1024; // ~2MB cap before rotation

/** Absolute on-disk path of the JS log file (file:// URI). */
export const JS_LOG_PATH = LOG_FILE;
export const JS_LOG_ROTATED_PATH = ROTATED_FILE;
export const JS_LOG_DIR = LOG_DIR;

let dirReady = false;
/** Serialize appends so concurrent flog() calls don't clobber each other. */
let writeChain: Promise<void> = Promise.resolve();
let headerWritten = false;

async function ensureDir(): Promise<boolean> {
  if (!FileSystem.documentDirectory) return false;
  if (dirReady) return true;
  try {
    const info = await FileSystem.getInfoAsync(LOG_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(LOG_DIR, { intermediates: true });
    }
    dirReady = true;
    return true;
  } catch {
    return false;
  }
}

/** Rename to killio-js.1.log (keep 2 files) once over the size cap. */
async function rotateIfNeeded(): Promise<void> {
  try {
    const info = await FileSystem.getInfoAsync(LOG_FILE);
    if (!info.exists || (info.size ?? 0) < MAX_BYTES) return;
    await FileSystem.deleteAsync(ROTATED_FILE, { idempotent: true });
    // expo-file-system has no rename; move via copy+delete.
    await FileSystem.copyAsync({ from: LOG_FILE, to: ROTATED_FILE });
    await FileSystem.deleteAsync(LOG_FILE, { idempotent: true });
  } catch {
    /* ignore — a failed rotation must not break logging */
  }
}

function isoNow(): string {
  return new Date().toISOString(); // already ISO8601 with millis + 'Z'
}

async function appendLine(line: string): Promise<void> {
  if (!(await ensureDir())) return;
  await rotateIfNeeded();
  // expo-file-system has no append mode; read-modify-write. At our log rate
  // (a handful of lines per wake/capture event) this is fine.
  let prev = '';
  try {
    const info = await FileSystem.getInfoAsync(LOG_FILE);
    if (info.exists) {
      prev = await FileSystem.readAsStringAsync(LOG_FILE, {
        encoding: FileSystem.EncodingType.UTF8,
      });
    }
  } catch {
    prev = '';
  }
  await FileSystem.writeAsStringAsync(LOG_FILE, prev + line, {
    encoding: FileSystem.EncodingType.UTF8,
  });
}

/**
 * Append a timestamped line `<ISO8601Z> <TAG>: <message>` to killio-js.log.
 * Best-effort + fire-and-forget — never throws, never blocks the caller. On a
 * platform without a document dir (web) it silently no-ops.
 */
export function flog(tag: string, msg: string): void {
  // Mirror to the JS console too so a live `npx react-native log-android` still
  // shows it (tee — same spirit as the native Log.i + FileLog tee).
  try {
    console.log(`[flog:${tag}] ${msg}`);
  } catch {
    /* ignore */
  }
  if (!FileSystem.documentDirectory) return;
  const line = `${isoNow()} ${tag}: ${msg}\n`;
  writeChain = writeChain
    .then(async () => {
      if (!headerWritten) {
        headerWritten = true;
        await appendLine(
          `${isoNow()} filelog: ──────── JS flog init — js log at ${LOG_FILE} (platform=${Platform.OS}) ────────\n`,
        );
      }
      await appendLine(line);
    })
    .catch(() => {
      /* swallow — logging must never crash the caller */
    });
}

/**
 * Read the full JS log (current + rotated, oldest first) as a single string for
 * the in-app export/share button. Returns '' if nothing is logged yet.
 */
export async function readJsLog(): Promise<string> {
  const parts: string[] = [];
  for (const p of [ROTATED_FILE, LOG_FILE]) {
    try {
      const info = await FileSystem.getInfoAsync(p);
      if (info.exists) {
        parts.push(
          await FileSystem.readAsStringAsync(p, {
            encoding: FileSystem.EncodingType.UTF8,
          }),
        );
      }
    } catch {
      /* ignore unreadable part */
    }
  }
  return parts.join('');
}
