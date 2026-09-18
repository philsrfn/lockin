import { useSyncExternalStore } from 'react';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { language, subscribeToLocale, t } from '../../src/lib/locale';
import { colors } from '../../src/theme';

/**
 * The system's own tab bar — a real UITabBarController — rather than one
 * drawn in JavaScript.
 *
 * On iOS 26 that is what gets Liquid Glass: the bar floats over the content,
 * refracts what scrolls beneath it, and shrinks out of the way while a list is
 * read. None of that can be imitated convincingly with a blur view, and every
 * imitation is one iOS release from looking dated. The drawn bar also had to
 * be allowed for by hand on every screen; the native one reports itself
 * through the safe area like any other system chrome.
 *
 * Symbols swap to their filled form when selected, which is the platform's
 * own "where am I" signal. Amber stays the selected tint — the only place in
 * the app where amber marks position rather than an action.
 */
export default function TabsLayout() {
  // Re-render when the language arrives, or the labels keep the first one.
  useSyncExternalStore(subscribeToLocale, language);

  return (
    <NativeTabs
      tintColor={colors.accent}
      iconColor={{ default: colors.textDim, selected: colors.accent }}
      labelStyle={{
        default: { color: colors.textDim },
        selected: { color: colors.accent },
      }}
      // A gym is read in glances between sets: the bar gets out of the way
      // while a long list scrolls, and is back the moment you scroll up.
      minimizeBehavior="onScrollDown"
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'calendar', selected: 'calendar' }} />
        <NativeTabs.Trigger.Label>{t('tabToday')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chat">
        <NativeTabs.Trigger.Icon
          sf={{
            default: 'bubble.left.and.bubble.right',
            selected: 'bubble.left.and.bubble.right.fill',
          }}
        />
        <NativeTabs.Trigger.Label>{t('tabTrainer')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="food">
        <NativeTabs.Trigger.Icon sf={{ default: 'fork.knife', selected: 'fork.knife' }} />
        <NativeTabs.Trigger.Label>{t('tabFood')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="weight">
        <NativeTabs.Trigger.Icon sf={{ default: 'scalemass', selected: 'scalemass.fill' }} />
        <NativeTabs.Trigger.Label>{t('tabWeight')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
