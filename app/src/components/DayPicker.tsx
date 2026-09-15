import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { t } from '../lib/locale';
import { colors, radius, space, type as typo } from '../theme';

/**
 * Which day of the programme to train.
 *
 * The rotation proposes the next one and used to insist on it. That is fine
 * on a Tuesday alone in a gym and wrong the moment training is social:
 * somebody whose friends are doing Pull today will do Pull, and the only
 * question the app gets to answer is whether it is logged as Pull or as
 * whatever the rotation had in mind. The second answer quietly corrupts
 * months of progression, which is the thing this app is for.
 *
 * So the day is a choice. The rotation's pick is marked, not enforced.
 *
 * The last row is none of the programme's days. Some sessions are not a day
 * at all — a stranger's gym with none of the right machines, twenty minutes
 * before a train, a sport that is not lifting. Those used to be logged under
 * whichever day happened to be next, which is the same corruption in a
 * politer form: the progression then reads a improvised session as a failed
 * attempt at Pull. `null` says "no day", and the history stays honest.
 */
export function DayPicker({
  days,
  visible,
  onPick,
  onClose,
}: {
  days: { code: string; name: string; isToday: boolean }[];
  visible: boolean;
  /** `null` is the free session: a workout belonging to no programme day. */
  onPick: (code: string | null) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropFill} onPress={onClose} />
        <View style={styles.sheet}>
          <Text style={styles.label}>{t('whichSession')}</Text>

          {days.map((day) => (
            <Pressable
              key={day.code}
              onPress={() => onPick(day.code)}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <Text style={styles.name}>{day.name}</Text>
              {day.isToday ? <Text style={styles.suggested}>{t('suggested')}</Text> : null}
            </Pressable>
          ))}

          <Pressable
            onPress={() => onPick(null)}
            style={({ pressed }) => [styles.row, styles.free, pressed && styles.pressed]}
          >
            <View style={styles.freeText}>
              <Text style={styles.name}>{t('freeSession')}</Text>
              <Text style={styles.hint}>{t('freeSessionHint')}</Text>
            </View>
          </Pressable>

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
    paddingTop: space.lg,
    paddingBottom: space.xxl,
    paddingHorizontal: space.lg,
    gap: space.xs,
  },
  label: { ...typo.label, color: colors.textFaint, marginBottom: space.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 54,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
  },
  pressed: { opacity: 0.7 },
  free: { marginTop: space.sm, paddingVertical: space.sm },
  freeText: { gap: 2 },
  hint: { fontSize: 12, color: colors.textDim },
  name: { ...typo.body, color: colors.text, fontWeight: '600' },
  suggested: { fontSize: 12, color: colors.accent },
  cancel: { alignItems: 'center', paddingTop: space.md },
  cancelText: { ...typo.body, color: colors.textDim },
});
