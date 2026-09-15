import { useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { monthShort, weekdayShort } from '../lib/format';
import { t } from '../lib/locale';
import { buildTrainingGrid, trainedDaysFrom } from '../lib/trainingGrid';
import { Card } from './Card';
import { colors, space, type as typo } from '../theme';

/**
 * A square per day, amber where something happened.
 *
 * The list below this answers what was done. This answers whether it is
 * happening at all, and it is the only place in the app where three months of
 * showing up can be taken in without reading a single number. That is worth a
 * screenful of squares: a gap is obvious, and so is a gap that closed again.
 *
 * Deliberately two colours and not five. The shading on the chart this borrows
 * from encodes volume, and volume is the wrong axis here — an hour of football
 * and forty-five minutes of squats are not comparable, and pretending they are
 * would put a value on the kind of training rather than on the turning up.
 *
 * All of the calendar sits in `lib/trainingGrid.ts`, tested. This file only
 * decides how big a square is.
 */

/** Big enough to see a pattern in, small enough that a quarter fits on a phone. */
const CELL = 12;
const GAP = 3;
const PITCH = CELL + GAP;
/** Room for the two-letter weekday labels down the left. */
const GUTTER = 22;

export function TrainingGrid({
  days,
  today,
  rangeDays,
}: {
  days: { day: string; sessions: unknown[]; cardio: unknown[] }[];
  today: string;
  rangeDays: number;
}) {
  const scroller = useRef<ScrollView>(null);
  const grid = buildTrainingGrid(trainedDaysFrom(days), today, rangeDays);

  /**
   * A year is wider than a phone, so it scrolls — and it opens at the right
   * hand end. The useful part of this chart is the last fortnight; arriving at
   * September 2025 and having to drag would be the wrong way round.
   */
  const anchorRight = () => scroller.current?.scrollToEnd({ animated: false });

  return (
    <Card label={t('trainingDaysTitle')}>
      <View style={styles.frame}>
        {/* Pinned, not scrolled with the squares. A year is four screens wide,
            and a row label that slides off the left takes the meaning of every
            row with it. */}
        <View style={styles.gutter}>
          <View style={styles.monthRow} />
          {[0, 1, 2, 3, 4, 5, 6].map((row) => (
            <View key={row} style={styles.gutterCell}>
              {/* Monday, Wednesday, Friday — the same three the chart this
                  borrows from labels. Seven would be a wall of text beside
                  squares three millimetres tall. */}
              {row % 2 === 0 && row < 5 ? (
                <Text style={styles.weekday}>{weekdayShort(mondayPlus(row))}</Text>
              ) : null}
            </View>
          ))}
        </View>

        <ScrollView
          ref={scroller}
          horizontal
          showsHorizontalScrollIndicator={false}
          onContentSizeChange={anchorRight}
        >
          <View>
            <View style={styles.monthRow}>
              {grid.months.map((month) => (
                <Text key={month.day} style={[styles.month, { left: month.column * PITCH }]}>
                  {monthShort(month.day)}
                </Text>
              ))}
            </View>

            <View style={styles.body}>
              {grid.weeks.map((week, column) => (
                <View key={week.find((cell) => cell !== null)?.day ?? column} style={styles.week}>
                  {week.map((cell, row) => (
                    <View
                      key={cell?.day ?? `pad${column}-${row}`}
                      style={[
                        styles.cell,
                        cell === null
                          ? styles.cellOutside
                          : cell.trained
                            ? styles.cellTrained
                            : styles.cellRest,
                      ]}
                    />
                  ))}
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>

      <View style={styles.legend}>
        <Text style={styles.summary}>
          {t('trainingDaysSummary', { trained: grid.trainedDays, total: grid.totalDays })}
        </Text>
        <View style={styles.keys}>
          <View style={[styles.cell, styles.cellRest]} />
          <Text style={styles.keyLabel}>{t('gridRestDay')}</Text>
          <View style={[styles.cell, styles.cellTrained]} />
          <Text style={styles.keyLabel}>{t('gridTrainedDay')}</Text>
        </View>
      </View>
    </Card>
  );
}

/**
 * A weekday name without a real date to hang it on.
 *
 * 2024-01-01 was a Monday, so adding the row index lands on that row's
 * weekday. Any Monday would do; this one is hardcoded so the label never
 * depends on what today happens to be.
 */
function mondayPlus(row: number): string {
  const monday = Date.UTC(2024, 0, 1) + row * 86_400_000;
  return new Date(monday).toISOString().slice(0, 10);
}

const styles = StyleSheet.create({
  frame: { flexDirection: 'row' },
  monthRow: { height: 16 },
  month: { ...typo.label, color: colors.textFaint, position: 'absolute', top: 0 },
  body: { flexDirection: 'row' },
  /* No `gap` here: the month row is the gutter's first child, and a gap after
     it would push every label half a square below the row it names. The
     spacing rides on the cells instead. */
  gutter: { width: GUTTER },
  gutterCell: { height: CELL, marginBottom: GAP, justifyContent: 'center' },
  weekday: { fontSize: 9, color: colors.textFaint },
  week: { gap: GAP, marginRight: GAP },
  /* 3, not `radius.sm` — the theme's smallest corner is meant for a chip a
     thumb lands on, and on a twelve-point square it would draw a circle. */
  cell: { width: CELL, height: CELL, borderRadius: 3 },
  /** Outside the range: not a rest day, so it is not drawn as one. */
  cellOutside: { backgroundColor: 'transparent' },
  cellRest: { backgroundColor: colors.surfaceHigh },
  cellTrained: { backgroundColor: colors.accent },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: space.md,
    gap: space.sm,
  },
  summary: { ...typo.bodyDim, color: colors.textDim, flexShrink: 1 },
  keys: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  keyLabel: { fontSize: 11, color: colors.textFaint, marginRight: space.xs },
});
