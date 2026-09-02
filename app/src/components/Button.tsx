import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { colors, space } from '../theme';

type Variant = 'primary' | 'secondary' | 'ghost';

/**
 * Square, wide-tracked, quiet. The primary action is bone-on-black rather than
 * a coloured slab: on a page this restrained, inverting the block is louder
 * than any fill, and it keeps amber meaning "on target" rather than "tap here".
 */
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
      <Text style={[styles.text, variant === 'primary' && styles.textPrimary]}>
        {title.toUpperCase()}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
  },
  primary: { backgroundColor: colors.text },
  secondary: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.textFaint,
  },
  ghost: { minHeight: 44 },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.28 },
  text: { fontSize: 13, fontWeight: '600', letterSpacing: 1.6, color: colors.text },
  textPrimary: { color: colors.bg },
});
