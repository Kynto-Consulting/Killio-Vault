import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

import { getTorch, subscribeTorch } from './torch';

/**
 * Invisible host for the device torch. expo-camera 16 only exposes the torch
 * through the <CameraView enableTorch> prop, so we keep a 1x1, off-screen
 * CameraView mounted at the app root and flip `enableTorch` when the
 * `flashlight` client-action calls setTorch(). When the torch is off we unmount
 * the camera entirely so it doesn't hold the camera device.
 *
 * Mounted once in app/_layout.tsx.
 */
export function TorchHost() {
  const [on, setOn] = useState(getTorch());
  const [permission] = useCameraPermissions();

  useEffect(() => subscribeTorch(setOn), []);

  if (!on || !permission?.granted) return null;

  return (
    <View style={styles.hidden} pointerEvents="none">
      <CameraView style={styles.cam} enableTorch facing="back" />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -10,
    top: -10,
  },
  cam: { width: 1, height: 1 },
});
