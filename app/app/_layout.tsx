import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { startAutoDrain } from '../src/sync/queue';
import { colors } from '../src/theme';

export default function RootLayout() {
  // Drains on foreground, and on a slow heartbeat while anything is waiting.
  useEffect(() => startAutoDrain(), []);

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="(tabs)" />
        {/* The logger takes the whole screen — nothing to tap by accident. */}
        <Stack.Screen name="workout" options={{ animation: 'slide_from_bottom' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
