import { useRef, useState } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import type { PhysiqueCheckin } from '../api/types';
import { messageFor } from '../lib/apiError';
import { deviceDay } from '../lib/format';
import { t } from '../lib/locale';
import { HISTORY_PHOTOS, listPhotos, readBase64, savePhoto } from '../lib/physiquePhotos';
import { Button } from './Button';
import { colors, radius, space, type as typo } from '../theme';

/**
 * The weekly photograph.
 *
 * THE ORDER OF OPERATIONS IS THE POINT
 *
 * Save first, upload second. The picture is written to this phone before
 * anything is sent anywhere, so a failed call, a dead network or a lapsed
 * subscription costs the words and never the photograph — and the photograph
 * is the part that cannot be taken again, because next Sunday is a different
 * body. This is the same instinct as §11's offline logger: never make
 * somebody redo the physical act because software could not reach a server.
 *
 * WHAT GOES OUT
 *
 * This one and the three before it, base64, in one request. They are read
 * back off the disk at the moment of sending and are not held anywhere else.
 * The server keeps the paragraph that comes back and drops the images — see
 * migration 034, which explains at length why that line is where it is.
 *
 * Front camera by default. The photograph is of the person holding the phone,
 * and starting on the back lens means everybody's first act is to flip it.
 */
export function PhysiqueCamera({
  visible,
  onDone,
  onClose,
}: {
  visible: boolean;
  onDone: (checkin: PhysiqueCheckin | null) => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function capture() {
    if (!camera.current || busy) return;
    setBusy(true);
    setError(null);

    let takenOn: string;
    try {
      // The same 0.35 as the meal and fridge photos. Vision does not need
      // twelve megapixels, and four of them in one body makes the difference
      // between an upload and a timeout.
      const photo = await camera.current.takePictureAsync({ base64: true, quality: 0.35 });
      if (!photo?.base64) throw new Error('No image');

      takenOn = deviceDay();
      savePhoto(takenOn, photo.base64);
    } catch (caught) {
      setError(messageFor(caught, 'somethingWentWrong'));
      setBusy(false);
      return;
    }

    // Past this line the photograph is safe on the phone. Everything that
    // follows is the trainer's opinion of it, which is worth having and is
    // not worth losing the picture over.
    try {
      const history = listPhotos()
        .filter((stored) => stored.takenOn !== takenOn)
        .slice(0, HISTORY_PHOTOS);

      const photos = await Promise.all(
        [takenOn, ...history.map((stored) => stored.takenOn)].map(async (day) => ({
          imageBase64: await readBase64(day),
          mimeType: 'image/jpeg',
          takenOn: day,
        })),
      );

      const { checkin } = await api<{ checkin: PhysiqueCheckin }>('/physique/checkin', {
        method: 'POST',
        body: { photos },
        // Four images through a vision model on gym wifi. The meal photo gets
        // ninety seconds for one.
        timeoutMs: 120_000,
      });
      onDone(checkin);
    } catch (caught) {
      // Named separately from the capture failure above, because they mean
      // opposite things to the person reading them: this one says the photo
      // is safe and only the write-up is missing.
      setError(messageFor(caught, 'physiqueFailed'));
      onDone(null);
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
            <Text style={styles.body}>{t('physiqueCameraWhy')}</Text>
            <Button title={t('allowCamera')} onPress={requestPermission} />
            <Button title={t('notNow')} variant="ghost" onPress={onClose} />
          </View>
        ) : (
          <>
            <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" />

            <View style={[styles.top, { paddingTop: insets.top + space.md }]}>
              <Pressable onPress={onClose} hitSlop={12} disabled={busy}>
                <Text style={styles.cancel}>{t('cancel')}</Text>
              </Pressable>
            </View>

            <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <Text style={styles.hint}>{t('physiquePhotoHint')}</Text>
              <Text style={styles.privacy}>{t('physiqueStaysHere')}</Text>
              <Button
                title={busy ? t('physiqueAnalysing') : t('physiqueTakePhoto')}
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

  bottom: {
    marginTop: 'auto',
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    gap: space.sm,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
  hint: { fontSize: 13, color: '#fff', lineHeight: 19 },
  /**
   * Said here rather than only on the card behind it. This is the screen with
   * the lens pointed at somebody, which is the moment the question occurs to
   * them, and an answer that arrives after the shutter is too late to be worth
   * anything.
   */
  privacy: { fontSize: 12, color: 'rgba(255,255,255,0.7)', lineHeight: 17 },
  error: { fontSize: 13, color: colors.danger },
});
