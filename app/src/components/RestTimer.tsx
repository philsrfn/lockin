import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { clock } from '../lib/format';
import { colors, radius, space, type as typo } from '../theme';

/**
 * Starts itself the moment a set is confirmed — he should never have to
 * remember to start a timer with a bar still on his back.
 */
export function RestTimer({
  startedAt,
  seconds,
  onDismiss,
}: {
  startedAt: number;
  seconds: number;
  onDismiss: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, [startedAt]);

  const elapsed = (now - startedAt) / 1000;
  const remaining = seconds - elapsed;
  const done = remaining <= 0;
  const progress = Math.min(1, Math.max(0, elapsed / seconds));

  return (
    <Pressable onPress={onDismiss} style={styles.bar}>
      <View style={[styles.fill, { width: `${progress * 100}%` }, done && styles.fillDone]} />
      <View style={styles.content}>
        <Text style={[styles.label, done && styles.labelDone]}>
          {done ? 'REST DONE' : 'RESTING'}
        </Text>
        <Text style={[styles.time, done && styles.labelDone]}>
          {done ? `+${clock(-remaining)}` : clock(remaining)}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 56,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.surfaceHigh,
  },
  fillDone: { backgroundColor: colors.accentDeep },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  label: { ...typo.label, color: colors.textDim },
  labelDone: { color: colors.accent },
  time: { fontSize: 22, fontWeight: '700', color: colors.text, ...typo.mono },
});
