import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { api } from '../api/client';
import type { Week, WeekDay } from '../api/types';
import { dateRange } from '../lib/format';
import { caps, colors, space, type as typo } from '../theme';
import { t } from '../lib/locale';
import { WeekStrip } from './WeekStrip';

/** Far enough back to see a training block, not so far it becomes an archive. */
const WEEKS = 16;

/**
 * The week strip, with the weeks behind it.
 *
 * Home is the week, and until now it was only ever *this* week — which answers
 * "how am I doing" and not "was last week better", which is the question you
 * ask when this one is going badly. Swiping back is the whole feature; the
 * heading and the tally follow whichever week is on screen, because a strip
 * showing August above a tally counting September would be worse than no
 * history at all.
 *
 * Each week is fetched when it is first scrolled to. The current one is handed
 * in, since the screen already has it.
 */
export function WeekPager({
  today,
  thisWeek,
  selected,
  onSelect,
}: {
  today: string;
  thisWeek: Week | null;
  selected: string;
  onSelect: (day: WeekDay) => void;
}) {
  const { width } = useWindowDimensions();
  // The strip is inset by the screen's own padding, so a page is the window
  // less that. Getting this wrong is what makes paging land between weeks.
  const page = width - space.lg * 2;

  const [weeks, setWeeks] = useState<Record<string, Week>>({});
  const [visible, setVisible] = useState(today);
  const asked = useRef(new Set<string>());

  // Oldest first, so the strip reads left-to-right the way a calendar does and
  // the newest week is the one you start on.
  const endings = useRef(
    Array.from({ length: WEEKS }, (_, i) => addDays(today, -7 * (WEEKS - 1 - i))),
  ).current;

  useEffect(() => {
    if (thisWeek) setWeeks((current) => ({ ...current, [today]: thisWeek }));
  }, [thisWeek, today]);

  const fetchWeek = useCallback((ending: string) => {
    if (asked.current.has(ending)) return;
    asked.current.add(ending);

    void api<Week>(`/week?ending=${ending}`)
      .then((week) => setWeeks((current) => ({ ...current, [ending]: week })))
      // Left absent rather than shown as an empty week: nothing logged and
      // nothing loaded look identical, and only one of them is true.
      .catch(() => asked.current.delete(ending));
  }, []);

  const onViewable = useRef(
    ({ viewableItems }: { viewableItems: { item: unknown }[] }) => {
      const ending = viewableItems[0]?.item as string | undefined;
      if (ending) setVisible(ending);
    },
  ).current;

  const week = weeks[visible];
  const isThisWeek = visible === today;

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text style={styles.label} numberOfLines={1}>
          {isThisWeek ? caps(t('thisWeek')) : dateRange(addDays(visible, -6), visible).toUpperCase()}
        </Text>
        {week?.strength && week.cardio && week.weighIns ? (
          <Text style={styles.tally}>
            {week.strength.done}/{week.strength.target} {t('lifts')} ·{' '}
            {week.cardio.done}/{week.cardio.target} {t('cardioTally')} ·{' '}
            {week.weighIns.done}/7 {t('weighIns')}
          </Text>
        ) : null}
      </View>

      <FlatList
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        data={endings}
        keyExtractor={(ending) => ending}
        initialScrollIndex={endings.length - 1}
        getItemLayout={(_, index) => ({ length: page, offset: page * index, index })}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        renderItem={({ item: ending }) => (
          <WeekPage
            width={page}
            days={weeks[ending]?.days ?? null}
            selected={selected}
            onSelect={onSelect}
            onNeeded={() => fetchWeek(ending)}
          />
        )}
      />
    </View>
  );
}

function WeekPage({
  width,
  days,
  selected,
  onSelect,
  onNeeded,
}: {
  width: number;
  days: Week['days'] | null;
  selected: string;
  onSelect: (day: WeekDay) => void;
  onNeeded: () => void;
}) {
  useEffect(onNeeded, [onNeeded]);

  return (
    <View style={{ width }}>
      {days ? (
        <WeekStrip days={days} selected={selected} onSelect={onSelect} />
      ) : (
        // Holds the row's height so paging does not jolt while a week loads.
        <View style={styles.placeholder} />
      )}
    </View>
  );
}

/** Local, because the server's day arithmetic is not on the phone. */
function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

const styles = StyleSheet.create({
  section: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.lg,
    gap: space.md,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    // A date range is wider than "this week", and without this the two
    // ends of the row meet in the middle.
    gap: space.md,
  },
  label: { ...typo.label, color: colors.textFaint, flexShrink: 0 },
  tally: { fontSize: 13, color: colors.textDim, flexShrink: 1 },
  placeholder: { height: 128 },
});
