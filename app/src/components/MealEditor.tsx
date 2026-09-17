import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { api } from '../api/client';
import type { FoodEstimate, Meal, MealSlot } from '../api/types';
import { Button } from './Button';
import { t } from '../lib/locale';
import { messageFor } from '../lib/apiError';
import { MEAL_SLOTS, slotLabelKey } from '../lib/mealSlots';
import { colors, radius, space, type as typo } from '../theme';

/** A number field's text, as the server wants it: empty is "not known". */
const toNumber = (value: string): number | null => {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Math.round(Number(trimmed.replace(',', '.')));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const toField = (value: number | null) => (value == null ? '' : String(value));

/**
 * Correcting a meal that is already in the day.
 *
 * Before this the only fix for a wrong estimate was to remove the meal and log
 * it again, which lost which food it came from and moved it to the end of the
 * day. Every field is editable, and removing lives here too — one row, one
 * tap, one place to do anything to it.
 *
 * "Estimate again" sends the description, as it now reads, back to the same
 * estimate the Describe flow uses. It fills the fields and writes nothing:
 * the numbers are still somebody's to confirm (§9), and Save is that
 * confirmation.
 */
export function MealEditor({
  meal,
  onClose,
  onSaved,
}: {
  meal: Meal | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [description, setDescription] = useState('');
  const [protein, setProtein] = useState('');
  const [kcal, setKcal] = useState('');
  const [fat, setFat] = useState('');
  const [carbs, setCarbs] = useState('');
  const [slot, setSlot] = useState<MealSlot>('snack');
  const [busy, setBusy] = useState<'save' | 'remove' | 'estimate' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A different meal must not open on the last one's edits.
  useEffect(() => {
    if (!meal) return;
    setDescription(meal.description ?? '');
    setProtein(toField(meal.proteinG));
    setKcal(toField(meal.kcal));
    setFat(toField(meal.fatG));
    setCarbs(toField(meal.carbsG));
    setSlot(meal.slot);
    setNote(null);
    setError(null);
    setBusy(null);
  }, [meal]);

  const valid = description.trim().length > 0;

  async function estimateAgain() {
    if (description.trim().length < 2) return;
    setBusy('estimate');
    setError(null);
    try {
      const { estimate } = await api<{ estimate: FoodEstimate }>('/foods/estimate', {
        method: 'POST',
        body: { text: description.trim() },
        timeoutMs: 60_000,
      });
      setProtein(toField(estimate.proteinG));
      setKcal(toField(estimate.kcal));
      setFat(toField(estimate.fatG));
      setCarbs(toField(estimate.carbsG));
      setNote(
        estimate.assumptions ||
          (estimate.confidence === 'low' ? t('roughGuess') : t('checkItLooksRight')),
      );
    } catch (caught) {
      setError(messageFor(caught, 'couldNotEstimate'));
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!meal || !valid) return;
    setBusy('save');
    setError(null);
    try {
      await api(`/meals/${meal.id}`, {
        method: 'PATCH',
        body: {
          slot,
          description: description.trim(),
          proteinG: toNumber(protein),
          kcal: toNumber(kcal),
          fatG: toNumber(fat),
          carbsG: toNumber(carbs),
        },
      });
      onSaved(t('mealUpdated'));
    } catch (caught) {
      setError(messageFor(caught, 'couldNotSave'));
    } finally {
      setBusy(null);
    }
  }

  function confirmRemove() {
    if (!meal) return;
    Alert.alert(t('removeMealTitle'), meal.description ?? undefined, [
      { text: t('keepIt'), style: 'cancel' },
      { text: t('removeEntry'), style: 'destructive', onPress: () => void remove() },
    ]);
  }

  async function remove() {
    if (!meal) return;
    setBusy('remove');
    setError(null);
    try {
      await api(`/meals/${meal.id}`, { method: 'DELETE' });
      onSaved(t('mealRemoved'));
    } catch (caught) {
      setError(messageFor(caught, 'couldNotSave'));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal visible={meal !== null} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdropFill} onPress={onClose} accessibilityLabel={t('cancel')} />
        <ScrollView
          style={styles.sheetScroll}
          contentContainerStyle={styles.sheet}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.grabber} />
          <View style={styles.head}>
            <Text style={styles.label}>{t('editMeal')}</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityRole="button">
              <Text style={styles.cancel}>{t('cancel')}</Text>
            </Pressable>
          </View>

          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder={t('nameItPlaceholder')}
            placeholderTextColor={colors.textFaint}
            style={[styles.input, styles.multiline]}
            multiline
          />

          <Pressable
            onPress={estimateAgain}
            disabled={busy !== null || description.trim().length < 2}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.estimate,
              (busy !== null || description.trim().length < 2) && styles.estimateDisabled,
              pressed && styles.pressed,
            ]}
          >
            {busy === 'estimate' ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : null}
            <Text style={styles.estimateText}>
              {busy === 'estimate' ? t('estimating') : `✦  ${t('estimateAgain')}`}
            </Text>
          </Pressable>
          {note ? <Text style={styles.note}>{note}</Text> : null}

          <View style={styles.grid}>
            <Field label={t('macroProtein')} unit="g" value={protein} onChange={setProtein} hero />
            <Field label={t('macroKcal')} value={kcal} onChange={setKcal} />
            <Field label={t('macroFat')} unit="g" value={fat} onChange={setFat} />
            <Field label={t('macroCarbs')} unit="g" value={carbs} onChange={setCarbs} />
          </View>

          <View style={styles.slotRow}>
            {MEAL_SLOTS.map((option) => (
              <Pressable
                key={option}
                onPress={() => setSlot(option)}
                accessibilityRole="button"
                accessibilityState={{ selected: slot === option }}
                style={[styles.slotChip, slot === option && styles.slotChipActive]}
              >
                <Text style={[styles.slotText, slot === option && styles.slotTextActive]}>
                  {t(slotLabelKey(option))}
                </Text>
              </Pressable>
            ))}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            title={busy === 'save' ? t('saving') : t('save')}
            onPress={save}
            disabled={!valid || busy !== null}
          />
          <Button
            title={busy === 'remove' ? t('saving') : t('removeEntry')}
            variant="danger"
            onPress={confirmRemove}
            disabled={busy !== null}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label,
  unit,
  value,
  onChange,
  hero,
}: {
  label: string;
  unit?: string;
  value: string;
  onChange: (next: string) => void;
  hero?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.fieldRow}>
        <TextInput
          value={value}
          onChangeText={onChange}
          keyboardType="number-pad"
          placeholder="—"
          placeholderTextColor={colors.textFaint}
          selectTextOnFocus
          accessibilityLabel={label}
          style={[styles.fieldInput, hero && styles.fieldHero]}
        />
        {unit ? <Text style={styles.fieldUnit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  sheetScroll: { maxHeight: '92%', flexGrow: 0 },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    paddingTop: space.sm,
    paddingBottom: space.xxl + space.lg,
    gap: space.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    marginBottom: space.xs,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  label: { ...typo.label, color: colors.textFaint },
  cancel: { fontSize: 15, color: colors.textDim },

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
  multiline: { minHeight: 64, paddingTop: space.md, textAlignVertical: 'top' },

  estimate: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
  },
  estimateDisabled: { opacity: 0.5 },
  estimateText: { fontSize: 15, fontWeight: '600', color: colors.accent },
  note: { fontSize: 14, color: colors.textDim, lineHeight: 20 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  field: {
    width: '48.8%',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  fieldLabel: { fontSize: 12, color: colors.textFaint },
  fieldRow: { flexDirection: 'row', alignItems: 'baseline', gap: space.xs },
  fieldInput: {
    flex: 1,
    fontSize: 24,
    fontWeight: '400',
    color: colors.text,
    paddingVertical: space.xs,
    ...typo.mono,
  },
  fieldHero: { color: colors.accent },
  fieldUnit: { fontSize: 15, color: colors.textDim },

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
  slotText: { fontSize: 13, fontWeight: '600', color: colors.textDim },
  slotTextActive: { color: colors.accent },

  error: { color: colors.danger, fontSize: 14 },
  pressed: { opacity: 0.7 },
});
