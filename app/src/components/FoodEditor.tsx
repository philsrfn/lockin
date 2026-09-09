import { useEffect, useState } from 'react';
import { t } from '../lib/locale';
import {
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
import type { Food, MealSlot } from '../api/types';
import { Button } from './Button';
import { colors, radius, space, type as typo } from '../theme';
import { messageFor } from '../lib/apiError';

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * Editing a saved food. The seeded macros are estimates and the barcode ones
 * are crowd-sourced, so being able to correct them is what turns the library
 * from a guess into his own data.
 *
 * Removing archives rather than deletes: meals already logged against a food
 * keep pointing at it, and his history stays intact.
 */
export function FoodEditor({
  food,
  onClose,
  onSaved,
}: {
  food: Food | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [carbs, setCarbs] = useState('');
  const [quickAdd, setQuickAdd] = useState(false);
  const [slot, setSlot] = useState<MealSlot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  // Re-seed the form whenever a different food is opened.
  useEffect(() => {
    if (!food) return;
    setName(food.name);
    setKcal(String(food.kcal));
    setProtein(String(food.proteinG));
    setFat(food.fatG == null ? '' : String(food.fatG));
    setCarbs(food.carbsG == null ? '' : String(food.carbsG));
    setQuickAdd(food.quickAdd);
    setSlot(food.defaultSlot);
    setError(null);
    setConfirmRemove(false);
  }, [food]);

  const valid = name.trim().length > 0 && kcal !== '' && protein !== '';

  async function save() {
    if (!food || !valid) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/foods/${food.id}`, {
        method: 'PATCH',
        body: {
          name: name.trim(),
          kcal: Number(kcal),
          proteinG: Number(protein),
          fatG: fat === '' ? null : Number(fat),
          carbsG: carbs === '' ? null : Number(carbs),
          quickAdd,
          defaultSlot: slot,
        },
      });
      onSaved();
    } catch (caught) {
      setError(messageFor(caught, 'couldNotSave'));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!food) return;
    setBusy(true);
    try {
      await api(`/foods/${food.id}`, { method: 'DELETE' });
      onSaved();
    } catch (caught) {
      setError(messageFor(caught, 'couldNotRemove'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={food !== null} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheet}>
          <Text style={styles.label}>{t('editFood')}</Text>

          <TextInput value={name} onChangeText={setName} style={styles.input} />

          <View style={styles.numberRow}>
            <Field label={t('macroProtein')} value={protein} onChange={setProtein} />
            <Field label={t('macroKcal')} value={kcal} onChange={setKcal} />
            <Field label={t('macroFat')} value={fat} onChange={setFat} />
            <Field label={t('macroCarbs')} value={carbs} onChange={setCarbs} />
          </View>

          <Pressable onPress={() => setQuickAdd((v) => !v)} style={styles.toggle}>
            <Text style={[styles.toggleText, quickAdd && styles.toggleOn]}>
              {quickAdd ? `✓  ${t('showAsTile')}` : t('showAsTile')}
            </Text>
            <Text style={styles.toggleHint}>{t('tilesSitAtTop')}</Text>
          </Pressable>

          <Text style={styles.label}>{t('usualMeal')}</Text>
          <View style={styles.slotRow}>
            {SLOTS.map((option) => (
              <Pressable
                key={option}
                // Tapping the active one clears it — some foods are any-time.
                onPress={() => setSlot(slot === option ? null : option)}
                style={[styles.slotChip, slot === option && styles.slotChipActive]}
              >
                <Text style={[styles.slotText, slot === option && styles.slotTextActive]}>
                  {option}
                </Text>
              </Pressable>
            ))}
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button title={busy ? 'Saving…' : 'Save'} onPress={save} disabled={!valid || busy} />

          {confirmRemove ? (
            <>
              <Text style={styles.warn}>
                {t('removeFoodAsk')}
              </Text>
              <Button title={t('removeIt')} variant="secondary" onPress={remove} disabled={busy} />
              <Button title={t('keepIt')} variant="ghost" onPress={() => setConfirmRemove(false)} />
            </>
          ) : (
            <Button title={t('removeFromMyFoods')} variant="ghost" onPress={() => setConfirmRemove(true)} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <View style={styles.field}>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType="number-pad"
        placeholder="—"
        placeholderTextColor={colors.textFaint}
        style={[styles.input, styles.fieldInput]}
      />
      <Text style={styles.fieldLabel}>{label}</Text>
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
  numberRow: { flexDirection: 'row', gap: space.sm },
  field: { flex: 1, gap: 4 },
  fieldInput: { paddingHorizontal: space.sm, textAlign: 'center', fontWeight: '400' },
  fieldLabel: { fontSize: 11, color: colors.textFaint, textAlign: 'center' },

  toggle: {
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceHigh,
    padding: space.lg,
    gap: 2,
  },
  toggleText: { fontSize: 16, fontWeight: '400', color: colors.textDim },
  toggleOn: { color: colors.accent },
  toggleHint: { fontSize: 12, color: colors.textFaint },

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
  warn: { color: colors.warn, fontSize: 14, lineHeight: 20 },
});
