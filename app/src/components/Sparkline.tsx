import { StyleSheet, View } from 'react-native';
import type { TrendPoint } from '../api/types';
import { colors, radius } from '../theme';

/**
 * The 7-day average as columns. Built from Views rather than a charting
 * library — it is thirty rectangles, and a dependency for that is a bad trade.
 *
 * Days before the first weigh-in have no average and render as a flat stub, so
 * the gap reads as "no data" rather than as a drop to zero.
 */
export function Sparkline({ series, height = 56 }: { series: TrendPoint[]; height?: number }) {
  const values = series.map((point) => point.avgKg).filter((v): v is number => v != null);

  if (values.length < 2) {
    return <View style={[styles.row, { height }]} />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat week must not become a full-height bar.
  const span = max - min < 0.2 ? 0.2 : max - min;

  return (
    <View style={[styles.row, { height }]}>
      {series.map((point, index) => {
        const filled = point.avgKg != null;
        const ratio = filled ? (point.avgKg! - min) / span : 0;
        const isLast = index === series.length - 1;

        return (
          <View
            key={point.date}
            style={[
              styles.bar,
              {
                height: filled ? Math.max(3, 6 + ratio * (height - 6)) : 2,
                backgroundColor: filled
                  ? isLast
                    ? colors.accent
                    : colors.surfaceHigh
                  : colors.border,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  bar: {
    flex: 1,
    borderRadius: radius.sm,
    minWidth: 2,
  },
});
