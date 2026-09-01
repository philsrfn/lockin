import { Tabs } from 'expo-router';
import { colors } from '../../src/theme';

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
        // No icon set is bundled, and a label at this size reads fine.
        tabBarLabelStyle: { fontSize: 13, fontWeight: '700' },
        tabBarIconStyle: { display: 'none' },
        tabBarItemStyle: { paddingTop: 10 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Today' }} />
      <Tabs.Screen name="chat" options={{ title: 'Trainer' }} />
      <Tabs.Screen name="food" options={{ title: 'Food' }} />
      <Tabs.Screen name="weight" options={{ title: 'Weight' }} />
    </Tabs>
  );
}
