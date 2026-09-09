import { useCallback, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../src/api/client';
import type { Exercise, ProgramWithSlots } from '../src/api/types';
import { Button } from '../src/components/Button';
import { Card, Rule } from '../src/components/Card';
import { Screen } from '../src/components/Screen';
import { Stepper } from '../src/components/Stepper';
import { t } from '../src/lib/locale';
import {
  DEFAULT_RANGE,
  type Draft,
  type DraftProblem,
  MAX_DAYS,
  MAX_SETS,
  MAX_SLOTS_PER_DAY,
  REP_RANGES,
  addDay,
  addSlot,
  describeSlot,
  draftFrom,
  firstProblem,
  moveSlot,
  removeDay,
  removeSlot,
  rename,
  renameDay,
  replaceSlot,
  toSaveBody,
  updateSlot,
} from '../src/lib/programmeDraft';
import { colors, radius, space, type as typo } from '../src/theme';
import { messageFor } from '../src/lib/apiError';

/** The order a programme is usually written in, big movements first. */
const PATTERNS = [
  { pattern: 'squat', label: 'patternSquat' },
  { pattern: 'hinge', label: 'patternHinge' },
  { pattern: 'h_push', label: 'patternHPush' },
  { pattern: 'v_push', label: 'patternVPush' },
  { pattern: 'h_pull', label: 'patternHPull' },
  { pattern: 'v_pull', label: 'patternVPull' },
  { pattern: 'iso', label: 'patternIso' },
] as const;

const PROBLEM_TEXT: Record<DraftProblem, Parameters<typeof t>[0]> = {
  name_missing: 'programmeNeedsName',
  no_days: 'programmeNeedsDays',
  day_name_missing: 'programmeNeedsWork',
  day_empty: 'programmeNeedsWork',
  duplicate_exercise: 'programmeDuplicate',
};

/**
 * Building a training plan that is yours.
 *
 * §14 said not to build a programme builder, and for one athlete with one
 * rotation that was right. It stopped being right the moment other people
 * started using this: somebody standing in a gym with friends who train Pull
 * today is not helped by three presets chosen around somebody else's gym.
 *
 * The whole programme is saved at once rather than edit by edit. That is not
 * laziness about round trips — it is what makes the form safe. Moving a
 * movement, renaming a day and changing a rep range are one intention, and a
 * server that applies two of the three leaves a plan nobody meant to write.
 */
export default function ProgrammeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const programId = Number(params.id);

  const [program, setProgram] = useState<ProgramWithSlots | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The slot whose sets and reps are open. */
  const [tuning, setTuning] = useState<{ dayIndex: number; slotIndex: number } | null>(null);
  /** Picking a movement — for a new slot, or to replace the one at slotIndex. */
  const [picking, setPicking] = useState<{ dayIndex: number; slotIndex: number | null } | null>(
    null,
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const load = useCallback(async () => {
    if (!Number.isFinite(programId)) return;
    try {
      const [{ program: loaded }, { exercises: library }] = await Promise.all([
        api<{ program: ProgramWithSlots }>(`/programs/${programId}`),
        api<{ exercises: Exercise[] }>('/exercises'),
      ]);
      setProgram(loaded);
      setDraft(draftFrom(loaded));
      setExercises(library);
      setError(null);
    } catch (caught) {
      setError(messageFor(caught, 'couldNotLoadProgramme'));
    } finally {
      setLoading(false);
    }
  }, [programId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/programs/${programId}`, { method: 'PUT', body: toSaveBody(draft) });
      router.back();
    } catch (caught) {
      // The server's validator is the authority — `firstProblem` only decides
      // whether the button is pressable — so whatever it says is what shows.
      setError(messageFor(caught, 'couldNotSaveProgramme'));
      setBusy(false);
    }
  }

  async function destroy() {
    setBusy(true);
    setError(null);
    try {
      await api(`/programs/${programId}`, { method: 'DELETE' });
      router.back();
    } catch (caught) {
      // Refused while it is the programme you are on, and that refusal is
      // worth reading rather than swallowing.
      setError(messageFor(caught, 'couldNotDeleteProgramme'));
      setConfirmingDelete(false);
      setBusy(false);
    }
  }

  /** A built-in belongs to everybody, so editing it means taking a copy. */
  async function fork() {
    if (!program) return;
    setBusy(true);
    try {
      const { program: created } = await api<{ program: { id: number } }>('/programs', {
        method: 'POST',
        body: { name: program.name, fromProgramId: program.id },
      });
      router.replace(`/programme?id=${created.id}`);
    } catch (caught) {
      setError(messageFor(caught, 'couldNotSaveProgramme'));
      setBusy(false);
    }
  }

  const problem = draft ? firstProblem(draft) : 'no_days';

  return (
    <Screen keyboardAware>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>‹ {t('back')}</Text>
        </Pressable>
      </View>

      {loading ? <Text style={styles.dim}>{t('loading')}</Text> : null}

      {program && !program.mine ? (
        <Card label={program.name}>
          <Text style={styles.blurb}>{t('builtInProgramme')}</Text>
          <Button title={t('forkThis')} onPress={() => void fork()} disabled={busy} />
        </Card>
      ) : null}

      {draft && program?.mine ? (
        <>
          <View style={styles.nameBlock}>
            <Text style={styles.label}>{t('programmeName')}</Text>
            <TextInput
              value={draft.name}
              onChangeText={(next) => setDraft(rename(draft, next))}
              style={styles.nameInput}
              placeholder={t('newProgrammeName')}
              placeholderTextColor={colors.textFaint}
              // A programme is called what its owner calls it. Autocorrect
              // rewrites "PPL mit Tarnas" and spellcheck underlines it in red,
              // both of which treat a name as a misspelt sentence.
              autoCorrect={false}
              spellCheck={false}
            />
          </View>

          {draft.days.map((day, dayIndex) => (
            <Card key={day.code ?? `new-${dayIndex}`} label={t('dayNumber', { n: dayIndex + 1 })}>
              <TextInput
                value={day.name}
                onChangeText={(next) => setDraft(renameDay(draft, dayIndex, next))}
                placeholder={t('dayName')}
                placeholderTextColor={colors.textFaint}
                style={styles.dayInput}
                autoCorrect={false}
                spellCheck={false}
              />

              {day.slots.length === 0 ? (
                <Text style={styles.dim}>{t('noExercisesInDay')}</Text>
              ) : (
                day.slots.map((slot, slotIndex) => (
                  <View key={`${slot.exerciseId}-${slotIndex}`}>
                    {slotIndex > 0 ? <Rule /> : null}
                    <Pressable
                      onPress={() => setTuning({ dayIndex, slotIndex })}
                      style={({ pressed }) => [styles.slot, pressed && styles.pressed]}
                    >
                      <Text style={styles.slotName} numberOfLines={1}>
                        {slot.exerciseName}
                      </Text>
                      <Text style={styles.slotReps}>{describeSlot(slot)}</Text>
                    </Pressable>
                  </View>
                ))
              )}

              <View style={styles.dayActions}>
                <Pressable
                  onPress={() => setPicking({ dayIndex, slotIndex: null })}
                  disabled={day.slots.length >= MAX_SLOTS_PER_DAY}
                  hitSlop={8}
                >
                  <Text
                    style={[
                      styles.action,
                      day.slots.length >= MAX_SLOTS_PER_DAY && styles.actionOff,
                    ]}
                  >
                    {t('addExercise')}
                  </Text>
                </Pressable>
                <Pressable onPress={() => setDraft(removeDay(draft, dayIndex))} hitSlop={8}>
                  <Text style={styles.actionQuiet}>{t('removeDay')}</Text>
                </Pressable>
              </View>
            </Card>
          ))}

          {draft.days.length < MAX_DAYS ? (
            <Button
              title={t('addDay')}
              variant="secondary"
              onPress={() => setDraft(addDay(draft, t('newDayName')))}
            />
          ) : null}

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {problem ? <Text style={styles.dim}>{t(PROBLEM_TEXT[problem])}</Text> : null}

          <Button
            title={busy ? t('saving') : t('saveProgramme')}
            onPress={() => void save()}
            disabled={busy || problem !== null}
          />

          {confirmingDelete ? (
            <View style={styles.confirm}>
              <Text style={styles.blurb}>{t('deleteProgrammeAsk')}</Text>
              <Button title={t('deleteProgramme')} variant="danger" onPress={() => void destroy()} />
              <Button title={t('cancel')} variant="ghost" onPress={() => setConfirmingDelete(false)} />
            </View>
          ) : (
            <Button
              title={t('deleteProgramme')}
              variant="ghost"
              onPress={() => setConfirmingDelete(true)}
            />
          )}
        </>
      ) : null}

      {error && !draft ? <Text style={styles.error}>{error}</Text> : null}

      <SlotSheet
        slot={
          tuning && draft ? (draft.days[tuning.dayIndex]?.slots[tuning.slotIndex] ?? null) : null
        }
        canMoveUp={tuning ? tuning.slotIndex > 0 : false}
        canMoveDown={
          tuning && draft
            ? tuning.slotIndex < (draft.days[tuning.dayIndex]?.slots.length ?? 0) - 1
            : false
        }
        onChange={(patch) => {
          if (!tuning || !draft) return;
          setDraft(updateSlot(draft, tuning.dayIndex, tuning.slotIndex, patch));
        }}
        onMove={(direction) => {
          if (!tuning || !draft) return;
          setDraft(moveSlot(draft, tuning.dayIndex, tuning.slotIndex, direction));
          setTuning({ ...tuning, slotIndex: tuning.slotIndex + direction });
        }}
        onReplace={() => {
          if (!tuning) return;
          setPicking({ dayIndex: tuning.dayIndex, slotIndex: tuning.slotIndex });
          setTuning(null);
        }}
        onRemove={() => {
          if (!tuning || !draft) return;
          setDraft(removeSlot(draft, tuning.dayIndex, tuning.slotIndex));
          setTuning(null);
        }}
        onClose={() => setTuning(null)}
      />

      <ExercisePicker
        visible={picking !== null}
        exercises={exercises}
        // Dimmed rather than hidden: "it is already on this day" is a better
        // answer than a movement that has vanished from the library.
        used={
          picking && draft
            ? (draft.days[picking.dayIndex]?.slots.map((slot) => slot.exerciseId) ?? [])
            : []
        }
        onPick={(exercise) => {
          if (!picking || !draft) return;
          setDraft(
            picking.slotIndex === null
              ? addSlot(draft, picking.dayIndex, exercise)
              : replaceSlot(draft, picking.dayIndex, picking.slotIndex, exercise),
          );
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </Screen>
  );
}

/** Sets, reps, order and removal for one movement. */
function SlotSheet({
  slot,
  canMoveUp,
  canMoveDown,
  onChange,
  onMove,
  onReplace,
  onRemove,
  onClose,
}: {
  slot: { exerciseName: string; sets: number; repMin: number; repMax: number } | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onChange: (patch: { sets?: number; repMin?: number; repMax?: number }) => void;
  onMove: (direction: -1 | 1) => void;
  onReplace: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={slot !== null} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <View style={styles.sheet}>
          {slot ? (
            <>
              <Text style={styles.sheetTitle}>{slot.exerciseName}</Text>

              <Text style={styles.label}>{t('setsLabel')}</Text>
              <Stepper
                value={slot.sets}
                unit={t('sets')}
                step={1}
                min={1}
                max={MAX_SETS}
                onChange={(sets) => onChange({ sets })}
              />

              {/*
                Chips rather than two number fields. Two fields let somebody
                type 12–8 and learn about it from a server error; six chips
                cannot express a range that is backwards.
              */}
              <Text style={styles.label}>{t('repsLabel')}</Text>
              <View style={styles.chips}>
                {REP_RANGES.map((range) => {
                  const on = range.min === slot.repMin && range.max === slot.repMax;
                  return (
                    <Pressable
                      key={`${range.min}-${range.max}`}
                      onPress={() => onChange({ repMin: range.min, repMax: range.max })}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>
                        {range.min}–{range.max}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Button title={t('replaceExercise')} variant="secondary" onPress={onReplace} />
              <View style={styles.moveRow}>
                <Button
                  title={t('moveUp')}
                  variant="ghost"
                  style={styles.flex}
                  disabled={!canMoveUp}
                  onPress={() => onMove(-1)}
                />
                <Button
                  title={t('moveDown')}
                  variant="ghost"
                  style={styles.flex}
                  disabled={!canMoveDown}
                  onPress={() => onMove(1)}
                />
              </View>
              <Button title={t('removeExercise')} variant="ghost" onPress={onRemove} />
            </>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/** The exercise library, grouped the way a programme is written. */
function ExercisePicker({
  visible,
  exercises,
  used,
  onPick,
  onClose,
}: {
  visible: boolean;
  exercises: Exercise[];
  used: number[];
  onPick: (exercise: Exercise) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  const needle = query.trim().toLowerCase();
  const matching = needle
    ? exercises.filter((exercise) => exercise.name.toLowerCase().includes(needle))
    : exercises;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => setQuery('')}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <View style={styles.pickerSheet}>
          <Text style={styles.label}>{t('pickExercise')}</Text>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('searchExercise')}
            placeholderTextColor={colors.textFaint}
            autoCorrect={false}
            style={styles.search}
          />

          <ScrollView keyboardShouldPersistTaps="handled" style={styles.pickerList}>
            {matching.length === 0 ? <Text style={styles.dim}>{t('noExerciseFound')}</Text> : null}

            {PATTERNS.map(({ pattern, label }) => {
              const group = matching.filter((exercise) => exercise.pattern === pattern);
              if (group.length === 0) return null;
              return (
                <View key={pattern} style={styles.group}>
                  <Text style={styles.groupLabel}>{t(label)}</Text>
                  {group.map((exercise) => {
                    const already = used.includes(exercise.id);
                    return (
                      <Pressable
                        key={exercise.id}
                        onPress={() => onPick(exercise)}
                        disabled={already}
                        style={({ pressed }) => [styles.pickRow, pressed && styles.pressed]}
                      >
                        <Text style={[styles.pickName, already && styles.pickNameOff]}>
                          {exercise.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              );
            })}
          </ScrollView>

          <Pressable onPress={onClose} style={styles.cancel} hitSlop={8}>
            <Text style={styles.cancelText}>{t('cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  back: { ...typo.body, color: colors.textDim },
  label: { ...typo.label, color: colors.textFaint },
  blurb: { fontSize: 14, color: colors.textBody, lineHeight: 20 },
  dim: { ...typo.bodyDim, color: colors.textFaint },
  error: { color: colors.danger, fontSize: 14 },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },

  nameBlock: { gap: space.sm },
  nameInput: {
    fontSize: 28,
    fontWeight: '300',
    letterSpacing: -0.5,
    color: colors.text,
    paddingVertical: 0,
  },
  dayInput: {
    ...typo.title,
    color: colors.text,
    paddingVertical: 0,
    marginBottom: space.xs,
  },

  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
    minHeight: 44,
  },
  slotName: { ...typo.body, color: colors.text, flexShrink: 1 },
  slotReps: { fontSize: 14, color: colors.textDim, ...typo.mono },

  dayActions: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: space.xs },
  action: { fontSize: 14, color: colors.accent },
  actionOff: { color: colors.textFaint },
  actionQuiet: { fontSize: 14, color: colors.textFaint },

  confirm: { gap: space.sm },

  backdrop: { flex: 1, justifyContent: 'flex-end' },
  backdropFill: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    paddingBottom: space.xxl,
    gap: space.md,
  },
  sheetTitle: { fontSize: 22, fontWeight: '400', color: colors.text },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: 44,
    paddingHorizontal: space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceHigh,
  },
  chipOn: { backgroundColor: colors.accentDeep },
  chipText: { ...typo.body, color: colors.textDim, ...typo.mono },
  chipTextOn: { color: colors.accent },

  moveRow: { flexDirection: 'row', gap: space.sm },

  pickerSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: space.lg,
    paddingBottom: space.xl,
    gap: space.md,
    maxHeight: '85%',
  },
  search: {
    minHeight: 52,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: space.lg,
    color: colors.text,
    fontSize: 16,
  },
  pickerList: { flexGrow: 0 },
  group: { paddingBottom: space.md },
  groupLabel: { ...typo.label, color: colors.textFaint, paddingBottom: space.xs },
  pickRow: { minHeight: 48, justifyContent: 'center' },
  pickName: { ...typo.body, color: colors.text },
  pickNameOff: { color: colors.textFaint },

  cancel: { alignItems: 'center', paddingTop: space.sm },
  cancelText: { ...typo.body, color: colors.textDim },
});
