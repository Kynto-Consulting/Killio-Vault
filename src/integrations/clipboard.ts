import * as Clipboard from 'expo-clipboard';

/** Reads + writes the system clipboard. Async on both platforms. */
export async function read(): Promise<string> {
  return Clipboard.getStringAsync();
}

export async function write(text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
}
