import * as SecureStore from 'expo-secure-store';

/**
 * Offline owner voice-ID ("voiceprint").
 *
 * The on-device speaker model emits a speaker EMBEDDING (`spk`) for every final
 * utterance. We enroll the owner once by averaging a handful of those vectors
 * into a single L2-normalized voiceprint, persisted locally. On each later
 * transcript we compare its embedding to the stored voiceprint by cosine
 * similarity; >= a threshold means "this is the owner". Fully on-device — no
 * audio or vectors ever leave the phone.
 *
 * DIM-AGNOSTIC: this module never hardcodes the embedding dimension — enroll()
 * uses whatever length arrives and cosineSimilarity() only compares
 * equal-length vectors. The engine migrated from Vosk (128-dim x-vector) to
 * sherpa-onnx 3D-Speaker CAM++ (192-dim); no change was needed here beyond the
 * match threshold (CAM++ same-speaker cosine sits lower than Vosk x-vectors —
 * see DEFAULT_MATCH_THRESHOLD).
 *
 * This gates only the WAKE/assistant action: when a voiceprint is enrolled, the
 * wake word fires only for the owner. With no voiceprint enrolled the system
 * behaves as before (anyone can wake) — strictly opt-in. Diary capture is never
 * gated.
 */

const VOICEPRINT_KEY = 'killio.voiceprint';

/** Default match threshold for cosine similarity (tunable).
 *  Engine note: with sherpa-onnx 3D-Speaker CAM++ embeddings, same-speaker
 *  cosine typically sits ~0.65+ while different speakers fall below ~0.45, so
 *  the threshold is 0.65 (the old Vosk x-vector value was 0.80, which is too
 *  strict for CAM++ and would reject the owner). */
export const DEFAULT_MATCH_THRESHOLD = 0.65;

/** L2-normalize a vector. Returns a zero vector unchanged (avoids /0). */
function l2normalize(v: number[]): number[] {
  let sum = 0;
  for (const x of v) sum += x * x;
  const norm = Math.sqrt(sum);
  if (norm === 0) return v.slice();
  return v.map((x) => x / norm);
}

/**
 * Cosine similarity of two equal-length vectors, in [-1, 1]. Returns 0 for
 * empty / mismatched-length / zero-norm inputs (treated as "no match").
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Build an owner voiceprint from a set of enrollment x-vectors: per-dimension
 * mean, then L2-normalized, and persist it. Throws if given no usable vectors.
 */
export async function enroll(vectors: number[][]): Promise<number[]> {
  const usable = (vectors ?? []).filter((v) => Array.isArray(v) && v.length > 0);
  if (usable.length === 0) {
    throw new Error('No speaker vectors to enroll');
  }
  const dim = usable[0].length;
  const same = usable.filter((v) => v.length === dim);
  const mean = new Array<number>(dim).fill(0);
  for (const v of same) {
    for (let i = 0; i < dim; i++) mean[i] += v[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= same.length;
  const voiceprint = l2normalize(mean);
  await SecureStore.setItemAsync(VOICEPRINT_KEY, JSON.stringify(voiceprint));
  return voiceprint;
}

/** The enrolled owner voiceprint, or null if none has been enrolled yet. */
export async function getVoiceprint(): Promise<number[] | null> {
  const raw = await SecureStore.getItemAsync(VOICEPRINT_KEY);
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.every((n) => typeof n === 'number') ? v : null;
  } catch {
    return null;
  }
}

/** Whether an owner voiceprint is currently enrolled. */
export async function hasVoiceprint(): Promise<boolean> {
  return (await getVoiceprint()) !== null;
}

/** Remove the enrolled voiceprint (reverts to open/anyone-can-wake behavior). */
export async function clear(): Promise<void> {
  await SecureStore.deleteItemAsync(VOICEPRINT_KEY);
}

/**
 * Whether an utterance's x-vector matches a voiceprint at/above `threshold`.
 * Pure helper (no storage) so callers can pass a cached voiceprint and reuse it
 * across many transcripts without re-reading SecureStore.
 */
export function matchesVoiceprint(
  spk: number[],
  voiceprint: number[],
  threshold: number = DEFAULT_MATCH_THRESHOLD,
): boolean {
  return cosineSimilarity(spk, voiceprint) >= threshold;
}

/**
 * Convenience: load the stored voiceprint and test `spk` against it. Returns
 * false when nothing is enrolled. Prefer matchesVoiceprint() in hot paths to
 * avoid a SecureStore read per transcript.
 */
export async function matchesOwner(
  spk: number[],
  threshold: number = DEFAULT_MATCH_THRESHOLD,
): Promise<boolean> {
  const vp = await getVoiceprint();
  if (!vp) return false;
  return matchesVoiceprint(spk, vp, threshold);
}
