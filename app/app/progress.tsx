import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError, api } from '../src/api/client';
import type { ExerciseProgress, Progress, WeeklyReview, WeightSummary } from '../src/api/types';
import { Card } from '../src/components/Card';
import { Screen } from '../src/components/Screen';
import { Sparkline } from '../src/components/Sparkline';
import { kg, shortDate, signedKg } from '../src/lib/format';
import { t } from '../src/lib/locale';
import { colors, radius, space, type as typo } from '../src/theme';

const RANGES = [30, 90, 365] as const;

export default function ProgressScreen() {
  const router = useRouter();
  const [days, setDays] = useState<number>(90);
  const [data, setData] = useState<Progress | null>(null);
  const [weight, setWeight] = useState<WeightSummary | null>(null);
  const [review, setReview] = useState<WeeklyReview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const [p, w, r] = await Promise.all([
        api<Progress>(`/progress?days=${days}`),
        api<WeightSummary>(`/bodyweight?days=${Math.min(days, 365)}`),
        // The Sunday review is the most considered thing the trainer produces.
        // It has been landing in a database column nobody reads.
        api<{ review: WeeklyReview | null }>('/review').catch(() => ({ review: null })),
      ]);
      setData(p);
      setWeight(w);
      setReview(r.review);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('couldNotLoadHistory'));
    } finally {
      setRefreshing(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>{t('backToTodayShort')}</Text>
        </Pressable>
        <Text style={styles.title}>{t('progressTitle')}</Text>
      </View>

      <View style={styles.rangeRow}>
        {RANGES.map((option) => (
          <Pressable
            key={option}
            onPress={() => setDays(option)}
            style={[styles.rangeChip, days === option && styles.rangeChipActive]}
          >
            <Text style={[styles.rangeText, days === option && styles.rangeTextActive]}>
              {option === 365 ? t('oneYear') : `${option} ${t('days')}`}
            </Text>
          </Pressable>
        ))}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {review ? (
        <Card label={`${t('reviewWeekEnding')} ${shortDate(review.weekEnding).toUpperCase()}`}>
          <Text style={styles.reviewBody}>{review.trend}</Text>
          <View style={styles.reviewBlock}>
            <Text style={styles.reviewLabel}>{t('wentWell')}</Text>
            <Text style={styles.reviewBody}>{review.wentWell}</Text>
          </View>
          <View style={styles.reviewBlock}>
            <Text style={[styles.reviewLabel, { color: colors.accent }]}>
              {t('changeOneThing')}
            </Text>
            <Text style={[styles.reviewBody, styles.reviewChange]}>{review.oneChange}</Text>
          </View>
          {review.targetsNote ? <Text style={styles.footnote}>{review.targetsNote}</Text> : null}
          <Text style={styles.footnote}>
            {review.calorieTarget} kcal/day{review.calorieChanged ? ` · ${t('changedThisWeek')}` : ''}
          </Text>
        </Card>
      ) : null}

      <Card label={t('weight')}>
        {weight?.average7 ? (
          <>
            <View style={styles.row}>
              <View>
                <Text style={styles.numeral}>{kg(weight.average7.avgKg)} kg</Text>
                <Text style={styles.dim}>{t('sevenDayAverage')}</Text>
              </View>
              <View style={styles.alignEnd}>
                <Text
                  style={[
                    styles.change,
                    { color: (weight.changeKg ?? 0) <= 0 ? colors.accent : colors.warn },
                  ]}
                >
                  {signedKg(weight.changeKg)} kg
                </Text>
                <Text style={styles.dim}>{t('thisWeekLower')}</Text>
              </View>
            </View>
            <Sparkline series={weight.series} height={72} />
            {weight.goalWeightKg ? (
              <Text style={styles.footnote}>
                {kg(weight.average7.avgKg - weight.goalWeightKg)} kg {t('aboveGoal')}{' '}
                {kg(weight.goalWeightKg, 0)} kg
              </Text>
            ) : null}
          </>
        ) : (
          <Text style={styles.dim}>{t('notEnoughWeighIns')}</Text>
        )}
      </Card>

      <Card label={t('training')}>
        <View style={styles.statRow}>
          <Stat value={String(data?.sessionCount ?? 0)} label={t('sessions')} />
          <Stat value={String(data?.setCount ?? 0)} label={t('sets')} />
          <Stat
            value={
              data ? `${Math.round(data.totalVolumeKg / 1000)}t` : '0t'
            }
            label={t('volumeLifted')}
          />
        </View>
      </Card>

      {data?.exercises.length ? (
        data.exercises.map((exercise) => <ExerciseCard key={exercise.exerciseId} exercise={exercise} />)
      ) : (
        <Card label={t('liftsHeading')}>
          <Text style={styles.dim}>
            Nothing logged in this window yet. Finish a session and it shows up here.
          </Text>
        </Card>
      )}
    </Screen>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/**
 * One movement over time. The bars are estimated 1RM rather than raw weight, so
 * a heavier set of three does not read as progress over a much harder set of
 * eight.
 */
function ExerciseCard({ exercise }: { exercise: ExerciseProgress }) {
  const points = exercise.points;
  if (points.length === 0) return null;

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const delta = last.estimated1rm - first.estimated1rm;
  const values = points.map((point) => point.estimated1rm);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  // A flat series has no shape to show. Drawing it at zero height reads as
  // "you lifted nothing"; half height reads as "no change", which is the truth.
  const flat = range < 0.5;

  return (
    <Card label={exercise.name.toUpperCase()}>
      <View style={styles.row}>
        <View>
          <Text style={styles.numeral}>
            {kg(last.weightKg)} kg × {last.reps}
          </Text>
          <Text style={styles.dim}>best set on {shortDate(last.date)}</Text>
        </View>
        {points.length > 1 ? (
          <View style={styles.alignEnd}>
            <Text style={[styles.change, { color: delta >= 0 ? colors.accent : colors.warn }]}>
              {signedKg(delta)} kg
            </Text>
            <Text style={styles.dim}>est. 1RM</Text>
          </View>
        ) : null}
      </View>

      {points.length > 1 ? (
        <View style={styles.chart}>
          {points.map((point, index) => (
            <View
              key={`${point.date}-${index}`}
              style={[
                styles.bar,
                {
                  height: flat ? 34 : Math.max(6, 10 + ((point.estimated1rm - min) / range) * 54),
                  backgroundColor:
                    index === points.length - 1 ? colors.accent : colors.surfaceHigh,
                },
              ]}
            />
          ))}
        </View>
      ) : (
        <Text style={styles.footnote}>{t('oneSessionSoFar')}</Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  back: { ...typo.body, color: colors.textDim, marginBottom: space.sm },
  title: { fontSize: 30, fontWeight: '300', color: colors.text },

  rangeRow: { flexDirection: 'row', gap: space.sm },
  rangeChip: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  rangeChipActive: { backgroundColor: colors.surfaceHigh, borderColor: colors.text },
  rangeText: { fontSize: 14, fontWeight: '600', color: colors.textDim },
  rangeTextActive: { color: colors.text },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  alignEnd: { alignItems: 'flex-end' },
  numeral: { ...typo.numeral, ...typo.mono, color: colors.text },
  change: { fontSize: 19, fontWeight: '400', ...typo.mono },

  statRow: { flexDirection: 'row', gap: space.sm },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statValue: { fontSize: 24, fontWeight: '300', color: colors.text, ...typo.mono },
  statLabel: { fontSize: 12, color: colors.textFaint },

  chart: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'flex-start', gap: 4, height: 72 },
  bar: { flex: 1, borderRadius: radius.sm, minWidth: 3, maxWidth: 26 },

  dim: { ...typo.bodyDim, color: colors.textDim },
  footnote: { fontSize: 13, color: colors.textFaint },
  reviewBlock: { gap: space.xs },
  reviewLabel: { ...typo.label, color: colors.textFaint },
  reviewBody: { ...typo.body, color: colors.text, lineHeight: 22 },
  reviewChange: { fontWeight: '400' },
  error: { color: colors.danger, fontSize: 14 },
});
