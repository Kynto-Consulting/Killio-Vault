import { API_BASE_URL } from './config';
import { getAccessToken } from '../auth/token-store';

export interface UploadResult {
  url?: string;
  key?: string;
  [k: string]: unknown;
}

/**
 * Uploads a local file (e.g. a screenshot) to POST /uploads (multipart, field
 * "file"). Used by the vault_upload_screenshot client-action when the AI decides
 * a screenshot should go to the cloud.
 */
export async function uploadFile(input: {
  uri: string;
  name: string;
  type: string;
  ownerScopeType?: string;
  ownerScopeId?: string;
  usage?: string;
}): Promise<UploadResult> {
  const token = await getAccessToken();
  const form = new FormData();
  // React Native FormData file shape:
  form.append('file', {
    uri: input.uri,
    name: input.name,
    type: input.type,
  } as any);
  if (input.ownerScopeType) form.append('ownerScopeType', input.ownerScopeType);
  if (input.ownerScopeId) form.append('ownerScopeId', input.ownerScopeId);
  if (input.usage) form.append('usage', input.usage);

  const res = await fetch(`${API_BASE_URL}/uploads`, {
    method: 'POST',
    headers: { Authorization: token ? `Bearer ${token}` : '' },
    body: form,
  });
  if (!res.ok) {
    throw new Error(`upload failed (${res.status})`);
  }
  return (await res.json()) as UploadResult;
}
