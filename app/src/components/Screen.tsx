import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space, tabBarHeight } from '../theme';

export function Screen({
  children,
  onRefresh,
  refreshing = false,
  keyboardAware = false,
}: {
  children: ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /**
   * For a screen whose text fields sit in the scroll view rather than in a
   * sheet. Opt-in rather than always on: it changes what a tap does while the
   * keyboard is up, and most screens here have nothing to type into.
   */
  keyboardAware?: boolean;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + space.md,
            // The tab bar floats over the scroll view, and the safe-area inset
            // does not know about it — the last paragraph of the weight screen
            // was running underneath. Allowed for on every screen: the ones
            // without a tab bar simply end with more air, which this design
            // prefers anyway.
            paddingBottom: insets.bottom + tabBarHeight + space.xl,
          },
        ]}
        automaticallyAdjustKeyboardInsets={keyboardAware}
        // Without this, the first tap while typing only dismisses the keyboard
        // and the button under the thumb does nothing.
        keyboardShouldPersistTaps={keyboardAware ? 'handled' : 'never'}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.textDim}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.lg, gap: space.lg },
});
