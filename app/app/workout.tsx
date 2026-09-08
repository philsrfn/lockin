import { useMemo, useState } from 'react';
import { t } from '../src/lib/locale';
import { useRouter } from 'expo-router';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ExercisePrescription } from '../src/api/types';
import { Button } from '../src/components/Button';
import { RestTimer } from '../src/components/RestTimer';
import { RirChips } from '../src/components/RirChips';
import { Stepper } from '../src/components/Stepper';
import { kg, performedLine } from '../src/lib/format';
import { colors, radius, space, type as typo } from '../src/theme';
import { useWorkout } from '../src/workout/useWorkout';

/** No history for a movement: start light and let hold-to-repeat do the rest. */
const UNKNOWN_START_KG = 20;

type Draft = { weightKg: number; reps: number; rir: number | null };

export default function WorkoutScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const workout = useWorkout();

  const [index, setIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [rest, setRest] = useState<{ startedAt: number; seconds: number } | null>(null);
  const [finishing, setFinishing] = useState(false);

  const exercises = workout.plan?.exercises ?? [];
  const exercise = exercises[Math.min(index, Math.max(0, exercises.length - 1))];

  const draft = useMemo<Draft>(() => {
    if (!exercise) return { weightKg: UNKNOWN_START_KG, reps: 10, rir: null };
    return (
      drafts[exercise.exerciseId] ?? {
        weightKg: exercise.weightKg ?? UNKNOWN_START_KG,
        reps: exercise.targetReps,
        rir: null,
      }
    );
  }, [drafts, exercise]);

  function updateDraft(patch: Partial<Draft>) {
    if (!exercise) return;
    setDrafts((current) => ({
      ...current,
      [exercise.exerciseId]: { ...draft, ...patch },
    }));
  }

  if (workout.loading || !exercise) {
    return (
      <View style={[styles.centred, { paddingTop: insets.top }]}>
        <Text style={styles.dim}>{workout.error ?? 'Getting your session ready…'}</Text>
        {workout.error ? (
          <Button title={t('back')} variant="secondary" onPress={() => router.back()} />
        ) : null}
      </View>
    );
  }

  const logged = workout.setsFor(exercise.exerciseId);
  const setNumber = logged.length + 1;
  const complete = logged.length >= exercise.sets;

  function confirmSet() {
    if (!exercise) return;
    // Not awaited: the set is already on disk. Waiting on a request here is
    // exactly the pause this screen exists to avoid.
    workout.logSet({
      exerciseId: exercise.exerciseId,
      weightKg: draft.weightKg,
      reps: draft.reps,
      rir: draft.rir,
    });
    // Rest starts on its own; the draft stays put so the next set is one tap.
    setRest({ startedAt: Date.now(), seconds: exercise.restSeconds });
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + space.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.headerButton}>
          <Text style={styles.headerAction}>CLOSE</Text>
        </Pressable>
        {/* The day's name, not its code: 'Push' reads, 'DAY Push' does not. */}
        <Text style={styles.headerTitle}>
          {(workout.plan?.dayName ?? '').toUpperCase()}
        </Text>
        <Pressable onPress={() => setFinishing(true)} hitSlop={12} style={styles.headerButton}>
          <Text style={[styles.headerAction, styles.headerFinish]}>{t('finishSession')}</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        // Without flexGrow:0 a horizontal ScrollView expands to fill the
        // column and pushes the exercise off the first screen.
        style={styles.pillsRow}
        contentContainerStyle={styles.pills}
      >
        {exercises.map((item, itemIndex) => {
          const done = workout.setsFor(item.exerciseId).length >= item.sets;
          const active = itemIndex === index;
          return (
            <Pressable
              key={item.exerciseId}
              onPress={() => setIndex(itemIndex)}
              style={[styles.pill, active && styles.pillActive, done && styles.pillDone]}
            >
              <Text
                style={[styles.pillText, active && styles.pillTextActive, done && styles.pillTextDone]}
                numberOfLines={1}
              >
                {done ? '✓ ' : ''}
                {item.name}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: insets.bottom + space.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        {workout.stale ? (
          <Text style={styles.offline}>
            {t('offlineLastPlan')}
          </Text>
        ) : null}

        <View style={styles.titleBlock}>
          <Text style={styles.exerciseName}>{exercise.name}</Text>
          <Text style={styles.target}>
            {exercise.sets}×{exercise.targetReps}
            {exercise.weightKg != null ? ` @ ${kg(exercise.weightKg)}kg` : ''}
            {' · '}
            {REASONS[exercise.reason]}
          </Text>
          {exercise.last ? (
            <Text style={styles.lastLine}>last: {performedLine(exercise.last.sets)}</Text>
          ) : (
            <Text style={styles.lastLine}>{t('noHistoryYet')}</Text>
          )}
        </View>

        <Stepper
          value={draft.weightKg}
          unit="kg"
          step={exercise.incrementKg}
          decimals={exercise.incrementKg < 2.5 ? 2 : 1}
          onChange={(weightKg) => updateDraft({ weightKg })}
        />

        <Stepper
          value={draft.reps}
          unit="reps"
          step={1}
          min={1}
          max={100}
          onChange={(reps) => updateDraft({ reps })}
        />

        <RirChips value={draft.rir} onChange={(rir) => updateDraft({ rir })} />

        <Button
          title={complete ? `Log extra set ${setNumber}` : `Log set ${setNumber} of ${exercise.sets}`}
          onPress={confirmSet}
        />

        {rest ? (
          <RestTimer
            startedAt={rest.startedAt}
            seconds={rest.seconds}
            onDismiss={() => setRest(null)}
          />
        ) : null}

        {logged.length > 0 ? (
          <View style={styles.loggedBlock}>
            {logged.map((set) => (
              <View key={set.clientId} style={styles.loggedRow}>
                <Text style={styles.loggedIndex}>{set.setIndex}</Text>
                <Text style={styles.loggedText}>
                  {kg(set.weightKg)} kg × {set.reps}
                  {set.rir != null ? `  ·  ${set.rir} RIR` : ''}
                </Text>
                {set.sync === 'queued' ? <Text style={styles.pending}>{t('queued')}</Text> : null}
                {set.sync === 'failed' ? <Text style={styles.failed}>{t('notSaved')}</Text> : null}
              </View>
            ))}
            <Pressable onPress={() => workout.undoLastSet(exercise.exerciseId)} hitSlop={8}>
              <Text style={styles.undo}>{t('undoLastSet')}</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.footerActions}>
          <SwapButton exercise={exercise} onSwap={workout.swap} />
          {index < exercises.length - 1 ? (
            <Button
              title={t('nextExercise')}
              variant="secondary"
              style={styles.flex}
              onPress={() => {
                setIndex(index + 1);
                setRest(null);
              }}
            />
          ) : null}
        </View>

        {workout.pending > 0 ? (
          <Text style={styles.offline}>
            {workout.pending} write{workout.pending === 1 ? '' : 's'} waiting on the server. Saved
            on the phone either way — keep going.
          </Text>
        ) : null}

        {workout.failed > 0 ? (
          <Text style={styles.failedNotice}>
            {workout.failed} write{workout.failed === 1 ? '' : 's'} the server refused. Still on
            this phone, but not in your history — worth a look after the session.
          </Text>
        ) : null}
      </ScrollView>

      <FinishSheet
        visible={finishing}
        onCancel={() => setFinishing(false)}
        onFinish={async (result) => {
          await workout.finish(result);
          setFinishing(false);
          router.back();
        }}
      />
    </View>
  );
}

const REASONS: Record<ExercisePrescription['reason'], string> = {
  first_time: 'first time',
  increase_load: 'add weight',
  increase_reps: 'one more rep',
  hold: 'hold',
  deload: 'deload',
  joint_pain: 'load cut — joint pain',
};

function SwapButton({
  exercise,
  onSwap,
}: {
  exercise: ExercisePrescription;
  onSwap: (from: number, to: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  if (exercise.substitutes.length === 0) return null;

  return (
    <>
      <Button title={t('swapExercise')} variant="secondary" style={styles.flex} onPress={() => setOpen(true)} />
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
            <Text style={styles.sheetLabel}>SWAP {exercise.name.toUpperCase()} FOR</Text>
            {exercise.substitutes.map((substitute) => (
              <Pressable
                key={substitute.id}
                onPress={async () => {
                  await onSwap(exercise.exerciseId, substitute.id);
                  setOpen(false);
                }}
                style={({ pressed }) => [styles.sheetOption, pressed && styles.pressed]}
              >
                <Text style={styles.sheetOptionText}>{substitute.name}</Text>
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

function FinishSheet({
  visible,
  onCancel,
  onFinish,
}: {
  visible: boolean;
  onCancel: () => void;
  onFinish: (result: { rpe: number; jointPain: boolean; notes?: string }) => Promise<void>;
}) {
  const [rpe, setRpe] = useState(7);
  const [jointPain, setJointPain] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.sheetLabel}>{t('howHardWasThat')}</Text>
          {/* Chips rather than a slider: no extra dependency, and easier to hit. */}
          <View style={styles.rpeRow}>
            {[5, 6, 7, 8, 9, 10].map((value) => (
              <Pressable
                key={value}
                onPress={() => setRpe(value)}
                style={[styles.rpeChip, rpe === value && styles.rpeChipActive]}
              >
                <Text style={[styles.rpeText, rpe === value && styles.rpeTextActive]}>{value}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.rpeHint}>{RPE_HINTS[rpe] ?? ''}</Text>

          <Pressable
            onPress={() => setJointPain((current) => !current)}
            style={[styles.toggle, jointPain && styles.toggleActive]}
          >
            <Text style={[styles.toggleText, jointPain && styles.toggleTextActive]}>
              {jointPain ? '✓  Joint pain' : 'Joint pain'}
            </Text>
            <Text style={styles.toggleHint}>{t('jointHint')}</Text>
          </Pressable>

          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder={t('sessionNotePlaceholder')}
            placeholderTextColor={colors.textFaint}
            style={styles.notes}
            multiline
          />

          <Button
            title={saving ? 'Saving…' : 'Finish session'}
            disabled={saving}
            onPress={async () => {
              setSaving(true);
              try {
                await onFinish({ rpe, jointPain, notes: notes.trim() || undefined });
              } finally {
                setSaving(false);
              }
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const RPE_HINTS: Record<number, string> = {
  5: 'easy — plenty left',
  6: 'comfortable',
  7: 'solid working session',
  8: 'hard, a couple of reps left in most sets',
  9: 'very hard, close to failure',
  10: 'nothing left',
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  centred: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    padding: space.xl,
  },
  dim: { ...typo.body, color: colors.textDim, textAlign: 'center' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.md,
  },
  headerButton: { minWidth: 64, minHeight: 32, justifyContent: 'center' },
  headerTitle: { ...typo.label, color: colors.textDim },
  headerAction: { ...typo.label, color: colors.textFaint },
  headerFinish: { color: colors.text, textAlign: 'right' },

  pillsRow: { flexGrow: 0, flexShrink: 0 },
  pills: { paddingHorizontal: space.lg, gap: space.sm, paddingBottom: space.md },
  pill: {
    paddingHorizontal: space.sm,
    height: 34,
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
    maxWidth: 190,
  },
  pillActive: { borderBottomColor: colors.text },
  pillDone: {},
  pillText: { fontSize: 14, fontWeight: '400', color: colors.textFaint },
  pillTextActive: { color: colors.text },
  pillTextDone: { color: colors.accent },

  body: { paddingHorizontal: space.lg, gap: space.md },
  titleBlock: { gap: space.xs, marginBottom: space.xs },
  exerciseName: { fontSize: 30, fontWeight: '300', color: colors.text, letterSpacing: -1 },
  target: { ...typo.body, color: colors.textDim },
  lastLine: { fontSize: 14, color: colors.textFaint },

  loggedBlock: {
    gap: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.md,
  },
  loggedRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  loggedIndex: {
    width: 18,
    color: colors.textFaint,
    fontSize: 12,
    ...typo.mono,
  },
  loggedText: { fontSize: 15, ...typo.mono, color: colors.text, flex: 1 },
  pending: { fontSize: 10, fontWeight: '600', letterSpacing: 1, color: colors.accent },
  failed: { fontSize: 12, fontWeight: '400', color: colors.danger },
  failedNotice: { fontSize: 13, color: colors.danger, lineHeight: 19 },
  undo: { fontSize: 14, color: colors.textFaint, paddingTop: space.xs },

  footerActions: { flexDirection: 'row', gap: space.sm },
  flex: { flex: 1 },
  offline: { fontSize: 13, color: colors.warn, lineHeight: 19 },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
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
  sheetLabel: { ...typo.label, color: colors.textFaint },
  sheetOption: { minHeight: 56, justifyContent: 'center', paddingHorizontal: space.md },
  sheetOptionText: { fontSize: 17, fontWeight: '400', color: colors.text },
  pressed: { opacity: 0.7 },

  rpeRow: { flexDirection: 'row', gap: space.sm },
  rpeChip: {
    flex: 1,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rpeChipActive: { borderBottomColor: colors.accent, borderBottomWidth: 2 },
  rpeText: { fontSize: 22, fontWeight: '300', color: colors.textFaint },
  rpeTextActive: { color: colors.accent },
  rpeHint: { fontSize: 14, color: colors.textFaint, marginTop: -space.sm },

  toggle: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: space.md,
    gap: 2,
  },
  toggleActive: { borderColor: colors.danger },
  toggleText: { fontSize: 16, fontWeight: '400', color: colors.textDim },
  toggleTextActive: { color: colors.danger },
  toggleHint: { fontSize: 13, color: colors.textFaint },

  notes: {
    minHeight: 72,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceHigh,
    padding: space.md,
    color: colors.text,
    fontSize: 15,
    textAlignVertical: 'top',
  },
});
