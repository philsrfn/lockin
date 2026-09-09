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
import { CardioSheet } from '../../src/components/CardioSheet';
import { FoodCapture } from '../../src/components/FoodCapture';
import { WeekPager } from '../../src/components/WeekPager';
import { DayPicker } from '../../src/components/DayPicker';
import { SessionPreview } from '../../src/components/SessionPreview';
import { greeting, initials, kg, longDate, shortDate, signedKg } from '../../src/lib/format';
import { rememberLocale } from '../../src/api/config';
import { t } from '../../src/lib/locale';
import { colors, radius, space, type as typo } from '../../src/theme';

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
  /** The day the strip is pointing at. The day itself, not its date: with
   *  earlier weeks in play there is no single week to resolve a date in. */
  const [selected, setSelected] = useState<WeekDay | null>(null);
  const [coachOpen, setCoachOpen] = useState(false);
  const [cardioOpen, setCardioOpen] = useState(false);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);
  const [capture, setCapture] = useState<'scan' | 'describe' | null>(null);
  /** Bumped to send the strip back to this week along with the numbers. */
  const [goHome, setGoHome] = useState(0);

  // Follow the day over midnight rather than stranding the selection.


  /**
   * The language follows the athlete, not the handset. This is the one screen
   * that always loads and always carries the profile, so it is where the
   * choice is picked up — including a change made on another device.
   */
  useEffect(() => {
    if (today.data) void rememberLocale(today.data.profile.locale);
  }, [today.data]);

  if (!today.data) {
    return (
      <View style={[styles.root, styles.centre, { paddingTop: insets.top }]}>
        <Text style={styles.placeholder}>
          {today.loading ? 'Loading' : (today.error ?? 'No data')}
        </Text>
        {today.error ? <Button title={t('tryAgain')} variant="secondary" onPress={today.reload} /> : null}
      </View>
    );
  }

  const { plan, weight, macros, openSession, context, date, completedToday, coach, profile } =
    today.data;
  const inProgress = openSession !== null;
  const doneToday = !inProgress && (completedToday?.length ?? 0) > 0;
  const resting = !!coach && coach.sessionType !== 'strength' && !doneToday && !inProgress;

  /**
   * Which direction is the good one.
   *
   * This used to be "down is amber, up is red", full stop — correct for the
   * one athlete the app was written for and wrong for anybody trying to gain.
   * The goal is on the profile; where onboarding never asked (a profile that
   * predates it), the goal weight answers instead, and losing is the fallback
   * because that is what every athlete on this server is doing.
   */
  const wantsToGain =
    profile.goal === 'gain' ||
    (profile.goal == null &&
      profile.goalWeightKg != null &&
      weight.average7 != null &&
      profile.goalWeightKg > weight.average7.avgKg);
  const change = weight.changeKg ?? 0;
  const trendColour =
    profile.goal === 'maintain'
      ? colors.textDim
      : (wantsToGain ? change >= 0 : change <= 0)
        ? colors.accent
        : colors.danger;

  /**
   * Start the logger, optionally on a day the athlete picked rather than the
   * one the rotation proposed. An already-open session ignores the choice —
   * the logger keeps the day its logged sets belong to.
   */
  function startSession(template?: string) {
    setDayPickerOpen(false);
    router.push(template ? { pathname: '/workout', params: { template } } : '/workout');
  }

  const active = selected ?? week.data?.days.find((day) => day.date === date) ?? null;
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
          <View style={styles.titleRow}>
            <View style={styles.titleText}>
              <Text style={styles.greeting} numberOfLines={1}>
                {greeting(profile.name)}
              </Text>
              <Text style={styles.date}>{longDate(date)}</Text>
            </View>
            {/*
              Where every app keeps the account, and the one place an icon
              beats a word: a name in a circle is recognised without reading,
              and it frees the row below for the two places you actually go.
            */}
            <Pressable
              onPress={() => router.push('/account')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={t('accountTitle')}
              style={({ pressed }) => [styles.avatar, pressed && styles.chipOn]}
            >
              <Text style={styles.avatarText}>{initials(profile.name)}</Text>
            </Pressable>
          </View>
          <View style={styles.mastheadRow}>
            <ContextChip context={context} onChanged={today.reload} />
            {/* Chips rather than spaced small caps: three words in a row at
                11pt looked like a caption, not three places to go. */}
            <View style={styles.links}>
              {(
                [
                  ['/history', t('history')],
                  ['/progress', t('progress')],
                ] as const
              ).map(([href, label]) => (
                <Pressable
                  key={href}
                  onPress={() => router.push(href)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.chip, pressed && styles.chipOn]}
                >
                  <Text style={styles.chipText}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </View>

        {plan.jointPain.recommendDoctor ? (
          <Text style={styles.alert}>
            {t('jointPainAlert', { pct: plan.jointPain.reduceLoadPct })}
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

        {/* The week: the subject of the screen and its navigation, and the
            weeks behind it — "was last week better" is the question you ask
            when this one is going badly. */}
        <WeekPager
          today={date}
          thisWeek={week.data}
          selected={selected?.date ?? date}
          onSelect={setSelected}
          since={today.data.since ?? null}
          goHome={goHome}
        />

        {/* Driven by the strip. Today by default, any day on tap. */}
        <View style={styles.section}>
          {/* Only when it is news. On today's screen a label reading TODAY
              above today's numbers is a caption for something nobody was
              confused about; scrolled back to Thursday, the date is the whole
              point. */}
          {isToday ? null : (
            <Text style={styles.label}>{shortDate(active!.date).toUpperCase()}</Text>
          )}

          {isToday ? (
            <>
              {/*
                Calories belong under the protein, not beside a body weight.
                They are the same question in another unit — how much of today
                is left to eat — and they were sitting in a column next to a
                seven-day average, which is a different question about a
                different thing on a different timescale. Three equal columns
                said those were three facts of one kind. They were two.
              */}
              <View style={styles.foodGroup}>
                <View style={styles.heroRow}>
                  <Text style={styles.hero}>{macros.remaining.proteinG}</Text>
                  <Text style={styles.heroUnit}>{t('proteinLeft')}</Text>
                  <View style={styles.heroSpacer} />
                  {/*
                    The number is the question and a barcode is the fastest
                    answer to it, so the two sit together rather than a tab
                    away.
                  */}
                  <Pressable
                    onPress={() => setCapture('scan')}
                    hitSlop={10}
                    style={({ pressed }) => [styles.scan, pressed && styles.chipOn]}
                  >
                    <Text style={styles.scanText}>{t('scan')}</Text>
                  </Pressable>
                </View>
                <Text style={styles.heroSupport}>
                  {macros.remaining.kcal} {t('kcalLeftOf')} {macros.targets.kcal}
                </Text>
              </View>

              {/*
                The body, in one line. Weight and its weekly change are not two
                facts either — "95.1, down 0.4" is one sentence, and splitting
                it into two boxes made the reader assemble it.
              */}
              <View style={styles.bodyRow}>
                {weight.average7 ? (
                  <>
                    <Text style={styles.bodyValue}>{kg(weight.average7.avgKg)} kg</Text>
                    {weight.changeKg != null ? (
                      <Text style={[styles.bodyDelta, { color: trendColour }]}>
                        {signedKg(weight.changeKg)} {t('thisWeekInline')}
                      </Text>
                    ) : null}
                  </>
                ) : (
                  <Text style={styles.bodyAbsent}>{t('noWeighInYet')}</Text>
                )}
                {/* Only once the phone shares them. A zero here would be a
                    claim we cannot make. */}
                {today.data.health?.steps != null ? (
                  <Text style={styles.bodyAside}>
                    · {(today.data.health.steps / 1000).toFixed(1)}k {t('stepsLower')}
                  </Text>
                ) : null}
              </View>
            </>
          ) : (
            <DayDetail day={active!} target={week.data?.proteinTargetG ?? 190} />
          )}
        </View>

        {/*
          What the Start button will actually start. This screen used to end
          here with a third of it empty, and the only way to find out whether
          today was squats or a rest day was to press the button.

          No label above it. The card names the day and the programme in its
          own header, and the whole screen is today — the same argument the
          date label above makes for itself: a caption for something nobody
          was confused about is a line of screen spent on nothing.
        */}
        {isToday ? (
          <View style={styles.section}>
            <SessionPreview plan={plan} onPickDay={() => setDayPickerOpen(true)} />
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {/*
          Its own row above the actions, not squeezed in beside them. Sharing
          the row left the primary button a third of its width, and the two
          actions belong to today while the link is about leaving another day.

          Cleared rather than set to today: the hero falls back to today on its
          own, so the strip does not have to be showing this week for the
          button to work.
        */}
        {!isToday ? (
          <Pressable
            onPress={() => {
              setSelected(null);
              // The strip too: leaving it stranded in August under today's
              // numbers is half a return.
              setGoHome((n) => n + 1);
            }}
            hitSlop={10}
            style={styles.backToToday}
          >
            <Text style={styles.backText}>{t('backToToday')}</Text>
          </Pressable>
        ) : null}

        <View style={styles.actions}>
          <Button
            title={t(
              inProgress ? 'resume' : doneToday ? 'trainAgain' : resting ? 'liftAnyway' : 'start',
            )}
            variant={!inProgress && (doneToday || resting) ? 'secondary' : 'primary'}
            onPress={() => startSession()}
            style={styles.primaryAction}
          />
          {/*
            §11 expects two actions here. The second used to be food, which has
            its own tab; the one with nowhere to go was cardio — the coach
            prescribed it and had no way to know whether it happened.
          */}
          <Pressable
            onPress={() => setCardioOpen(true)}
            style={({ pressed }) => [styles.cardioAction, pressed && styles.cardioActionOn]}
          >
            <Text style={styles.cardioActionText}>{t('cardio')}</Text>
          </Pressable>
        </View>
      </View>

      <DayPicker
        days={plan?.days ?? []}
        visible={dayPickerOpen}
        onPick={(code) => startSession(code)}
        onClose={() => setDayPickerOpen(false)}
      />

      <CardioSheet
        visible={cardioOpen}
        onClose={() => setCardioOpen(false)}
        onLogged={() => {
          void today.reload();
          void week.reload();
        }}
      />

      {/* The same sheet the food tab uses — one code path to a logged meal. */}
      <FoodCapture
        mode={capture}
        onClose={() => setCapture(null)}
        onLogged={() => {
          setCapture(null);
          void today.reload();
          void week.reload();
        }}
      />
    </View>
  );
}

/** A past day, read off the strip. Says what is missing rather than showing 0. */
function DayDetail({ day, target }: { day: WeekDay; target: number }) {
  return (
    <>
      {/* An em-dash at 62pt reads as a stray rule, not as "no data". */}
      {day.proteinPct === null ? (
        <Text style={styles.empty}>{t('nothingLoggedThatDay')}</Text>
      ) : (
        <View style={styles.heroRow}>
          <Text style={styles.hero}>{day.proteinG}</Text>
          <Text style={styles.heroUnit}>
            {t('gOf')} {target}
          </Text>
        </View>
      )}
      <View style={styles.facts}>
        <Fact
          value={day.lifted ? (day.template ?? '—') : '—'}
          label={day.lifted ? `${day.sets} ${t('setsShort')}` : t('noSession')}
        />
        <Fact value={day.weightKg ? kg(day.weightKg) : '—'} label={t('weighed')} />
        <Fact value={day.kcal ? `${day.kcal}` : '—'} label={t('kcalLabel')} />
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
  // A bone-coloured dash looks like a hairline. Absent values recede.
  const absent = value === '—';
  const color = absent
    ? colors.textFaint
    : tone === 'signal'
      ? colors.accent
      : tone === 'alert'
        ? colors.danger
        : colors.text;
  return (
    <View style={styles.fact}>
      <Text style={[styles.factValue, { color }]}>{value}</Text>
      {/* One line, always. A wrapping label turns a calm row of numbers into
          a paragraph — which is what four facts in German did. */}
      <Text style={styles.factLabel} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  page: { paddingHorizontal: space.lg, gap: space.lg, paddingBottom: space.md },
  centre: { alignItems: 'center', justifyContent: 'center', gap: space.lg, padding: space.lg },

  masthead: { gap: space.sm },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  titleText: { flex: 1 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  avatarText: { fontSize: 15, fontWeight: '600', color: colors.textDim, letterSpacing: 0.3 },
  greeting: { fontSize: 26, fontWeight: '300', color: colors.text, letterSpacing: -0.6 },
  date: { fontSize: 14, color: colors.textFaint, letterSpacing: 0.3, marginBottom: space.xs },
  mastheadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  links: { flexDirection: 'row', gap: space.sm },
  chip: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: 7,
  },
  chipOn: { opacity: 0.65 },
  chipText: { fontSize: 12, fontWeight: '600', color: colors.textDim, letterSpacing: 0 },

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
  heroSpacer: { flex: 1 },
  scan: {
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.pill,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  scanText: { fontSize: 14, fontWeight: '600', color: colors.text },
  hero: { fontSize: 62, fontWeight: '300', color: colors.text, letterSpacing: -3, ...typo.mono },
  heroUnit: { fontSize: 15, color: colors.textDim },

  /**
   * Hero and calories are one group and sit tight together; the body line is
   * a different subject and gets the section's own gap. Three lines evenly
   * spaced read as three unrelated facts, which is the arrangement this
   * replaced.
   */
  foodGroup: { gap: space.xs },
  heroSupport: { fontSize: 14, color: colors.textDim },

  bodyRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm, flexWrap: 'wrap' },
  bodyValue: { fontSize: 18, color: colors.text, ...typo.mono },
  bodyDelta: { fontSize: 14, ...typo.mono },
  bodyAside: { fontSize: 14, color: colors.textFaint, ...typo.mono },
  bodyAbsent: { fontSize: 15, color: colors.textFaint },

  facts: { flexDirection: 'row', gap: space.lg },
  fact: { flex: 1, gap: 2 },
  factValue: { fontSize: 18, color: colors.text, ...typo.mono },
  factLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 1, color: colors.textFaint },

  primaryAction: { flex: 1 },
  cardioAction: {
    minHeight: 54,
    paddingHorizontal: space.xl,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
  },
  cardioActionOn: { opacity: 0.7 },
  cardioActionText: { fontSize: 16, fontWeight: '600', color: colors.text, letterSpacing: -0.2 },
  footer: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    gap: space.md,
  },
  actions: { flexDirection: 'row', alignItems: 'stretch', gap: space.md },
  backToToday: { alignSelf: 'flex-start', paddingVertical: space.xs },
  backText: { fontSize: 14, fontWeight: '500', color: colors.textDim },

  alert: { fontSize: 13, color: colors.danger, lineHeight: 19 },
  placeholder: { ...typo.body, color: colors.textDim },
  empty: { fontSize: 17, color: colors.textFaint, paddingVertical: space.lg },
});
