import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { WeekDay } from '../api/types';
// Derived here rather than taken from the server's `weekday`, which is German.
// The date is the fact; the label is a rendering of it.
import { weekdayShort } from '../lib/format';
import { colors, space, type as typo } from '../theme';

const TRACK = 84;

/**
 * The week, as one object.
 *
 * §4 is explicit that the programme is weekly and that fixed weekdays fail
 * because he travels. So the home screen is organised around the week rather
 * than the day: seven columns, each encoding what actually happened.
 *
 *   bar height  protein against target — the thing he manages daily
 *   letter      the session, if he lifted, and which one
 *   underline   today
 *
 * A day with nothing logged draws a faint stub rather than a zero bar. Absent
 * and zero are different facts, and a full-height empty column would read as
 * failure when it only means he did not write it down.
 */
export function WeekStrip({
  days,
  selected,
  onSelect,
}: {
  days: WeekDay[];
  selected: string;
  onSelect: (date: string) => void;
}) {
  return (
    <View style={styles.row}>
      {days.map((day) => {
        const logged = day.proteinPct !== null;
        const pct = Math.min(120, Math.max(0, day.proteinPct ?? 0));
        const hit = (day.proteinPct ?? 0) >= 100;
        const isSelected = day.date === selected;

        return (
          <Pressable
            key={day.date}
            onPress={() => onSelect(day.date)}
            style={styles.col}
            hitSlop={4}
          >
            <Text style={[styles.letter, !day.lifted && styles.letterEmpty]}>
              {day.template ?? '·'}
            </Text>

            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  logged
                    ? {
                        height: Math.max(4, (pct / 120) * TRACK),
                        // Colour carries the meaning, not opacity — a dimmed
                        // amber just reads as brown.
                        backgroundColor: hit ? colors.accent : colors.textDim,
                      }
                    : { height: 2, backgroundColor: colors.border },
                  isSelected && logged && { backgroundColor: hit ? colors.accent : colors.text },
                ]}
              />
            </View>

            <Text
              style={[
                styles.day,
                day.isToday && styles.dayToday,
                isSelected && styles.daySelected,
              ]}
            >
              {weekdayShort(day.date)}
            </Text>
            <View style={[styles.marker, isSelected && styles.markerOn]} />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.xs },
  col: { flex: 1, alignItems: 'center', gap: space.xs },

  letter: { fontSize: 12, color: colors.text, height: 16, lineHeight: 16, letterSpacing: 0.5 },
  letterEmpty: { color: colors.textFaint },

  // Full-width columns. Thin bars were more restrained but read as a
  // sparkline; these read as a week, which is the point of the screen.
  track: { height: TRACK, width: '100%', justifyContent: 'flex-end' },
  fill: { width: '100%' },

  day: { fontSize: 11, letterSpacing: 0.6, color: colors.textFaint },
  dayToday: { color: colors.text },
  daySelected: { color: colors.text },
  marker: { height: 1, width: 14, backgroundColor: 'transparent' },
  markerOn: { backgroundColor: colors.text },
});
