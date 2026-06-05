import { SttEngine, Utterance } from './types';

/**
 * On-device whisper.cpp engine (whisper.rn). Requires the custom dev-build —
 * the native module isn't present in Expo Go, so we lazy-require it and surface
 * a clear error if missing. This keeps Phase-0/JS iteration unblocked.
 */
export class WhisperEngine implements SttEngine {
  readonly name = 'whisper_on_device';
  private ctx: any = null;

  async init(modelPath: string): Promise<void> {
    let initWhisper: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ({ initWhisper } = require('whisper.rn'));
    } catch {
      throw new Error(
        'whisper.rn not available — run the Vault dev-build APK (not Expo Go).',
      );
    }
    this.ctx = await initWhisper({ filePath: modelPath });
  }

  async transcribe(utt: Utterance): Promise<string> {
    if (!this.ctx) throw new Error('WhisperEngine not initialized');
    // whisper.rn transcribes a wav/pcm buffer; the native bridge accepts raw
    // 16k mono PCM. Returns { result }.
    const { result } = await this.ctx.transcribeData(utt.pcm, {
      language: 'auto',
    });
    return (result ?? '').trim();
  }
}

/**
 * No-op engine used in Expo Go / when no model is loaded. Returns '' so the
 * pipeline runs end-to-end (capture → VAD → outbox) without real transcription.
 */
export class NullEngine implements SttEngine {
  readonly name = 'null';
  async transcribe(): Promise<string> {
    return '';
  }
}

let active: SttEngine = new NullEngine();

export function setSttEngine(engine: SttEngine): void {
  active = engine;
}

export function getSttEngine(): SttEngine {
  return active;
}
