import { useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api } from '../src/api/client';
import type { Profile } from '../src/api/types';
import {
  clearConfig,
  isHealthConnected,
  isOnboardedLocally,
  loadConfig,
  markOnboardedLocally,
  onSignedOut,
} from '../src/api/config';
import { startHealthSync } from '../src/health/sync';
import { ApiError, onRefused } from '../src/api/client';
import { OnboardingScreen } from '../src/components/OnboardingScreen';
import { WaitingScreen } from '../src/components/WaitingScreen';
import { SignInScreen } from '../src/components/SignInScreen';
import { startAutoDrain } from '../src/sync/queue';
import { registerForPush, screenFromNotification } from '../src/push';
import { colors } from '../src/theme';

export default function RootLayout() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  /** Signed in, but not yet let in by whoever runs the server. */
  const [waiting, setWaiting] = useState(false);
  const router = useRouter();
  const registered = useRef(false);
  /** Set the moment sign-in answers, so the cold-start check below skips. */
  const onboardingKnown = useRef(false);

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
    if (!configured || onboardingKnown.current) return;
    void (async () => {
      if (await isOnboardedLocally()) return setOnboarded(true);
      try {
        const { profile } = await api<{ profile: Profile }>('/profile');
        if (profile.onboarded) await markOnboardedLocally();
        setOnboarded(profile.onboarded);
      } catch (caught) {
        // An account that has not been admitted holds a working token and
        // reaches nothing with it. Anything else — offline, a flaky gym
        // connection — opens the app rather than trapping them here.
        if (caught instanceof ApiError && caught.code === 'pending_approval') {
          setWaiting(true);
        }
        setOnboarded(true);
      }
    })();
  }, [configured]);

  /**
   * A refusal reaches here from wherever it happened.
   *
   * A warm start skips the /profile check below — the onboarding answer is
   * remembered locally so a cold start does not wait on the network — which
   * means an account revoked or not yet approved would otherwise carry on
   * looking like a working app until something happened to fail visibly.
   */
  useEffect(
    () =>
      onRefused((kind) => {
        if (kind === 'refused') setWaiting(true);
        // A token that no longer resolves is a revoked account or a device
        // that was signed out elsewhere. Back to the sign-in screen.
        else void clearConfig();
      }),
    [],
  );

  /**
   * Signing out happens four routes deep, on the rules screen. This is what
   * puts the sign-in screen back in front — and the onboarding answer with it,
   * because the next person to sign in on this phone may be somebody else.
   */
  useEffect(
    () =>
      onSignedOut(() => {
        onboardingKnown.current = false;
        setWaiting(false);
        setOnboarded(null);
        setConfigured(false);
      }),
    [],
  );

  // Drains on foreground, and on a slow heartbeat while anything is waiting.
  useEffect(() => {
    if (configured) return startAutoDrain();
    return undefined;
  }, [configured]);

  /**
   * Apple Health, on foreground. A window rather than a diff — the server
   * works out what is new, so a reinstalled app does not lose a fortnight.
   * A no-op in Expo Go, where the native module does not exist.
   */
  useEffect(() => {
    if (!configured || !onboarded) return undefined;
    let stop: (() => void) | undefined;
    void isHealthConnected().then((on) => {
      if (on) stop = startHealthSync();
    });
    return () => stop?.();
  }, [configured, onboarded]);

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
        <SignInScreen
          onDone={(needsOnboarding) => {
            // Sign-in already asked the server whether the questionnaire is
            // outstanding, so the effect below has nothing left to find out.
            onboardingKnown.current = true;
            if (!needsOnboarding) void markOnboardedLocally();
            setOnboarded(!needsOnboarding);
            setConfigured(true);
          }}
        />
      </SafeAreaProvider>
    );
  }

  if (waiting) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <WaitingScreen onAdmitted={() => setWaiting(false)} />
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
