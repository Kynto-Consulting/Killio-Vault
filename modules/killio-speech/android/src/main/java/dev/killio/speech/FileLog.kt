package dev.killio.speech

import android.content.Context
import android.util.Log
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Persistent, FILE-BASED diagnostic logger that survives app restarts and needs
 * NO adb/logcat to read. Logs are written to the app's EXTERNAL files dir:
 *
 *   /sdcard/Android/data/<pkg>/files/logs/killio.log
 *
 * which is pullable WITHOUT root via:
 *   adb pull /sdcard/Android/data/dev.killio.vault/files/logs/
 * and also survives across app restarts. The JS side (src/core/filelog.ts)
 * writes its own killio-js.log into the SAME folder, and the in-app
 * "Exportar logs" button (app/settings.tsx) shares both files.
 *
 * Design goals (per the logging spec):
 *  - BEST-EFFORT: a logging failure must NEVER throw or crash capture. Every
 *    public method swallows all exceptions.
 *  - Thread-safe: all writes are serialized on a lock (the recognition loop, the
 *    KWS feed and the one-shot path may all log concurrently).
 *  - Rolling: one file `killio.log`, capped at ~2MB; when it exceeds the cap it
 *    is renamed to `killio.1.log` (the previous .1 is overwritten), so at most
 *    two files (~4MB) are kept.
 *  - Line format: `<ISO8601Z> <TAG>: <message>` e.g.
 *      2026-06-10T14:03:11.482Z KillioKWS: WAKE keyword="hey killio"
 *
 * Usage: call [init] once (VaultSpeechService.onCreate / onStartCommand) to
 * resolve the external dir, then [log] from anywhere. The native KWS/STT
 * diagnostics in VaultSpeechService are TEE'd here (Log.i kept + FileLog.log
 * added) so the wake/capture pipeline can be debugged by reading the file.
 */
object FileLog {
  private const val LOG_NAME = "killio.log"
  private const val ROTATED_NAME = "killio.1.log"
  private const val MAX_BYTES = 2L * 1024 * 1024 // ~2MB cap before rotation

  private val lock = Any()

  @Volatile private var logsDir: File? = null
  @Volatile private var logFile: File? = null

  /** ISO8601 with millis in UTC (Z). Guarded by [lock] (SimpleDateFormat is not
   *  thread-safe). */
  private val iso = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
    timeZone = TimeZone.getTimeZone("UTC")
  }

  /**
   * Resolve the external logs dir once and write a header line. Idempotent and
   * best-effort: safe to call on every onStartCommand. Falls back to the
   * internal filesDir/logs if the external dir is unavailable (e.g. no SD
   * mounted) so logging never silently no-ops.
   */
  fun init(context: Context) {
    if (logFile != null) return
    synchronized(lock) {
      if (logFile != null) return
      try {
        // Prefer the EXTERNAL files dir (adb-pullable without root). Fall back to
        // the internal filesDir if external storage isn't available.
        val base = context.getExternalFilesDir(null) ?: context.filesDir
        val dir = File(base, "logs").apply { mkdirs() }
        logsDir = dir
        val f = File(dir, LOG_NAME)
        logFile = f
        appendRaw(
          f,
          line(
            "FileLog",
            "──────── FileLog init — native logs at ${f.absolutePath} (pull: adb pull ${dir.absolutePath}) ────────",
          ),
        )
        // Mirror the resolved path to logcat once so it's discoverable there too.
        Log.i("FileLog", "native log file: ${f.absolutePath}")
      } catch (_: Throwable) {
        // Never throw from logging init.
      }
    }
  }

  /** Absolute path of the on-disk log file (or null if not yet initialized). */
  fun currentPath(): String? = logFile?.absolutePath

  /** Absolute path of the logs directory (or null if not yet initialized). */
  fun currentDir(): String? = logsDir?.absolutePath

  /**
   * Return the TAIL of the native log (current + rotated, oldest-first), capped at
   * ~[maxBytes] so the in-app "Export logs" can concatenate the native lines (KWS +
   * whisper download + capture) with the JS log WITHOUT adb. Resolves the external
   * file even if [init] hasn't been called yet (e.g. capture never started this
   * launch) by best-effort re-resolving from [context]. Never throws; returns "" if
   * nothing is readable.
   */
  fun readTail(context: Context, maxBytes: Int = 200 * 1024): String {
    return try {
      // Resolve the dir even if the speech service never ran this launch.
      val dir = logsDir ?: run {
        val base = context.getExternalFilesDir(null) ?: context.filesDir
        File(base, "logs")
      }
      val current = logFile ?: File(dir, LOG_NAME)
      val rotated = File(dir, ROTATED_NAME)
      val sb = StringBuilder()
      synchronized(lock) {
        // oldest first: rotated then current.
        for (f in listOf(rotated, current)) {
          if (f.exists() && f.length() > 0) {
            try { sb.append(f.readText()) } catch (_: Throwable) {}
          }
        }
      }
      val text = sb.toString()
      if (text.length <= maxBytes) text
      else "…(truncated)…\n" + text.substring(text.length - maxBytes)
    } catch (_: Throwable) {
      ""
    }
  }

  /**
   * Append a timestamped line `<ISO8601Z> <TAG>: <message>` to killio.log.
   * Thread-safe, buffered (one open/append per call — fine at our log rate),
   * best-effort — never throws. No-op if [init] hasn't resolved a file yet.
   */
  fun log(tag: String, msg: String) {
    val f = logFile ?: return
    try {
      synchronized(lock) {
        rotateIfNeeded(f)
        appendRaw(f, line(tag, msg))
      }
    } catch (_: Throwable) {
      // swallow — logging must never crash the caller.
    }
  }

  // ── internals (all called under [lock]) ──────────────────────────────────

  private fun line(tag: String, msg: String): String =
    "${iso.format(Date())} $tag: $msg\n"

  private fun appendRaw(f: File, text: String) {
    // append=true; UTF-8 default. Open/close per write keeps it simple and means
    // a crash can never leave a half-buffered file.
    f.appendText(text)
  }

  /** Rename to killio.1.log (keep 2 files) once over the size cap. */
  private fun rotateIfNeeded(f: File) {
    try {
      if (f.length() < MAX_BYTES) return
      val rotated = File(f.parentFile, ROTATED_NAME)
      if (rotated.exists()) rotated.delete()
      if (!f.renameTo(rotated)) {
        // rename failed (rare) — truncate in place rather than grow unbounded.
        f.delete()
      }
    } catch (_: Throwable) {
      // ignore — a failed rotation must not break logging.
    }
  }
}
