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
 */
export function DayPicker({
  days,
  visible,
  onPick,
  onClose,
}: {
  days: { code: string; name: string; isToday: boolean }[];
  visible: boolean;
  onPick: (code: string) => void;
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
  name: { ...typo.body, color: colors.text, fontWeight: '600' },
  suggested: { fontSize: 12, color: colors.accent },
  cancel: { alignItems: 'center', paddingTop: space.md },
  cancelText: { ...typo.body, color: colors.textDim },
});
