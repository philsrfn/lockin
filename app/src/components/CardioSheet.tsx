import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../api/client';
import type { CardioKind, CardioSession } from '../api/types';
import { t } from '../lib/locale';
import { Button } from './Button';
import { caps, colors, space, type as typo } from '../theme';

/**
 * Logging cardio in about four taps.
 *
 * The coach has been prescribing 35 minutes of zone-2 twice a week with no way
 * to know whether it happened. Minutes is the only field that matters, so it is
 * the only one that opens with a value; everything else is a chip.
 */
const KINDS: { kind: CardioKind; label: () => string }[] = [
  { kind: 'zone2', label: () => t('kindZone2') },
  { kind: 'intervals', label: () => t('kindIntervals') },
  { kind: 'sport', label: () => t('kindSport') },
  { kind: 'walk', label: () => t('kindWalk') },
];

export function CardioSheet({
  visible,
  onClose,
  onLogged,
}: {
  visible: boolean;
  onClose: () => void;
  onLogged: () => void;
}) {
  const [kind, setKind] = useState<CardioKind>('zone2');
  const [minutes, setMinutes] = useState('35');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const value = Number(minutes);
    if (!Number.isFinite(value) || value < 1) return;

    setBusy(true);
    setError(null);
    try {
      await api<{ session: CardioSession }>('/cardio', {
        method: 'POST',
        body: { kind, minutes: Math.round(value), description: note.trim() || null },
      });
      setNote('');
      onLogged();
      onClose();
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.label}>{caps(t('logCardio'))}</Text>

          <View style={styles.kinds}>
            {KINDS.map((option) => {
              const active = option.kind === kind;
              return (
                <Pressable
                  key={option.kind}
                  onPress={() => setKind(option.kind)}
                  style={[styles.chip, active && styles.chipOn]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextOn]}>
                    {option.label()}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* Said once, where the decision is made, rather than discovered
              later when the week does not add up. */}
          {kind === 'walk' ? <Text style={styles.hint}>{t('walkNote')}</Text> : null}

          <Text style={[styles.label, styles.minutesLabel]}>{caps(t('minutes'))}</Text>
          <View style={styles.minutesRow}>
            <TextInput
              value={minutes}
              onChangeText={setMinutes}
              keyboardType="number-pad"
              maxLength={3}
              selectTextOnFocus
              style={[styles.minutes, typo.mono]}
            />
            <TextInput
              value={note}
              onChangeText={setNote}
              placeholder="—"
              placeholderTextColor={colors.textFaint}
              style={styles.note}
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button title={busy ? '…' : t('save')} onPress={save} disabled={busy} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000CC', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    padding: space.lg,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  label: { ...typo.label, color: colors.textFaint },
  minutesLabel: { marginTop: space.sm },

  kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipOn: { borderColor: colors.text, backgroundColor: colors.text },
  chipText: { ...typo.body, color: colors.textDim },
  chipTextOn: { color: colors.bg, fontWeight: '600' },

  hint: { ...typo.bodyDim, fontSize: 13, color: colors.textFaint, lineHeight: 19 },

  minutesRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.lg },
  minutes: {
    ...typo.hero,
    fontSize: 56,
    letterSpacing: -2,
    color: colors.text,
    padding: 0,
    minWidth: 110,
  },
  note: {
    flex: 1,
    ...typo.body,
    color: colors.text,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: space.sm,
  },
  error: { ...typo.bodyDim, color: colors.danger },
});
