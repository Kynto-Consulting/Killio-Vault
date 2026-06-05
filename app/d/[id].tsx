import { useLocalSearchParams, Redirect } from 'expo-router';

// /d/<id> mirrors the web doc URL. Forward to /document/<id> so the same UI
// (BrickEditor + BrickRenderer) renders regardless of which path you reach.
export default function DocDetailAlias() {
  const params = useLocalSearchParams<{ id: string; title?: string }>();
  return (
    <Redirect
      href={{
        pathname: '/document/[id]',
        params: { id: String(params.id), title: params.title ?? '' },
      }}
    />
  );
}
