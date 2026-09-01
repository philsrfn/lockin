import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { colors, radius, space } from '../theme';

type Variant = 'primary' | 'secondary' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      // Big enough to hit between sets without looking.
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text style={[styles.text, variant === 'primary' && styles.textPrimary]}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: colors.surfaceHigh, borderWidth: 1, borderColor: colors.border },
  ghost: { backgroundColor: 'transparent', minHeight: 44 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.4 },
  text: { fontSize: 17, fontWeight: '700', color: colors.text },
  textPrimary: { color: '#08130C' },
});
