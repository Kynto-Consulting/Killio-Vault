package dev.killio.media

import android.content.Context
import android.media.AudioManager
import android.view.KeyEvent
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo module that controls media transport (play/pause, next, previous) by
 * dispatching hardware media-key events through [AudioManager.dispatchMediaKeyEvent].
 *
 * Why native: the public `spotify:` URI scheme has NO transport deep links, and
 * RN/Linking can't pause or skip. AudioManager media-key dispatch posts a
 * KEYCODE_MEDIA_* event to whatever app currently owns the active media session
 * (Spotify, YouTube Music, any player) WITHOUT opening that app and WITHOUT
 * closing Killio. No permission is required.
 *
 * JS API (see src/integrations/native/KillioMedia.ts):
 *   playPause(): Promise<Boolean>
 *   play(): Promise<Boolean>
 *   pause(): Promise<Boolean>
 *   next(): Promise<Boolean>
 *   previous(): Promise<Boolean>
 */
class KillioMediaModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KillioMedia")

    AsyncFunction("playPause") { dispatch(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE) }
    AsyncFunction("play")      { dispatch(KeyEvent.KEYCODE_MEDIA_PLAY) }
    AsyncFunction("pause")     { dispatch(KeyEvent.KEYCODE_MEDIA_PAUSE) }
    AsyncFunction("next")      { dispatch(KeyEvent.KEYCODE_MEDIA_NEXT) }
    AsyncFunction("previous")  { dispatch(KeyEvent.KEYCODE_MEDIA_PREVIOUS) }
  }

  /** Send a DOWN+UP media key pair to the active media session. */
  private fun dispatch(keyCode: Int): Boolean {
    val ctx: Context = appContext.reactContext
      ?: throw IllegalStateException("No React context")
    val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
      ?: throw IllegalStateException("AudioManager unavailable")
    am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, keyCode))
    am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, keyCode))
    return true
  }
}
