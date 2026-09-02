import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { randomUUID } from 'expo-crypto';
import { api } from '../../src/api/client';
import { useResource } from '../../src/api/hooks';
import { enqueue } from '../../src/sync/queue';
import type { WeightSummary } from '../../src/api/types';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Screen } from '../../src/components/Screen';
import { Sparkline } from '../../src/components/Sparkline';
import { kg, shortDate, signedKg } from '../../src/lib/format';
import { colors, radius, space, type as typo } from '../../src/theme';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'] as const;

/**
 * One number pad, three seconds (§11). No keyboard, no date picker, no notes —
 * anything that adds a tap here is a reason to skip the weigh-in.
 */
export default function WeightScreen() {
  const summary = useResource<WeightSummary>('/bodyweight?days=30');
  const [entry, setEntry] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  const value = Number(entry);
  const valid = entry.length > 0 && Number.isFinite(value) && value >= 30 && value <= 300;

  function press(key: (typeof KEYS)[number]) {
    setError(null);
    setQueued(false);
    if (key === '⌫') {
      setEntry((current) => current.slice(0, -1));
      return;
    }
    setEntry((current) => {
      if (key === '.' && current.includes('.')) return current;
      if (key === '.' && current === '') return '0.';
      // One decimal is all a bathroom scale gives, and all the average needs.
      const [, decimals] = current.split('.');
      if (decimals && decimals.length >= 1 && key !== '.') return current;
      return (current + key).slice(0, 6);
    });
  }

  async function save() {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const result = await api<{ summary: WeightSummary }>('/bodyweight', {
        method: 'POST',
        body: { weightKg: value },
      });
      summary.set(result.summary);
      setEntry('');
    } catch {
      // Offline: queue it. The weigh-in still counts, the average catches up
      // when the drain lands. Never make him weigh himself twice.
      enqueue(randomUUID(), { op: 'log_weight', payload: { weightKg: value } });
      setEntry('');
      setQueued(true);
    } finally {
      setSaving(false);
    }
  }

  const data = summary.data;

  return (
    <Screen onRefresh={summary.reload} refreshing={summary.refreshing}>
      <View style={styles.display}>
        <Text style={[styles.entry, entry.length === 0 && styles.entryEmpty]}>
          {entry.length > 0 ? entry : '—'}
        </Text>
        <Text style={styles.unit}>kg</Text>
      </View>

      <View style={styles.pad}>
        {KEYS.map((key) => (
          <Pressable
            key={key}
            onPress={() => press(key)}
            style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
          >
            <Text style={styles.keyText}>{key}</Text>
          </Pressable>
        ))}
      </View>

      {summary.stale ? (
        <Text style={styles.queued}>Offline — the averages below may be behind.</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {queued ? (
        <Text style={styles.queued}>Saved on the phone — it will sync when you have signal.</Text>
      ) : null}

      <Button
        title={saving ? 'Saving…' : "Log today's weight"}
        onPress={save}
        disabled={!valid || saving}
      />

      <Card label="THE NUMBER THAT COUNTS">
        <View style={styles.row}>
          <View>
            <Text style={styles.numeral}>{kg(data?.average7?.avgKg)} kg</Text>
            <Text style={styles.subtle}>
              7-day average
              {data?.average7 ? ` · ${data.average7.sampleCount} of 7 days` : ''}
            </Text>
          </View>
          <View style={styles.alignEnd}>
            <Text style={[styles.change, { color: changeColor(data?.changeKg ?? null) }]}>
              {signedKg(data?.changeKg ?? null)} kg
            </Text>
            <Text style={styles.subtle}>vs last week</Text>
          </View>
        </View>

        {data ? <Sparkline series={data.series} height={64} /> : null}

        <Text style={styles.footnote}>
          Day to day is water and salt. The average is the trend — judge progress on this line, not
          on this morning.
        </Text>
      </Card>

      {data && data.series.some((point) => point.weightKg != null) ? (
        <Card label="RECENT">
          {data.series
            .filter((point) => point.weightKg != null)
            .slice(-7)
            .reverse()
            .map((point) => (
              <View key={point.date} style={styles.row}>
                <Text style={styles.subtle}>{shortDate(point.date)}</Text>
                <Text style={styles.recentValue}>{kg(point.weightKg)} kg</Text>
              </View>
            ))}
        </Card>
      ) : null}
    </Screen>
  );
}

function changeColor(changeKg: number | null): string {
  if (changeKg == null) return colors.textDim;
  return changeKg <= 0 ? colors.accent : colors.warn;
}

const styles = StyleSheet.create({
  display: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
  },
  entry: { fontSize: 64, fontWeight: '300', color: colors.text, ...typo.mono },
  entryEmpty: { color: colors.textFaint },
  unit: { fontSize: 24, fontWeight: '300', color: colors.textDim },

  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  key: {
    width: '31.5%',
    flexGrow: 1,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  keyPressed: { backgroundColor: colors.surfaceHigh },
  keyText: { fontSize: 26, fontWeight: '600', color: colors.text },

  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  alignEnd: { alignItems: 'flex-end' },
  numeral: { ...typo.numeral, ...typo.mono, color: colors.text },
  change: { fontSize: 20, fontWeight: '400', ...typo.mono },
  recentValue: { ...typo.body, ...typo.mono, color: colors.text },
  subtle: { ...typo.bodyDim, color: colors.textDim },
  footnote: { fontSize: 13, color: colors.textFaint, lineHeight: 19 },
  error: { color: colors.danger, fontSize: 14 },
  queued: { color: colors.warn, fontSize: 14 },
});
