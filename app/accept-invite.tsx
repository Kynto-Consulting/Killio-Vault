import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * `https://killio.dev/accept-invite?token=…` is the canonical accept-invite
 * URL the backend emails out and also returns from `POST /teams/:id/invites`.
 * In Vault we just forward to the actual screen at `/teams/accept`, preserving
 * the token so the same handler runs whether the user landed via universal
 * link, paste, or the killiovault:// scheme.
 */
export default function AcceptInviteRedirect() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  return (
    <Redirect
      href={
        token
          ? { pathname: '/teams/accept', params: { token: String(token) } }
          : '/teams/accept'
      }
    />
  );
}
