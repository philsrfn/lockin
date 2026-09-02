/**
 * Push registration (§8).
 *
 * Remote push needs a real build: Expo Go cannot receive it on iOS, and a
 * simulator cannot receive it at all. Everything here degrades to a no-op in
 * those cases rather than throwing, so development is unaffected.
 */
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { api } from './api/client';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PushState = 'unsupported' | 'denied' | 'registered' | 'error';

export async function registerForPush(): Promise<PushState> {
  // A simulator has no APNs registration to give, and asking produces an error
  // rather than a prompt.
  if (!Device.isDevice) return 'unsupported';

  try {
    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;

    if (!granted && existing.canAskAgain) {
      const asked = await Notifications.requestPermissionsAsync();
      granted = asked.granted;
    }
    if (!granted) return 'denied';

    const token = await Notifications.getExpoPushTokenAsync();
    await api('/push/register', {
      method: 'POST',
      body: { token: token.data, platform: Platform.OS },
    });
    return 'registered';
  } catch {
    // Never let a push failure block the app starting.
    return 'error';
  }
}

/** Where a tapped notification should land. */
export function screenFromNotification(
  response: Notifications.NotificationResponse,
): string | null {
  const data = response.notification.request.content.data as { screen?: string } | undefined;
  switch (data?.screen) {
    case 'food':
      return '/food';
    case 'workout':
      return '/workout';
    case 'today':
      return '/';
    default:
      return null;
  }
}
