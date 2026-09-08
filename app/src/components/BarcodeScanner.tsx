import { useState } from 'react';
import { t } from '../lib/locale';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button } from './Button';
import { colors, radius, space, type as typo } from '../theme';

/**
 * Barcode scanning for packaged food (§11).
 *
 * Scanning fires continuously while the camera is open, so the first accepted
 * code disables the handler — otherwise one tub of Skyr triggers a dozen
 * lookups before the sheet has finished closing.
 */
export function BarcodeScanner({
  visible,
  onClose,
  onScanned,
}: {
  visible: boolean;
  onClose: () => void;
  onScanned: (barcode: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);

  function handle(barcode: string) {
    if (locked) return;
    setLocked(true);
    onScanned(barcode);
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => setLocked(false)}
    >
      <View style={styles.root}>
        {!permission ? null : !permission.granted ? (
          <View style={[styles.centred, { paddingTop: insets.top + space.xxl }]}>
            <Text style={styles.title}>{t('cameraAccess')}</Text>
            <Text style={styles.body}>
              lockin needs the camera to read barcodes. Nothing is recorded — the code is looked up
              and the picture is discarded.
            </Text>
            <Button title={t('allowCamera')} onPress={requestPermission} />
            <Button title={t('notNow')} variant="ghost" onPress={onClose} />
          </View>
        ) : (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              // The formats actually printed on European groceries.
              barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
              onBarcodeScanned={locked ? undefined : ({ data }) => handle(data)}
            />
            <View style={styles.overlay} pointerEvents="box-none">
              <View style={[styles.top, { paddingTop: insets.top + space.md }]}>
                <Text style={styles.hint}>
                  {locked ? 'Looking it up…' : 'Point at the barcode'}
                </Text>
              </View>
              <View style={styles.reticle} />
              <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
                <Pressable onPress={onClose} style={styles.cancel}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  centred: { flex: 1, padding: space.lg, gap: space.lg },
  title: { fontSize: 24, fontWeight: '300', color: colors.text },
  body: { fontSize: 15, color: colors.textDim, lineHeight: 22 },

  overlay: { flex: 1, justifyContent: 'space-between', alignItems: 'center' },
  top: { paddingHorizontal: space.lg },
  hint: {
    ...typo.body,
    color: '#fff',
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  reticle: {
    width: '78%',
    height: 150,
    borderWidth: 2,
    borderColor: colors.accent,
    borderRadius: radius.md,
    backgroundColor: 'transparent',
  },
  bottom: { width: '100%', paddingHorizontal: space.lg },
  cancel: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  cancelText: { fontSize: 17, fontWeight: '400', color: '#fff' },
});
