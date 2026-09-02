import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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
  max = 1000,
  decimals = 0,
  onChange,
}: {
  value: number;
  unit: string;
  step: number;
  min?: number;
  max?: number;
  decimals?: number;
  onChange: (next: number) => void;
}) {
  // Tap the number to type it. Stepping from an empty bar to 90kg is a hold;
  // going straight to a weight he already knows is four keystrokes.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
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

  /** Snap what he typed onto the plate grid, so the log stays loadable. */
  function commit() {
    setEditing(false);
    // Tapping in and tapping away again should change nothing.
    if (draft.trim() === '') return;
    const parsed = Number(draft.replace(',', '.'));
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.min(max, Math.max(min, parsed));
    const snapped = Math.round(clamped / step) * step;
    onChange(Number(snapped.toFixed(2)));
  }

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

      {editing ? (
        <TextInput
          value={draft}
          onChangeText={setDraft}
          // Starts empty with the current value behind it. selectTextOnFocus is
          // unreliable alongside autoFocus, and appending to the old number
          // means deleting four characters before every entry.
          placeholder={value.toFixed(decimals)}
          placeholderTextColor={colors.textFaint}
          keyboardType={decimals > 0 ? 'decimal-pad' : 'number-pad'}
          autoFocus
          returnKeyType="done"
          onBlur={commit}
          onSubmitEditing={commit}
          style={[styles.readout, styles.value, styles.input]}
        />
      ) : (
        <Pressable
          onPress={() => {
            setDraft('');
            setEditing(true);
          }}
          style={styles.readout}
          hitSlop={8}
        >
          <Text style={styles.value}>{value.toFixed(decimals)}</Text>
          <Text style={styles.unit}>{unit}</Text>
        </Pressable>
      )}

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
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  button: {
    width: 80,
    height: 76,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.45 },
  symbol: { fontSize: 30, fontWeight: '300', color: colors.textDim, marginTop: -2 },
  readout: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: space.xs,
  },
  value: { fontSize: 40, fontWeight: '300', color: colors.text, letterSpacing: -1.5, ...typo.mono },
  input: { textAlign: 'center', paddingVertical: 0, height: 76 },
  unit: { fontSize: 13, fontWeight: '400', color: colors.textFaint, letterSpacing: 0.6 },
});
