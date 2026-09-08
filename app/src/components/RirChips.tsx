import { Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../lib/locale';
import { colors, radius, space } from '../theme';

/** Reps in reserve, in the words they would actually use. Optional by design. */
const OPTIONS: { label: () => string; value: number }[] = [
  { label: () => t('rirEasy'), value: 4 },
  { label: () => '2', value: 2 },
  { label: () => '1', value: 1 },
  { label: () => t('rirFailure'), value: 0 },
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
            key={option.label()}
            // Tapping the active chip clears it — RIR is never mandatory.
            onPress={() => onChange(active ? null : option.value)}
            style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.pressed]}
          >
            <Text style={[styles.text, active && styles.textActive]}>{option.label()}</Text>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  chipActive: { borderBottomColor: colors.accent, borderBottomWidth: 2 },
  pressed: { opacity: 0.7 },
  text: { fontSize: 14, fontWeight: '400', color: colors.textFaint, letterSpacing: 0.4 },
  textActive: { color: colors.accent, fontWeight: '500' },
});
