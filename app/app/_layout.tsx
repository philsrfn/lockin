import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadConfig } from '../src/api/config';
import { SetupScreen } from '../src/components/SetupScreen';
import { startAutoDrain } from '../src/sync/queue';
import { colors } from '../src/theme';

export default function RootLayout() {
  const [configured, setConfigured] = useState<boolean | null>(null);

  // The token lives in the keychain, so nothing can talk to the API until it
  // has been read back.
  useEffect(() => {
    void loadConfig().then(setConfigured);
  }, []);

  // Drains on foreground, and on a slow heartbeat while anything is waiting.
  useEffect(() => {
    if (configured) return startAutoDrain();
    return undefined;
  }, [configured]);

  if (configured === null) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
          <ActivityIndicator color={colors.textFaint} />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!configured) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <SetupScreen onDone={() => setConfigured(true)} />
      </SafeAreaProvider>
    );
  }

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
