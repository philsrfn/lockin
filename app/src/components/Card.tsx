import type { ReactNode } from 'react';
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { colors, radius, space, type as typo } from '../theme';

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
    <View style={[styles.card, style]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
  label: {
    ...typo.label,
    color: colors.textFaint,
  },
});
