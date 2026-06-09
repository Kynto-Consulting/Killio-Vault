package dev.killio.speech

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.Build
import androidx.core.content.ContextCompat
import android.os.Bundle
import android.os.IBinder
import android.os.PowerManager
import org.json.JSONArray
import com.k2fsa.sherpa.onnx.EndpointConfig
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.KeywordSpotter
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineRecognizer
import com.k2fsa.sherpa.onnx.OnlineRecognizerConfig
import com.k2fsa.sherpa.onnx.OnlineStream
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractor
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import java.io.File
import java.io.FileOutputStream
import android.util.Log
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Continuous, fully on-device speech recognition powered by Sherpa-ONNX
 * (k2-fsa, Apache-2.0). This REPLACES the previous Vosk (Kaldi) engine — the
 * win is a true streaming Zipformer transducer (low CPU), an integrated Silero
 * VAD that gates decoding (battery), and an open speaker-embedding model for
 * offline voice-ID. No API key, no usage limits, 100% offline after the
 * one-time model fetch (Apache-2.0).
 *
 * The PUBLIC EVENT CONTRACT to JS is byte-for-byte identical to the Vosk impl,
 * so src/capture/CaptureController.ts, src/voiceid/voiceprint.ts, the wake-word
 * scan and the diary all keep working unchanged:
 *   onTranscript { text: String, ts: Double (UTC ms), spk?: JSON-array string }
 *   onError      { message: String }
 *   onModelStatus{ state, progress?, bytes?, total?, message? }
 *
 * Model strategy (offline guarantee): NONE of the models are bundled in the APK.
 * On first start the STT (es/en streaming Zipformer), the Silero VAD, and the
 * speaker-embedding model are downloaded once over HTTP into filesDir and reused
 * offline on every subsequent start. STT models are per-language (es/en) so
 * switching languages never re-downloads the other. If a download fails (e.g. no
 * network on first run) we emit onError + onModelStatus error and stopSelf
 * gracefully instead of crashing; voice-ID degrades to "no spk" if only the
 * speaker model is missing.
 *
 * Engine flow (continuous): AudioRecord PCM16 16kHz → normalize to FloatArray →
 * Silero VAD.acceptWaveform. When VAD emits a finished speech segment we (a) feed
 * its samples through a fresh OnlineRecognizer stream → getResult().text → emit
 * onTranscript, and (b) feed the same samples through the SpeakerEmbeddingExtractor
 * → FloatArray embedding → forward as the "spk" vector (same JSON-array-string
 * shape Vosk used). Decoding only runs on detected speech, so the recognizer is
 * idle during silence (battery).
 */
class VaultSpeechService : Service() {
  companion object {
    @Volatile var emitter: ((String, Bundle) -> Unit)? = null
    private const val CHANNEL_ID = "killio_vault_speech"
    private const val NOTIF_ID = 4712
    private const val SAMPLE_RATE = 16_000

    // ── Multi-language streaming STT model registry ─────────────────────────
    // Each supported recognition language maps to its own offline sherpa-onnx
    // streaming Zipformer transducer. sherpa-onnx ships these as a tar.bz2 in
    // the GitHub `asr-models` release, but to avoid bundling a bzip2/tar
    // extractor we download the THREE loose ONNX files + tokens.txt directly
    // from the upstream HuggingFace repo (resolve/main/<file>) into a per-lang
    // filesDir subfolder. Each language caches independently; switching never
    // re-downloads the other.
    //
    //   es → csukuangfj/sherpa-onnx-streaming-zipformer-es-kroko-2025-08-06
    //        (the FIRST dedicated SPANISH streaming Zipformer in sherpa-onnx;
    //         encoder ~155MB fp32, decoder/joiner tiny). This is the closest
    //         real Spanish streaming model — there is no smaller/int8 es variant
    //         published yet, so we use fp32. Kroko-ASR, Apache-2.0 compatible.
    //   en → csukuangfj/sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06
    //        (small English streaming Zipformer, encoder ~70MB fp32).
    // files = remote HF filename → local filename. The recognizer always reads
    // encoder.onnx/decoder.onnx/joiner.onnx/tokens.txt locally; repos that name
    // their files differently (e.g. bookbot's int8 epoch-tagged names) map here.
    private data class SttModel(
      val dir: String,
      val hfRepo: String,
      val files: List<Pair<String, String>>,
    )

    private const val HF_BASE = "https://huggingface.co"
    private const val HF_REVISION = "main"
    // LOCAL filenames the recognizer loads (constant across languages).
    private val STT_FILES = listOf("encoder.onnx", "decoder.onnx", "joiner.onnx", "tokens.txt")
    // kroko repos name files identically → identity map.
    private val KROKO_FILES = STT_FILES.map { it to it }

    // NOTE (Bug 1 fix — model swap): the es model was previously bookbot
    // robust-es int8. That repo is a PHONEME-recognition model: its tokens.txt
    // holds only ~37 IPA phonemes (a e i o u b d t͡ʃ ɲ ɾ ʎ ʝ θ …) with NO word
    // boundaries, so its decoded output is a run-on phoneme string like
    // "todelosatatadelosrexa" — exactly the garbage seen on-device. It is NOT a
    // text/orthographic ASR model. Switched es to the kroko Spanish streaming
    // Zipformer, whose tokens.txt is a proper 651-entry BPE vocab with `▁` word
    // boundaries (▁de ▁que ▁la …) → produces readable Spanish words. Tradeoff:
    // kroko encoder is fp32 ~155MB vs bookbot int8 ~26MB; correctness wins.
    // kroko uses identity file names, matching the recognizer's expected
    // encoder.onnx/decoder.onnx/joiner.onnx/tokens.txt and modelType=zipformer2.

    private val MODELS: Map<String, SttModel> = mapOf(
      "es" to SttModel(
        "sherpa-stt-es-kroko",
        "csukuangfj/sherpa-onnx-streaming-zipformer-es-kroko-2025-08-06",
        KROKO_FILES,
      ),
      "en" to SttModel(
        "sherpa-stt-en",
        "csukuangfj/sherpa-onnx-streaming-zipformer-en-kroko-2025-08-06",
        KROKO_FILES,
      ),
    )
    private const val DEFAULT_LANG = "es"

    /** Normalize "es"/"es-ES"/"en-US"/… → supported model code; unknown→default. */
    private fun langCode(language: String?): String {
      val code = language?.trim()?.lowercase()?.substringBefore('-')?.substringBefore('_') ?: ""
      return if (MODELS.containsKey(code)) code else DEFAULT_LANG
    }

    private fun modelFor(language: String?): SttModel =
      MODELS[langCode(language)] ?: MODELS[DEFAULT_LANG]!!

    // ── Silero VAD model (single ~2MB ONNX) ─────────────────────────────────
    // Gates decoding so the recognizer only runs on detected speech (battery).
    // Downloaded once from the sherpa-onnx `asr-models` GitHub release.
    private const val VAD_DIR = "sherpa-vad"
    private const val VAD_FILE = "silero_vad.onnx"
    private const val VAD_URL =
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"

    // ── Speaker-embedding model (single ONNX) for voice-ID ──────────────────
    // 3D-Speaker CAM++ (zh+en, ~28MB), the standard small sherpa-onnx speaker
    // model. Emits a 192-dim L2-comparable embedding per utterance — we forward
    // it as the "spk" vector exactly like the old Vosk 128-dim x-vector. The dim
    // differs (192 vs 128); src/voiceid/voiceprint.ts is dim-agnostic so it
    // stores/compares whatever dim the model emits. Same download/offline
    // pattern as above. Apache-2.0 / CC-BY model.
    private const val SPK_MODEL_DIR = "sherpa-spk"
    private const val SPK_MODEL_FILE = "3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"
    private const val SPK_MODEL_URL =
      "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx"

    // ── Keyword-spotting (wake-word) model ──────────────────────────────────
    // A DEDICATED sherpa-onnx KeywordSpotter model — SEPARATE from the ASR
    // transducer above; the two coexist (ASR transcribes the diary, KWS detects
    // wake phrases DIRECTLY from audio with no transcript). The old wake path
    // fuzzy-matched the Spanish ASR transcript, which fails because the es model
    // mis-transcribes the made-up brand "Killio". KWS spots phonetic keywords
    // straight from the PCM stream, so the brand name triggers reliably.
    //
    // Model: sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01 (English BPE
    // streaming Zipformer, ~3.3M params; the encoder/decoder/joiner are only a
    // few MB each — total well under the 10–30MB budget). It is an English BPE
    // model, but wake words are PHONETIC: "hey killio"/"oye killio" and Latin-
    // script agent names tokenize fine through its byte-level BPE vocab, and KWS
    // matches on acoustics, not orthography, so an English model still fires on
    // Spanish-accented speech. Same offline/onModelStatus download pattern as the
    // ASR: we fetch the loose ONNX files + tokens.txt + bpe.model directly from
    // the upstream HuggingFace repo (resolve/main/<file>) into a filesDir subdir,
    // avoiding a bundled bzip2/tar extractor for the GitHub .tar.bz2 release.
    //
    // GitHub release (archives):  https://github.com/k2-fsa/sherpa-onnx/releases/tag/kws-models
    //   asset: sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2
    // HuggingFace (loose files we actually download):
    //   https://huggingface.co/pkufool/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01
    private const val KWS_DIR = "sherpa-kws"
    private const val KWS_HF_REPO =
      "pkufool/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"
    // Remote HF filename → local filename. The encoder/decoder/joiner are epoch-
    // tagged upstream; we save them under stable names the spotter loads. We use
    // the int8 variants (smaller; KWS accuracy is unaffected for short phrases).
    private val KWS_FILES = listOf(
      "encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx" to "encoder.onnx",
      "decoder-epoch-12-avg-2-chunk-16-left-64.onnx" to "decoder.onnx",
      "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx" to "joiner.onnx",
      "tokens.txt" to "tokens.txt",
      "bpe.model" to "bpe.model",
    )
    // LOCAL filenames the spotter loads (the 3 onnx + tokens). bpe.model is only
    // needed by the offline text2token CLI; our on-device tokenizer reads
    // tokens.txt directly, so the spotter itself needs just these four.
    private val KWS_LOCAL_REQUIRED = listOf("encoder.onnx", "decoder.onnx", "joiner.onnx", "tokens.txt")
    /** The default built-in wake phrases, always added to the keyword set. */
    val DEFAULT_WAKE_PHRASES = listOf("hey killio", "oye killio", "okay killio", "ok killio")

    /** Process-wide shared KeywordSpotter (lazy, best-effort). Reused across
     *  the continuous loop; stream is re-created when keywords change. */
    @Volatile private var sharedKws: KeywordSpotter? = null
    @Volatile private var sharedKwsTried = false
    private val kwsLock = Any()
    /** Cached tokens.txt vocab (token → id) for on-device BPE tokenization. */
    @Volatile private var kwsTokenVocab: Map<String, Int>? = null

    /** All required KWS files present in [dir]? */
    private fun kwsModelComplete(dir: File): Boolean =
      dir.isDirectory && KWS_LOCAL_REQUIRED.all { File(dir, it).let { f -> f.exists() && f.length() > 0 } }

    /** True once the KWS model has been fully downloaded. */
    fun isKwsModelPresent(ctx: android.content.Context): Boolean =
      kwsModelComplete(File(ctx.filesDir, KWS_DIR))

    /**
     * Load (once) the tokens.txt vocab for the KWS model into a token→id map.
     * Each line is "<token> <id>"; the first column is the BPE piece (which may
     * contain the U+2581 '▁' word-boundary marker). Returns null if missing.
     */
    private fun loadKwsTokenVocab(dir: File): Map<String, Int>? {
      kwsTokenVocab?.let { return it }
      val f = File(dir, "tokens.txt")
      if (!f.exists()) return null
      return try {
        val map = HashMap<String, Int>()
        f.forEachLine { line ->
          val sp = line.lastIndexOf(' ')
          if (sp > 0) {
            val tok = line.substring(0, sp)
            val id = line.substring(sp + 1).trim().toIntOrNull()
            if (id != null) map[tok] = id
          }
        }
        kwsTokenVocab = map
        map
      } catch (e: Exception) {
        Log.w("KillioKWS", "tokens.txt parse failed: ${e.message}")
        null
      }
    }

    /**
     * Greedy longest-match BPE tokenizer over the KWS model's tokens.txt. The
     * gigaspeech model uses byte-level BPE with the '▁' (U+2581) word-boundary
     * marker prefixing the first piece of each word. We lowercase→UPPERCASE (the
     * vocab is upper-cased), join words with '▁', and greedily consume the
     * longest vocab piece at each position. Returns the space-separated token
     * string sherpa's keywords file expects (e.g. "▁HE LL O ▁WORLD"), or null if
     * any character can't be covered by the vocab (caller logs + skips → that
     * phrase falls back to the JS transcript matcher).
     *
     * This is a pragmatic on-device substitute for sherpa's offline
     * `text2token --tokens-type bpe --bpe-model bpe.model` step (we don't ship a
     * SentencePiece runtime). It won't always reproduce the exact BPE merge the
     * trained model would, but for short wake phrases the greedy cover over the
     * same vocab yields tokens the spotter accepts and triggers on.
     */
    private fun tokenizeForKws(dir: File, phrase: String): String? {
      val vocab = loadKwsTokenVocab(dir) ?: return null
      val words = phrase.trim().uppercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
      if (words.isEmpty()) return null
      val out = ArrayList<String>()
      for (word in words) {
        // sherpa BPE prefixes the WORD with '▁'; we tokenize "▁WORD" as a unit.
        val s = "▁$word"
        var i = 0
        while (i < s.length) {
          var matched: String? = null
          // longest-match: try the longest substring starting at i.
          var end = s.length
          while (end > i) {
            val cand = s.substring(i, end)
            if (vocab.containsKey(cand)) { matched = cand; break }
            end--
          }
          if (matched == null) {
            // Char not coverable (e.g. accented letter not in the en vocab).
            return null
          }
          out.add(matched)
          i += matched.length
        }
      }
      return out.joinToString(" ")
    }

    /**
     * Build the sherpa keywords-file content for [phrases]. Each line is:
     *   <bpe tokens> :<score> #<threshold> @<original phrase>
     * The trailing "@<original phrase>" is what getResult().keyword reports on a
     * match, so JS can map the detection straight back to the agent/phrase.
     * Phrases that can't tokenize are logged + skipped. Returns the file text
     * plus the list of phrases that were actually included.
     */
    private fun buildKeywordsFile(dir: File, phrases: List<String>): Pair<String, List<String>> {
      val sb = StringBuilder()
      val kept = ArrayList<String>()
      val seen = HashSet<String>()
      for (raw in phrases) {
        val phrase = raw.trim()
        if (phrase.isEmpty() || !seen.add(phrase.lowercase())) continue
        val tokens = tokenizeForKws(dir, phrase)
        if (tokens == null) {
          Log.w("KillioKWS", "skip keyword (untokenizable): \"$phrase\"")
          continue
        }
        // score 2.0 (easier to survive beam), threshold 0.25 (sherpa default).
        // @phrase preserves the ORIGINAL text as the reported keyword.
        sb.append(tokens).append(" :2.0 #0.25 @").append(phrase).append('\n')
        kept.add(phrase)
      }
      return sb.toString() to kept
    }

    /**
     * Ensure + load the shared KeywordSpotter. Best-effort: returns null (never
     * throws) so 24/7 ASR keeps working even if the KWS model can't be
     * prepared. Cached after first success.
     */
    fun loadSharedKws(ctx: android.content.Context): KeywordSpotter? {
      synchronized(kwsLock) {
        sharedKws?.let { return it }
        if (sharedKwsTried && sharedKws == null) return null
        sharedKwsTried = true
        return try {
          val dir = ensureKwsModelStatic(ctx) ?: return null
          val cfg = KeywordSpotterConfig(
            featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80),
            modelConfig = OnlineModelConfig(
              transducer = OnlineTransducerModelConfig(
                encoder = File(dir, "encoder.onnx").absolutePath,
                decoder = File(dir, "decoder.onnx").absolutePath,
                joiner = File(dir, "joiner.onnx").absolutePath,
              ),
              tokens = File(dir, "tokens.txt").absolutePath,
              numThreads = 1,
              provider = "cpu",
              modelType = "zipformer2",
            ),
            // keywordsFile is required by the data class but we pass keywords
            // PER-STREAM via createStream(keywords), so point it at our generated
            // file (written by setKeywordsStatic) to satisfy construction.
            keywordsFile = File(dir, "keywords.txt").absolutePath,
            keywordsScore = 2.0f,
            keywordsThreshold = 0.25f,
          )
          // Construction reads keywordsFile, so ensure a non-empty default exists.
          ensureDefaultKeywordsFile(ctx, dir)
          val ks = KeywordSpotter(null, cfg)
          sharedKws = ks
          Log.i("KillioKWS", "KeywordSpotter loaded (gigaspeech kws zipformer)")
          ks
        } catch (e: Exception) {
          Log.w("KillioKWS", "KeywordSpotter load failed (wake-word off, fuzzy fallback only): ${e.message}")
          null
        }
      }
    }

    /** Write a default keywords.txt (built-ins only) if none exists yet. */
    private fun ensureDefaultKeywordsFile(ctx: android.content.Context, dir: File) {
      val f = File(dir, "keywords.txt")
      if (f.exists() && f.length() > 0) return
      val (content, _) = buildKeywordsFile(dir, DEFAULT_WAKE_PHRASES)
      try { f.writeText(if (content.isEmpty()) "▁HE Y ▁KI LL I O :2.0 #0.25 @hey killio\n" else content) }
      catch (e: Exception) { Log.w("KillioKWS", "default keywords write failed: ${e.message}") }
    }

    /** Static KWS download (loose HF files). Returns null on failure. */
    private fun ensureKwsModelStatic(ctx: android.content.Context): File? {
      val dir = File(ctx.filesDir, KWS_DIR)
      if (kwsModelComplete(dir)) return dir
      Log.i("KillioKWS", "KWS model incomplete — downloading from $KWS_HF_REPO (first run only)")
      dir.mkdirs()
      return try {
        for ((remote, local) in KWS_FILES) {
          val dest = File(dir, local)
          if (dest.exists() && dest.length() > 0) continue
          val url = "$HF_BASE/$KWS_HF_REPO/resolve/$HF_REVISION/$remote"
          downloadTo(url, dest, null)
        }
        if (kwsModelComplete(dir)) dir else null
      } catch (e: Exception) {
        Log.w("KillioKWS", "KWS model download failed: ${e.message}")
        null
      }
    }

    /** True once the STT model for [language] has been fully downloaded. */
    fun isModelPresent(ctx: android.content.Context, language: String? = null): Boolean =
      sttModelComplete(File(ctx.filesDir, modelFor(language).dir))

    // ── One-shot ↔ continuous-capture mic coordination (UNCHANGED contract) ──
    @Volatile private var instance: VaultSpeechService? = null
    @Volatile private var paused = false

    /**
     * Shared, cached offline OnlineRecognizer instances keyed by language CODE
     * (es/en). A sherpa-onnx OnlineRecognizer is reusable across many streams
     * (createStream() per utterance), so one recognizer per language is opened
     * once and reused by both the continuous loop and the one-shot path.
     */
    private val sharedRecognizers = HashMap<String, OnlineRecognizer>()
    private val modelLock = Any()

    /** Process-wide shared speaker-embedding extractor (lazy, best-effort). */
    @Volatile private var sharedSpk: SpeakerEmbeddingExtractor? = null
    @Volatile private var sharedSpkTried = false
    private val spkLock = Any()

    /**
     * Ensure + load the shared streaming recognizer for [language]. Downloads
     * the model on first run (throws on hard failure / offline first run).
     */
    fun loadSharedRecognizer(ctx: android.content.Context, language: String? = null): OnlineRecognizer {
      val code = langCode(language)
      synchronized(modelLock) {
        sharedRecognizers[code]?.let { return it }
        val dir = ensureSttModelStatic(ctx, code)
          ?: throw java.io.IOException("Sherpa STT model could not be prepared ($code)")
        val r = buildRecognizer(dir)
        sharedRecognizers[code] = r
        return r
      }
    }

    /** Build an OnlineRecognizer over a prepared model dir (loose ONNX files). */
    private fun buildRecognizer(dir: File): OnlineRecognizer {
      val config = OnlineRecognizerConfig(
        featConfig = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = 80),
        modelConfig = OnlineModelConfig(
          transducer = OnlineTransducerModelConfig(
            encoder = File(dir, "encoder.onnx").absolutePath,
            decoder = File(dir, "decoder.onnx").absolutePath,
            joiner = File(dir, "joiner.onnx").absolutePath,
          ),
          tokens = File(dir, "tokens.txt").absolutePath,
          numThreads = 2,
          provider = "cpu",
          // The kroko es/en streaming models are zipformer2 transducers. Setting
          // it explicitly avoids a runtime auto-detect miss (recognizer fails to
          // construct) flagged during integration.
          modelType = "zipformer2",
        ),
        endpointConfig = EndpointConfig(),
        enableEndpoint = true,
        decodingMethod = "greedy_search",
      )
      // assetManager = null → load from absolute filesystem paths (filesDir).
      return OnlineRecognizer(null, config)
    }

    /**
     * Process-wide shared speaker-embedding extractor. Best-effort: returns null
     * (never throws) if the model can't be downloaded/loaded so STT keeps working
     * without voice-ID. Cached after the first successful load.
     */
    fun loadSharedSpk(ctx: android.content.Context): SpeakerEmbeddingExtractor? {
      synchronized(spkLock) {
        sharedSpk?.let { return it }
        if (sharedSpkTried && sharedSpk == null) return null
        sharedSpkTried = true
        return try {
          val f = ensureSpkModelStatic(ctx) ?: return null
          val ext = SpeakerEmbeddingExtractor(
            null,
            SpeakerEmbeddingExtractorConfig(model = f.absolutePath, numThreads = 1, provider = "cpu"),
          )
          sharedSpk = ext
          Log.i("KillioSTT", "Speaker-embedding model loaded (dim=${ext.dim()})")
          ext
        } catch (e: Exception) {
          Log.w("KillioSTT", "Speaker model load failed (continuing without voice-ID): ${e.message}")
          null
        }
      }
    }

    // ── Model presence / download helpers ────────────────────────────────────

    /** All four STT files present in [dir]? */
    private fun sttModelComplete(dir: File): Boolean =
      dir.isDirectory && STT_FILES.all { File(dir, it).let { f -> f.exists() && f.length() > 0 } }

    /**
     * Static STT download (no service instance) so the one-shot can prepare the
     * model with 24/7 capture off. Idempotent + offline after the one-time fetch.
     * Downloads each loose file from the HuggingFace repo. No progress events
     * here (the continuous path drives onModelStatus via the instance method).
     */
    private fun ensureSttModelStatic(ctx: android.content.Context, language: String? = null): File? {
      val sm = modelFor(language)
      val code = langCode(language)
      val dir = File(ctx.filesDir, sm.dir)
      if (sttModelComplete(dir)) return dir

      Log.i("KillioSTT", "[$code] STT model incomplete (one-shot) — downloading from ${sm.hfRepo} (first run only)")
      dir.mkdirs()
      for ((remote, local) in sm.files) {
        val dest = File(dir, local)
        if (dest.exists() && dest.length() > 0) continue
        val url = "$HF_BASE/${sm.hfRepo}/resolve/$HF_REVISION/$remote"
        downloadTo(url, dest, null)
      }
      return if (sttModelComplete(dir)) dir else null
    }

    /** Static speaker-model download (single ONNX). Returns null on failure. */
    private fun ensureSpkModelStatic(ctx: android.content.Context): File? {
      val dest = File(File(ctx.filesDir, SPK_MODEL_DIR).apply { mkdirs() }, SPK_MODEL_FILE)
      if (dest.exists() && dest.length() > 0) return dest
      return try {
        Log.i("KillioSTT", "Speaker model not found — downloading $SPK_MODEL_URL (first run only)")
        downloadTo(SPK_MODEL_URL, dest, null)
        if (dest.exists() && dest.length() > 0) dest else null
      } catch (e: Exception) {
        Log.w("KillioSTT", "Speaker model download failed: ${e.message}")
        null
      }
    }

    /**
     * Download [url] → [dest] following redirects (HuggingFace + GitHub release
     * assets 302 to a CDN). Optionally reports byte progress via [onProgress].
     * Writes to a .part file then renames so a partial download is never seen as
     * complete. Throws on hard failure.
     */
    private fun downloadTo(url: String, dest: File, onProgress: ((downloaded: Long, total: Long) -> Unit)?) {
      val part = File(dest.parentFile, "${dest.name}.part")
      if (part.exists()) part.delete()
      var current = url
      var redirects = 0
      while (true) {
        val conn = (URL(current).openConnection() as HttpURLConnection).apply {
          connectTimeout = 20_000
          readTimeout = 60_000
          requestMethod = "GET"
          instanceFollowRedirects = false
          setRequestProperty("User-Agent", "KillioVault")
        }
        try {
          conn.connect()
          val rc = conn.responseCode
          if (rc in 300..399) {
            val loc = conn.getHeaderField("Location")
              ?: throw java.io.IOException("Redirect with no Location ($rc) for $current")
            if (++redirects > 5) throw java.io.IOException("Too many redirects for $url")
            current = if (loc.startsWith("http")) loc else URL(URL(current), loc).toString()
            continue
          }
          if (rc != HttpURLConnection.HTTP_OK) {
            throw java.io.IOException("HTTP $rc fetching $current")
          }
          val total = conn.contentLength.toLong()
          conn.inputStream.use { input ->
            FileOutputStream(part).use { out ->
              val buffer = ByteArray(64 * 1024)
              var downloaded = 0L
              while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                out.write(buffer, 0, n)
                downloaded += n
                onProgress?.invoke(downloaded, total)
              }
            }
          }
          break
        } finally {
          conn.disconnect()
        }
      }
      if (dest.exists()) dest.delete()
      if (!part.renameTo(dest)) {
        part.copyTo(dest, overwrite = true)
        part.delete()
      }
    }

    /**
     * Normalize PCM16 shorts → [-1,1] floats, which is what every sherpa-onnx
     * acceptWaveform(FloatArray) expects.
     */
    private fun toFloat(buf: ShortArray, len: Int): FloatArray {
      val out = FloatArray(len)
      for (i in 0 until len) out[i] = buf[i] / 32768.0f
      return out
    }

    /**
     * Run one full speech segment ([samples], normalized floats) through a fresh
     * recognizer stream and return the decoded text ("" if none). Stateless per
     * call — uses createStream() + inputFinished() + decode-to-drain.
     */
    private fun decodeSegment(rec: OnlineRecognizer, samples: FloatArray): String {
      val stream: OnlineStream = rec.createStream()
      return try {
        stream.acceptWaveform(samples, SAMPLE_RATE)
        stream.inputFinished()
        while (rec.isReady(stream)) rec.decode(stream)
        val text = rec.getResult(stream).text.trim()
        // Quality verification log: raw decoded text + sample count + duration.
        Log.i(
          "KillioSTT",
          "DECODE segment samples=${samples.size} (~${samples.size * 1000L / SAMPLE_RATE}ms) raw=\"$text\"",
        )
        text
      } finally {
        stream.release()
      }
    }

    /** Speaker embedding for [samples]; null on any failure / not-ready. */
    private fun embedSegment(ext: SpeakerEmbeddingExtractor, samples: FloatArray): FloatArray? {
      return try {
        val s = ext.createStream()
        try {
          s.acceptWaveform(samples, SAMPLE_RATE)
          s.inputFinished()
          if (!ext.isReady(s)) return null
          ext.compute(s)
        } finally {
          s.release()
        }
      } catch (e: Exception) {
        Log.w("KillioSTT", "embed failed: ${e.message}")
        null
      }
    }

    /**
     * One-shot push-to-talk recognition using the SAME sherpa-onnx engine as
     * 24/7 capture. Blocking — call off the main thread. (UNCHANGED contract:
     * pauses the continuous loop for mic exclusivity, returns "" if nothing
     * heard, throws only on hard errors.)
     */
    fun recognizeOnceBlocking(ctx: android.content.Context, language: String): String {
      Log.i("KillioSTT", "[${langCode(language)}] one-shot recognizeOnce (lang=$language)")
      val rec = loadSharedRecognizer(ctx, language)

      val svc = instance
      val didPause = if (svc != null) {
        paused = true
        svc.awaitContinuousIdle(2_000)
        true
      } else false

      var recorder: AudioRecord? = null
      try {
        val minBuf = AudioRecord.getMinBufferSize(
          SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
        )
        val frameSamples = maxOf(minBuf / 2, SAMPLE_RATE / 5)
        val bufSize = maxOf(minBuf, frameSamples * 2)

        recorder = AudioRecord(
          MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
          AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize,
        )
        if (recorder.state != AudioRecord.STATE_INITIALIZED) {
          throw java.io.IOException("AudioRecord failed to initialize (one-shot)")
        }

        // Stream straight into a single OnlineStream with endpointing — return
        // as soon as sherpa detects an endpoint (end of utterance), with a crude
        // amplitude silence-timeout and a hard cap as safety nets.
        val stream = rec.createStream()
        try {
          val buf = ShortArray(frameSamples)
          recorder.startRecording()
          val startMs = System.currentTimeMillis()
          val hardCapMs = 10_000L
          val silenceTimeoutMs = 1_500L
          var speechStarted = false
          var lastVoiceMs = startMs
          while (true) {
            val read = recorder.read(buf, 0, frameSamples)
            if (read <= 0) {
              if (System.currentTimeMillis() - startMs > hardCapMs) break
              continue
            }
            var peak = 0
            for (i in 0 until read) {
              val a = kotlin.math.abs(buf[i].toInt())
              if (a > peak) peak = a
            }
            val now = System.currentTimeMillis()
            if (peak > 700) { speechStarted = true; lastVoiceMs = now }

            stream.acceptWaveform(toFloat(buf, read), SAMPLE_RATE)
            while (rec.isReady(stream)) rec.decode(stream)
            if (rec.isEndpoint(stream)) {
              val text = rec.getResult(stream).text.trim()
              if (text.isNotEmpty()) return text
              rec.reset(stream)
            }
            if (speechStarted && now - lastVoiceMs > silenceTimeoutMs) break
            if (now - startMs > hardCapMs) break
          }
          stream.inputFinished()
          while (rec.isReady(stream)) rec.decode(stream)
          return rec.getResult(stream).text.trim()
        } finally {
          stream.release()
        }
      } finally {
        try { recorder?.stop() } catch (_: Exception) {}
        try { recorder?.release() } catch (_: Exception) {}
        if (didPause) {
          paused = false
          instance?.resumeContinuous()
        }
      }
    }
  }

  private var wakeLock: PowerManager.WakeLock? = null
  private var worker: Thread? = null
  @Volatile private var running = false

  /** Recognition language code (es/en) for THIS session. */
  @Volatile private var langCode: String = DEFAULT_LANG

  @Volatile private var recognizer: OnlineRecognizer? = null
  @Volatile private var vad: Vad? = null
  @Volatile private var spk: SpeakerEmbeddingExtractor? = null
  @Volatile private var audioRecord: AudioRecord? = null

  // ── Keyword-spotting (wake-word) per-session state ────────────────────────
  /** Shared spotter (process-lifetime) used by this session, if loaded. */
  @Volatile private var kws: KeywordSpotter? = null
  /** This session's KWS stream, fed the SAME PCM frames as the ASR/VAD loop. */
  @Volatile private var kwsStream: OnlineStream? = null
  /** Current wake keywords (built-ins + agent phrases). Mutable via setKeywords. */
  @Volatile private var kwsKeywords: List<String> = DEFAULT_WAKE_PHRASES
  /** Pending keyword list requested via setKeywords() while the loop runs; the
   *  loop swaps the stream on the next iteration (cheap, no service restart). */
  @Volatile private var pendingKeywords: List<String>? = null
  private val kwsStreamLock = Any()

  @Volatile private var continuousIdle = false
  private val pauseLock = Any()

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    instance = this
  }

  fun awaitContinuousIdle(timeoutMs: Long) {
    val deadline = System.currentTimeMillis() + timeoutMs
    while (!continuousIdle && System.currentTimeMillis() < deadline) {
      try { Thread.sleep(20) } catch (_: InterruptedException) { break }
    }
  }

  fun resumeContinuous() {
    synchronized(pauseLock) { (pauseLock as Object).notifyAll() }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val notifText = intent?.getStringExtra("notificationText") ?: "Killio Vault is listening"
    langCode = Companion.langCode(intent?.getStringExtra("language"))

    // Wake keywords passed from JS (agent names + wake phrases). Built-ins are
    // always merged in below. A re-delivered start intent (e.g. after agents
    // change) updates the keyword set live via pendingKeywords.
    val reloadOnly = intent?.getBooleanExtra("keywordsReloadOnly", false) ?: false
    intent?.getStringArrayExtra("keywords")?.let { arr ->
      val merged = (DEFAULT_WAKE_PHRASES + arr.toList())
        .map { it.trim() }.filter { it.isNotEmpty() }.distinct()
      if (running) {
        // Loop already running → hot-swap on the next iteration.
        pendingKeywords = merged
      } else {
        kwsKeywords = merged
      }
    }

    // A keyword-reload-only delivery (setKeywords) must NOT spin up capture if it
    // isn't already running — the user may have capture off. Bail without
    // becoming a foreground service in that case.
    if (reloadOnly && !running) {
      stopSelf()
      return START_NOT_STICKY
    }

    if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
        != PackageManager.PERMISSION_GRANTED) {
      stopSelf()
      return START_NOT_STICKY
    }

    startForegroundWithNotification(notifText)
    acquireWakeLock()

    if (!running) {
      running = true
      worker = thread(start = true) { recognitionLoop() }
    }
    return START_STICKY
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val pm = getSystemService(PowerManager::class.java)
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "KillioVault:speech").apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun releaseWakeLock() {
    try {
      if (wakeLock?.isHeld == true) wakeLock?.release()
    } catch (_: Exception) {}
    wakeLock = null
  }

  /** Emit a model lifecycle update to JS (UNCHANGED contract). */
  private fun emitModelStatus(state: String, progress: Int = -1, bytes: Long = -1, total: Long = -1, message: String? = null) {
    emitter?.invoke("onModelStatus", Bundle().apply {
      putString("state", state)
      if (progress >= 0) putInt("progress", progress)
      if (bytes >= 0) putLong("bytes", bytes)
      if (total >= 0) putLong("total", total)
      if (message != null) putString("message", message)
    })
  }

  /**
   * Worker body: ensure + load STT model (drives onModelStatus) → load Silero
   * VAD → load speaker model (best-effort) → open AudioRecord → stream PCM into
   * the VAD, decode each finished speech segment + compute its speaker embedding.
   */
  private fun recognitionLoop() {
    val rec: OnlineRecognizer = try {
      ensureSttModelWithProgress()        // download bar
      loadSharedRecognizer(this, langCode) // shared, cached
    } catch (e: Exception) {
      emitError("Sherpa STT model unavailable (offline first run?): ${e.message}")
      stopSelf()
      return
    }
    recognizer = rec
    Log.i("KillioSTT", "[$langCode] Recognizer loaded (sherpa-onnx, shared)")

    // Silero VAD — gates decoding. Required for the streaming loop; if it can't
    // be prepared we fail the session (the whole point is VAD-gated decode).
    val v: Vad = try {
      val vadFile = ensureVadModelWithProgress()
        ?: throw java.io.IOException("Silero VAD model could not be prepared")
      Vad(
        null,
        VadModelConfig(
          sileroVadModelConfig = SileroVadModelConfig(
            model = vadFile.absolutePath,
            threshold = 0.5f,
            minSilenceDuration = 0.25f,
            minSpeechDuration = 0.25f,
            windowSize = 512,
            maxSpeechDuration = 8.0f,
          ),
          sampleRate = SAMPLE_RATE,
          numThreads = 1,
          provider = "cpu",
        ),
      )
    } catch (e: Exception) {
      emitError("Silero VAD unavailable (offline first run?): ${e.message}")
      stopSelf()
      return
    }
    vad = v

    // Speaker-embedding model (best-effort voice-ID). STT keeps working without.
    spk = loadSharedSpk(this)
    if (spk == null) Log.w("KillioSTT", "Speaker model unavailable — continuing without voice-ID")

    // Keyword-spotter (best-effort wake-word). Runs IN PARALLEL with the ASR on
    // the SAME PCM frames (NOT VAD-gated — wake must trigger any time). If it
    // can't load, capture/ASR continue and JS falls back to fuzzy transcript
    // matching. Downloads the KWS model on first run (separate from the ASR).
    kws = loadSharedKwsWithProgress()
    if (kws != null) {
      openKwsStream(kwsKeywords)
      Log.i("KillioKWS", "wake-word spotter active with ${kwsKeywords.size} keywords")
    } else {
      Log.w("KillioKWS", "KWS unavailable — wake-word falls back to JS transcript matcher")
    }

    val minBuf = AudioRecord.getMinBufferSize(
      SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
    )
    // Silero VAD wants 512-sample (32ms @16k) windows. Read that many shorts per
    // pull (but never below the device minimum buffer).
    val frameSamples = maxOf(minBuf / 2, 512)
    val bufSize = maxOf(minBuf, frameSamples * 2)
    val buf = ShortArray(frameSamples)

    fun openRecorder(): AudioRecord? {
      val r = try {
        AudioRecord(
          MediaRecorder.AudioSource.MIC, SAMPLE_RATE,
          AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, bufSize,
        )
      } catch (e: SecurityException) {
        emitError("Microphone permission denied")
        return null
      }
      if (r.state != AudioRecord.STATE_INITIALIZED) {
        emitError("AudioRecord failed to initialize")
        r.release()
        return null
      }
      r.startRecording()
      audioRecord = r
      return r
    }

    var recorder = openRecorder() ?: run { stopSelf(); return }
    emitModelStatus("ready")
    Log.i("KillioSTT", "[$langCode] sherpa-onnx ready, AudioRecord started (16kHz) — VAD-gated loop running")
    try {
      while (running) {
        // ── One-shot coordination (UNCHANGED) ────────────────────────────────
        if (paused) {
          try { recorder.stop() } catch (_: Exception) {}
          try { recorder.release() } catch (_: Exception) {}
          audioRecord = null
          v.reset()
          continuousIdle = true
          synchronized(pauseLock) {
            while (paused && running) {
              try { (pauseLock as Object).wait(500) } catch (_: InterruptedException) {}
            }
          }
          continuousIdle = false
          if (!running) break
          val reopened = openRecorder()
          if (reopened == null) { stopSelf(); break }
          recorder = reopened
          // Reset the wake stream so the gap during the one-shot doesn't leave
          // stale partial state that could mis-fire on resume.
          kws?.let { ks -> kwsStream?.let { try { ks.reset(it) } catch (_: Exception) {} } }
          Log.i("KillioSTT", "Continuous capture resumed after one-shot")
          continue
        }

        val read = recorder.read(buf, 0, frameSamples)
        if (read <= 0) continue

        val floats = toFloat(buf, read)

        // ── Wake-word (KWS) — parallel, NOT VAD-gated ─────────────────────────
        // Feed the SAME raw frames into the keyword spotter continuously so the
        // wake phrase fires any time. Cheap (small model, single thread). A
        // pending keyword change (setKeywords) is applied here by re-opening the
        // stream. Wrapped so a KWS error can never break ASR/diary.
        try {
          pendingKeywords?.let { next ->
            pendingKeywords = null
            kwsKeywords = next
            if (kws != null) {
              openKwsStream(next)
              Log.i("KillioKWS", "wake keywords reloaded (${next.size})")
            }
          }
          val ks = kws
          val kstream = kwsStream
          if (ks != null && kstream != null) {
            kstream.acceptWaveform(floats, SAMPLE_RATE)
            while (ks.isReady(kstream)) ks.decode(kstream)
            val kw = ks.getResult(kstream).keyword
            if (kw.isNotEmpty()) {
              Log.i("KillioKWS", "WAKE keyword=\"$kw\"")
              emitWake(kw)
              // Reset so the same keyword can fire again on the next utterance.
              ks.reset(kstream)
            }
          }
        } catch (e: Exception) {
          Log.w("KillioKWS", "KWS feed failed: ${e.message}")
        }

        // Feed normalized floats to Silero VAD. When a speech segment finishes,
        // VAD.front() holds the full segment samples — decode + embed it.
        v.acceptWaveform(floats)
        while (!v.empty()) {
          val segment = v.front()
          v.pop()
          val samples = segment.samples
          if (samples.isEmpty()) continue
          val text = try {
            decodeSegment(rec, samples)
          } catch (e: Exception) {
            Log.w("KillioSTT", "decode failed: ${e.message}")
            ""
          }
          if (text.isEmpty()) continue
          val embedding = spk?.let { embedSegment(it, samples) }
          emitTranscript(text, embedding)
        }
      }
    } catch (e: Exception) {
      if (running) emitError(e.message ?: "recognition error")
    } finally {
      audioRecord?.let {
        try { it.stop() } catch (_: Exception) {}
        try { it.release() } catch (_: Exception) {}
      }
      audioRecord = null
    }
  }

  /**
   * Emit a finalized segment to JS (UNCHANGED contract). When a speaker
   * embedding is present, forward it as the "spk" field — a JSON-array STRING,
   * exactly the shape the Vosk x-vector used — so KillioSpeech.ts parses it and
   * voiceprint.ts compares it (now dim-agnostic; CAM++ emits 192 dims).
   */
  private fun emitTranscript(text: String, embedding: FloatArray?) {
    Log.i("KillioSTT", "TRANSCRIPT: $text")
    emitter?.invoke("onTranscript", Bundle().apply {
      putString("text", text)
      putDouble("ts", System.currentTimeMillis().toDouble())
      if (embedding != null && embedding.isNotEmpty()) {
        val arr = JSONArray()
        for (f in embedding) arr.put(f.toDouble())
        putString("spk", arr.toString())
      }
    })
  }

  /**
   * Emit a wake-word detection to JS. NEW event contract:
   *   onWake { keyword: String, ts: Double (UTC ms) }
   * [keyword] is the ORIGINAL phrase text (from the "@phrase" suffix in the
   * keywords file), so JS maps it back to the matching agent / default assistant.
   */
  private fun emitWake(keyword: String) {
    emitter?.invoke("onWake", Bundle().apply {
      putString("keyword", keyword)
      putDouble("ts", System.currentTimeMillis().toDouble())
    })
  }

  /**
   * (Re)create this session's KWS stream for [phrases]. The keyword set is passed
   * INLINE to createStream(keywords) as the keywords-file content (sherpa accepts
   * the same line format via the stream argument), so changing keywords is cheap
   * — just swap the stream, no spotter/service rebuild. The old stream is
   * released. Best-effort: a failure leaves kwsStream null (wake-word silently
   * off until the next attempt) but never breaks ASR.
   */
  private fun openKwsStream(phrases: List<String>) {
    val ks = kws ?: return
    val dir = File(filesDir, KWS_DIR)
    synchronized(kwsStreamLock) {
      val (content, kept) = buildKeywordsFile(dir, phrases)
      try {
        kwsStream?.release()
      } catch (_: Exception) {}
      kwsStream = try {
        // Inline keywords string; empty → spotter uses its configured default file.
        ks.createStream(content)
      } catch (e: Exception) {
        Log.w("KillioKWS", "createStream(keywords) failed: ${e.message}")
        null
      }
      Log.i("KillioKWS", "KWS stream open with ${kept.size}/${phrases.size} keywords")
    }
  }

  /**
   * Replace the active wake keywords live (no service restart). Stores them as
   * pending; the recognition loop swaps the stream on its next iteration. Safe to
   * call from any thread / before the loop starts.
   */
  fun setKeywords(phrases: List<String>) {
    val merged = (DEFAULT_WAKE_PHRASES + phrases)
      .map { it.trim() }.filter { it.isNotEmpty() }.distinct()
    if (running) pendingKeywords = merged else kwsKeywords = merged
  }

  /** KWS model load with onModelStatus progress (first-run download). */
  private fun loadSharedKwsWithProgress(): KeywordSpotter? {
    val dir = File(filesDir, KWS_DIR)
    if (!kwsModelCompleteInstance(dir)) {
      // Surface the (small) KWS download on the same banner as the ASR/VAD.
      emitModelStatus("downloading", progress = 0, bytes = 0, total = -1)
    }
    return loadSharedKws(this)
  }

  /** Instance accessor for the companion's KWS-complete check. */
  private fun kwsModelCompleteInstance(dir: File): Boolean =
    File(dir, "encoder.onnx").let { it.exists() && it.length() > 0 } &&
      File(dir, "tokens.txt").let { it.exists() && it.length() > 0 }

  /** STT model download with onModelStatus progress (continuous path). */
  private fun ensureSttModelWithProgress(): File? {
    val sm = modelFor(langCode)
    val dir = File(filesDir, sm.dir)
    if (sttModelComplete(dir)) {
      Log.i("KillioSTT", "[$langCode] STT model already present (offline) at ${dir.absolutePath}")
      emitModelStatus("ready")
      return dir
    }

    Log.i("KillioSTT", "[$langCode] STT model not found — downloading from ${sm.hfRepo} (first run only)")
    dir.mkdirs()
    // The encoder dominates (~70–155MB); weight progress by file index so the
    // bar advances smoothly across the four files.
    val n = sm.files.size
    emitModelStatus("downloading", progress = 0, bytes = 0, total = -1)
    sm.files.forEachIndexed { idx, (remote, local) ->
      val dest = File(dir, local)
      if (dest.exists() && dest.length() > 0) return@forEachIndexed
      val url = "$HF_BASE/${sm.hfRepo}/resolve/$HF_REVISION/$remote"
      var lastEmit = 0L
      downloadTo(url, dest) { downloaded, total ->
        val now = System.currentTimeMillis()
        if (now - lastEmit >= 500L) {
          lastEmit = now
          val filePct = if (total > 0) (downloaded.toDouble() / total) else 0.0
          val pct = (((idx + filePct) / n) * 100).toInt().coerceIn(0, 100)
          emitModelStatus("downloading", progress = pct, bytes = downloaded, total = if (total > 0) total else -1)
        }
      }
    }
    emitModelStatus("preparing") // recognizer construction is the "prepare" step
    return if (sttModelComplete(dir)) dir else null
  }

  /** Silero VAD download with progress. */
  private fun ensureVadModelWithProgress(): File? {
    val dest = File(File(filesDir, VAD_DIR).apply { mkdirs() }, VAD_FILE)
    if (dest.exists() && dest.length() > 0) return dest
    Log.i("KillioSTT", "Silero VAD not found — downloading $VAD_URL (first run only)")
    return try {
      var lastEmit = 0L
      downloadTo(VAD_URL, dest) { downloaded, total ->
        val now = System.currentTimeMillis()
        if (now - lastEmit >= 500L) {
          lastEmit = now
          val pct = if (total > 0) ((downloaded * 100L) / total).toInt().coerceIn(0, 100) else -1
          emitModelStatus("downloading", progress = pct, bytes = downloaded, total = if (total > 0) total else -1)
        }
      }
      if (dest.exists() && dest.length() > 0) dest else null
    } catch (e: Exception) {
      Log.w("KillioSTT", "Silero VAD download failed: ${e.message}")
      null
    }
  }

  private fun emitError(message: String) {
    Log.e("KillioSTT", "ERROR: $message")
    emitter?.invoke("onError", Bundle().apply { putString("message", message) })
    emitModelStatus("error", message = message)
  }

  private fun startForegroundWithNotification(text: String) {
    val nm = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      nm.createNotificationChannel(
        NotificationChannel(CHANNEL_ID, "Killio Vault speech", NotificationManager.IMPORTANCE_LOW),
      )
    }
    val notification: Notification = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle("Killio Vault")
      .setContentText(text)
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
    } else {
      startForeground(NOTIF_ID, notification)
    }
  }

  override fun onDestroy() {
    running = false
    synchronized(pauseLock) { (pauseLock as Object).notifyAll() }
    releaseWakeLock()
    worker?.join(800)
    worker = null
    try { audioRecord?.let { if (it.state == AudioRecord.STATE_INITIALIZED) it.release() } } catch (_: Exception) {}
    audioRecord = null
    // Do NOT release the shared recognizer / speaker extractor / KWS spotter —
    // they're the process-lifetime shared instances reused by the one-shot path.
    // The VAD and the per-session KWS STREAM are per-session, so release them.
    try { vad?.release() } catch (_: Exception) {}
    vad = null
    synchronized(kwsStreamLock) {
      try { kwsStream?.release() } catch (_: Exception) {}
      kwsStream = null
    }
    kws = null
    recognizer = null
    spk = null
    if (instance === this) instance = null
    super.onDestroy()
  }
}
