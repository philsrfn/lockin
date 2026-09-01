import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space, type as typo } from '../theme';

/**
 * The control he uses between sets, one-handed, without looking closely.
 * Both targets are 64pt tall and span a third of the screen each.
 */
export function Stepper({
  value,
  unit,
  step,
  min = 0,
  decimals = 0,
  onChange,
}: {
  value: number;
  unit: string;
  step: number;
  min?: number;
  decimals?: number;
  onChange: (next: number) => void;
}) {
  const held = useRef<ReturnType<typeof setInterval> | null>(null);
  const latest = useRef(value);
  latest.current = value;

  // Snap to the step grid so repeated taps cannot drift into 87.49999.
  const adjust = (direction: 1 | -1) => {
    const next = Math.max(min, Math.round((latest.current + direction * step) / step) * step);
    onChange(Number(next.toFixed(2)));
  };

  // Hold to repeat, accelerating once. Going from an empty bar to 90kg should
  // be a hold, not twenty-eight taps — but slow enough to stop on the number
  // he wants. Roughly: 6 steps at walking pace, then ~14 a second.
  const startHold = (direction: 1 | -1) => {
    stopHold();
    let ticks = 0;
    held.current = setInterval(() => {
      ticks += 1;
      adjust(direction);
      if (ticks === 6 && held.current) {
        clearInterval(held.current);
        held.current = setInterval(() => adjust(direction), 70);
      }
    }, 110);
  };

  const stopHold = () => {
    if (held.current) clearInterval(held.current);
    held.current = null;
  };

  useEffect(() => stopHold, []);

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => adjust(-1)}
        onLongPress={() => startHold(-1)}
        onPressOut={stopHold}
        delayLongPress={280}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        hitSlop={6}
      >
        <Text style={styles.symbol}>−</Text>
      </Pressable>

      <View style={styles.readout}>
        <Text style={styles.value}>{value.toFixed(decimals)}</Text>
        <Text style={styles.unit}>{unit}</Text>
      </View>

      <Pressable
        onPress={() => adjust(1)}
        onLongPress={() => startHold(1)}
        onPressOut={stopHold}
        delayLongPress={280}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        hitSlop={6}
      >
        <Text style={styles.symbol}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  button: {
    width: 76,
    height: 68,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceHigh,
  },
  pressed: { backgroundColor: colors.border },
  symbol: { fontSize: 30, fontWeight: '600', color: colors.text, marginTop: -2 },
  readout: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: space.xs,
  },
  value: { fontSize: 32, fontWeight: '700', color: colors.text, ...typo.mono },
  unit: { fontSize: 15, fontWeight: '600', color: colors.textDim },
});
