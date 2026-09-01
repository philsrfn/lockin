import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApiError, api } from '../api/client';
import type { BarcodeCandidate, FoodEstimate, MealSlot } from '../api/types';
import { BarcodeScanner } from './BarcodeScanner';
import { Button } from './Button';
import { colors, radius, space, type as typo } from '../theme';

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/** What both routes converge on before anything is written. */
type Draft = {
  name: string;
  kcal: number;
  proteinG: number;
  fatG: number | null;
  carbsG: number | null;
  /** Set when scanned: the numbers are per 100g and need a portion. */
  barcode?: string;
  perHundred?: boolean;
  note?: string;
};

export function FoodCapture({
  mode,
  onClose,
  onLogged,
}: {
  mode: 'scan' | 'describe' | null;
  onClose: () => void;
  onLogged: () => void;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [text, setText] = useState('');
  const [grams, setGrams] = useState('100');
  const [slot, setSlot] = useState<MealSlot>('snack');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setDraft(null);
    setText('');
    setGrams('100');
    setError(null);
  }

  async function lookup(barcode: string) {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ candidate: BarcodeCandidate }>(
        `/foods/barcode?barcode=${encodeURIComponent(barcode)}`,
        { timeoutMs: 20_000 },
      );
      const c = result.candidate;
      setDraft({
        name: c.name,
        kcal: c.kcal,
        proteinG: c.proteinG,
        fatG: c.fatG,
        carbsG: c.carbsG,
        barcode: c.barcode,
        // A saved entry is already a portion; OpenFoodFacts gives per 100g.
        perHundred: !c.known,
        note: c.known ? 'From your saved foods' : 'Per 100g — how much did you have?',
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Lookup failed');
    } finally {
      setBusy(false);
    }
  }

  async function estimate() {
    if (text.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ estimate: FoodEstimate }>('/foods/estimate', {
        method: 'POST',
        body: { text: text.trim() },
        timeoutMs: 60_000,
      });
      const e = result.estimate;
      setDraft({
        name: e.name,
        kcal: e.kcal,
        proteinG: e.proteinG,
        fatG: e.fatG,
        carbsG: e.carbsG,
        note:
          e.assumptions ||
          (e.confidence === 'low' ? 'Rough guess — worth correcting.' : 'Check it looks right.'),
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not estimate that');
    } finally {
      setBusy(false);
    }
  }

  // Scanned values are per 100g, so scale by the portion he actually ate.
  const factor = draft?.perHundred ? (Number(grams) || 0) / 100 : 1;
  const scaled = draft
    ? {
        kcal: Math.round(draft.kcal * factor),
        proteinG: Math.round(draft.proteinG * factor),
        fatG: draft.fatG == null ? null : Math.round(draft.fatG * factor),
        carbsG: draft.carbsG == null ? null : Math.round(draft.carbsG * factor),
      }
    : null;

  async function log() {
    if (!draft || !scaled) return;
    setBusy(true);
    setError(null);
    try {
      // Keep the scanned product at per-100g values, so the next scan can be
      // scaled to a different portion rather than inheriting this one.
      if (draft.barcode && draft.perHundred) {
        await api('/foods/scanned', {
          method: 'POST',
          body: {
            barcode: draft.barcode,
            name: draft.name,
            kcal: draft.kcal,
            proteinG: draft.proteinG,
            fatG: draft.fatG,
            carbsG: draft.carbsG,
          },
        }).catch(() => undefined);
      }

      await api('/meals', {
        method: 'POST',
        body: {
          slot,
          description: draft.perHundred ? `${draft.name} (${grams}g)` : draft.name,
          ...scaled,
        },
      });
      reset();
      onLogged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not log that');
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'scan' && !draft) {
    return (
      <BarcodeScanner
        visible
        onClose={() => {
          reset();
          onClose();
        }}
        onScanned={lookup}
      />
    );
  }

  return (
    <Modal
      visible={mode !== null}
      transparent
      animationType="slide"
      onRequestClose={() => {
        reset();
        onClose();
      }}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable
          style={styles.backdropFill}
          onPress={() => {
            reset();
            onClose();
          }}
        />
        <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheet}>
          {!draft ? (
            <>
              <Text style={styles.label}>DESCRIBE IT</Text>
              <Text style={styles.help}>
                In your words, English or German. Give weights if you know them and the estimate
                gets much better.
              </Text>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="200g Hähnchen, Reis, Brokkoli"
                placeholderTextColor={colors.textFaint}
                style={[styles.input, styles.multiline]}
                multiline
                autoFocus
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Button
                title={busy ? 'Working it out…' : 'Estimate macros'}
                onPress={estimate}
                disabled={busy || text.trim().length < 2}
              />
            </>
          ) : (
            <>
              <Text style={styles.label}>CHECK THIS BEFORE SAVING</Text>
              <Text style={styles.draftName}>{draft.name}</Text>
              {draft.note ? <Text style={styles.help}>{draft.note}</Text> : null}

              {draft.perHundred ? (
                <View style={styles.gramsRow}>
                  <TextInput
                    value={grams}
                    onChangeText={setGrams}
                    keyboardType="number-pad"
                    style={[styles.input, styles.grams]}
                  />
                  <Text style={styles.gramsLabel}>grams eaten</Text>
                </View>
              ) : null}

              <View style={styles.macroRow}>
                <Macro label="protein" value={`${scaled!.proteinG}g`} hero />
                <Macro label="kcal" value={`${scaled!.kcal}`} />
                <Macro label="fat" value={scaled!.fatG == null ? '—' : `${scaled!.fatG}g`} />
                <Macro label="carbs" value={scaled!.carbsG == null ? '—' : `${scaled!.carbsG}g`} />
              </View>

              <View style={styles.slotRow}>
                {SLOTS.map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => setSlot(option)}
                    style={[styles.slotChip, slot === option && styles.slotChipActive]}
                  >
                    <Text style={[styles.slotText, slot === option && styles.slotTextActive]}>
                      {option}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Button title={busy ? 'Saving…' : 'Log it'} onPress={log} disabled={busy} />
              <Button title="Start over" variant="ghost" onPress={reset} />
            </>
          )}

          {busy && !draft ? <ActivityIndicator color={colors.textFaint} /> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Macro({ label, value, hero }: { label: string; value: string; hero?: boolean }) {
  return (
    <View style={styles.macro}>
      <Text style={[styles.macroValue, hero && styles.macroHero]}>{value}</Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.65)' },
  sheetScroll: { maxHeight: '88%', flexGrow: 0 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    paddingBottom: space.xxl + space.lg,
    gap: space.md,
  },
  label: { ...typo.label, color: colors.textFaint },
  help: { fontSize: 14, color: colors.textDim, lineHeight: 20 },
  draftName: { fontSize: 20, fontWeight: '700', color: colors.text },

  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: space.lg,
    color: colors.text,
    fontSize: 16,
  },
  multiline: { minHeight: 88, paddingTop: space.md, textAlignVertical: 'top' },

  gramsRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  grams: { width: 110, textAlign: 'center', fontSize: 20, fontWeight: '700' },
  gramsLabel: { ...typo.body, color: colors.textDim },

  macroRow: { flexDirection: 'row', gap: space.sm },
  macro: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
  },
  macroValue: { fontSize: 19, fontWeight: '700', color: colors.text, ...typo.mono },
  macroHero: { color: colors.accent, fontSize: 22 },
  macroLabel: { fontSize: 11, color: colors.textFaint, marginTop: 2 },

  slotRow: { flexDirection: 'row', gap: space.sm },
  slotChip: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
  },
  slotChipActive: { backgroundColor: colors.accentDeep, borderColor: colors.accent },
  slotText: { fontSize: 13, fontWeight: '600', color: colors.textDim, textTransform: 'capitalize' },
  slotTextActive: { color: colors.accent },

  error: { color: colors.danger, fontSize: 14 },
});
