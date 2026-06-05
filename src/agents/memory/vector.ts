/** Pure vector math for on-device memory similarity. */

export function dot(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

export function norm(a: number[]): number {
  return Math.sqrt(dot(a, a));
}

export function cosine(a: number[], b: number[]): number {
  const na = norm(a);
  const nb = norm(b);
  if (na === 0 || nb === 0) return 0;
  return dot(a, b) / (na * nb);
}

/** Returns the indices of the top-k items by cosine similarity to `query`. */
export function topK(
  query: number[],
  vectors: number[][],
  k: number,
): Array<{ index: number; score: number }> {
  const scored = vectors.map((v, index) => ({ index, score: cosine(query, v) }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, k));
}
