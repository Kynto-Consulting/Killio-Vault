package dev.killio.vault.widgets

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import dev.killio.vault.R

/**
 * Voice-mode widget — single tap opens Vault straight into the assistant
 * screen with `?voice=1` so the JS side auto-enables wake-word listening
 * ("Hey Killio") without user interaction. Used as the headline widget for
 * users that want to launch the assistant from their home screen.
 */
class VaultVoiceWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) {
            val views = RemoteViews(context.packageName, R.layout.widget_voice)
            views.setOnClickPendingIntent(
                R.id.widget_voice_root,
                buildLaunchIntent(context, "voice", id),
            )
            mgr.updateAppWidget(id, views)
        }
    }
}

/**
 * Screenshot + voice widget — when tapped:
 *   1. Vault opens with `?capture=screenshot&voice=1`
 *   2. The JS side asks MediaProjection consent (one-time per session)
 *   3. A screenshot is captured, uploaded, attached to the chat as
 *      `<asset type="img" .../>`
 *   4. Voice mode begins so the user can speak about the screenshot
 *
 * Used for "what's on my screen?"-style asks.
 */
class VaultScreenshotWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) {
            val views = RemoteViews(context.packageName, R.layout.widget_screenshot)
            views.setOnClickPendingIntent(
                R.id.widget_screenshot_root,
                buildLaunchIntent(context, "screenshot_voice", id),
            )
            mgr.updateAppWidget(id, views)
        }
    }
}

/**
 * Quick-chat widget — tap opens Vault assistant in text mode (no voice).
 * For users that just want to type a question fast.
 */
class VaultChatWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, mgr: AppWidgetManager, ids: IntArray) {
        for (id in ids) {
            val views = RemoteViews(context.packageName, R.layout.widget_chat)
            views.setOnClickPendingIntent(
                R.id.widget_chat_root,
                buildLaunchIntent(context, "chat", id),
            )
            mgr.updateAppWidget(id, views)
        }
    }
}

/**
 * Build a PendingIntent that boots MainActivity with a `killiovault://` deep
 * link. The JS side (`app/_layout.tsx` initialURL handler) reads the action
 * query param to decide:
 *   - voice              → /assistant?voice=1
 *   - screenshot_voice   → /assistant?capture=screenshot&voice=1
 *   - chat               → /assistant
 *
 * `appWidgetId` is included so each widget instance gets its own unique
 * PendingIntent — otherwise Android would reuse the same intent extras across
 * widgets and the action would be wrong.
 */
private fun buildLaunchIntent(context: Context, action: String, appWidgetId: Int): PendingIntent {
    val uri = Uri.parse("killiovault://assistant?action=$action&wid=$appWidgetId")
    val intent = Intent(Intent.ACTION_VIEW, uri).apply {
        setPackage(context.packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return PendingIntent.getActivity(context, appWidgetId, intent, flags)
}
