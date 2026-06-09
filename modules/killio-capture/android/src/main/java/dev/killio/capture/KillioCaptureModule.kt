package dev.killio.capture

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

/**
 * Expo module bridging JS ↔ the Android microphone foreground service.
 *
 * JS API (see src/capture/native/KillioCapture.ts):
 *   start({ sampleRate, frameSamples, notificationText }) -> Promise
 *   stop() -> Promise
 *   events: onAudioFrame { samples:Int[], sampleRate:Int, ts:Double }, onError { message }
 */
class StartOptions : Record {
  @Field var sampleRate: Int = 16_000
  @Field var frameSamples: Int = 320
  @Field var notificationText: String = "Killio Vault is listening"
  /** When true, start a non-recording keep-alive FGS (no mic) so background JS
   *  timers (cron) keep firing. See VaultCaptureService.keepAliveOnly. */
  @Field var keepAlive: Boolean = false
}

class KillioCaptureModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KillioCapture")

    Events("onAudioFrame", "onError")

    OnCreate {
      // Let the service push frames/errors back through this module instance.
      VaultCaptureService.emitter = { name, body -> sendEvent(name, body) }
    }

    OnDestroy {
      VaultCaptureService.emitter = null
    }

    AsyncFunction("start") { options: StartOptions ->
      val ctx: Context = appContext.reactContext
        ?: throw IllegalStateException("No React context")
      val intent = Intent(ctx, VaultCaptureService::class.java).apply {
        putExtra("sampleRate", options.sampleRate)
        putExtra("frameSamples", options.frameSamples)
        putExtra("notificationText", options.notificationText)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent)
      } else {
        ctx.startService(intent)
      }
    }

    AsyncFunction("stop") {
      val ctx: Context? = appContext.reactContext
      if (ctx != null) {
        ctx.stopService(Intent(ctx, VaultCaptureService::class.java))
      }
      // Explicit Unit so Kotlin doesn't infer the lambda's return type from
      // stopService()'s Boolean (which conflicts with the early-return path).
      Unit
    }

    /**
     * Whether the app is exempt from Doze / battery optimization. When false,
     * Android can suspend the capture foreground service while the screen is off
     * and 24/7 capture dies. JS should prompt the user to grant the exemption on
     * first capture start (see CaptureController).
     */
    Function("isIgnoringBatteryOptimizations") {
      val ctx: Context = appContext.reactContext ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return@Function true
      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      pm.isIgnoringBatteryOptimizations(ctx.packageName)
    }

    /**
     * Opens the system dialog that asks the user to exempt Vault from battery
     * optimization (REQUEST_IGNORE_BATTERY_OPTIMIZATIONS). Required so Doze does
     * not kill the screen-off capture service. No-op if already exempt.
     */
    AsyncFunction("requestIgnoreBatteryOptimizations") {
      val ctx: Context? = appContext.reactContext
      val pm = ctx?.getSystemService(Context.POWER_SERVICE) as? PowerManager
      // Only act when we have a context, are on M+, and aren't already exempt.
      // No bare early-returns — those make Kotlin infer a non-Unit lambda type
      // from the trailing expression and the build fails.
      if (
        ctx != null &&
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M &&
        pm != null &&
        !pm.isIgnoringBatteryOptimizations(ctx.packageName)
      ) {
        val intent = Intent(
          Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
          Uri.parse("package:${ctx.packageName}"),
        ).apply { addFlags(Intent.FLAG_ACTIVITY_NEW_TASK) }
        try {
          ctx.startActivity(intent)
        } catch (_: Exception) {
          // Fall back to the generic battery-optimization settings list.
          try {
            ctx.startActivity(
              Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
          } catch (_: Exception) {}
        }
      }
      Unit
    }
  }
}
