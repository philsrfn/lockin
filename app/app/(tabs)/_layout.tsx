import { Tabs } from 'expo-router';
import { t } from '../../src/lib/locale';
import { StyleSheet } from 'react-native';
import { colors } from '../../src/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textFaint,
        // Flat: the bar sits on the page rather than on a raised slab, and a
        // hairline is enough to separate it.
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 0,
        },
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600', letterSpacing: 1.4 },
        tabBarIconStyle: { display: 'none' },
        tabBarItemStyle: { paddingTop: 10 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t('tabToday') }} />
      <Tabs.Screen name="chat" options={{ title: t('tabTrainer') }} />
      <Tabs.Screen name="food" options={{ title: t('tabFood') }} />
      <Tabs.Screen name="weight" options={{ title: t('tabWeight') }} />
    </Tabs>
  );
}
