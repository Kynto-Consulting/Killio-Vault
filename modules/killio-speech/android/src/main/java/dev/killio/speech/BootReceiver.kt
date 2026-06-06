package dev.killio.speech

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build

/**
 * Restarts continuous capture after a device reboot.
 *
 * RECEIVE_BOOT_COMPLETED is declared for the app, so without a receiver that
 * actually handles ACTION_BOOT_COMPLETED the permission does nothing. This
 * receiver re-launches the speech foreground service on boot IF the user had
 * 24/7 capture enabled before the reboot (persisted in SharedPreferences by JS
 * via setCaptureEnabledFlag).
 *
 * NOTE: On Android 12+ starting a microphone-typed FGS from the background is
 * restricted; the start succeeds on OEM builds where the app is
 * battery-optimization-exempt (which Vault prompts for on first capture). When
 * it can't auto-start, capture resumes the next time the user opens the app.
 */
class BootReceiver : BroadcastReceiver() {
  companion object {
    const val PREFS = "killio_vault_capture"
    const val KEY_ENABLED = "capture_enabled"
    const val KEY_LANGUAGE = "capture_language"
  }

  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED &&
      action != "android.intent.action.QUICKBOOT_POWERON"
    ) {
      return
    }

    val prefs: SharedPreferences =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(KEY_ENABLED, false)) return

    val language = prefs.getString(KEY_LANGUAGE, "es-ES") ?: "es-ES"
    val svc = Intent(context, VaultSpeechService::class.java).apply {
      putExtra("language", language)
      putExtra("notificationText", "Killio Vault is listening")
    }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(svc)
      } else {
        context.startService(svc)
      }
    } catch (_: Exception) {
      // Background FGS start blocked (Android 12+ without exemption) — capture
      // resumes when the user next opens the app.
    }
  }
}
