package dev.killio.screen

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle

/**
 * Invisible activity that fires `MediaProjectionManager.createScreenCaptureIntent()`
 * for ACTION_REQUEST, then routes the (resultCode, data) tuple back into
 * `KillioScreenModule` and finishes immediately.
 *
 * We cache the consent extras statically inside `KillioScreenModule` so
 * subsequent capture() calls can spin up the foreground service without
 * re-prompting (the user only sees the system dialog once per session).
 */
class ProjectionConsentActivity : Activity() {

  companion object {
    private const val REQ_CODE = 0xC0DE

    fun launch(ctx: Context) {
      val intent = Intent(ctx, ProjectionConsentActivity::class.java).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      ctx.startActivity(intent)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val mpm = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    try {
      startActivityForResult(mpm.createScreenCaptureIntent(), REQ_CODE)
    } catch (t: Throwable) {
      KillioScreenModule.onConsentResult(Activity.RESULT_CANCELED, null)
      finish()
    }
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode == REQ_CODE) {
      KillioScreenModule.onConsentResult(resultCode, data)
    }
    finish()
    overridePendingTransition(0, 0)
  }
}
