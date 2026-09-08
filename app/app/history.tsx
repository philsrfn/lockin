import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ApiError, api } from '../src/api/client';
import type {
  CardioKind,
  CardioSession,
  HistorySession,
  TrainingHistory,
} from '../src/api/types';
import { Card, Rule } from '../src/components/Card';
import { Screen } from '../src/components/Screen';
import { kg, longDate } from '../src/lib/format';
import { t } from '../src/lib/locale';
import { colors, radius, space, type as typo } from '../src/theme';

/**
 * What was actually done.
 *
 * Progress answers whether the numbers are going up. This answers what
 * happened — the question you ask when a weight feels wrong and you want to
 * see last Tuesday, or when you simply want to look at the work.
 *
 * Sets expand in place rather than opening a detail screen. The server sends
 * them with the list (it had already loaded them to summarise them), so
 * expanding is instant and works with no signal, which is exactly when
 * somebody is standing in a gym wondering what they did last time.
 */

const RANGES = [30, 90, 365] as const;

/**
 * Every kind the API can return, spelled out. A computed `t('kind' + kind)`
 * would have compiled and then silently printed a key on a value nobody
 * remembered to translate — `other` had no string at all.
 */
const KIND_LABEL: Record<CardioKind, () => string> = {
  zone2: () => t('kindZone2'),
  intervals: () => t('kindIntervals'),
  sport: () => t('kindSport'),
  walk: () => t('kindWalk'),
  other: () => t('kindOther'),
};

export default function HistoryScreen() {
  const router = useRouter();
  const [days, setDays] = useState<number>(30);
  const [data, setData] = useState<TrainingHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await api<TrainingHistory>(`/history?days=${days}`));
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

  const totals = data?.totals;
  const empty = data !== null && data.days.length === 0;

  return (
    <Screen onRefresh={load} refreshing={refreshing}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>{t('backToTodayShort')}</Text>
        </Pressable>
        <Text style={styles.title}>{t('historyTitle')}</Text>
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

      {totals && !empty ? (
        <Card label={t('training')}>
          <View style={styles.statRow}>
            <Stat value={String(totals.sessions)} label={t('sessions')} />
            <Stat value={String(totals.setCount)} label={t('sets')} />
            <Stat
              value={`${Math.round(totals.totalVolumeKg / 1000)}t`}
              label={t('volumeLifted')}
            />
            <Stat value={String(totals.cardioMinutes)} label={t('cardioMinutesTotal')} />
          </View>
        </Card>
      ) : null}

      {empty ? (
        <Text style={styles.empty}>
          {/* Never trained at all reads differently from "not in these 30 days",
              and telling somebody the wrong one of those is discouraging. */}
          {days === 365 ? t('nothingTrainedYet') : t('nothingInThisRange')}
        </Text>
      ) : null}

      {data?.days.map((entry) => (
        <View key={entry.day} style={styles.day}>
          <Text style={styles.dayLabel}>{dayHeading(entry.day, data.today)}</Text>

          {entry.sessions.map((session) => (
            <SessionRow
              key={`s${session.id}`}
              session={session}
              open={expanded === session.id}
              onToggle={() => setExpanded(expanded === session.id ? null : session.id)}
            />
          ))}

          {entry.cardio.map((entry_) => (
            <CardioRow key={`c${entry_.id}`} cardio={entry_} />
          ))}
        </View>
      ))}
    </Screen>
  );
}

function SessionRow({
  session,
  open,
  onToggle,
}: {
  session: HistorySession;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Card>
      <Pressable onPress={onToggle} accessibilityRole="button">
        <View style={styles.rowTop}>
          <Text style={styles.rowTitle}>
            {session.template ?? t('training')}
            {session.contextName ? <Text style={styles.dim}>{`  ${session.contextName}`}</Text> : null}
          </Text>
          <Text style={styles.dim}>
            {session.summary.setCount} {t('sets')}
          </Text>
        </View>

        {session.summary.exercises.map((exercise) => (
          <View key={exercise.exerciseId} style={styles.exerciseRow}>
            <Text style={styles.exerciseName} numberOfLines={1}>
              {exercise.exerciseName}
            </Text>
            <Text style={styles.exerciseTop}>
              {exercise.sets}×{exercise.topReps} · {kg(exercise.topWeightKg)} kg
            </Text>
          </View>
        ))}

        <Text style={styles.footnote}>
          {[
            `${Math.round(session.summary.totalVolumeKg).toLocaleString()} kg ${t('volumeLifted')}`,
            session.rpe ? `${t('rpeShort')} ${session.rpe}` : null,
            session.finished ? null : t('unfinishedSession'),
            session.jointPain ? t('jointPainFlagged') : null,
          ]
            .filter(Boolean)
            .join('  ·  ')}
        </Text>

        {session.notes ? <Text style={styles.notes}>{session.notes}</Text> : null}

        {session.sets.length > 0 ? (
          <Text style={styles.toggle}>{open ? t('hideSets') : t('showSets')}</Text>
        ) : null}
      </Pressable>

      {open ? (
        <>
          <Rule />
          {session.sets.map((performed) => (
            <View key={performed.id} style={styles.setRow}>
              <Text style={styles.setIndex}>{performed.setIndex}</Text>
              <Text style={styles.setName} numberOfLines={1}>
                {performed.exerciseName}
              </Text>
              <Text style={styles.setNumbers}>
                {kg(performed.weightKg)} kg × {performed.reps}
                {performed.rir != null ? (
                  <Text style={styles.dim}>{`  RIR ${performed.rir}`}</Text>
                ) : null}
              </Text>
            </View>
          ))}
        </>
      ) : null}
    </Card>
  );
}

function CardioRow({ cardio }: { cardio: CardioSession }) {
  return (
    <Card>
      <View style={styles.rowTop}>
        <Text style={styles.rowTitle}>
          {cardio.description || KIND_LABEL[cardio.kind]()}
        </Text>
        <Text style={styles.dim}>
          {cardio.minutes} {t('minutesWord')}
        </Text>
      </View>
      <Text style={styles.footnote}>
        {[
          cardio.distanceKm != null ? `${cardio.distanceKm} km` : null,
          cardio.avgHr != null ? `${cardio.avgHr} bpm` : null,
          cardio.contextName,
          // A walk is recorded but does not tick a weekly box, and a history
          // that did not say so would quietly overstate the week.
          cardio.counts ? null : t('cardioDoesNotCount'),
        ]
          .filter(Boolean)
          .join('  ·  ')}
      </Text>
    </Card>
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
 * Today and yesterday by name; everything older by date.
 *
 * `today` is the server's, computed in the athlete's own timezone — the same
 * clock that decided which day each session belongs to. Deriving it from the
 * device instead would label the top row "Today" on a phone that had crossed
 * a timezone while the grouping underneath still said otherwise.
 *
 * longDate takes a bare YYYY-MM-DD and appends its own time.
 */
function dayHeading(day: string, today: string): string {
  if (day === today) return t('today');

  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  if (day === yesterday.toISOString().slice(0, 10)) return t('yesterday');

  return longDate(day);
}

// Every Text style names its own colour. The typography tokens deliberately
// carry size and weight only, and React Native does not inherit colour across
// a View — so a style that spreads `typo.body` and stops renders black text on
// a near-black ground, which is not a subtle bug but an invisible screen.
const styles = StyleSheet.create({
  header: { marginBottom: space.lg },
  back: { ...typo.body, color: colors.textDim, marginBottom: space.sm },
  title: { ...typo.title, color: colors.text },

  rangeRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.lg },
  rangeChip: {
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  rangeChipActive: { backgroundColor: colors.surfaceHigh },
  rangeText: { ...typo.bodyDim, color: colors.textDim },
  rangeTextActive: { color: colors.text, fontWeight: '600' },

  error: { ...typo.body, color: colors.danger, marginBottom: space.md },
  empty: { ...typo.bodyDim, color: colors.textFaint, marginTop: space.xl },

  day: { marginTop: space.lg },
  dayLabel: {
    ...typo.label,
    color: colors.textFaint,
    marginBottom: space.xs,
    marginLeft: space.xs,
  },

  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: space.sm,
  },
  rowTitle: { ...typo.body, fontWeight: '600', color: colors.text },
  dim: { ...typo.bodyDim, color: colors.textDim },

  exerciseRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
  exerciseName: { ...typo.bodyDim, color: colors.textDim, flexShrink: 1, marginRight: space.md },
  exerciseTop: { ...typo.body, ...typo.mono, color: colors.text },

  footnote: { fontSize: 12, color: colors.textFaint, marginTop: space.sm },
  notes: { ...typo.bodyDim, color: colors.textDim, marginTop: space.xs, fontStyle: 'italic' },
  toggle: { fontSize: 12, color: colors.accent, marginTop: space.sm },

  setRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: space.xs },
  setIndex: { ...typo.bodyDim, color: colors.textFaint, width: 20 },
  setName: { ...typo.bodyDim, color: colors.textDim, flex: 1, marginRight: space.sm },
  setNumbers: { ...typo.body, ...typo.mono, color: colors.text },

  statRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.lg },
  stat: { minWidth: 64 },
  statValue: { ...typo.numeral, ...typo.mono, fontSize: 22, color: colors.text },
  statLabel: { ...typo.bodyDim, color: colors.textFaint, fontSize: 11 },
});
