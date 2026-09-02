import { useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  LayoutAnimation,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResource } from '../../src/api/hooks';
import type { Today, Week, WeekDay } from '../../src/api/types';
import { Button } from '../../src/components/Button';
import { ContextChip } from '../../src/components/ContextChip';
import { WeekStrip } from '../../src/components/WeekStrip';
import { kg, longDate, shortDate, signedKg } from '../../src/lib/format';
import { colors, space, type as typo } from '../../src/theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/**
 * Home is the week, not the day.
 *
 * §4: "weekly targets, not fixed weekdays — travel makes fixed days fail." The
 * strip is the subject and also the navigation: tapping a day drives the
 * numbers beneath it, so the same screen answers "how is the week going" and
 * "what did Saturday look like" without going anywhere.
 *
 * It does not scroll, and the movement list is not on it. Six exercise names
 * are for when he is standing in the gym, which is what Start is for.
 */
export default function TodayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const today = useResource<Today>('/today');
  const week = useResource<Week>('/week');
  const [selected, setSelected] = useState<string | null>(null);
  const [coachOpen, setCoachOpen] = useState(false);

  // Follow the day over midnight rather than stranding the selection.
  useEffect(() => {
    if (today.data && !selected) setSelected(today.data.date);
  }, [today.data, selected]);

  if (!today.data) {
    return (
      <View style={[styles.root, styles.centre, { paddingTop: insets.top }]}>
        <Text style={styles.placeholder}>
          {today.loading ? 'Loading' : (today.error ?? 'No data')}
        </Text>
        {today.error ? <Button title="Try again" variant="secondary" onPress={today.reload} /> : null}
      </View>
    );
  }

  const { plan, weight, macros, openSession, context, date, completedToday, coach } = today.data;
  const inProgress = openSession !== null;
  const doneToday = !inProgress && (completedToday?.length ?? 0) > 0;
  const resting = !!coach && coach.sessionType !== 'strength' && !doneToday && !inProgress;

  const days = week.data?.days ?? [];
  const active = days.find((day) => day.date === (selected ?? date));
  const isToday = !active || active.date === date;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.page, { paddingTop: insets.top + space.md }]}
        bounces={false}
        refreshControl={
          <RefreshControl
            refreshing={today.refreshing}
            onRefresh={() => {
              void today.reload();
              void week.reload();
            }}
            tintColor={colors.textFaint}
          />
        }
      >
        <View style={styles.masthead}>
          <Text style={styles.date}>{longDate(date)}</Text>
          <View style={styles.mastheadRow}>
            <ContextChip context={context} onChanged={today.reload} />
            <View style={styles.links}>
              <Pressable onPress={() => router.push('/progress')} hitSlop={12}>
                <Text style={styles.link}>PROGRESS</Text>
              </Pressable>
              <Pressable onPress={() => router.push('/rules')} hitSlop={12}>
                <Text style={styles.link}>RULES</Text>
              </Pressable>
            </View>
          </View>
        </View>

        {plan.jointPain.recommendDoctor ? (
          <Text style={styles.alert}>
            Joint pain twice running · load cut {plan.jointPain.reduceLoadPct}% · see someone
          </Text>
        ) : null}

        {/* The trainer's read. One line; the reasoning on tap. */}
        {coach ? (
          <Pressable
            onPress={() => {
              LayoutAnimation.configureNext(
                LayoutAnimation.create(160, 'easeInEaseOut', 'opacity'),
              );
              setCoachOpen((v) => !v);
            }}
            style={styles.coach}
          >
            <Text style={styles.headline}>{coach.headline}</Text>
            {coachOpen ? <Text style={styles.prose}>{coach.body}</Text> : null}
          </Pressable>
        ) : null}

        {/* The week: the subject of the screen and its navigation. */}
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.label}>DIESE WOCHE</Text>
            {week.data ? (
              <Text style={styles.tally}>
                {week.data.strength.done}/{week.data.strength.target} lifts ·{' '}
                {week.data.weighIns.done}/7 weigh-ins
              </Text>
            ) : null}
          </View>
          <WeekStrip
            days={days}
            selected={selected ?? date}
            onSelect={(next) => setSelected(next)}
          />
        </View>

        {/* Driven by the strip. Today by default, any day on tap. */}
        <View style={styles.section}>
          <Text style={styles.label}>
            {isToday ? 'HEUTE' : shortDate(active!.date).toUpperCase()}
          </Text>

          {isToday ? (
            <>
              <View style={styles.heroRow}>
                <Text style={styles.hero}>{macros.remaining.proteinG}</Text>
                <Text style={styles.heroUnit}>g protein left</Text>
              </View>
              <View style={styles.facts}>
                <Fact value={`${macros.remaining.kcal}`} label="KCAL LEFT" />
                <Fact
                  value={weight.average7 ? kg(weight.average7.avgKg) : '—'}
                  label="7-DAY AVG"
                />
                <Fact
                  value={signedKg(weight.changeKg)}
                  label="THIS WEEK"
                  tone={(weight.changeKg ?? 0) <= 0 ? 'signal' : 'alert'}
                />
              </View>
            </>
          ) : (
            <DayDetail day={active!} target={week.data?.proteinTargetG ?? 190} />
          )}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {!isToday ? (
          <Pressable onPress={() => setSelected(date)} hitSlop={10} style={styles.backToToday}>
            <Text style={styles.backText}>BACK TO TODAY</Text>
          </Pressable>
        ) : null}
        <Button
          title={
            inProgress ? 'Resume' : doneToday ? 'Train again' : resting ? 'Lift anyway' : 'Start'
          }
          variant={!inProgress && (doneToday || resting) ? 'secondary' : 'primary'}
          onPress={() => router.push('/workout')}
        />
      </View>
    </View>
  );
}

/** A past day, read off the strip. Says what is missing rather than showing 0. */
function DayDetail({ day, target }: { day: WeekDay; target: number }) {
  return (
    <>
      <View style={styles.heroRow}>
        <Text style={styles.hero}>{day.proteinPct === null ? '—' : day.proteinG}</Text>
        <Text style={styles.heroUnit}>
          {day.proteinPct === null ? 'nothing logged' : `g of ${target}`}
        </Text>
      </View>
      <View style={styles.facts}>
        <Fact
          value={day.lifted ? `Day ${day.template ?? '?'}` : '—'}
          label={day.lifted ? `${day.sets} SETS` : 'NO SESSION'}
        />
        <Fact value={day.weightKg ? kg(day.weightKg) : '—'} label="WEIGHED" />
        <Fact value={day.kcal ? `${day.kcal}` : '—'} label="KCAL" />
      </View>
    </>
  );
}

function Fact({
  value,
  label,
  tone = 'default',
}: {
  value: string;
  label: string;
  tone?: 'default' | 'signal' | 'alert';
}) {
  const color = tone === 'signal' ? colors.accent : tone === 'alert' ? colors.danger : colors.text;
  return (
    <View style={styles.fact}>
      <Text style={[styles.factValue, { color }]}>{value}</Text>
      <Text style={styles.factLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  page: { paddingHorizontal: space.lg, gap: space.lg, paddingBottom: space.md },
  centre: { alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.lg },

  masthead: { gap: space.md },
  date: { fontSize: 15, color: colors.textDim, letterSpacing: 0.3 },
  mastheadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  links: { flexDirection: 'row', gap: space.lg },
  link: { ...typo.label, color: colors.textFaint },

  coach: { gap: space.sm },
  headline: { fontSize: 20, fontWeight: '400', color: colors.text, lineHeight: 27, letterSpacing: -0.3 },
  prose: { fontSize: 15, color: colors.textDim, lineHeight: 22 },

  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.md,
    gap: space.md,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { ...typo.label, color: colors.textFaint },
  tally: { fontSize: 12, color: colors.textFaint, ...typo.mono },

  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  hero: { fontSize: 62, fontWeight: '300', color: colors.text, letterSpacing: -3, ...typo.mono },
  heroUnit: { fontSize: 15, color: colors.textDim },

  facts: { flexDirection: 'row', gap: space.lg },
  fact: { flex: 1, gap: 2 },
  factValue: { fontSize: 18, color: colors.text, ...typo.mono },
  factLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 1, color: colors.textFaint },

  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: space.md,
  },
  backToToday: { alignSelf: 'center' },
  backText: { ...typo.label, color: colors.textFaint },

  alert: { fontSize: 13, color: colors.danger, lineHeight: 19 },
  placeholder: { ...typo.body, color: colors.textDim },
});
