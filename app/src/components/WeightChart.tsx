import { useMemo, useState } from 'react';
import { LayoutChangeEvent, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import type { TrendPoint } from '../api/types';
import { shortDate } from '../lib/format';
import { t } from '../lib/locale';
import { colors, space, type as typo } from '../theme';

/**
 * Bodyweight over time, as a line in a coordinate system.
 *
 * It was thirty columns, which is the wrong form: bars encode magnitude and
 * ask to be read against zero, and nobody's bodyweight is interesting relative
 * to zero. The question here is direction, and direction is a line.
 *
 * Two encodings of one measure. The daily weigh-ins are dots, because day to
 * day is water and salt; the seven-day average is the line, because that is
 * the number this app says counts. Only the line is emphasised, and only its
 * final point is labelled — a number on every point is noise on a phone.
 *
 * Touch it to read a day, which is what hover would be on a bigger screen.
 */

/** Room for the axis labels, inside the drawing area. */
const GUTTER = { left: 38, right: 10, top: 12, bottom: 20 };
const HEIGHT = 190;

/**
 * The smallest span the y-axis will show, in kg.
 *
 * A fortnight that moved 300g would otherwise fill the whole plot and read as
 * a collapse. Padding the domain keeps a quiet week looking quiet.
 */
const MIN_SPAN_KG = 2;

export function WeightChart({ series }: { series: TrendPoint[] }) {
  const [width, setWidth] = useState(0);
  const [touched, setTouched] = useState<number | null>(null);

  const points = useMemo(
    () => series.filter((point) => point.avgKg != null || point.weightKg != null),
    [series],
  );

  const scale = useMemo(() => {
    const values = points.flatMap((point) =>
      [point.avgKg, point.weightKg].filter((v): v is number => v != null),
    );
    if (values.length === 0) return null;

    const low = Math.min(...values);
    const high = Math.max(...values);
    const pad = Math.max(MIN_SPAN_KG - (high - low), (high - low) * 0.15, 0.3) / 2;

    return { min: low - pad, max: high + pad };
  }, [points]);

  if (points.length < 2 || !scale) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>{t('notEnoughWeighIns')}</Text>
      </View>
    );
  }

  const plotW = Math.max(0, width - GUTTER.left - GUTTER.right);
  const plotH = HEIGHT - GUTTER.top - GUTTER.bottom;

  const x = (index: number) =>
    GUTTER.left + (points.length === 1 ? plotW / 2 : (index / (points.length - 1)) * plotW);
  const y = (value: number) =>
    GUTTER.top + plotH - ((value - scale.min) / (scale.max - scale.min)) * plotH;

  // The average is drawn as one path, broken wherever there is no average yet —
  // a straight line across a gap would invent a fortnight of data.
  const path = points
    .map((point, index) => {
      if (point.avgKg == null) return null;
      const previous = points[index - 1];
      const command = index === 0 || !previous || previous.avgKg == null ? 'M' : 'L';
      return `${command}${x(index).toFixed(1)} ${y(point.avgKg).toFixed(1)}`;
    })
    .filter(Boolean)
    .join(' ');

  const ticks = niceTicks(scale.min, scale.max);
  const lastWithAverage = [...points].reverse().find((point) => point.avgKg != null);
  const lastIndex = lastWithAverage ? points.indexOf(lastWithAverage) : -1;

  const active = touched != null ? points[touched] : null;

  return (
    <View onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}>
      {/* The readout replaces the caption while a day is held, so the block
          does not change height under the thumb. */}
      <View style={styles.readout}>
        {active ? (
          <>
            <Text style={styles.readoutDate}>{shortDate(active.date)}</Text>
            <Text style={styles.readoutValue}>
              {active.avgKg != null ? `Ø ${active.avgKg.toFixed(1)} kg` : '—'}
              {active.weightKg != null ? `   ·   ${active.weightKg.toFixed(1)} kg` : ''}
            </Text>
          </>
        ) : (
          <Text style={styles.legend}>
            <Text style={styles.legendLine}>——</Text> {t('sevenDayAverage')}
            {'   '}
            <Text style={styles.legendDot}>•</Text> {t('weighIns')}
          </Text>
        )}
      </View>

      {width > 0 ? (
        <View
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(event) => setTouched(nearest(event.nativeEvent.locationX))}
          onResponderMove={(event) => setTouched(nearest(event.nativeEvent.locationX))}
          onResponderRelease={() => setTouched(null)}
          onResponderTerminate={() => setTouched(null)}
        >
          <Svg width={width} height={HEIGHT}>
            {/* Recessive grid: it locates a value, it does not compete with one. */}
            {ticks.map((value) => (
              <Line
                key={value}
                x1={GUTTER.left}
                x2={width - GUTTER.right}
                y1={y(value)}
                y2={y(value)}
                stroke={colors.border}
                strokeWidth={StyleSheet.hairlineWidth}
              />
            ))}
            {ticks.map((value) => (
              <SvgText
                key={`label-${value}`}
                x={GUTTER.left - 8}
                y={y(value) + 4}
                fontSize={11}
                fill={colors.textFaint}
                textAnchor="end"
              >
                {value.toFixed(0)}
              </SvgText>
            ))}

            {/* Daily weigh-ins: context under the trend, never above it. */}
            {points.map((point, index) =>
              point.weightKg != null ? (
                <Circle
                  key={point.date}
                  cx={x(index)}
                  cy={y(point.weightKg)}
                  r={2}
                  fill={colors.textFaint}
                />
              ) : null,
            )}

            <Path d={path} stroke={colors.text} strokeWidth={2} fill="none" />

            {lastIndex >= 0 && lastWithAverage?.avgKg != null ? (
              <Circle
                cx={x(lastIndex)}
                cy={y(lastWithAverage.avgKg)}
                r={4.5}
                fill={colors.accent}
              />
            ) : null}

            {touched != null ? (
              <Line
                x1={x(touched)}
                x2={x(touched)}
                y1={GUTTER.top}
                y2={GUTTER.top + plotH}
                stroke={colors.textDim}
                strokeWidth={1}
              />
            ) : null}
          </Svg>
        </View>
      ) : (
        <View style={{ height: HEIGHT }} />
      )}

      <View style={styles.axis}>
        <Text style={styles.axisLabel}>{shortDate(points[0]!.date)}</Text>
        <Text style={styles.axisLabel}>{shortDate(points[points.length - 1]!.date)}</Text>
      </View>
    </View>
  );

  function nearest(locationX: number): number {
    const ratio = (locationX - GUTTER.left) / Math.max(1, plotW);
    const index = Math.round(ratio * (points.length - 1));
    return Math.min(points.length - 1, Math.max(0, index));
  }
}

/** Three or four round values inside the domain. */
function niceTicks(min: number, max: number): number[] {
  const span = max - min;
  const step = span > 8 ? 4 : span > 4 ? 2 : 1;
  const first = Math.ceil(min / step) * step;

  const ticks: number[] = [];
  for (let value = first; value <= max; value += step) ticks.push(value);
  return ticks;
}

const styles = StyleSheet.create({
  empty: { height: HEIGHT, justifyContent: 'center' },
  emptyText: { ...typo.bodyDim, color: colors.textFaint },

  readout: { height: 34, justifyContent: 'center' },
  readoutDate: { fontSize: 11, color: colors.textFaint, letterSpacing: 0.6 },
  readoutValue: { fontSize: 15, color: colors.text, ...typo.mono },

  legend: { fontSize: 12, color: colors.textFaint },
  legendLine: { color: colors.text },
  legendDot: { color: colors.textFaint, fontSize: 15 },

  axis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingLeft: GUTTER.left,
    paddingRight: GUTTER.right,
    marginTop: space.xs,
  },
  axisLabel: { fontSize: 11, color: colors.textFaint },
});
