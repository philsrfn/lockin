import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useResource } from '../../src/api/hooks';
import type { Today } from '../../src/api/types';
import { Banner } from '../../src/components/Banner';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { ContextChip } from '../../src/components/ContextChip';
import { Screen } from '../../src/components/Screen';
import { Sparkline } from '../../src/components/Sparkline';
import { kg, longDate, prescriptionLine, signedKg } from '../../src/lib/format';
import { colors, radius, space, type as typo } from '../../src/theme';

export default function TodayScreen() {
  const router = useRouter();
  const today = useResource<Today>('/today');

  if (!today.data) {
    return (
      <Screen onRefresh={today.reload} refreshing={today.refreshing}>
        <Text style={styles.placeholder}>
          {today.loading ? 'Loading…' : (today.error ?? 'No data')}
        </Text>
        {today.error ? <Button title="Try again" variant="secondary" onPress={today.reload} /> : null}
      </Screen>
    );
  }

  const { plan, weight, macros, week, openSession, context, date } = today.data;
  const inProgress = openSession !== null;

  return (
    <Screen onRefresh={today.reload} refreshing={today.refreshing}>
      <View style={styles.header}>
        <Text style={styles.date}>{longDate(date)}</Text>
        <ContextChip context={context} onChanged={today.reload} />
        {today.stale ? (
          <Text style={styles.stale}>Offline — showing the last plan this phone saw.</Text>
        ) : null}
      </View>

      {plan.jointPain.recommendDoctor ? (
        <Banner
          tone="danger"
          title="Joint pain two sessions running"
          body={`Load is cut ${plan.jointPain.reduceLoadPct}% today. Get it looked at by a doctor before you push again.`}
        />
      ) : null}

      {plan.rampIn.active ? (
        <Banner
          tone="warn"
          title="Ramp-in — first two weeks"
          body={`Capped at ${plan.rampIn.maxWorkingSets} working sets, ${plan.rampIn.minRir}+ reps in reserve. Connective tissue lags muscle.`}
        />
      ) : null}

      <Card label={`DAY ${plan.template}`}>
        {plan.exercises.map((exercise) => (
          <View key={exercise.exerciseId} style={styles.exerciseRow}>
            <Text style={styles.exerciseName} numberOfLines={1}>
              {exercise.name}
            </Text>
            <Text style={styles.exercisePrescription}>
              {prescriptionLine(exercise.sets, exercise.targetReps, exercise.weightKg)}
            </Text>
          </View>
        ))}

        <Button
          title={inProgress ? 'Resume workout' : 'Start workout'}
          onPress={() => router.push('/workout')}
          style={{ marginTop: space.sm }}
        />

        <Text style={styles.footnote}>
          {week.strengthSessions.done} of {week.strengthSessions.target} strength sessions this week
        </Text>
      </Card>

      <Card label="PROTEIN REMAINING">
        <View style={styles.heroRow}>
          <Text style={styles.hero}>{macros.remaining.proteinG}</Text>
          <Text style={styles.heroUnit}>g</Text>
        </View>
        <ProgressBar percent={macros.remaining.proteinPct} />
        <Text style={styles.subtle}>
          {macros.remaining.kcal} kcal left of {macros.targets.kcal} · fat floor{' '}
          {macros.remaining.fatToFloorG}g to go
        </Text>
        <Text style={styles.footnote}>Food logging arrives in phase 4 — targets shown for now.</Text>
      </Card>

      <Card label="WEIGHT">
        {weight.latest ? (
          <>
            <View style={styles.weightRow}>
              <View>
                <Text style={styles.numeral}>{kg(weight.average7?.avgKg)} kg</Text>
                <Text style={styles.subtle}>
                  7-day average{weight.average7 ? ` · ${weight.average7.sampleCount}/7 days` : ''}
                </Text>
              </View>
              <View style={styles.alignEnd}>
                <Text style={[styles.change, changeTone(weight.changeKg)]}>
                  {signedKg(weight.changeKg)} kg
                </Text>
                <Text style={styles.subtle}>this week</Text>
              </View>
            </View>
            <Sparkline series={weight.series} />
            <Text style={styles.footnote}>
              Last: {kg(weight.latest.weightKg)} kg · goal {kg(weight.goalWeightKg, 0)} kg
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.subtle}>No weigh-ins yet. It takes three seconds.</Text>
            <Button
              title="Log weight"
              variant="secondary"
              onPress={() => router.push('/weight')}
            />
          </>
        )}
      </Card>
    </Screen>
  );
}

/** Losing is good, gaining is not — but neither is an alarm. */
function changeTone(changeKg: number | null) {
  if (changeKg == null) return { color: colors.textDim };
  return { color: changeKg <= 0 ? colors.accent : colors.warn };
}

function ProgressBar({ percent }: { percent: number }) {
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, percent))}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.md },
  date: { ...typo.title, color: colors.text },

  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  exerciseName: { ...typo.body, color: colors.text, flexShrink: 1 },
  exercisePrescription: { ...typo.bodyDim, ...typo.mono, color: colors.textDim },

  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  hero: { ...typo.hero, ...typo.mono, color: colors.accent },
  heroUnit: { fontSize: 22, fontWeight: '700', color: colors.textDim },

  track: {
    height: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHigh,
    overflow: 'hidden',
  },
  fill: { height: '100%', backgroundColor: colors.accent, borderRadius: radius.pill },

  weightRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  alignEnd: { alignItems: 'flex-end' },
  numeral: { ...typo.numeral, ...typo.mono, color: colors.text },
  change: { fontSize: 20, fontWeight: '700', ...typo.mono },

  subtle: { ...typo.bodyDim, color: colors.textDim },
  footnote: { fontSize: 13, color: colors.textFaint },
  placeholder: { ...typo.body, color: colors.textDim, marginTop: space.xxl },
  stale: { fontSize: 13, color: colors.warn },
});
