import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, api } from '../api/client';
import { t } from '../lib/locale';
import { signOut } from '../auth/session';
import { Button } from './Button';
import { colors, space, type as typo } from '../theme';

/**
 * Signing in with Apple creates an account; it does not admit one. Between
 * those two moments the athlete holds a working token that reaches nothing,
 * and without this they would meet an app where every screen fails.
 *
 * No progress bar and no estimate: nobody here knows how long a person takes
 * to press a button.
 */
export function WaitingScreen({ onAdmitted }: { onAdmitted: () => void }) {
  const insets = useSafeAreaInsets();
  const [checking, setChecking] = useState(false);
  const [stillWaiting, setStillWaiting] = useState(false);

  async function check() {
    setChecking(true);
    setStillWaiting(false);
    try {
      await api('/profile');
      onAdmitted();
    } catch (caught) {
      // Any other failure is the network, and saying "not yet" about a dropped
      // connection would be a lie.
      if (caught instanceof ApiError && caught.code === 'pending_approval') {
        setStillWaiting(true);
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top + space.xxl }]}>
      <Image
        source={require('../../assets/splash-icon.png')}
        style={styles.mark}
        resizeMode="contain"
      />
      <Text style={styles.title}>{t('waitingTitle')}</Text>
      <Text style={styles.blurb}>{t('waitingBlurb')}</Text>

      {stillWaiting ? <Text style={styles.note}>{t('stillWaiting')}</Text> : null}

      <Button
        title={checking ? t('checking') : t('checkAgain')}
        variant="secondary"
        onPress={() => void check()}
        disabled={checking}
      />

      <Pressable onPress={() => void signOut()} hitSlop={12}>
        <Text style={styles.link}>{t('signOut')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, padding: space.lg, gap: space.lg },
  mark: { width: 68, height: 68 },
  title: { fontSize: 34, fontWeight: '300', color: colors.text, letterSpacing: -1 },
  blurb: { fontSize: 16, color: colors.textDim, lineHeight: 24 },
  note: { ...typo.label, color: colors.accent },
  link: { fontSize: 14, color: colors.textFaint, paddingVertical: space.sm },
});
