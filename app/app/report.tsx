import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useResource } from '../src/api/hooks';
import type { SessionReport, SessionReportExercise } from '../src/api/types';
import { Card, Rule } from '../src/components/Card';
import { Screen } from '../src/components/Screen';
import { kg, longDate } from '../src/lib/format';
import { t } from '../src/lib/locale';
import { colors, radius, space, type as typo } from '../src/theme';

/**
 * The write-up after a session.
 *
 * Two layers, and the split is §1 rather than a design preference. The
 * numbers on this screen are arithmetic the server did on what was logged —
 * sets, reps, volume, what moved against last time, whether the plan was
 * met. The prose underneath is the trainer talking about those numbers. If
 * they ever disagree, the numbers are right; that is what keeping them out
 * of the model buys.
 *
 * Reached from a push notification straight after finishing, and from any
 * session in history that was closed out. That second way is the durable one:
 * the screen that appears when a workout ends is gone as soon as somebody
 * leaves it, and a notification is gone as soon as it is swiped. It is also
 * the one place in the app that answers "was that a good session?" with
 * something other than a chart.
 */
export default function ReportScreen() {
  const router = useRouter();
  const { sessionId, pending } = useLocalSearchParams<{ sessionId?: string; pending?: string }>();

  /**
   * `pending` is a session that finished with no signal. There is no id to
   * ask about yet and no report to fetch — asking for the latest one would
   * answer with a different session's write-up, which is worse than nothing.
   */
  const waiting = pending === '1' && !sessionId;
  const path = sessionId ? `/sessions/${sessionId}/report` : '/reports/latest';
  const report = useResource<{ report: SessionReport | null }>(path);

  const data = waiting ? null : (report.data?.report ?? null);

  return (
    <Screen onRefresh={report.reload} refreshing={report.refreshing}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>{t('back')}</Text>
        </Pressable>
        <Text style={styles.label}>{t('sessionReport')}</Text>
      </View>

      {report.loading && !data && !waiting ? <Text style={styles.dim}>{t('loading')}</Text> : null}

      {/*
        A missing report and a report that has not been written yet look the
        same from here, and saying "still being written" is the kinder of the
        two wrongs: the generation runs behind the finish, so somebody who
        taps through a second too early is in that state rather than in an
        empty one.
      */}
      {(!report.loading && !data) || waiting ? (
        <Text style={styles.dim}>{sessionId || waiting ? t('reportPending') : t('reportNone')}</Text>
      ) : null}

      {data ? (
        <>
          <Card>
            <Text style={styles.headline}>{data.headline}</Text>
            <Text style={styles.when}>
              {[data.dayName, longDate(data.performedAt)].filter(Boolean).join(' · ')}
            </Text>
            <Rule />
            <Text style={styles.body}>{data.assessment}</Text>
          </Card>

          {data.oneThing ? (
            <Card>
              <Text style={styles.label}>{t('reportOneThing')}</Text>
              <Text style={styles.body}>{data.oneThing}</Text>
            </Card>
          ) : null}

          <Card>
            <View style={styles.figures}>
              <Figure value={String(data.facts.totalSets)} label={t('reportSets')} />
              <Figure value={String(data.facts.totalReps)} label={t('reportReps')} />
              <Figure value={String(data.facts.exerciseCount)} label={t('reportExercises')} />
              <Figure value={`${kg(data.facts.volumeKg)} kg`} label={t('reportVolume')} />
            </View>

            <Rule />

            <Text style={styles.label}>{t('reportVersusLast')}</Text>
            {data.facts.versusLast ? (
              <Text style={[styles.body, tone(data.facts.versusLast.deltaKg)]}>
                {signed(data.facts.versusLast.deltaKg)} kg (
                {signed(data.facts.versusLast.deltaPct)}%) · {longDate(data.facts.versusLast.performedAt)}
              </Text>
            ) : (
              // The absence is the answer, not a gap. Printing "0 kg" here
              // would claim a comparison that was never made.
              <Text style={styles.dim}>{t('reportFirstTime')}</Text>
            )}
          </Card>

          {data.facts.records.length > 0 ? (
            <Card>
              <Text style={styles.label}>{t('reportRecords')}</Text>
              {data.facts.records.map((record) => (
                <Text key={`${record.exerciseId}-${record.kind}`} style={styles.body}>
                  {record.name} — {kg(record.weightKg)} kg × {record.reps}
                </Text>
              ))}
            </Card>
          ) : null}

          {data.facts.plan ? (
            <Card>
              <Text style={styles.label}>{t('reportPlan')}</Text>
              <Text style={styles.body}>
                {data.facts.plan.setsDone >= data.facts.plan.setsPlanned
                  ? t('reportPlanMet')
                  : t('reportPlanShort', {
                      done: data.facts.plan.setsDone,
                      planned: data.facts.plan.setsPlanned,
                    })}
              </Text>
            </Card>
          ) : null}

          <Card>
            <Text style={styles.label}>{t('reportMovements')}</Text>
            {data.facts.exercises.map((exercise, index) => (
              <View key={exercise.exerciseId}>
                {index > 0 ? <Rule /> : null}
                <Movement exercise={exercise} />
              </View>
            ))}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}

function Figure({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.figure}>
      <Text style={styles.figureValue}>{value}</Text>
      <Text style={styles.figureLabel}>{label}</Text>
    </View>
  );
}

function Movement({ exercise }: { exercise: SessionReportExercise }) {
  return (
    <View style={styles.movement}>
      <Text style={styles.movementName}>{exercise.name}</Text>
      <Text style={styles.body}>
        {exercise.sets}×  ·  {kg(exercise.topSet.weightKg)} kg × {exercise.topSet.reps}
      </Text>

      {/*
        Estimated max, not the load on the bar. Somebody who did the same
        weight for two more reps got stronger, and a screen that reports that
        as "no change" teaches them the wrong thing about their own training.
      */}
      {exercise.estimatedMaxDeltaKg != null ? (
        <Text style={[styles.delta, tone(exercise.estimatedMaxDeltaKg)]}>
          {signed(exercise.estimatedMaxDeltaKg)} kg e1RM
        </Text>
      ) : null}

      {exercise.inRange === false ? (
        <Text style={styles.dim}>{t('reportOutOfRange')}</Text>
      ) : null}
    </View>
  );
}

/** A leading sign on everything, so zero reads as "held" rather than as null. */
const signed = (value: number) => (value > 0 ? `+${value}` : String(value));

const tone = (value: number) =>
  value > 0 ? styles.up : value < 0 ? styles.down : styles.flat;

const styles = StyleSheet.create({
  header: { gap: space.xs, paddingBottom: space.sm },
  back: { ...typo.body, color: colors.textDim },
  label: { ...typo.label, color: colors.textFaint },
  dim: { ...typo.body, color: colors.textDim },
  headline: { ...typo.title, color: colors.text },
  when: { ...typo.body, color: colors.textDim },
  body: { ...typo.body, color: colors.text },

  figures: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  figure: {
    minWidth: 72,
    paddingVertical: space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
  },
  figureValue: { ...typo.numeral, color: colors.text },
  figureLabel: { fontSize: 12, color: colors.textFaint },

  movement: { paddingVertical: space.sm, gap: 2 },
  movementName: { ...typo.body, color: colors.text, fontWeight: '600' },
  delta: { ...typo.body, ...typo.mono },
  up: { color: colors.accent },
  down: { color: colors.danger },
  flat: { color: colors.textDim },
});
