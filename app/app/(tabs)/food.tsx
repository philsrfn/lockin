import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../src/api/client';
import type { Food, Meal, MealSlot, Today } from '../../src/api/types';
import { Button } from '../../src/components/Button';
import { FoodCapture } from '../../src/components/FoodCapture';
import { FoodEditor } from '../../src/components/FoodEditor';
import { MealEditor } from '../../src/components/MealEditor';
import { PortionSheet } from '../../src/components/PortionSheet';
import { t } from '../../src/lib/locale';
import { MEAL_SLOTS, slotForHour, slotLabelKey } from '../../src/lib/mealSlots';
import { colors, radius, space, type as typo } from '../../src/theme';
import { messageFor } from '../../src/lib/apiError';

/** Past this many foods a list is scanned rather than read, so it gets a search. */
const SEARCH_FROM = 7;

/**
 * §11: quick-add tiles for actual staples, then their own library, then
 * manual entry that offers to save. No general nutrition database, no asking
 * anybody to weigh a vegetable.
 *
 * The screen is ordered by the question somebody opens it with. It used to put
 * the three ways of logging something new — photo, barcode, description — at
 * the very bottom, under the whole library, so the most common first visit
 * ("I just ate, how do I put it in") was a scroll past things that were not
 * the answer. Now the ways in come first, the staples second, and the record
 * of the day after that.
 *
 * Two gestures were invisible: removing a meal was a long press on its row,
 * and nothing on screen said so except a hint in faint grey. A logged meal is
 * now a row you tap to correct or remove, and a successful log says so out
 * loud instead of only changing a number at the top.
 *
 * The quickest way in is a sentence. The line at the top takes whatever was
 * eaten in plain words and hands it to the same estimate-and-confirm sheet as
 * Describe, already running — nothing is written until it is confirmed (§9).
 */
export default function FoodScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [today, setToday] = useState<Today | null>(null);
  const [foods, setFoods] = useState<Food[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [capture, setCapture] = useState<'scan' | 'describe' | 'photo' | null>(null);
  const [editing, setEditing] = useState<Food | null>(null);
  const [portioning, setPortioning] = useState<Food | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [line, setLine] = useState('');
  const [editingMeal, setEditingMeal] = useState<Meal | null>(null);
  const toast = useToast();

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

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  /**
   * One tap is right for a food that *is* a portion, and wrong for one
   * measured by weight — that used to log 100 g of it without saying so.
   * The basis lives on the food, so the tap can branch on it.
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
      toast.show(t('loggedName', { name: food.name }));
      await load();
    } catch (caught) {
      setError(messageFor(caught, 'couldNotLog'));
    } finally {
      setBusy(null);
    }
  }

  function sendLine() {
    if (line.trim().length < 2) return;
    setCapture('describe');
  }

  const macros = today?.macros;
  const quick = foods.filter((food) => food.quickAdd);
  const rest = foods.filter((food) => !food.quickAdd);
  const meals = macros?.meals ?? [];

  const needle = query.trim().toLocaleLowerCase();
  const library = needle
    ? rest.filter((food) => food.name.toLocaleLowerCase().includes(needle))
    : rest;

  // The day's record in the order the day had it, under the names it has.
  const bySlot = useMemo(
    () =>
      MEAL_SLOTS.map((slot) => ({ slot, meals: meals.filter((meal) => meal.slot === slot) })).filter(
        (group) => group.meals.length > 0,
      ),
    [meals],
  );

  const firstVisit = !loading && foods.length === 0 && meals.length === 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* Pinned: the number the tab is about stays visible while the library scrolls. */}
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
        {macros ? (
          <View style={styles.statRow}>
            <Stat value={macros.remaining.kcal} label={t('kcalLeft')} />
            {macros.remaining.fatToFloorG > 0 ? (
              <Stat value={macros.remaining.fatToFloorG} label={t('fatToGo')} />
            ) : (
              <Text style={styles.statDone}>✓ {t('fatFloorCleared')}</Text>
            )}
          </View>
        ) : null}
      </View>

      <ScrollView
        // Liquid Glass floats over the content, so the scroll view runs to the
        // bottom edge and the safe area — which now includes the native tab
        // bar — is what keeps the last row reachable.
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.textDim} />
        }
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {/*
          The ways to answer "what did I just eat", most general first: a
          sentence covers anything, a plate has a camera, a packet has a
          barcode. All of them land in one confirmation.
        */}
        <View style={styles.line}>
          <Symbol name="sparkles" size={18} color={colors.accent} />
          <TextInput
            value={line}
            onChangeText={setLine}
            placeholder={t('quickDescribePlaceholder')}
            placeholderTextColor={colors.textFaint}
            style={styles.lineInput}
            returnKeyType="send"
            onSubmitEditing={sendLine}
            submitBehavior="blurAndSubmit"
            accessibilityLabel={t('whatDidYouEatShort')}
          />
          <Pressable
            onPress={sendLine}
            disabled={line.trim().length < 2}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel={t('estimateWithAi')}
            style={({ pressed }) => [
              styles.lineSend,
              line.trim().length < 2 && styles.lineSendDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Symbol
              name="arrow.up"
              size={16}
              color={line.trim().length < 2 ? colors.textFaint : colors.bg}
            />
          </Pressable>
        </View>
        <View style={styles.captureRow}>
          <CaptureTile symbol="camera.fill" label={t('tilePhoto')} onPress={() => setCapture('photo')} />
          <CaptureTile symbol="barcode.viewfinder" label={t('tileBarcode')} onPress={() => setCapture('scan')} />
        </View>
        <View style={styles.linkRow}>
          <LinkChip symbol="square.and.pencil" label={t('byHand')} onPress={() => setManualOpen(true)} />
          <LinkChip symbol="refrigerator" label={t('fridgeShort')} onPress={() => router.push('/fridge')} />
        </View>

        {loading ? <ActivityIndicator color={colors.textFaint} style={styles.loader} /> : null}
        {firstVisit ? <Text style={styles.emptyHint}>{t('foodEmptyHint')}</Text> : null}

        {quick.length > 0 ? (
          <Section title={t('oneTap')}>
            <View style={styles.tiles}>
              {quick.map((food) => (
                <Pressable
                  key={food.id}
                  onPress={() => tapFood(food)}
                  onLongPress={() => setEditing(food)}
                  delayLongPress={450}
                  disabled={busy !== null}
                  accessibilityRole="button"
                  accessibilityLabel={t('logFoodA11y', { name: food.name })}
                  accessibilityHint={t('tapToLogHoldToEdit')}
                  style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
                >
                  <View style={styles.tileTop}>
                    <Text style={styles.tileName} numberOfLines={2}>
                      {food.name}
                    </Text>
                    {busy === food.id ? (
                      <ActivityIndicator size="small" color={colors.accent} />
                    ) : (
                      <Symbol name="plus.circle.fill" size={24} color={colors.accent} />
                    )}
                  </View>
                  <FoodMacros food={food} />
                </Pressable>
              ))}
            </View>
          </Section>
        ) : null}

        {!loading && !firstVisit ? (
          <Section title={t('loggedToday')} hint={bySlot.length > 0 ? t('tapToEdit') : undefined}>
            {bySlot.length === 0 ? (
              <Text style={styles.muted}>{t('nothingLoggedToday')}</Text>
            ) : (
              <View style={styles.card}>
                {bySlot.map((group, groupIndex) => (
                  <View key={group.slot} style={groupIndex > 0 && styles.groupDivider}>
                    <Text style={styles.slotHeading}>{t(slotLabelKey(group.slot))}</Text>
                    {group.meals.map((meal) => (
                      <Pressable
                        key={meal.id}
                        onPress={() => setEditingMeal(meal)}
                        accessibilityRole="button"
                        accessibilityLabel={t('editMealA11y', { name: meal.description ?? '' })}
                        style={({ pressed }) => [styles.mealRow, pressed && styles.rowPressed]}
                      >
                        <View style={styles.mealText}>
                          <Text style={styles.rowName} numberOfLines={2}>
                            {meal.description}
                          </Text>
                          <Text style={styles.rowMacros}>
                            <Text style={styles.rowProtein}>{meal.proteinG ?? 0} g P</Text> ·{' '}
                            {meal.kcal ?? 0} kcal
                          </Text>
                        </View>
                        <Symbol name="chevron.right" size={14} color={colors.textFaint} />
                      </Pressable>
                    ))}
                  </View>
                ))}
              </View>
            )}
          </Section>
        ) : null}

        {rest.length > 0 ? (
          <Section title={t('myFoods')} hint={t('tapToLogHoldToEdit')}>
            {rest.length >= SEARCH_FROM ? (
              <View style={styles.search}>
                <Symbol name="magnifyingglass" size={16} color={colors.textFaint} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('searchMyFoods')}
                  placeholderTextColor={colors.textFaint}
                  style={styles.searchInput}
                  clearButtonMode="while-editing"
                  autoCorrect={false}
                  returnKeyType="search"
                />
              </View>
            ) : null}
            <View style={styles.card}>
              {library.length === 0 ? (
                <Text style={[styles.muted, styles.cardPad]}>{t('noFoodMatches')}</Text>
              ) : null}
              {library.map((food, index) => (
                <Pressable
                  key={food.id}
                  onPress={() => tapFood(food)}
                  onLongPress={() => setEditing(food)}
                  delayLongPress={450}
                  disabled={busy !== null}
                  accessibilityRole="button"
                  accessibilityLabel={t('logFoodA11y', { name: food.name })}
                  accessibilityHint={t('tapToLogHoldToEdit')}
                  style={({ pressed }) => [
                    styles.libraryRow,
                    index > 0 && styles.rowDivider,
                    pressed && styles.rowPressed,
                  ]}
                >
                  <View style={styles.mealText}>
                    <Text style={styles.rowName} numberOfLines={1}>
                      {food.name}
                    </Text>
                    <FoodMacros food={food} />
                  </View>
                  {busy === food.id ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Symbol name="plus.circle.fill" size={26} color={colors.accent} />
                  )}
                </Pressable>
              ))}
            </View>
          </Section>
        ) : null}
      </ScrollView>

      <Animated.View
        pointerEvents="none"
        style={[styles.toast, { bottom: insets.bottom + space.md, opacity: toast.opacity }]}
      >
        <Symbol name="checkmark.circle.fill" size={18} color={colors.accent} />
        <Text style={styles.toastText} numberOfLines={1}>
          {toast.message}
        </Text>
      </Animated.View>

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
        initialText={line}
        onClose={() => setCapture(null)}
        onLogged={async () => {
          setCapture(null);
          setLine('');
          toast.show(t('logged'));
          await load();
        }}
      />

      <MealEditor
        meal={editingMeal}
        onClose={() => setEditingMeal(null)}
        onSaved={async (message) => {
          setEditingMeal(null);
          toast.show(message);
          await load();
        }}
      />

      <ManualEntry
        visible={manualOpen}
        onClose={() => setManualOpen(false)}
        onLogged={async () => {
          setManualOpen(false);
          toast.show(t('logged'));
          await load();
        }}
      />
    </View>
  );
}

/**
 * "Logged." A number changing at the top of the screen is feedback only for
 * somebody looking at it; a tap on a tile at the bottom of a scrolled list
 * otherwise looks exactly like a tap that did nothing, and gets tapped again.
 */
function useToast() {
  const opacity = useRef(new Animated.Value(0)).current;
  const [message, setMessage] = useState('');

  const show = useCallback(
    (text: string) => {
      setMessage(text);
      AccessibilityInfo.announceForAccessibility(text);
      opacity.stopAnimation();
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }),
        Animated.delay(1600),
        Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true }),
      ]).start();
    },
    [opacity],
  );

  return { opacity, message, show };
}

function Symbol({ name, size, color }: { name: SymbolViewProps['name']; size: number; color: string }) {
  return <SymbolView name={name} size={size} tintColor={color} resizeMode="scaleAspectFit" />;
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <Text style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text> {label}
    </Text>
  );
}

/** Protein first — it is the number this tab is about — and the basis when it is a weight. */
function FoodMacros({ food }: { food: Food }) {
  return (
    <Text style={styles.rowMacros}>
      <Text style={styles.rowProtein}>{food.proteinG} g P</Text> · {food.kcal} kcal
      {food.perGrams != null ? ` / ${food.perGrams} g` : ''}
    </Text>
  );
}

function CaptureTile({
  symbol,
  label,
  primary,
  onPress,
}: {
  symbol: SymbolViewProps['name'];
  label: string;
  primary?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.captureTile,
        primary && styles.captureTilePrimary,
        pressed && styles.pressed,
      ]}
    >
      <Symbol name={symbol} size={28} color={primary ? colors.bg : colors.accent} />
      <Text style={[styles.captureLabel, primary && styles.captureLabelPrimary]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function LinkChip({
  symbol,
  label,
  onPress,
}: {
  symbol: SymbolViewProps['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.linkChip, pressed && styles.pressed]}
    >
      <Symbol name={symbol} size={16} color={colors.textDim} />
      <Text style={styles.linkText}>{label}</Text>
    </Pressable>
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

  // The sheet stays mounted between openings, so the guess is made on open
  // rather than once when the tab first rendered this morning.
  useEffect(() => {
    if (visible) setSlot(slotForHour(new Date().getHours()));
  }, [visible]);

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
          <View style={styles.grabber} />
          <Text style={styles.sectionTitle}>{t('whatDidYouEat')}</Text>

          <TextInput
            value={name}
            onChangeText={setName}
            placeholder={t('nameItPlaceholder')}
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            autoFocus
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

          <Pressable
            onPress={() => setSave((current) => !current)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: save }}
            style={styles.saveToggle}
          >
            <Symbol
              name={save ? 'checkmark.square.fill' : 'square'}
              size={22}
              color={save ? colors.accent : colors.textDim}
            />
            <Text style={[styles.saveText, save && styles.saveTextOn]}>{t('keepInMyFoods')}</Text>
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
    paddingTop: space.sm,
    paddingBottom: space.md,
    gap: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  heroRow: { flexDirection: 'row', alignItems: 'flex-end', gap: space.md },
  // Smaller than the app's hero: pinned, it costs every other row on the
  // screen its height, and 76 pt pushed the ways in below the fold.
  hero: { ...typo.hero, ...typo.mono, fontSize: 60, letterSpacing: -2.5, color: colors.text },
  heroLabel: { paddingBottom: space.sm },
  heroUnit: { fontSize: 16, fontWeight: '400', color: colors.textDim },
  heroSub: { fontSize: 12, color: colors.textFaint, letterSpacing: 0.4 },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceHigh, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent, borderRadius: radius.pill },
  statRow: { flexDirection: 'row', gap: space.lg, flexWrap: 'wrap' },
  stat: { fontSize: 14, color: colors.textDim },
  statValue: { ...typo.mono, color: colors.text, fontWeight: '500' },
  statDone: { fontSize: 14, color: colors.textDim },

  content: { padding: space.lg, gap: space.lg },
  loader: { marginTop: space.md },

  line: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 56,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.accent,
  },
  lineInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: space.md },
  lineSend: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  lineSendDisabled: { backgroundColor: colors.surfaceHigh },

  captureRow: { flexDirection: 'row', gap: space.sm },
  captureTile: {
    flex: 1,
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  captureTilePrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  captureLabel: { fontSize: 14, fontWeight: '600', color: colors.text },
  captureLabelPrimary: { color: colors.bg },

  linkRow: { flexDirection: 'row', gap: space.sm, marginTop: -space.sm },
  linkChip: {
    flex: 1,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  linkText: { fontSize: 14, fontWeight: '500', color: colors.textDim },

  emptyHint: { ...typo.bodyDim, color: colors.textDim, lineHeight: 22, textAlign: 'center', paddingHorizontal: space.md },

  section: { gap: space.sm },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.sm },
  sectionTitle: { ...typo.label, color: colors.textFaint },
  sectionHint: { fontSize: 11, color: colors.textFaint, flexShrink: 1, textAlign: 'right' },

  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    // Two columns: a staple is a word or two, and a thumb reaches both.
    width: '48.8%',
    minHeight: 84,
    justifyContent: 'space-between',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  tileTop: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  tileName: { flex: 1, fontSize: 15, fontWeight: '500', color: colors.text },

  card: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  cardPad: { padding: space.lg },
  groupDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  slotHeading: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textDim,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
  },
  mealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    gap: space.md,
  },
  libraryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 60,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    gap: space.md,
  },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowPressed: { backgroundColor: colors.surfaceHigh },
  mealText: { flex: 1, gap: 2 },
  rowName: { ...typo.body, color: colors.text },
  rowMacros: { fontSize: 13, color: colors.textDim, ...typo.mono },
  rowProtein: { color: colors.text },
  muted: { ...typo.bodyDim, color: colors.textFaint },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
  },
  searchInput: { flex: 1, color: colors.text, fontSize: 16, paddingVertical: space.sm },

  toast: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '86%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHigh,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  toastText: { fontSize: 15, fontWeight: '500', color: colors.text, flexShrink: 1 },

  error: { color: colors.danger, fontSize: 14 },
  pressed: { opacity: 0.7 },

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
  slotText: { fontSize: 13, fontWeight: '600', color: colors.textDim },
  slotTextActive: { color: colors.accent },

  saveToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  saveText: { fontSize: 15, fontWeight: '600', color: colors.textDim },
  saveTextOn: { color: colors.text },
});
