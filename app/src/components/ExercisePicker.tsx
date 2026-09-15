import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Exercise } from '../api/types';
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
  onClose,
}: {
  visible: boolean;
  exercises: Exercise[];
  /** Already in the day, or already in the session. Shown, but not pickable. */
  used: number[];
  title?: PhraseKey;
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
        <View style={styles.sheet}>
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
                        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                      >
                        <Text style={[styles.name, already && styles.nameOff]}>{exercise.name}</Text>
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
  row: { minHeight: 48, justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  name: { ...typo.body, color: colors.text },
  nameOff: { color: colors.textFaint },
  cancel: { alignItems: 'center', paddingTop: space.sm },
  cancelText: { ...typo.body, color: colors.textDim },
});
