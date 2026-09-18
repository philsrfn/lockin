import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space } from '../theme';

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
            // The native tab bar floats over the scroll view and reports its
            // height through the bottom safe-area inset, so the inset alone
            // keeps the last paragraph clear of it. The old JS bar did not,
            // and every screen added its height by hand.
            paddingBottom: insets.bottom + space.xl,
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
