import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, space } from '../theme';

type Tone = 'info' | 'warn' | 'danger';

const TONES: Record<Tone, { bg: string; border: string; text: string }> = {
  info: { bg: colors.accentDeep, border: colors.accent, text: colors.accent },
  warn: { bg: colors.warnDeep, border: colors.warn, text: colors.warn },
  danger: { bg: colors.dangerDeep, border: colors.danger, text: colors.danger },
};

export function Banner({ tone, title, body }: { tone: Tone; title: string; body?: string }) {
  const palette = TONES[tone];
  return (
    <View style={[styles.banner, { backgroundColor: palette.bg, borderColor: palette.border }]}>
      <Text style={[styles.title, { color: palette.text }]}>{title}</Text>
      {body ? <Text style={styles.body}>{body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderRadius: radius.md,
    borderLeftWidth: 3,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    gap: space.xs,
  },
  title: { fontSize: 15, fontWeight: '700' },
  body: { fontSize: 14, color: colors.text, opacity: 0.85, lineHeight: 20 },
});
