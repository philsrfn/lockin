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
import { t } from '../lib/locale';
import { colors, radius, space, type as typo } from '../theme';

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

const SLOT_LABELS = {
  breakfast: 'slotBreakfast',
  lunch: 'slotLunch',
  dinner: 'slotDinner',
  snack: 'slotSnack',
} as const;

/** What both routes converge on before anything is written. */
type Draft = {
  name: string;
  kcal: number;
  proteinG: number;
  fatG: number | null;
  carbsG: number | null;
  barcode?: string;
  /**
   * null = this is one portion. 100 = the numbers describe 100 g and a
   * weight has to be given.
   *
   * It comes from the server now. It used to be inferred from `known` —
   * "we have seen this before" read as "these numbers are a portion" — so a
   * second scan hid the weight field and logged 100 g of whatever it was.
   */
  perGrams?: number | null;
  note?: string | null;
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
        perGrams: c.perGrams,
        note: c.known ? t('fromYourFoods') : null,
      });
      // Last time beats a round number: somebody who had 60 g of this bar on
      // Tuesday is far likelier to have 60 again than 100, and 100 was never
      // chosen by anybody — it is the number the label is printed against.
      setGrams(String(c.lastGrams ?? c.perGrams ?? 100));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('lookupFailed'));
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
          (e.confidence === 'low' ? t('roughGuess') : t('checkItLooksRight')),
      });
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('couldNotEstimate'));
    } finally {
      setBusy(false);
    }
  }

  const byWeight = draft?.perGrams != null;
  // Scaled live as the number is typed, so the macros below the field are
  // always the macros of the portion on screen.
  const factor = byWeight ? (Number(grams) || 0) / (draft!.perGrams as number) : 1;
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
      if (draft.barcode && byWeight) {
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
          description: byWeight ? `${draft.name} (${grams} g)` : draft.name,
          ...scaled,
        },
      });
      reset();
      onLogged();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('couldNotLog'));
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
              <Text style={styles.label}>{t('describeIt')}</Text>
              <Text style={styles.help}>{t('describeHelp')}</Text>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder={t('describePlaceholder')}
                placeholderTextColor={colors.textFaint}
                style={[styles.input, styles.multiline]}
                multiline
                autoFocus
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Button
                title={busy ? t('estimating') : t('estimateMacros')}
                onPress={estimate}
                disabled={busy || text.trim().length < 2}
              />
            </>
          ) : (
            <>
              <Text style={styles.draftName}>{draft.name}</Text>
              {draft.note ? <Text style={styles.help}>{draft.note}</Text> : null}

              {/* The weight is the only decision on this sheet, so it gets the
                  size and the keyboard. Everything below it is a consequence
                  of the number typed here and updates as it is typed. */}
              {byWeight ? (
                <>
                  <Text style={styles.label}>{t('howMuch')}</Text>
                  <View style={styles.gramsRow}>
                    <TextInput
                      value={grams}
                      onChangeText={(next) => setGrams(next.replace(/[^0-9]/g, ''))}
                      keyboardType="number-pad"
                      selectTextOnFocus
                      autoFocus
                      style={styles.grams}
                    />
                    <Text style={styles.gramsUnit}>{t('gramsUnit')}</Text>
                  </View>
                  <Text style={styles.help}>{t('perHundredNote')}</Text>
                </>
              ) : null}

              <View style={styles.macroRow}>
                <Macro label={t('macroProtein')} value={`${scaled!.proteinG} g`} hero />
                <Macro label={t('macroKcal')} value={`${scaled!.kcal}`} />
                <Macro label={t('macroFat')} value={scaled!.fatG == null ? '—' : `${scaled!.fatG} g`} />
                <Macro label={t('macroCarbs')} value={scaled!.carbsG == null ? '—' : `${scaled!.carbsG} g`} />
              </View>

              <View style={styles.slotRow}>
                {SLOTS.map((option) => (
                  <Pressable
                    key={option}
                    onPress={() => setSlot(option)}
                    style={[styles.slotChip, slot === option && styles.slotChipActive]}
                  >
                    <Text style={[styles.slotText, slot === option && styles.slotTextActive]}>
                      {t(SLOT_LABELS[option])}
                    </Text>
                  </Pressable>
                ))}
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <Button
                title={busy ? t('savingShort') : t('logIt')}
                onPress={log}
                disabled={busy || (byWeight && !(Number(grams) > 0))}
              />
              <Button title={t('startOver')} variant="ghost" onPress={reset} />
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
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    paddingBottom: space.xxl + space.lg,
    gap: space.md,
  },
  label: { ...typo.label, color: colors.textFaint },
  help: { fontSize: 14, color: colors.textDim, lineHeight: 20 },
  draftName: { fontSize: 20, fontWeight: '400', color: colors.text },

  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: space.lg,
    color: colors.text,
    fontSize: 16,
  },
  multiline: { minHeight: 88, paddingTop: space.md, textAlignVertical: 'top' },

  gramsRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  grams: {
    minWidth: 110,
    fontSize: 52,
    fontWeight: '300',
    letterSpacing: -1.5,
    color: colors.text,
    fontVariant: ['tabular-nums'],
    paddingVertical: 0,
  },
  gramsUnit: { fontSize: 22, color: colors.textDim },

  macroRow: { flexDirection: 'row', gap: space.sm },
  macro: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  macroValue: { fontSize: 19, fontWeight: '400', color: colors.text, ...typo.mono },
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
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  slotChipActive: { backgroundColor: colors.accentDeep, borderColor: colors.accent },
  slotText: { fontSize: 13, fontWeight: '600', color: colors.textDim, textTransform: 'capitalize' },
  slotTextActive: { color: colors.accent },

  error: { color: colors.danger, fontSize: 14 },
});
