import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, radius, space, type as typo } from '../theme';

/**
 * A card again — but a card that earns it.
 *
 * The previous version was a hairline and a label, on the theory that boxing
 * ten groups made ten competing objects. It did the opposite: with nothing but
 * rules between them, ten groups read as one undifferentiated column and you
 * had to read every heading to find anything.
 *
 * One step of lightness separates a card from the page. No border and no
 * shadow — a border on a filled surface is a belt with braces, and a shadow on
 * near-black is mud.
 *
 * The label sits above the card rather than inside it, so the card holds only
 * content and the eye can skip headings it does not want.
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
    <View style={styles.group}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={[styles.card, style]}>{children}</View>
    </View>
  );
}

/** A hairline for splitting rows inside a card. */
export function Rule({ inset = false }: { inset?: boolean }) {
  return <View style={[styles.rule, inset && styles.ruleInset]} />;
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  label: { ...typo.label, color: colors.textFaint, paddingLeft: space.xs },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.md,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    // Full-bleed inside a padded card: a divider that stops short of the edge
    // reads as a mistake rather than as a considered inset.
    marginHorizontal: -space.lg,
  },
  ruleInset: { marginLeft: 0 },
});
