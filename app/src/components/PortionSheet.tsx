import { useGramsField } from '../lib/useGramsField';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button } from './Button';
import { t } from '../lib/locale';
import { colors, radius, space, type as typo } from '../theme';

/**
 * "How much?" — for a food whose numbers describe a weight.
 *
 * A tile used to log its row's raw macros with one tap, which for a scanned
 * product meant 100 g of it whatever had been eaten. One tap is still the
 * right interaction for a tub of Skyr; it is the wrong one for a bag of oats,
 * and the difference is now recorded on the food itself (migration 027).
 *
 * So the tap opens this instead. It asks one question, opens on the answer
 * from last time, and shows the macros moving as the number is typed — so the
 * thing being logged is visible before it is logged.
 */
export function PortionSheet({
  food,
  onCancel,
  onConfirm,
  busy = false,
}: {
  food: {
    name: string;
    kcal: number;
    proteinG: number;
    fatG: number | null;
    carbsG: number | null;
    perGrams: number | null;
    lastGrams: number | null;
  } | null;
  onCancel: () => void;
  onConfirm: (grams: number) => void;
  busy?: boolean;
}) {
  // Reopening on a different food must not carry the last one's number over,
  // and the suggestion arrives selected so the first keystroke replaces it.
  const field = useGramsField(food ? (food.lastGrams ?? food.perGrams ?? 100) : null);

  if (!food) return null;

  const factor = field.amount / (food.perGrams || 100);
  const round = (value: number | null) => (value == null ? null : Math.round(value * factor));

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdropFill} onPress={onCancel} />
        <View style={styles.sheet}>
          <Text style={styles.name}>{food.name}</Text>
          <Text style={styles.label}>{t('howMuch')}</Text>

          <View style={styles.row}>
            <TextInput {...field.props} autoFocus style={styles.grams} />
            <Text style={styles.unit}>{t('gramsUnit')}</Text>
          </View>

          {/* What will be logged, updating as the number is typed. */}
          <Text style={styles.macros}>
            {Math.round(food.proteinG * factor)} g {t('macroProtein')}
            {'   ·   '}
            {Math.round(food.kcal * factor)} {t('macroKcal')}
            {food.fatG != null ? `   ·   ${round(food.fatG)} g ${t('macroFat')}` : ''}
          </Text>

          <Button
            title={busy ? t('savingShort') : t('logIt')}
            onPress={() => onConfirm(field.amount)}
            disabled={busy || !field.valid}
          />
          <Button title={t('cancel')} variant="ghost" onPress={onCancel} />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropFill: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  name: { ...typo.title, color: colors.text },
  label: { ...typo.label, color: colors.textFaint },
  row: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  grams: {
    minWidth: 110,
    fontSize: 52,
    fontWeight: '300',
    letterSpacing: -1.5,
    color: colors.text,
    fontVariant: ['tabular-nums'],
    paddingVertical: 0,
  },
  unit: { fontSize: 22, color: colors.textDim },
  macros: { ...typo.bodyDim, color: colors.textDim, fontVariant: ['tabular-nums'] },
});
