/** A finalized utterance ready to transcribe. */
export interface Utterance {
  /** 16-bit PCM mono samples for the utterance. */
  pcm: Int16Array;
  /** Sample rate (Hz). */
  sampleRate: number;
  /** UTC epoch ms when the utterance started. */
  startedAt: number;
}

export interface TranscriptSegment {
  text: string;
  /** UTC epoch ms (global time unit) — start of the utterance. */
  ts: number;
  source: string;
}

/** Pluggable speech-to-text backend (on-device whisper, OS recognizer, cloud). */
export interface SttEngine {
  readonly name: string;
  /** Returns transcript text for an utterance, or '' if nothing recognized. */
  transcribe(utt: Utterance): Promise<string>;
}
