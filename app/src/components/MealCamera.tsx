import { useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import type { FoodEstimate } from '../api/types';
import { messageFor } from '../lib/apiError';
import { t } from '../lib/locale';
import { Button } from './Button';
import { colors, radius, space, type as typo } from '../theme';

/**
 * A photograph of a plate.
 *
 * The barcode scanner answers "what is in this packet", which most meals are
 * not. Describing a meal in a line answers the rest and asks somebody to type
 * while their food goes cold. This is the third way in and the one people
 * mean when they say scan my food.
 *
 * The picture is sent and forgotten: nothing is stored, on the phone or on the
 * server. §9's rule about the fridge applies here for the same reason — the
 * app has no use for the image once it has the answer.
 */
export function MealCamera({
  visible,
  onEstimated,
  onClose,
}: {
  visible: boolean;
  onEstimated: (estimate: FoodEstimate) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * What the lens cannot see. A photo answers what well and how much badly —
   * "mit 200 g Reis" is the difference between a guess and an estimate, and
   * it is optional because most of the time the picture is enough.
   */
  const [note, setNote] = useState('');

  async function capture() {
    if (!camera.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      // The same 0.35 the fridge uses: vision does not need twelve megapixels,
      // and a smaller image is the difference between an upload and a timeout
      // on a gym network.
      const photo = await camera.current.takePictureAsync({ base64: true, quality: 0.35 });
      if (!photo?.base64) throw new Error('No image');

      const { estimate } = await api<{ estimate: FoodEstimate }>('/foods/photo', {
        method: 'POST',
        body: {
          imageBase64: photo.base64,
          mimeType: 'image/jpeg',
          ...(note.trim() ? { note: note.trim() } : {}),
        },
        timeoutMs: 90_000,
      });
      setNote('');
      onEstimated(estimate);
    } catch (caught) {
      setError(messageFor(caught, 'couldNotEstimate'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        {!permission ? null : !permission.granted ? (
          <View style={[styles.centred, { paddingTop: insets.top + space.xxl }]}>
            <Text style={styles.title}>{t('cameraAccess')}</Text>
            <Text style={styles.body}>{t('cameraWhyMeal')}</Text>
            <Button title={t('allowCamera')} onPress={requestPermission} />
            <Button title={t('notNow')} variant="ghost" onPress={onClose} />
          </View>
        ) : (
          <>
            <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" />

            <View style={[styles.top, { paddingTop: insets.top + space.md }]}>
              <Pressable onPress={onClose} hitSlop={12}>
                <Text style={styles.cancel}>{t('cancel')}</Text>
              </Pressable>
            </View>

            <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Text style={styles.hint}>{t('mealPhotoHint')}</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder={t('mealPhotoNote')}
                placeholderTextColor={colors.textFaint}
                style={styles.note}
                autoCorrect={false}
                returnKeyType="done"
              />
              <Button
                title={busy ? t('estimating') : t('takePhoto')}
                onPress={() => void capture()}
                disabled={busy}
              />
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  centred: { flex: 1, padding: space.lg, gap: space.lg, justifyContent: 'center' },
  title: { fontSize: 24, fontWeight: '400', color: colors.text },
  body: { fontSize: 15, color: colors.textBody, lineHeight: 22 },

  top: { paddingHorizontal: space.lg },
  cancel: { ...typo.body, color: '#fff', fontWeight: '600' },

  /**
   * Over the viewfinder rather than beside it: the plate has to stay visible
   * while the note is typed, because the note is about what is in the frame.
   */
  bottom: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: space.lg,
    gap: space.md,
    backgroundColor: 'rgba(0,0,0,0.72)',
  },
  hint: { fontSize: 13, color: '#d6d2cb', lineHeight: 19 },
  note: {
    minHeight: 48,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.12)',
    paddingHorizontal: space.md,
    color: '#fff',
    fontSize: 16,
  },
  error: { color: colors.danger, fontSize: 14 },
});
