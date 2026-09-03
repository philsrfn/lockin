import { useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, api } from '../src/api/client';
import type { FridgeItem, MealPlan } from '../src/api/types';
import { Button } from '../src/components/Button';
import { t } from '../src/lib/locale';
import { Card } from '../src/components/Card';
import { colors, radius, space, type as typo } from '../src/theme';

type Stage = 'camera' | 'confirm' | 'plan';

/**
 * §9: photo → inventory → **confirm** → plan.
 *
 * The confirm step is not a formality. Vision mis-reads things, and a
 * mis-detected ingredient becomes a meal he cannot actually cook. Nothing is
 * planned until the list has been through his hands.
 */
export default function FridgeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);

  const [stage, setStage] = useState<Stage>('camera');
  const [items, setItems] = useState<FridgeItem[]>([]);
  const [plan, setPlan] = useState<MealPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function capture() {
    if (!camera.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Quality 0.35 keeps the base64 payload well inside the 12MB body limit.
      // Vision does not need a 12-megapixel image, and a smaller one is the
      // difference between a usable upload and a timeout on a phone network.
      const photo = await camera.current.takePictureAsync({ base64: true, quality: 0.35 });
      if (!photo?.base64) throw new Error('No image');

      const result = await api<{ items: FridgeItem[] }>('/fridge/read', {
        method: 'POST',
        body: { imageBase64: photo.base64, mimeType: 'image/jpeg' },
        timeoutMs: 90_000,
      });
      setItems(result.items);
      setStage('confirm');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not read that photo');
    } finally {
      setBusy(false);
    }
  }

  async function makePlan() {
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ plan: MealPlan }>('/fridge/plan', {
        method: 'POST',
        body: { items: items.filter((item) => item.name.trim()), confirmed: true },
        timeoutMs: 120_000,
      });
      setPlan(result.plan);
      setStage('plan');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not plan from that');
    } finally {
      setBusy(false);
    }
  }

  async function logMeal(index: number) {
    const meal = plan?.meals[index];
    if (!meal) return;
    await api('/meals', {
      method: 'POST',
      body: {
        slot: meal.slot,
        description: meal.name,
        kcal: meal.kcal,
        proteinG: meal.proteinG,
        fatG: meal.fatG,
        carbsG: meal.carbsG,
      },
    });
    setPlan({ ...plan!, meals: plan!.meals.filter((_, i) => i !== index) });
  }

  if (stage === 'camera') {
    return (
      <View style={styles.cameraRoot}>
        {!permission?.granted ? (
          <View style={[styles.centred, { paddingTop: insets.top + space.xxl }]}>
            <Text style={styles.title}>Photograph the fridge</Text>
            <Text style={styles.body}>
              lockin reads what is in there and plans around it. The photo is sent to be read and
              then discarded — nothing is stored.
            </Text>
            <Button title="Allow camera" onPress={requestPermission} />
            <Button title="Back" variant="ghost" onPress={() => router.back()} />
          </View>
        ) : (
          <>
            <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />
            <View style={[styles.cameraOverlay, { paddingBottom: insets.bottom + space.lg, paddingTop: insets.top + space.md }]}>
              <Text style={styles.hint}>Open the door, get the shelves in frame</Text>
              <View style={{ gap: space.sm }}>
                {error ? <Text style={styles.errorLight}>{error}</Text> : null}
                <Button title={busy ? 'Reading…' : 'Take the photo'} onPress={capture} disabled={busy} />
                <Pressable onPress={() => router.back()} style={styles.cancel}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          </>
        )}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + space.md, paddingBottom: insets.bottom + space.xxl },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>{t('backToTodayShort')}</Text>
        </Pressable>

        {stage === 'confirm' ? (
          <>
            <Text style={styles.title}>What it saw</Text>
            <Text style={styles.body}>
              Fix anything wrong before planning. A wrong ingredient here becomes a meal you cannot
              cook.
            </Text>

            <Card label="IN THE FRIDGE">
              {items.map((item, index) => (
                <View key={index} style={styles.itemRow}>
                  <TextInput
                    value={item.name}
                    onChangeText={(text) =>
                      setItems(items.map((it, i) => (i === index ? { ...it, name: text } : it)))
                    }
                    style={[styles.input, styles.itemName]}
                  />
                  <TextInput
                    value={item.estimatedQty}
                    onChangeText={(text) =>
                      setItems(items.map((it, i) => (i === index ? { ...it, estimatedQty: text } : it)))
                    }
                    style={[styles.input, styles.itemQty]}
                  />
                  <Pressable
                    onPress={() => setItems(items.filter((_, i) => i !== index))}
                    hitSlop={10}
                    style={styles.remove}
                  >
                    <Text style={styles.removeText}>✕</Text>
                  </Pressable>
                </View>
              ))}
              <Button
                title="Add something it missed"
                variant="ghost"
                onPress={() =>
                  setItems([...items, { name: '', estimatedQty: '', confidence: 'high' }])
                }
              />
            </Card>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button
              title={busy ? 'Planning…' : 'Plan from this'}
              onPress={makePlan}
              disabled={busy || items.length === 0}
            />
            <Button title="Retake the photo" variant="ghost" onPress={() => setStage('camera')} />
          </>
        ) : null}

        {stage === 'plan' && plan ? (
          <>
            <Text style={styles.title}>What to cook</Text>
            <Text style={styles.body}>For what is left of today, not a whole day.</Text>

            {plan.meals.length === 0 ? (
              <Card label="DONE">
                <Text style={styles.body}>Everything logged. Nothing left to cook.</Text>
              </Card>
            ) : (
              plan.meals.map((meal, index) => (
                <Card key={index} label={meal.slot.toUpperCase()}>
                  <Text style={styles.mealName}>{meal.name}</Text>
                  <View style={styles.macroRow}>
                    <Text style={styles.macroHero}>{meal.proteinG}g protein</Text>
                    <Text style={styles.macroDim}>
                      {meal.kcal} kcal · {meal.fatG}g fat · {meal.carbsG}g carbs
                    </Text>
                  </View>
                  <Text style={styles.method}>{meal.method}</Text>
                  {meal.usesFromFridge.length > 0 ? (
                    <Text style={styles.uses}>Uses: {meal.usesFromFridge.join(', ')}</Text>
                  ) : null}
                  <Button title="Log this" variant="secondary" onPress={() => logMeal(index)} />
                </Card>
              ))
            )}

            {plan.note ? <Text style={styles.footnote}>{plan.note}</Text> : null}
            <Button title="Start over" variant="ghost" onPress={() => setStage('camera')} />
          </>
        ) : null}

        {busy ? <ActivityIndicator color={colors.textFaint} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.lg, gap: space.md },
  cameraRoot: { flex: 1, backgroundColor: '#000' },
  cameraOverlay: {
    flex: 1,
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
  },
  centred: { flex: 1, padding: space.lg, gap: space.lg },

  back: { ...typo.body, color: colors.textDim },
  title: { fontSize: 28, fontWeight: '300', color: colors.text },
  body: { ...typo.bodyDim, color: colors.textDim, lineHeight: 21 },
  hint: {
    ...typo.body,
    color: '#fff',
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  cancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 16, fontWeight: '600', color: '#fff' },

  itemRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: space.md,
    color: colors.text,
    fontSize: 15,
  },
  itemName: { flex: 2 },
  itemQty: { flex: 1 },
  remove: { width: 28, alignItems: 'center' },
  removeText: { color: colors.textFaint, fontSize: 16 },

  mealName: { fontSize: 19, fontWeight: '400', color: colors.text },
  macroRow: { gap: 2 },
  macroHero: { fontSize: 17, fontWeight: '400', color: colors.accent },
  macroDim: { fontSize: 13, color: colors.textDim },
  method: { ...typo.bodyDim, color: colors.text, lineHeight: 21 },
  uses: { fontSize: 13, color: colors.textFaint },

  footnote: { fontSize: 13, color: colors.textFaint, lineHeight: 19 },
  error: { color: colors.danger, fontSize: 14 },
  errorLight: { color: '#fff', fontSize: 14, textAlign: 'center' },
});
