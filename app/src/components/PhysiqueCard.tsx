import { useCallback, useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import type { PhysiqueCheckin, PhysiqueStatus } from '../api/types';
import { shortDate } from '../lib/format';
import { t } from '../lib/locale';
import { type StoredPhoto, deletePhoto, listPhotos } from '../lib/physiquePhotos';
import { Button } from './Button';
import { Card } from './Card';
import { PhysiqueCamera } from './PhysiqueCamera';
import { colors, radius, space, type as typo } from '../theme';

const THUMB = 64;

/**
 * The weekly photograph, on the weight tab.
 *
 * It lives here because it answers the same question the scale does and
 * answers the part the scale cannot: the number went down, did anything about
 * the body change. Putting it on Progress would file it with the charts, and
 * the charts are where somebody goes once a month. This is where they go every
 * morning.
 *
 * TWO SOURCES, DELIBERATELY NOT JOINED
 *
 * The words come from the server, the pictures come off this phone, and
 * neither looks the other up. A photograph whose check-in failed still shows;
 * a check-in whose photograph was deleted still reads. Joining them would
 * mean a broken pair could hide either half, and both halves are worth
 * keeping on their own.
 */
export function PhysiqueCard() {
  const [status, setStatus] = useState<PhysiqueStatus | null>(null);
  const [photos, setPhotos] = useState<StoredPhoto[]>([]);
  const [camera, setCamera] = useState(false);
  const [viewing, setViewing] = useState<StoredPhoto | null>(null);

  const reloadPhotos = useCallback(() => {
    try {
      setPhotos(listPhotos());
    } catch {
      // A directory that cannot be read is an empty album, not a crash. The
      // weight tab has a job of its own and it is not this one.
      setPhotos([]);
    }
  }, []);

  useEffect(() => {
    reloadPhotos();
    void api<PhysiqueStatus>('/physique')
      .then(setStatus)
      .catch(() => {
        // Offline. The button still works, the camera still saves, and the
        // words arrive when the network does.
      });
  }, [reloadPhotos]);

  function finished(checkin: PhysiqueCheckin | null) {
    reloadPhotos();
    if (!checkin) return;
    setCamera(false);
    setStatus((current) => ({
      // Newest first, and the same day replaces rather than repeats — the
      // server upserts on the day, so the list must too or a retaken photo
      // would show twice until the next reload.
      checkins: [checkin, ...(current?.checkins ?? []).filter((c) => c.takenOn !== checkin.takenOn)],
      due: false,
      daysSince: 0,
    }));
  }

  function remove(photo: StoredPhoto) {
    deletePhoto(photo.takenOn);
    setViewing(null);
    reloadPhotos();
  }

  const latest = status?.checkins[0] ?? null;

  return (
    <>
      <Card label={t('physiqueTitle')}>
        {latest ? (
          <View style={styles.block}>
            <Text style={styles.headline}>{latest.headline}</Text>
            <Text style={styles.body}>{latest.assessment}</Text>
            {latest.change ? <Text style={styles.change}>{latest.change}</Text> : null}
            <Text style={styles.meta}>
              {shortDate(latest.takenOn)}
              {latest.photoCount > 1
                ? ` · ${
                    latest.photoCount === 2
                      ? t('physiqueComparedOne')
                      : t('physiqueCompared', { count: latest.photoCount - 1 })
                  }`
                : ''}
            </Text>
          </View>
        ) : (
          <Text style={styles.body}>{t('physiqueFirst')}</Text>
        )}

        {photos.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip}>
            <View style={styles.stripRow}>
              {photos.map((photo) => (
                <Pressable key={photo.takenOn} onPress={() => setViewing(photo)}>
                  <Image source={{ uri: photo.uri }} style={styles.thumb} />
                  <Text style={styles.thumbDate}>{shortDate(photo.takenOn)}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        ) : (
          <Text style={styles.meta}>{t('physiqueNothingYet')}</Text>
        )}

        {status?.due ? <Text style={styles.due}>{t('physiqueDue')}</Text> : null}

        <Button
          title={photos.length > 0 ? t('physiqueRetake') : t('physiqueTakePhoto')}
          variant={status?.due === false ? 'ghost' : 'primary'}
          onPress={() => setCamera(true)}
        />

        {/* Both sentences, every time. One says where the picture goes, the
            other says what the words are worth — and the second is the reason
            the trainer never puts a percentage next to a weight from a scale. */}
        <Text style={styles.fine}>{t('physiqueStaysHere')}</Text>
        <Text style={styles.fine}>{t('physiqueNoNumbers')}</Text>
      </Card>

      <PhysiqueCamera visible={camera} onDone={finished} onClose={() => setCamera(false)} />

      <Modal visible={viewing !== null} animationType="fade" onRequestClose={() => setViewing(null)}>
        <View style={styles.viewer}>
          {viewing ? (
            <>
              <Image source={{ uri: viewing.uri }} style={styles.full} resizeMode="contain" />
              <View style={styles.viewerBar}>
                <Text style={styles.viewerDate}>{shortDate(viewing.takenOn)}</Text>
                <Pressable onPress={() => remove(viewing)} hitSlop={12}>
                  <Text style={styles.delete}>{t('physiqueDelete')}</Text>
                </Pressable>
                <Pressable onPress={() => setViewing(null)} hitSlop={12}>
                  <Text style={styles.close}>{t('close')}</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  block: { gap: space.sm },
  headline: { ...typo.title, color: colors.text },
  body: { fontSize: 15, color: colors.textBody, lineHeight: 22 },
  /** The answer to the question they actually opened this for. */
  change: { fontSize: 15, color: colors.accent, lineHeight: 22 },
  meta: { fontSize: 12, color: colors.textFaint },
  due: { fontSize: 13, color: colors.accent },
  fine: { fontSize: 11, color: colors.textFaint, lineHeight: 16 },

  strip: { marginHorizontal: -space.xs },
  stripRow: { flexDirection: 'row', gap: space.sm, paddingHorizontal: space.xs },
  thumb: {
    width: THUMB,
    height: THUMB * 1.3,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceHigh,
  },
  thumbDate: { fontSize: 10, color: colors.textFaint, marginTop: space.xs, textAlign: 'center' },

  viewer: { flex: 1, backgroundColor: '#000' },
  full: { flex: 1 },
  viewerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: space.lg,
    paddingBottom: space.xxl,
  },
  viewerDate: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  delete: { fontSize: 14, color: colors.danger },
  close: { fontSize: 14, color: '#fff', fontWeight: '600' },
});
