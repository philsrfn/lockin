import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { ScrollViewContainer } from 'react-native-reorderable-list';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, space } from '../theme';

export function Screen({
  children,
  onRefresh,
  refreshing = false,
  keyboardAware = false,
  reorderable = false,
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
  /**
   * For a screen holding a `NestedReorderableList`. The nested list has to
   * reach the scroll view it lives in — to know where the finger is on the
   * page, and to scroll the page when a dragged row reaches the edge — and it
   * does that through a context this container provides.
   *
   * Opt-in because it is an animated scroll view with a worklet on every
   * frame of scrolling, and one screen in the app needs it.
   */
  reorderable?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const Container = reorderable ? ScrollViewContainer : ScrollView;

  return (
    <View style={styles.root}>
      <Container
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
      </Container>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.lg, gap: space.lg },
});
