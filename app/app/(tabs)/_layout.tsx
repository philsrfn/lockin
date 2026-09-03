import { Tabs } from 'expo-router';
import { StyleSheet } from 'react-native';
import { t } from '../../src/lib/locale';
import { TabIcon } from '../../src/components/TabIcon';
import { colors, tabBarHeight } from '../../src/theme';

/**
 * Icons and labels. The bar was four words in spaced small caps, which at 10pt
 * is a poor target and a poorer glance — HEUTE and GEWICHT are the same shape
 * from across a gym. The selected tab is amber, which is the only place in the
 * app where amber marks position rather than an action or a hit target; it is
 * also the only place a person looks to answer "where am I".
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textFaint,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 0,
          // Icon plus caption needs the room; at the old label-only height the
          // captions were clipped.
          height: tabBarHeight,
          paddingBottom: 6,
        },
        // Sentence case at a readable size. The label is a caption under the
        // symbol now, not the thing being read.
        tabBarLabelStyle: { fontSize: 11, fontWeight: '500', letterSpacing: 0 },
        tabBarItemStyle: { paddingTop: 8 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabToday'),
          tabBarIcon: ({ focused }) => (
            <TabIcon name="calendar" focused={focused} fallback="H" />
          ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: t('tabTrainer'),
          tabBarIcon: ({ focused }) => (
            <TabIcon name="bubble.left.and.bubble.right" focused={focused} fallback="T" />
          ),
        }}
      />
      <Tabs.Screen
        name="food"
        options={{
          title: t('tabFood'),
          tabBarIcon: ({ focused }) => (
            <TabIcon name="fork.knife" focused={focused} fallback="E" />
          ),
        }}
      />
      <Tabs.Screen
        name="weight"
        options={{
          title: t('tabWeight'),
          tabBarIcon: ({ focused }) => (
            <TabIcon name="scalemass" focused={focused} fallback="G" />
          ),
        }}
      />
    </Tabs>
  );
}
