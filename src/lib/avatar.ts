import { API_BASE_URL } from '@/core/api/config';

/**
 * Resolve a user's avatar URL to an absolute URL usable by <Image>.
 *
 * Ported from Killio-Frontend `src/lib/gravatar.ts#getUserAvatarUrl`: the
 * backend stores avatars as relative paths like `/uploads/image/…`, which the
 * web prefixes with the API base URL. Vault does the same using
 * `API_BASE_URL`. Already-absolute URLs (http/https/data/file) pass through.
 *
 * Returns null when there's no avatar — callers fall back to initials.
 */
export function resolveAvatarUrl(avatarUrl?: string | null): string | null {
  if (!avatarUrl) return null;
  if (avatarUrl.startsWith('/uploads/') || avatarUrl.startsWith('uploads/')) {
    const normalizedPath = avatarUrl.startsWith('/') ? avatarUrl : `/${avatarUrl}`;
    return `${API_BASE_URL}${normalizedPath}`;
  }
  return avatarUrl;
}

/** First-letter initial fallback shown when there's no avatar image. */
export function avatarInitial(name?: string | null, email?: string | null): string {
  return (name ?? email ?? '?').charAt(0).toUpperCase();
}
