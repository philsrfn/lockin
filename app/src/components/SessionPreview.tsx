import { StyleSheet, Text, View } from 'react-native';
import type { WorkoutPlan } from '../api/types';
import { t } from '../lib/locale';
import { colors, radius, space, type as typo } from '../theme';

/**
 * What today's session actually is, on the screen that opens the app.
 *
 * Today showed a Start button and a third of a screen of nothing — you had to
 * press it to find out whether the answer was squats or a rest day. The plan
 * is already in the payload; it was just never drawn.
 *
 * Prescribed numbers only. What was lifted last time belongs in the logger,
 * where it is the target you are chasing; here it would be two numbers per row
 * and no glance.
 */
export function SessionPreview({ plan }: { plan: WorkoutPlan }) {
  if (plan.exercises.length === 0) {
    return (
      <View style={styles.card}>
        <Text style={styles.rest}>{t('restDay')}</Text>
        <Text style={styles.restBlurb}>{t('restDayBlurb')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.day}>{plan.dayName}</Text>
        <Text style={styles.programme}>{plan.programName}</Text>
      </View>

      {plan.exercises.map((exercise, index) => (
        <View
          key={exercise.exerciseId}
          style={[styles.row, index > 0 && styles.divided]}
        >
          <Text style={styles.name} numberOfLines={1}>
            {exercise.name}
          </Text>
          <Text style={styles.prescription}>
            {exercise.sets}
            {t('setsBy')}
            {exercise.targetReps}
            {exercise.weightKg ? `  ·  ${exercise.weightKg} kg` : ''}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg },
  head: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  day: { fontSize: 20, fontWeight: '600', color: colors.text, letterSpacing: -0.3 },
  programme: { fontSize: 13, color: colors.textFaint },

  row: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: space.md,
    paddingTop: space.md,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: space.md,
    paddingTop: space.md,
  },
  name: { flex: 1, fontSize: 16, color: colors.text },
  prescription: { fontSize: 15, color: colors.textDim, ...typo.mono },

  rest: { fontSize: 20, fontWeight: '600', color: colors.text, letterSpacing: -0.3 },
  restBlurb: { fontSize: 15, color: colors.textDim, lineHeight: 22, marginTop: space.sm },
});
