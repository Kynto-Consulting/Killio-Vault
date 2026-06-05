import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Image, View } from 'react-native';

import { useAuth } from '@/core/auth/AuthContext';
import { useAppMode } from '@/nav/AppModeContext';
import { useLocalWorkspace } from '@/local-workspace/LocalWorkspaceProvider';

/**
 * Auth gate. Uses an imperative `router.replace` instead of `<Redirect />` so
 * the router stack never lingers on the index screen — the previous Redirect
 * caused the side-nav list to flash on cold start while expo-router decided
 * which target to mount.
 */
export default function Index() {
  const router = useRouter();
  const { status } = useAuth();
  const { mode } = useAppMode();
  const local = useLocalWorkspace();

  useEffect(() => {
    if (status === 'loading') return;
    // Local mode is sign-in-free — if the user previously selected a local
    // workspace they land straight in /documents without needing the cloud.
    if (local.mode === 'local') {
      router.replace('/documents');
      return;
    }
    if (status !== 'signedIn') {
      router.replace('/login');
      return;
    }
    router.replace(mode === 'workspace' ? '/workspace' : '/assistant');
  }, [router, status, mode, local.mode]);

  return (
    <View className="flex-1 items-center justify-center gap-6 bg-background">
      <Image
        source={require('../assets/killio_white.webp')}
        className="h-9 w-32"
        resizeMode="contain"
      />
      <ActivityIndicator color="#a1a1a1" />
    </View>
  );
}
