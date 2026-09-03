import { Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { colors, radius, space } from '../theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * The primary action is amber and filled.
 *
 * It used to be a bone slab — bone being the text colour, so the button was
 * the brightest thing on every screen whether or not it was the point of it.
 * Worse, disabled meant that slab at 28% opacity, which on this ground is a
 * mid-grey block: the loudest element on the screen was routinely the one
 * thing you could not press. Now disabled recedes into the surface.
 *
 * Amber does double duty as the accent and as "on target", which works only
 * because the two never look alike: a filled amber shape is an action, amber
 * text is a state. Fill means press me.
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
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      // Big enough to hit between sets without looking.
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      <Text
        style={[
          styles.text,
          variant === 'primary' && styles.textPrimary,
          variant === 'danger' && styles.textDanger,
          disabled && styles.textDisabled,
        ]}
      >
        {title}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 54,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
  },
  primary: { backgroundColor: colors.accent },
  /** Filled rather than outlined: an outline on a card is a second border. */
  secondary: { backgroundColor: colors.surfaceHigh },
  ghost: { minHeight: 44, backgroundColor: 'transparent' },
  danger: { backgroundColor: 'transparent' },

  pressed: { opacity: 0.7 },
  /** Recedes into the surface rather than glowing at 28% of the text colour. */
  disabled: { backgroundColor: colors.surfaceHigh, opacity: 0.5 },

  // Sentence case, not the shouted small caps this app used everywhere. A
  // button says what it does; it does not need to be spelled out in caps.
  text: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2, color: colors.text },
  textPrimary: { color: colors.bg },
  textDanger: { color: colors.danger },
  textDisabled: { color: colors.textFaint },
});
