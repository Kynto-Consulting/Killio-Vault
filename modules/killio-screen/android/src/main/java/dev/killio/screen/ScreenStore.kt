package dev.killio.screen

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import java.io.File
import java.io.FileOutputStream

/**
 * Local PNG store for MediaProjection screenshots.
 *
 * Files land under `context.filesDir/killio_screens/` and are returned to JS as
 * `file://` URIs. Listing reads the PNG header (inJustDecodeBounds = true) so we
 * surface width/height without decoding pixels.
 */
data class StoredShot(
  val id: String,
  val file: File,
  val ts: Long,
  val width: Int,
  val height: Int,
)

object ScreenStore {
  private const val DIR_NAME = "killio_screens"

  private fun dir(ctx: Context): File {
    val d = File(ctx.filesDir, DIR_NAME)
    if (!d.exists()) d.mkdirs()
    return d
  }

  fun save(ctx: Context, bitmap: Bitmap): StoredShot {
    val ts = System.currentTimeMillis()
    val id = "shot_$ts"
    val f = File(dir(ctx), "$id.png")
    FileOutputStream(f).use { out ->
      bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
      out.flush()
    }
    return StoredShot(id = id, file = f, ts = ts, width = bitmap.width, height = bitmap.height)
  }

  /** Most-recent first. */
  fun list(ctx: Context): List<StoredShot> {
    val d = dir(ctx)
    val files = d.listFiles { f -> f.isFile && f.name.endsWith(".png") } ?: return emptyList()
    return files
      .sortedByDescending { it.lastModified() }
      .map { f ->
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(f.absolutePath, opts)
        StoredShot(
          id = f.nameWithoutExtension,
          file = f,
          ts = f.lastModified(),
          width = opts.outWidth.coerceAtLeast(0),
          height = opts.outHeight.coerceAtLeast(0),
        )
      }
  }
}
