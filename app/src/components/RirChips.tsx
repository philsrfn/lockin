import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '../theme';

/** Reps in reserve, in the words he would actually use. Optional by design. */
const OPTIONS: { label: string; value: number }[] = [
  { label: 'easy', value: 4 },
  { label: '2', value: 2 },
  { label: '1', value: 1 },
  { label: 'failure', value: 0 },
];

export function RirChips({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (next: number | null) => void;
}) {
  return (
    <View style={styles.row}>
      {OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <Pressable
            key={option.label}
            // Tapping the active chip clears it — RIR is never mandatory.
            onPress={() => onChange(active ? null : option.value)}
            style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
          >
            <Text style={[styles.text, active && styles.textActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.sm },
  chip: {
    flex: 1,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accentDeep, borderColor: colors.accent },
  pressed: { opacity: 0.7 },
  text: { fontSize: 15, fontWeight: '600', color: colors.textDim },
  textActive: { color: colors.accent },
});
