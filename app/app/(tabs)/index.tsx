import { useState } from 'react';
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
import type { Today } from '../../src/api/types';
import { Button } from '../../src/components/Button';
import { ContextChip } from '../../src/components/ContextChip';
import { Rail } from '../../src/components/Numeral';
import { Sparkline } from '../../src/components/Sparkline';
import { kg, longDate, signedKg } from '../../src/lib/format';
import { colors, space, type as typo } from '../../src/theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

type Panel = 'coach' | 'day' | 'food' | 'weight';

/**
 * The home screen does not scroll.
 *
 * Everything he needs at a glance fits on one screen, and each line opens if he
 * wants the detail behind it. In particular the movement list stays shut: he
 * does not need to read six exercise names over breakfast — that is a thing to
 * look at once he is standing in the gym, which is what Start is for.
 *
 * One panel open at a time, so opening one cannot push the rest off the screen.
 */
export default function TodayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const today = useResource<Today>('/today');
  const [open, setOpen] = useState<Panel | null>(null);

  function toggle(panel: Panel) {
    LayoutAnimation.configureNext(LayoutAnimation.create(160, 'easeInEaseOut', 'opacity'));
    setOpen((current) => (current === panel ? null : panel));
  }

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

  const { plan, weight, macros, week, openSession, context, date, completedToday, coach } =
    today.data;
  const inProgress = openSession !== null;
  const done = !inProgress && (completedToday?.length ?? 0) > 0;
  const resting = !!coach && coach.sessionType !== 'strength' && !done && !inProgress;

  return (
    <View style={styles.root}>
    <ScrollView
      style={styles.scroll}
      // Sized to fit, so in practice it never moves. The ScrollView is only a
      // safety net for a smaller screen or larger type — clipping content
      // would be worse than a few points of give.
      contentContainerStyle={[
        styles.page,
        { paddingTop: insets.top + space.md, paddingBottom: space.md },
      ]}
      bounces={false}
      refreshControl={
        <RefreshControl
          refreshing={today.refreshing}
          onRefresh={today.reload}
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
        {today.stale ? <Text style={styles.stale}>Offline · last plan this phone saw</Text> : null}
      </View>

      {plan.jointPain.recommendDoctor ? (
        <View style={styles.alertRow}>
          <Text style={styles.alert}>
            Joint pain twice running · load cut {plan.jointPain.reduceLoadPct}% · see someone
          </Text>
        </View>
      ) : null}

      {/* The coach's read. Headline always; the reasoning on tap. */}
      {coach ? (
        <Panel
          label={resting ? 'NO LIFT TODAY' : 'LIFT TODAY'}
          labelTone="signal"
          open={open === 'coach'}
          onPress={() => toggle('coach')}
        >
          <Text style={styles.headline}>{coach.headline}</Text>
          {open === 'coach' ? <Text style={styles.prose}>{coach.body}</Text> : null}
        </Panel>
      ) : null}

      {/* The session. Movements stay shut until he asks or hits Start. */}
      <Panel
        label={done ? 'DONE TODAY' : 'SESSION'}
        open={open === 'day'}
        onPress={() => toggle('day')}
      >
        <View style={styles.dayRow}>
          <Text style={[styles.dayLetter, done && { color: colors.accent }]}>
            {done ? (completedToday[0]?.template ?? plan.template) : plan.template}
          </Text>
          <View style={styles.dayMeta}>
            <Text style={styles.dayCount}>
              {done
                ? `${completedToday.reduce((sum, s) => sum + s.sets.length, 0)} sets logged`
                : `${plan.exercises.length} movements`}
            </Text>
            <Text style={styles.dayNote}>
              {done
                ? `${week.strengthSessions.done} of ${week.strengthSessions.target} this week`
                : plan.rampIn.active
                  ? `Ramp-in · ${plan.rampIn.maxWorkingSets} sets · ${plan.rampIn.minRir} RIR`
                  : `${week.strengthSessions.done} of ${week.strengthSessions.target} this week`}
            </Text>
          </View>
        </View>

        {open === 'day' ? (
          <View style={styles.ledger}>
            {(done
              ? [...new Map(
                  completedToday
                    .flatMap((s) => s.sets)
                    .map((set) => [set.exerciseName, `${kg(set.weightKg)} × ${set.reps}`]),
                ).entries()]
              : plan.exercises.map(
                  (e) =>
                    [
                      e.name,
                      `${e.sets}×${e.targetReps}${e.weightKg != null ? `  ${kg(e.weightKg)}` : '  —'}`,
                    ] as [string, string],
                )
            ).map(([name, detail], index) => (
              <View key={name} style={[styles.ledgerRow, index > 0 && styles.ledgerDivider]}>
                <Text style={styles.movement} numberOfLines={1}>
                  {name}
                </Text>
                <Text style={styles.prescription}>{detail}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </Panel>

      {/* Protein is the number he manages all day. It keeps the hero. */}
      <Panel label="PROTEIN LEFT" open={open === 'food'} onPress={() => toggle('food')}>
        <View style={styles.heroRow}>
          <Text style={styles.hero}>{macros.remaining.proteinG}</Text>
          <Text style={styles.heroUnit}>g</Text>
          <View style={styles.heroAside}>
            <Text style={styles.asideValue}>{macros.remaining.kcal}</Text>
            <Text style={styles.asideLabel}>KCAL LEFT</Text>
          </View>
        </View>
        <Rail percent={macros.remaining.proteinPct} />
        {open === 'food' ? (
          <>
            <View style={styles.stats}>
              <Stat value={`${macros.consumed.proteinG}`} label="G EATEN" />
              <Stat value={`${macros.remaining.fatToFloorG}`} label="G TO FAT FLOOR" />
              <Stat value={`${macros.meals.length}`} label="MEALS" />
            </View>
            <Button title="Log food" variant="secondary" onPress={() => router.push('/food')} />
          </>
        ) : null}
      </Panel>

      <Panel label="WEIGHT" open={open === 'weight'} onPress={() => toggle('weight')}>
        {weight.latest ? (
          <>
            <View style={styles.weightRow}>
              <Text style={styles.weightValue}>{kg(weight.average7?.avgKg)}</Text>
              <Text style={styles.weightUnit}>kg</Text>
              <Text
                style={[
                  styles.weightChange,
                  { color: (weight.changeKg ?? 0) <= 0 ? colors.accent : colors.danger },
                ]}
              >
                {signedKg(weight.changeKg)}
              </Text>
            </View>
            {open === 'weight' ? (
              <>
                <Sparkline series={weight.series} height={52} />
                <View style={styles.stats}>
                  <Stat value={kg(weight.latest.weightKg)} label="LAST" />
                  <Stat value={kg(weight.goalWeightKg, 0)} label="GOAL" />
                  <Stat value={`${weight.average7?.sampleCount ?? 0}/7`} label="WEIGH-INS" />
                </View>
                <Button
                  title="Log weight"
                  variant="secondary"
                  onPress={() => router.push('/weight')}
                />
              </>
            ) : null}
          </>
        ) : (
          <Text style={styles.subtle}>No weigh-ins yet. Three seconds.</Text>
        )}
      </Panel>

    </ScrollView>

    {/* Pinned. Expanding a panel must never push the one action off-screen. */}
    <View style={styles.footer}>
      <Button
        title={inProgress ? 'Resume' : done ? 'Train again' : resting ? 'Lift anyway' : 'Start'}
        variant={!inProgress && (done || resting) ? 'secondary' : 'primary'}
        onPress={() => router.push('/workout')}
      />
    </View>
    </View>
  );
}

/** A line of the page that opens when tapped. */
function Panel({
  label,
  labelTone = 'faint',
  open,
  onPress,
  children,
}: {
  label: string;
  labelTone?: 'faint' | 'signal';
  open: boolean;
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.panel, pressed && styles.pressed]}>
      <View style={styles.panelHead}>
        <Text
          style={[styles.label, labelTone === 'signal' && { color: colors.accent }]}
        >
          {label}
        </Text>
        <Text style={styles.chevron}>{open ? '−' : '+'}</Text>
      </View>
      {children}
    </Pressable>
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

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  page: { paddingHorizontal: space.lg, gap: space.md },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  centre: { alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.lg },

  masthead: { gap: space.md },
  date: { fontSize: 15, color: colors.textDim, letterSpacing: 0.3 },
  mastheadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  links: { flexDirection: 'row', gap: space.lg },
  link: { ...typo.label, color: colors.textFaint },
  stale: { fontSize: 13, color: colors.accent },

  panel: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.md,
    gap: space.sm,
  },
  panelHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { ...typo.label, color: colors.textFaint },
  chevron: { fontSize: 15, color: colors.textFaint, lineHeight: 15 },
  pressed: { opacity: 0.7 },

  headline: { fontSize: 20, fontWeight: '400', color: colors.text, lineHeight: 26, letterSpacing: -0.3 },
  prose: { fontSize: 15, color: colors.textDim, lineHeight: 22 },

  dayRow: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  dayLetter: { fontSize: 52, fontWeight: '300', color: colors.text, letterSpacing: -2, lineHeight: 56 },
  dayMeta: { gap: 1 },
  dayCount: { ...typo.body, color: colors.text },
  dayNote: { fontSize: 13, color: colors.textDim },

  ledger: { paddingTop: space.xs },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: space.sm,
    gap: space.md,
  },
  ledgerDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  movement: { fontSize: 15, color: colors.text, flexShrink: 1 },
  prescription: { fontSize: 14, color: colors.textDim, ...typo.mono },

  heroRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  hero: { fontSize: 60, fontWeight: '300', color: colors.text, letterSpacing: -3, ...typo.mono },
  heroUnit: { fontSize: 16, color: colors.textDim },
  heroAside: { flex: 1, alignItems: 'flex-end' },
  asideValue: { fontSize: 20, color: colors.textDim, ...typo.mono },
  asideLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 1, color: colors.textFaint },

  weightRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  weightValue: { fontSize: 34, fontWeight: '300', color: colors.text, letterSpacing: -1, ...typo.mono },
  weightUnit: { fontSize: 15, color: colors.textDim, flex: 1 },
  weightChange: { fontSize: 19, ...typo.mono },

  stats: { flexDirection: 'row', gap: space.lg, paddingTop: space.xs },
  stat: { flex: 1, gap: 2 },
  statValue: { fontSize: 17, color: colors.text, ...typo.mono },
  statLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 1, color: colors.textFaint },

  subtle: { ...typo.bodyDim, color: colors.textDim },
  alertRow: { paddingVertical: space.xs },
  alert: { fontSize: 13, color: colors.danger, lineHeight: 19 },
  placeholder: { ...typo.body, color: colors.textDim },
});
