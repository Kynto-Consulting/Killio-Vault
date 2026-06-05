import { api } from './http';

/**
 * Embeds text via the backend (POST /ai/embed) so on-device agent memory shares
 * the server's vector space. Returns one vector per non-empty input.
 */
export async function embedTexts(
  texts: string[],
  inputType: 'search_document' | 'search_query' = 'search_query',
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const { data } = await api.post<{ vectors: number[][]; dim: number }>(
    '/ai/embed',
    { texts, inputType },
  );
  return data.vectors ?? [];
}

export async function embedOne(
  text: string,
  inputType: 'search_document' | 'search_query' = 'search_query',
): Promise<number[]> {
  const [v] = await embedTexts([text], inputType);
  return v ?? [];
}
