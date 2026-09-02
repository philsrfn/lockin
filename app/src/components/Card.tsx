import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, space, type as typo } from '../theme';

/**
 * Not a card any more — a section of a page.
 *
 * A hairline above, the label sitting on it, then the content. Boxing every
 * group in a bordered rectangle made ten sections look like ten competing
 * objects. A rule and some air makes them read as one document.
 */
export function Card({
  label,
  children,
  style,
}: {
  label?: string;
  children: ReactNode;
  style?: ViewStyle;
}) {
  return (
    <View style={[styles.section, style]}>
      {label ? (
        <View style={styles.head}>
          <Text style={styles.label}>{label}</Text>
        </View>
      ) : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

/** A bare hairline, for splitting things inside a section. */
export function Rule({ inset = false }: { inset?: boolean }) {
  return <View style={[styles.rule, inset && styles.ruleInset]} />;
}

const styles = StyleSheet.create({
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.md,
  },
  head: { paddingBottom: space.md },
  label: { ...typo.label, color: colors.textFaint },
  body: { gap: space.md },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  ruleInset: { marginLeft: space.lg },
});
