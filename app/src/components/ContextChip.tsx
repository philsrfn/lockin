import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../api/client';
import type { Context } from '../api/types';
import { t } from '../lib/locale';
import { colors, radius, space, type as typo } from '../theme';

/**
 * Which city he is in. Travel is the norm, so this sits at the top of Today
 * and is one tap away from changing.
 */
export function ContextChip({
  context,
  onChanged,
}: {
  context: Context | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [contexts, setContexts] = useState<Context[]>([]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function openPicker() {
    setOpen(true);
    setAdding('');
    setError(null);
    try {
      const result = await api<{ contexts: Context[] }>('/contexts');
      setContexts(result.contexts);
    } catch {
      setContexts([]);
    }
  }

  /**
   * Phil's four German cities were seeded. Everybody else starts with one
   * place and needs somewhere to put the gym near work, or the hotel they are
   * in this week — so the list is editable from where it is read.
   */
  async function add() {
    const name = adding.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ contexts: Context[] }>('/contexts', {
        method: 'POST',
        body: { name, equipment: { gym: true } },
      });
      setContexts(result.contexts);
      setAdding('');
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function choose(id: number) {
    setBusy(true);
    try {
      await api(`/contexts/${id}/activate`, { method: 'POST' });
      setOpen(false);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Pressable onPress={openPicker} style={({ pressed }) => [styles.chip, pressed && styles.pressed]}>
        <View style={styles.dot} />
        <Text style={styles.chipText}>{context?.name ?? 'No context'}</Text>
        <Text style={styles.caret}>⌄</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.sheetLabel}>{t('whereAreYou')}</Text>
            {contexts.map((option) => (
              <Pressable
                key={option.id}
                disabled={busy}
                onPress={() => choose(option.id)}
                style={({ pressed }) => [styles.option, pressed && styles.pressed]}
              >
                <Text style={[styles.optionText, option.isActive && styles.optionActive]}>
                  {option.name}
                </Text>
                {option.isActive ? <Text style={styles.check}>✓</Text> : null}
              </Pressable>
            ))}

            <View style={styles.addRow}>
              <TextInput
                value={adding}
                onChangeText={setAdding}
                placeholder={t('addPlace')}
                placeholderTextColor={colors.textFaint}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="done"
                onSubmitEditing={add}
                style={styles.addInput}
              />
              {adding.trim() ? (
                <Pressable onPress={add} disabled={busy} hitSlop={16}>
                  {/* A glyph rather than a word: the placeholder beside it
                      already says what this does, in whatever language. */}
                  <Text style={styles.addAction}>+</Text>
                </Pressable>
              ) : null}
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space.sm,
    backgroundColor: colors.bg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    minHeight: 40,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    marginTop: space.sm,
    paddingTop: space.md,
  },
  addInput: { flex: 1, ...typo.body, color: colors.text, paddingVertical: space.sm },
  addAction: { fontSize: 28, fontWeight: '300', lineHeight: 30, color: colors.accent },
  error: { ...typo.bodyDim, fontSize: 13, color: colors.danger, marginTop: space.sm },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  chipText: { ...typo.body, color: colors.text },
  caret: { color: colors.textFaint, fontSize: 16, marginTop: -4 },
  pressed: { opacity: 0.7 },

  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    paddingBottom: space.xxl + space.lg,
    gap: space.xs,
  },
  sheetLabel: { ...typo.label, color: colors.textFaint, marginBottom: space.sm },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  optionText: { fontSize: 18, fontWeight: '600', color: colors.textDim },
  optionActive: { color: colors.text },
  check: { color: colors.accent, fontSize: 18, fontWeight: '400' },
});
