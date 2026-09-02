import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import type { CoachNote } from '../api/types';
import { colors, radius, space, type as typo } from '../theme';

const LABEL: Record<CoachNote['sessionType'], string> = {
  strength: 'LIFT TODAY',
  cardio: 'ZONE 2 TODAY',
  rest: 'REST TODAY',
};

const TONE: Record<CoachNote['sessionType'], string> = {
  strength: colors.accent,
  cardio: colors.warn,
  rest: colors.textDim,
};

/**
 * The trainer's read on today. Renders as a quiet card, not a banner — it is
 * the first thing he reads, and it should feel like a person, not an alert.
 */
export function CoachCard({ note, loading }: { note: CoachNote | null; loading: boolean }) {
  if (!note) {
    return (
      <View style={styles.block}>
        <View style={styles.pendingRow}>
          {loading ? <ActivityIndicator size="small" color={colors.textFaint} /> : null}
          <Text style={styles.pending}>
            {loading ? 'Your trainer is looking at the last two weeks…' : 'No read on today yet.'}
          </Text>
        </View>
      </View>
    );
  }

  const tone = TONE[note.sessionType];

  return (
    <View style={styles.block}>
      <Text style={[styles.label, { color: tone }]}>{LABEL[note.sessionType]}</Text>
      <Text style={styles.headline}>{note.headline}</Text>
      <Text style={styles.body}>{note.body}</Text>

      {note.swaps.length > 0 ? (
        <View style={styles.swaps}>
          {note.swaps.map((swap) => (
            <Text key={`${swap.from}-${swap.to}`} style={styles.swap}>
              {swap.from} → {swap.to} · {swap.reason}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  /**
   * The coach speaks in the page's own voice — a rule above, the read
   * underneath. It was a bordered slab with a coloured bar, which made the one
   * paragraph of prose shout louder than every number on the screen.
   */
  block: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.md,
    gap: space.sm,
  },
  label: { ...typo.label, color: colors.accent },
  headline: { fontSize: 21, fontWeight: '400', color: colors.text, lineHeight: 28, letterSpacing: -0.3 },
  body: { fontSize: 15, color: colors.textDim, lineHeight: 22 },
  swaps: { gap: space.xs, marginTop: space.xs },
  swap: { fontSize: 13, color: colors.warn, lineHeight: 19 },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  pending: { fontSize: 14, color: colors.textFaint },
});
