import { Redirect } from 'expo-router';
import { ActivityIndicator, Image, View } from 'react-native';

import { useAuth } from '@/core/auth/AuthContext';
import { useAppMode } from '@/nav/AppModeContext';

/** Auth gate: routes to login or the per-mode landing screen. */
export default function Index() {
  const { status } = useAuth();
  const { mode } = useAppMode();

  if (status === 'loading') {
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

  if (status !== 'signedIn') return <Redirect href="/login" />;
  return <Redirect href={mode === 'workspace' ? '/workspace' : '/assistant'} />;
}
