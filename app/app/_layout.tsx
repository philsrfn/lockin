import { useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '../src/api/client';
import type { Profile } from '../src/api/types';
import { isOnboardedLocally, loadConfig, markOnboardedLocally } from '../src/api/config';
import { OnboardingScreen } from '../src/components/OnboardingScreen';
import { SetupScreen } from '../src/components/SetupScreen';
import { startAutoDrain } from '../src/sync/queue';
import { registerForPush, screenFromNotification } from '../src/push';
import { colors } from '../src/theme';

export default function RootLayout() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const router = useRouter();
  const registered = useRef(false);

  // The token lives in the keychain, so nothing can talk to the API until it
  // has been read back.
  useEffect(() => {
    void loadConfig().then(setConfigured);
  }, []);

  /**
   * Asked once, then remembered locally. An install that has already been
   * through the questionnaire never waits on this again — and if the check
   * itself fails, the app opens anyway rather than trapping somebody offline
   * in a form they may already have filled in.
   */
  useEffect(() => {
    if (!configured) return;
    void (async () => {
      if (await isOnboardedLocally()) return setOnboarded(true);
      try {
        const { profile } = await api<{ profile: Profile }>('/profile');
        if (profile.onboarded) await markOnboardedLocally();
        setOnboarded(profile.onboarded);
      } catch {
        setOnboarded(true);
      }
    })();
  }, [configured]);

  // Drains on foreground, and on a slow heartbeat while anything is waiting.
  useEffect(() => {
    if (configured) return startAutoDrain();
    return undefined;
  }, [configured]);

  // Only once the token is in hand — registering posts to the API. A no-op on
  // simulators and in Expo Go, neither of which can receive remote push.
  useEffect(() => {
    if (!configured || registered.current) return;
    registered.current = true;
    void registerForPush();
  }, [configured]);

  // A tapped notification should land on the screen it is about, rather than
  // opening the app and leaving him to find it.
  useEffect(() => {
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const screen = screenFromNotification(response);
      if (screen) router.push(screen as never);
    });
    return () => subscription.remove();
  }, [router]);

  if (configured === null || (configured && onboarded === null)) {
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

  if (!onboarded) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <OnboardingScreen
          onDone={() => {
            void markOnboardedLocally();
            setOnboarded(true);
          }}
        />
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
        <Stack.Screen name="progress" />
        <Stack.Screen name="rules" />
        <Stack.Screen name="fridge" options={{ animation: 'slide_from_bottom' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
