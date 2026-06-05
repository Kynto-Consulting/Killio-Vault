import { Share } from 'react-native';
import * as Sharing from 'expo-sharing';

/** Native share sheet for arbitrary text — falls through to system share. */
export async function shareText(opts: { title?: string; message: string }): Promise<{ shared: boolean }> {
  try {
    const res = await Share.share({ title: opts.title, message: opts.message });
    return { shared: res.action === Share.sharedAction };
  } catch {
    return { shared: false };
  }
}

/** Share a local file URI through the system picker (expo-sharing). */
export async function shareFile(uri: string, mimeType?: string): Promise<{ shared: boolean }> {
  try {
    if (!(await Sharing.isAvailableAsync())) return { shared: false };
    await Sharing.shareAsync(uri, mimeType ? { mimeType } : undefined);
    return { shared: true };
  } catch {
    return { shared: false };
  }
}
