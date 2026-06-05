import { Redirect } from 'expo-router';
import { ActivityIndicator, Image, View } from 'react-native';

import { useAuth } from '@/core/auth/AuthContext';

/** Auth gate: routes to login or home once the session status is known. */
export default function Index() {
  const { status } = useAuth();

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

  return <Redirect href={status === 'signedIn' ? '/assistant' : '/login'} />;
}
