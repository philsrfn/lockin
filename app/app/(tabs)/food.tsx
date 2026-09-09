import { useCallback, useEffect, useState } from 'react';
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
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/api/client';
import type { Food, Meal, MealSlot, Today } from '../../src/api/types';
import { Button } from '../../src/components/Button';
import { FoodCapture } from '../../src/components/FoodCapture';
import { FoodEditor } from '../../src/components/FoodEditor';
import { PortionSheet } from '../../src/components/PortionSheet';
import { t } from '../../src/lib/locale';
import { colors, radius, space, tabBarHeight, type as typo } from '../../src/theme';
import { messageFor } from '../../src/lib/apiError';

const SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack'];

/**
 * §11: quick-add tiles for actual staples, then his own library ordered by what
 * he last reached for, then manual entry that offers to save. No general
 * nutrition database, no portion pickers, and no asking him to weigh a
 * vegetable — precision there is not required and should not be requested.
 */
export default function FoodScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [today, setToday] = useState<Today | null>(null);
  const [foods, setFoods] = useState<Food[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [capture, setCapture] = useState<'scan' | 'describe' | null>(null);
  const [editing, setEditing] = useState<Food | null>(null);
  const [portioning, setPortioning] = useState<Food | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [t, f] = await Promise.all([
        api<Today>('/today'),
        api<{ foods: Food[] }>('/foods'),
      ]);
      setToday(t);
      setFoods(f.foods);
      setError(null);
    } catch (caught) {
      setError(messageFor(caught, 'couldNotLoadFood'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  /**
   * One tap is right for a food that *is* a portion, and wrong for one
   * measured by weight — that used to log 100 g of it without saying so.
   * The basis now lives on the food, so the tap can branch on it.
   */
  function tapFood(food: Food) {
    if (food.perGrams != null) setPortioning(food);
    else void logFood(food, null);
  }

  async function logFood(food: Food, grams: number | null) {
    setBusy(food.id);
    setError(null);
    try {
      await api('/meals/from-food', {
        method: 'POST',
        body: { foodId: food.id, ...(grams == null ? {} : { grams }) },
      });
      setPortioning(null);
      await load();
    } catch (caught) {
      setError(messageFor(caught, 'couldNotLog'));
    } finally {
      setBusy(null);
    }
  }

  async function removeMeal(meal: Meal) {
    setBusy(-meal.id);
    try {
      await api(`/meals/${meal.id}`, { method: 'DELETE' });
      await load();
    } catch {
      // Next refresh reconciles.
    } finally {
      setBusy(null);
    }
  }

  const macros = today?.macros;
  const quick = foods.filter((food) => food.quickAdd);
  const rest = foods.filter((food) => !food.quickAdd);
  const meals = macros?.meals ?? [];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Pinned: the hero number stays visible while he scrolls the library. */}
      <View style={styles.totals}>
        <View style={styles.heroRow}>
          <Text style={styles.hero}>{macros ? macros.remaining.proteinG : '—'}</Text>
          <View style={styles.heroLabel}>
            <Text style={styles.heroUnit}>{t('gProtein')}</Text>
            <Text style={styles.heroSub}>{t('stillToGo')}</Text>
          </View>
        </View>
        <View style={styles.track}>
          <View
            style={[styles.fill, { width: `${Math.min(100, macros?.remaining.proteinPct ?? 0)}%` }]}
          />
        </View>
        <Text style={styles.subtle}>
          {macros ? `${macros.remaining.kcal} ${t('kcalLeftOf')} ${macros.targets.kcal}` : ' '}
          {macros && macros.remaining.fatToFloorG > 0
            ? ` · ${macros.remaining.fatToFloorG}g ${t('toTheFatFloor')}`
            : macros
              ? ` · ${t('fatFloorCleared')}`
              : ''}
        </Text>
      </View>

      <ScrollView
        // The tab bar floats over this scroll view and the safe-area inset does
        // not know it is there — the two buttons at the end were half under it.
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + tabBarHeight + space.xl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        {loading ? <ActivityIndicator color={colors.textFaint} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {quick.length > 0 ? (
          <>
            <Text style={styles.section}>{t('oneTap')}</Text>
            <View style={styles.tiles}>
              {quick.map((food) => (
                <Pressable
                  key={food.id}
                  onPress={() => tapFood(food)}
                  onLongPress={() => setEditing(food)}
                  delayLongPress={450}
                  disabled={busy !== null}
                  style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
                >
                  {busy === food.id ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <>
                      <Text style={styles.tileName} numberOfLines={2}>
                        {food.name}
                      </Text>
                      <Text style={styles.tileMacros}>
                        {food.proteinG} g P · {food.kcal} kcal
                        {food.perGrams != null ? ` / ${food.perGrams} g` : ''}
                      </Text>
                    </>
                  )}
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {meals.length > 0 ? (
          <>
            <Text style={styles.section}>{t('loggedToday')}</Text>
            <View style={styles.card}>
              {meals.map((meal) => (
                <Pressable
                  key={meal.id}
                  onLongPress={() => removeMeal(meal)}
                  delayLongPress={500}
                  style={styles.mealRow}
                >
                  <View style={styles.mealText}>
                    <Text style={styles.mealName} numberOfLines={1}>
                      {meal.description}
                    </Text>
                    <Text style={styles.mealSlot}>{meal.slot}</Text>
                  </View>
                  <Text style={styles.mealMacros}>
                    {meal.proteinG ?? 0} g P · {meal.kcal ?? 0} kcal
                  </Text>
                </Pressable>
              ))}
              <Text style={styles.hint}>{t('holdToRemove')}</Text>
            </View>
          </>
        ) : null}

        {rest.length > 0 ? (
          <>
            <Text style={styles.section}>{t('myFoods')}</Text>
            <View style={styles.card}>
              <Text style={styles.hint}>{t('tapToLogHoldToEdit')}</Text>
              {rest.map((food) => (
                <Pressable
                  key={food.id}
                  onPress={() => tapFood(food)}
                  onLongPress={() => setEditing(food)}
                  delayLongPress={450}
                  disabled={busy !== null}
                  style={({ pressed }) => [styles.libraryRow, pressed && styles.pressed]}
                >
                  <Text style={styles.mealName} numberOfLines={1}>
                    {food.name}
                  </Text>
                  <Text style={styles.mealMacros}>
                    {food.proteinG} g P · {food.kcal} kcal
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <View style={styles.captureRow}>
          <Button title={t('scan')} variant="secondary" style={styles.flex} onPress={() => setCapture('scan')} />
          <Button
            title={t('describeIt')}
            variant="secondary"
            style={styles.flex}
            onPress={() => setCapture('describe')}
          />
        </View>
        <Button
          title={t('whatsInTheFridge')}
          variant="secondary"
          onPress={() => router.push('/fridge')}
        />
        <Button title={t('enterByHand')} variant="ghost" onPress={() => setManualOpen(true)} />
      </ScrollView>

      <PortionSheet
        food={portioning}
        busy={busy !== null}
        onCancel={() => setPortioning(null)}
        onConfirm={(grams) => portioning && void logFood(portioning, grams)}
      />

      <FoodEditor
        food={editing}
        onClose={() => setEditing(null)}
        onSaved={async () => {
          setEditing(null);
          await load();
        }}
      />

      <FoodCapture
        mode={capture}
        onClose={() => setCapture(null)}
        onLogged={async () => {
          setCapture(null);
          await load();
        }}
      />

      <ManualEntry
        visible={manualOpen}
        onClose={() => setManualOpen(false)}
        onLogged={async () => {
          setManualOpen(false);
          await load();
        }}
      />
    </View>
  );
}

/** Manual entry. Offers to keep it, so the library grows by use (§11). */
function ManualEntry({
  visible,
  onClose,
  onLogged,
}: {
  visible: boolean;
  onClose: () => void;
  onLogged: () => void;
}) {
  const [name, setName] = useState('');
  const [kcal, setKcal] = useState('');
  const [protein, setProtein] = useState('');
  const [fat, setFat] = useState('');
  const [slot, setSlot] = useState<MealSlot>('snack');
  const [save, setSave] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim().length > 0 && kcal !== '' && protein !== '';

  async function submit() {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const macros = {
        kcal: Number(kcal),
        proteinG: Number(protein),
        fatG: fat === '' ? null : Number(fat),
      };
      // Saving first means the meal carries a food_id and the library orders
      // itself by real use.
      let foodId: number | null = null;
      if (save) {
        const created = await api<{ food: Food }>('/foods', {
          method: 'POST',
          body: { name: name.trim(), ...macros, defaultSlot: slot },
        });
        foodId = created.food.id;
      }
      await api('/meals', {
        method: 'POST',
        body: { slot, description: name.trim(), ...macros, foodId },
      });
      setName('');
      setKcal('');
      setProtein('');
      setFat('');
      onLogged();
    } catch (caught) {
      setError(messageFor(caught, 'couldNotSave'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.section}>{t('whatDidYouEat')}</Text>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t('nameItPlaceholder')}
            placeholderTextColor={colors.textFaint}
            style={styles.input}
          />

          <View style={styles.numberRow}>
            <TextInput
              value={protein}
              onChangeText={setProtein}
              placeholder={t('proteinGShort')}
              placeholderTextColor={colors.textFaint}
              keyboardType="number-pad"
              style={[styles.input, styles.numberInput]}
            />
            <TextInput
              value={kcal}
              onChangeText={setKcal}
              placeholder={t('macroKcal')}
              placeholderTextColor={colors.textFaint}
              keyboardType="number-pad"
              style={[styles.input, styles.numberInput]}
            />
            <TextInput
              value={fat}
              onChangeText={setFat}
              placeholder={t('fatGShort')}
              placeholderTextColor={colors.textFaint}
              keyboardType="number-pad"
              style={[styles.input, styles.numberInput]}
            />
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

          <Pressable onPress={() => setSave((current) => !current)} style={styles.saveToggle}>
            <Text style={[styles.saveText, save && styles.saveTextOn]}>
              {save ? `✓  ${t('keepInMyFoods')}` : t('keepInMyFoods')}
            </Text>
          </Pressable>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            title={busy ? t('saving') : t('logIt')}
            onPress={submit}
            disabled={!valid || busy}
          />
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  totals: {
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.lg,
    gap: space.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  hero: { ...typo.hero, ...typo.mono, color: colors.text },
  heroLabel: { paddingBottom: space.sm },
  heroUnit: { fontSize: 16, fontWeight: '400', color: colors.textDim },
  heroSub: { fontSize: 12, color: colors.textFaint, letterSpacing: 0.4 },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceHigh, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent, borderRadius: radius.pill },

  content: { padding: space.lg, gap: space.md },
  section: { ...typo.label, color: colors.textFaint, marginTop: space.sm },

  tiles: { gap: 0 },
  tile: {
    minHeight: 64,
    justifyContent: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingVertical: space.md,
    gap: 3,
  },
  tileName: { fontSize: 16, fontWeight: '400', color: colors.text },
  tileMacros: { fontSize: 13, color: colors.textDim, ...typo.mono },

  card: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingVertical: space.sm,
  },
  mealRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, gap: space.md },
  libraryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 52,
    gap: space.md,
  },
  mealText: { flex: 1 },
  mealName: { ...typo.body, color: colors.text, flexShrink: 1 },
  mealSlot: { fontSize: 12, color: colors.textFaint, textTransform: 'capitalize' },
  mealMacros: { ...typo.bodyDim, ...typo.mono, color: colors.textDim },
  hint: { fontSize: 12, color: colors.textFaint, paddingVertical: space.sm },

  subtle: { ...typo.bodyDim, color: colors.textDim },
  error: { color: colors.danger, fontSize: 14 },
  pressed: { opacity: 0.7 },
  captureRow: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },

  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropFill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    paddingBottom: space.xxl + space.lg,
    gap: space.md,
  },
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
  numberInput: { flex: 1, paddingHorizontal: space.md, textAlign: 'center' },

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

  saveToggle: { minHeight: 44, justifyContent: 'center' },
  saveText: { fontSize: 15, fontWeight: '600', color: colors.textDim },
  saveTextOn: { color: colors.accent },
});
