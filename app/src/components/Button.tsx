import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { Platform, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { colors, radius, space } from '../theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

/**
 * Asked once. The answer is a property of the OS the binary is running on,
 * and it cannot change while the app is open.
 */
export const GLASS = Platform.OS === 'ios' && isLiquidGlassAvailable();

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
  /**
   * On iOS 26 the two buttons that are a surface — primary and secondary —
   * are Liquid Glass, like the tab bar they sit above. Primary keeps its
   * amber as the tint, so "fill means press me" still holds; secondary is
   * untinted glass, which reads as a control without competing with it.
   *
   * Ghost and danger stay text: glass is a surface, and they have none.
   * Disabled drops the glass too. Glass that shimmers under a thumb and then
   * does nothing is the same lie the 28% bone slab told.
   *
   * The Pressable stays the outer element so layout props a caller passes
   * (flex: 1 in a row of two) and the accessibility role land where they
   * always did. The glass is interactive, so it gives the system's own
   * press response and the opacity fade is not needed on top of it.
   */
  if (GLASS && !disabled && (variant === 'primary' || variant === 'secondary')) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        style={[styles.glassOuter, style]}
      >
        <GlassView
          glassEffectStyle="regular"
          colorScheme="dark"
          isInteractive
          tintColor={variant === 'primary' ? colors.accent : undefined}
          style={[styles.base, styles.glass]}
        >
          <Text style={[styles.text, variant === 'primary' && styles.textPrimary]}>{title}</Text>
        </GlassView>
      </Pressable>
    );
  }

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

  /**
   * A capsule, because that is the shape iOS 26 gives a glass button, and a
   * rounded rectangle of glass beside the system's capsules looks like a
   * near miss rather than a choice.
   */
  glassOuter: { borderRadius: radius.pill },
  glass: { flexGrow: 1, borderRadius: radius.pill, overflow: 'hidden' },

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
