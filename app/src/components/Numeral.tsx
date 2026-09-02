import { StyleSheet, Text, View } from 'react-native';
import { colors, space, type as typo } from '../theme';

/**
 * The number a screen is about, and the words that qualify it.
 *
 * Set large and light, with the unit and caption kept small beside it — so the
 * figure carries the screen and the explanation stays out of the way. One of
 * these per screen; a page with two heroes has none.
 */
export function Numeral({
  value,
  unit,
  caption,
  tone = 'default',
}: {
  value: string;
  unit?: string;
  caption?: string;
  tone?: 'default' | 'signal' | 'alert';
}) {
  const color =
    tone === 'signal' ? colors.accent : tone === 'alert' ? colors.danger : colors.text;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={[styles.value, { color }]}>{value}</Text>
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
      {caption ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
}

/** A thin rail. Fills toward a target; never a rounded pill of colour. */
export function Rail({ percent, tone = 'signal' }: { percent: number; tone?: 'signal' | 'dim' }) {
  const width = Math.min(100, Math.max(0, percent));
  return (
    <View style={styles.rail}>
      <View
        style={[
          styles.railFill,
          { width: `${width}%`, backgroundColor: tone === 'signal' ? colors.accent : colors.textFaint },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  value: { ...typo.hero, ...typo.mono },
  unit: { fontSize: 17, fontWeight: '400', color: colors.textDim, letterSpacing: 0.2 },
  caption: { fontSize: 14, color: colors.textDim, lineHeight: 20 },
  rail: { height: 2, backgroundColor: colors.border },
  railFill: { height: 2 },
});
