package dev.killio.appintent

import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import java.text.Normalizer
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Expo module that fires app-specific Android intents — the realistic, Gemini /
 * Google-Assistant-style "control installed apps" path (deep links + App-Action
 * intents), without an accessibility service.
 *
 * Implemented:
 *  - whatsappMessage(phone, text): opens WhatsApp chat with a pre-filled message
 *    via https://api.whatsapp.com/send (no permission needed). User taps send.
 *  - whatsappCall(phone): best-effort 1-tap VOICE call. Looks the number up in
 *    Contacts → finds the WhatsApp VoIP-call data row (mimetype
 *    vnd.android.cursor.item/vnd.com.whatsapp.voip.call) → ACTION_VIEW on that
 *    data id. Falls back to opening the chat when the number isn't a saved
 *    WhatsApp contact (a true 1-tap call is only possible for saved contacts).
 *  - openAppAction(packageName, action, data): generic — fire ACTION on a URI,
 *    optionally constrained to a package, so future App-Action style intents can
 *    be added without new native code.
 *  - listInstalledApps(): the user's LAUNCHABLE apps [{label, packageName}],
 *    via queryIntentActivities(MAIN/LAUNCHER) — no QUERY_ALL_PACKAGES needed.
 *  - searchApps(query): the same list filtered by label/package (accent-insensitive).
 *  - launchApp(packageName): open an installed app by its launch intent.
 *
 * JS API: see src/integrations/native/KillioAppIntent.ts
 */
class KillioAppIntentModule : Module() {
  private val WA_PACKAGE = "com.whatsapp"
  private val WA_BUSINESS = "com.whatsapp.w4b"
  private val WA_VOIP_MIME = "vnd.android.cursor.item/vnd.com.whatsapp.voip.call"
  /** Cap the installed-app list so a device with hundreds of apps stays cheap. */
  private val MAX_APPS = 300

  override fun definition() = ModuleDefinition {
    Name("KillioAppIntent")

    /** Open a WhatsApp chat with a pre-filled message. Returns the method used. */
    AsyncFunction("whatsappMessage") { phone: String, text: String? ->
      val digits = phone.filter { it.isDigit() || it == '+' }.removePrefix("+")
      val url = buildString {
        append("https://api.whatsapp.com/send?phone=")
        append(digits)
        if (!text.isNullOrEmpty()) {
          append("&text=")
          append(Uri.encode(text))
        }
      }
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      startWhatsApp(intent)
      mapOf("opened" to true, "via" to "wa.me", "phone" to digits)
    }

    /**
     * Best-effort 1-tap WhatsApp VOICE call. Resolves the number to the
     * WhatsApp VoIP data row and ACTION_VIEWs it; on failure opens the chat.
     */
    AsyncFunction("whatsappCall") { phone: String ->
      val dataId = findWhatsAppVoipDataId(phone)
      if (dataId != null) {
        val callUri = ContentUris.withAppendedId(ContactsContract.Data.CONTENT_URI, dataId)
        val intent = Intent(Intent.ACTION_VIEW).apply {
          setDataAndType(callUri, WA_VOIP_MIME)
          setPackage(WA_PACKAGE)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        try {
          appContext.reactContext!!.startActivity(intent)
          return@AsyncFunction mapOf("called" to true, "via" to "voip-intent")
        } catch (e: Exception) {
          // fall through to chat
        }
      }
      // Fallback: open the chat (no saved WhatsApp contact / call intent failed).
      val digits = phone.filter { it.isDigit() || it == '+' }.removePrefix("+")
      val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://api.whatsapp.com/send?phone=$digits")).apply {
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      startWhatsApp(intent)
      mapOf(
        "called" to false,
        "via" to "chat-fallback",
        "note" to "Number is not a saved WhatsApp contact; opened the chat instead. Save the contact for 1-tap calls.",
      )
    }

    /** Generic app-action intent: ACTION on a URI, optionally pinned to a pkg. */
    AsyncFunction("openAppAction") { packageName: String?, action: String?, data: String? ->
      val intent = Intent(action ?: Intent.ACTION_VIEW).apply {
        if (!data.isNullOrEmpty()) setData(Uri.parse(data))
        if (!packageName.isNullOrEmpty()) setPackage(packageName)
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      appContext.reactContext!!.startActivity(intent)
      mapOf("opened" to true, "package" to (packageName ?: ""), "action" to (action ?: Intent.ACTION_VIEW))
    }

    /**
     * List the user's LAUNCHABLE apps as [{ label, packageName }], sorted by
     * label. Uses queryIntentActivities for the MAIN/LAUNCHER intent — the same
     * set the home-screen launcher shows — which does NOT require the
     * QUERY_ALL_PACKAGES permission (the module manifest declares a matching
     * <queries><intent> so it's visible under Android 11+ scoped visibility).
     */
    AsyncFunction("listInstalledApps") {
      queryLaunchableApps().take(MAX_APPS)
    }

    /**
     * Same launcher-app list, filtered (case- and accent-insensitive) by label
     * OR package containing the query. Returns the matching apps.
     */
    AsyncFunction("searchApps") { query: String ->
      val q = foldAccents(query.trim().lowercase())
      if (q.isEmpty()) {
        queryLaunchableApps().take(MAX_APPS)
      } else {
        queryLaunchableApps().filter { app ->
          val label = foldAccents((app["label"] ?: "").lowercase())
          val pkg = foldAccents((app["packageName"] ?: "").lowercase())
          label.contains(q) || pkg.contains(q)
        }.take(MAX_APPS)
      }
    }

    /**
     * Launch an installed app by its package name via its launch intent.
     * Returns { opened:true, packageName } or throws if there is no launchable
     * activity for that package (not installed / no launcher entry).
     */
    AsyncFunction("launchApp") { packageName: String ->
      val ctx: Context = appContext.reactContext
        ?: throw IllegalStateException("No React context")
      val launch = ctx.packageManager.getLaunchIntentForPackage(packageName)
        ?: throw IllegalArgumentException("No launchable app for package: $packageName")
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(launch)
      mapOf("opened" to true, "packageName" to packageName)
    }
  }

  /** Query MAIN/LAUNCHER activities → [{label, packageName}] sorted by label. */
  private fun queryLaunchableApps(): List<Map<String, String>> {
    val ctx = appContext.reactContext ?: return emptyList()
    val pm = ctx.packageManager
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
    val resolved = try {
      pm.queryIntentActivities(intent, 0)
    } catch (e: Exception) {
      return emptyList()
    }
    // De-dupe by package (an app can register several launcher activities).
    val seen = HashSet<String>()
    val apps = ArrayList<Map<String, String>>()
    for (ri in resolved) {
      val pkg = ri.activityInfo?.packageName ?: continue
      if (!seen.add(pkg)) continue
      val label = try {
        ri.loadLabel(pm)?.toString()
      } catch (e: Exception) {
        null
      } ?: pkg
      apps.add(mapOf("label" to label, "packageName" to pkg))
    }
    apps.sortWith(compareBy(String.CASE_INSENSITIVE_ORDER) { it["label"] ?: "" })
    return apps
  }

  /** Strip diacritics so "Telefono" matches "Teléfono". */
  private fun foldAccents(s: String): String =
    Normalizer.normalize(s, Normalizer.Form.NFD).replace(Regex("\\p{M}+"), "")

  /** Start an intent, falling back from WhatsApp to WhatsApp Business. */
  private fun startWhatsApp(intent: Intent) {
    val ctx: Context = appContext.reactContext
      ?: throw IllegalStateException("No React context")
    try {
      val pinned = Intent(intent).setPackage(WA_PACKAGE)
      ctx.startActivity(pinned)
    } catch (e: Exception) {
      try {
        val biz = Intent(intent).setPackage(WA_BUSINESS)
        ctx.startActivity(biz)
      } catch (e2: Exception) {
        // Last resort: unpinned (system chooser / browser wa.me).
        ctx.startActivity(intent)
      }
    }
  }

  /**
   * Find the ContactsContract.Data _ID of the WhatsApp VoIP-call row whose
   * sibling phone number matches `phone`. Returns null when there's no match
   * (number not saved, WhatsApp not installed, or no contacts permission).
   */
  private fun findWhatsAppVoipDataId(phone: String): Long? {
    val ctx = appContext.reactContext ?: return null
    val target = normalizeDigits(phone)
    if (target.isEmpty()) return null

    val resolver = ctx.contentResolver
    return try {
      // Query all WhatsApp VoIP-call data rows; each row's Data.DATA3 typically
      // holds the displayed number. We match on normalized trailing digits.
      val cursor = resolver.query(
        ContactsContract.Data.CONTENT_URI,
        arrayOf(
          ContactsContract.Data._ID,
          ContactsContract.Data.CONTACT_ID,
          ContactsContract.Data.DATA1,
          ContactsContract.Data.DATA3,
        ),
        "${ContactsContract.Data.MIMETYPE} = ?",
        arrayOf(WA_VOIP_MIME),
        null,
      ) ?: return null

      cursor.use { c ->
        val idCol = c.getColumnIndex(ContactsContract.Data._ID)
        val contactIdCol = c.getColumnIndex(ContactsContract.Data.CONTACT_ID)
        val data3Col = c.getColumnIndex(ContactsContract.Data.DATA3)
        var firstId: Long? = null
        while (c.moveToNext()) {
          val id = if (idCol >= 0) c.getLong(idCol) else continue
          if (firstId == null) firstId = id
          val label = if (data3Col >= 0) c.getString(data3Col) else null
          if (label != null && digitsMatch(normalizeDigits(label), target)) {
            return@use id
          }
          // DATA3 may not carry the number; cross-check the contact's phones.
          val contactId = if (contactIdCol >= 0) c.getLong(contactIdCol) else continue
          if (contactHasPhone(resolver, contactId, target)) {
            return@use id
          }
        }
        // No exact phone match — if there is exactly one WhatsApp row, use it.
        firstId.takeIf { c.count == 1 }
      }
    } catch (e: Exception) {
      null
    }
  }

  /** Whether the given contact has a phone number matching `target` digits. */
  private fun contactHasPhone(
    resolver: android.content.ContentResolver,
    contactId: Long,
    target: String,
  ): Boolean {
    return try {
      val pc = resolver.query(
        ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
        arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
        "${ContactsContract.CommonDataKinds.Phone.CONTACT_ID} = ?",
        arrayOf(contactId.toString()),
        null,
      ) ?: return false
      pc.use { p ->
        val numCol = p.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)
        while (p.moveToNext()) {
          val num = if (numCol >= 0) p.getString(numCol) else null
          if (num != null && digitsMatch(normalizeDigits(num), target)) return true
        }
      }
      false
    } catch (e: Exception) {
      false
    }
  }

  private fun normalizeDigits(s: String?): String =
    (s ?: "").filter { it.isDigit() }

  /** Match if one normalized number ends with the other (≥7 trailing digits). */
  private fun digitsMatch(a: String, b: String): Boolean {
    if (a.isEmpty() || b.isEmpty()) return false
    val n = minOf(a.length, b.length, 9).coerceAtLeast(7)
    if (a.length < 7 || b.length < 7) return a == b
    return a.takeLast(n) == b.takeLast(n)
  }
}
