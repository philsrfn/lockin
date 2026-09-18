import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { api } from '../api/client';
import type { Exercise } from '../api/types';
import { exerciseImage } from '../lib/exerciseImages';
import { type PhraseKey, t } from '../lib/locale';
import { colors, radius, space, type as typo } from '../theme';

/**
 * The order movements are shown in, and the only order that reads like a
 * training plan rather than like a database table. Alphabetical would put
 * Barbell Bench Press next to Barbell Row, which are opposite halves of a
 * session.
 */
const PATTERNS: { pattern: string; label: PhraseKey }[] = [
  { pattern: 'squat', label: 'patternSquat' },
  { pattern: 'hinge', label: 'patternHinge' },
  { pattern: 'h_push', label: 'patternHPush' },
  { pattern: 'v_push', label: 'patternVPush' },
  { pattern: 'h_pull', label: 'patternHPull' },
  { pattern: 'v_pull', label: 'patternVPull' },
  { pattern: 'iso', label: 'patternIso' },
];

/**
 * Stand-ins for the photograph a movement somebody invented will never have.
 *
 * A blank tile made every custom row look like a picture that had failed to
 * load, and a single shared glyph made four of them look like one repeated
 * entry. So the row gets its own mark, picked from the name — which means it
 * is the same mark every time that movement is shown, on every screen and
 * after every reinstall. A random one per render would be worse than none:
 * the eye learns a shape and then cannot trust it.
 *
 * SF Symbols rather than an image, because the alternative is shipping
 * artwork for something we by definition have never seen.
 */
const CUSTOM_SYMBOLS: SymbolViewProps['name'][] = [
  'figure.strengthtraining.traditional',
  'figure.strengthtraining.functional',
  'figure.core.training',
  'figure.flexibility',
  'figure.cooldown',
  'figure.step.training',
  'figure.mixed.cardio',
  'figure.highintensity.intervaltraining',
];

/**
 * Deliberately the dullest hash there is. It has to agree with itself across
 * launches, not resist an attacker, and anything cleverer here would be a
 * dependency in exchange for nothing.
 */
function symbolFor(name: string): SymbolViewProps['name'] {
  let sum = 0;
  for (let at = 0; at < name.length; at += 1) sum = (sum * 31 + name.charCodeAt(at)) % 100_003;
  return CUSTOM_SYMBOLS[sum % CUSTOM_SYMBOLS.length]!;
}

/**
 * Pick a movement out of the library.
 *
 * Shared between the programme editor, which uses it to fill a day, and the
 * logger, which uses it to add something to a session in progress. They were
 * one picker copied twice for about a week; the copy that lived in the
 * editor grew a search box the other never got, which is exactly how two
 * screens end up disagreeing about what the exercise library contains.
 */
export function ExercisePicker({
  visible,
  exercises,
  used,
  title,
  onPick,
  onCreated,
  onClose,
}: {
  visible: boolean;
  exercises: Exercise[];
  /** Already in the day, or already in the session. Shown, but not pickable. */
  used: number[];
  title?: PhraseKey;
  onPick: (exercise: Exercise) => void;
  /**
   * Called with a movement this athlete just invented, before `onPick`, so the
   * screen can fold it into the library it is holding. Without it the row
   * would be picked and then rendered from a list that has never heard of it.
   *
   * Optional, and the create affordance only appears when it is given: a
   * screen that cannot absorb a new movement should not offer to make one.
   */
  onCreated?: (exercise: Exercise) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  /** The movement being invented, or null while browsing. */
  const [draft, setDraft] = useState<{ name: string; pattern: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const reset = () => {
    setQuery('');
    setDraft(null);
    setSaving(false);
    setFailed(null);
  };

  const needle = query.trim().toLowerCase();
  const matching = needle
    ? exercises.filter((exercise) => exercise.name.toLowerCase().includes(needle))
    : exercises;

  /**
   * Offered on an exact miss rather than on an empty list. Somebody typing
   * "curl" gets nine hits and no button; somebody typing "Zercher Squat" gets
   * none and the button is the whole point. The middle case — hits, but not
   * the one they meant — is why this keys on an exact name match and not on
   * `matching.length === 0`.
   */
  const canCreate =
    onCreated !== undefined &&
    needle.length > 0 &&
    !exercises.some((exercise) => exercise.name.toLowerCase() === needle);

  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setFailed(null);
    try {
      const { exercise } = await api<{ exercise: Exercise }>('/exercises', {
        method: 'POST',
        body: { name: draft.name.trim(), pattern: draft.pattern },
      });
      onCreated?.(exercise);
      onPick(exercise);
      reset();
    } catch (error) {
      setFailed((error as Error).message || t('createExerciseFailed'));
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} onShow={reset}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <View style={styles.sheet}>
          {draft ? (
            <>
              <Text style={styles.label}>{t('createExerciseTitle')}</Text>
              <TextInput
                value={draft.name}
                onChangeText={(name) => setDraft({ ...draft, name })}
                autoCorrect={false}
                autoFocus
                style={styles.search}
              />
              <Text style={styles.dim}>{t('createExerciseWhy')}</Text>
              <View style={styles.chips}>
                {PATTERNS.map(({ pattern, label }) => {
                  const on = draft.pattern === pattern;
                  return (
                    <Pressable
                      key={pattern}
                      onPress={() => setDraft({ ...draft, pattern })}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{t(label)}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {failed ? <Text style={styles.failed}>{failed}</Text> : null}
              <Pressable
                onPress={save}
                disabled={saving || draft.name.trim().length === 0}
                style={({ pressed }) => [
                  styles.create,
                  (saving || draft.name.trim().length === 0) && styles.createOff,
                  pressed && styles.pressed,
                ]}
              >
                {saving ? (
                  <ActivityIndicator color={colors.accentDeep} />
                ) : (
                  <Text style={styles.createText}>{t('createExerciseSave')}</Text>
                )}
              </Pressable>
              <Pressable onPress={() => setDraft(null)} style={styles.cancel} hitSlop={8}>
                <Text style={styles.cancelText}>{t('cancel')}</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.label}>{t(title ?? 'pickExercise')}</Text>
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('searchExercise')}
                placeholderTextColor={colors.textFaint}
                autoCorrect={false}
                style={styles.search}
              />

              <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
                {matching.length === 0 ? (
                  <Text style={styles.dim}>{t('noExerciseFound')}</Text>
                ) : null}

                {PATTERNS.map(({ pattern, label }) => {
                  const group = matching.filter((exercise) => exercise.pattern === pattern);
                  if (group.length === 0) return null;
                  return (
                    <View key={pattern} style={styles.group}>
                      <Text style={styles.groupLabel}>{t(label)}</Text>
                      {group.map((exercise) => {
                        const already = used.includes(exercise.id);
                        const thumbnail = exerciseImage(exercise.name);
                        return (
                          <Pressable
                            key={exercise.id}
                            onPress={() => onPick(exercise)}
                            disabled={already}
                            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                          >
                            {/*
                              A movement somebody invented has no photograph
                              and never will, so it gets a mark of its own
                              instead. The slot keeps its width either way —
                              otherwise every custom row sits forty pixels
                              left of the rest and the list looks broken
                              rather than incomplete.
                            */}
                            {thumbnail ? (
                              <Image source={thumbnail} style={styles.thumb} />
                            ) : (
                              <View style={[styles.thumb, styles.thumbGlyph]}>
                                <SymbolView
                                  name={symbolFor(exercise.name)}
                                  size={22}
                                  tintColor={already ? colors.textFaint : colors.accent}
                                  resizeMode="scaleAspectFit"
                                />
                              </View>
                            )}
                            <Text style={[styles.name, already && styles.nameOff]}>
                              {exercise.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}

                {canCreate ? (
                  <Pressable
                    onPress={() => setDraft({ name: query.trim(), pattern: 'iso' })}
                    style={({ pressed }) => [styles.createRow, pressed && styles.pressed]}
                  >
                    <Text style={styles.createRowText}>
                      {t('createExercise', { name: query.trim() })}
                    </Text>
                  </Pressable>
                ) : null}
              </ScrollView>

              <Pressable onPress={onClose} style={styles.cancel} hitSlop={8}>
                <Text style={styles.cancelText}>{t('cancel')}</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
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
    paddingBottom: space.xl,
    gap: space.md,
    maxHeight: '85%',
  },
  label: { ...typo.label, color: colors.textFaint },
  search: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: space.lg,
    color: colors.text,
    fontSize: 16,
  },
  list: { flexGrow: 0 },
  dim: { ...typo.body, color: colors.textDim },
  group: { paddingBottom: space.md },
  groupLabel: { ...typo.label, color: colors.textFaint, paddingBottom: space.xs },
  row: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: space.md },
  thumb: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.surfaceHigh },
  thumbGlyph: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  name: { ...typo.body, color: colors.text, flex: 1 },
  nameOff: { color: colors.textFaint },

  // The way out of a library that does not have what they came for.
  createRow: { minHeight: 48, justifyContent: 'center' },
  createRowText: { ...typo.body, color: colors.accent },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
  },
  chipOn: { backgroundColor: colors.accentSoft },
  chipText: { ...typo.body, color: colors.textDim },
  chipTextOn: { color: colors.accent },
  failed: { ...typo.body, color: colors.danger },
  create: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  createOff: { opacity: 0.4 },
  createText: { ...typo.body, color: colors.accentDeep, fontWeight: '600' },

  cancel: { alignItems: 'center', paddingTop: space.sm },
  cancelText: { ...typo.body, color: colors.textDim },
});
