import { useState } from 'react';
import * as Linking from 'expo-linking';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { currentBaseUrl } from '../api/config';
import type { ConsentState } from '../api/types';
import { messageFor } from '../lib/apiError';
import { t } from '../lib/locale';
import { Button } from './Button';
import { colors, space, type as typo } from '../theme';

/**
 * The one screen that has to come before everything else.
 *
 * Training history, body weight and anything Apple Health sends are a special
 * category of personal data, and the lawful basis for holding them is explicit
 * consent — which means somebody was shown what they were agreeing to and said
 * yes to that. A policy that exists on a website and is never read is not a
 * basis for anything.
 *
 * So this sits between signing in and the questionnaire, and the documents are
 * one tap away rather than a line of small print. The server records which
 * version was in force; see `domain/consent.ts`.
 */
export function ConsentScreen({
  outstanding,
  onDone,
}: {
  outstanding: string[];
  onDone: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function agree() {
    setBusy(true);
    setError(null);
    try {
      // One call per outstanding document rather than a single "agree to
      // everything": the rows are separate because the documents are, and a
      // notice that changes should not silently re-agree the other one.
      let state: ConsentState | null = null;
      for (const document of outstanding) {
        state = await api<ConsentState>('/consents', { method: 'POST', body: { document } });
      }
      if (state && state.outstanding.length > 0) throw new Error('still outstanding');
      onDone();
    } catch (caught) {
      setError(messageFor(caught, 'consentFailed'));
      setBusy(false);
    }
  }

  /** The notices live on the server, so they are the same text either way. */
  const open = (path: string) => {
    const base = currentBaseUrl();
    if (base) void Linking.openURL(`${base}${path}`);
  };

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.page,
          { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl },
        ]}
      >
        <Text style={styles.title}>{t('consentTitle')}</Text>
        <Text style={styles.blurb}>{t('consentBlurb')}</Text>

        <View style={styles.links}>
          <Pressable onPress={() => open('/privacy')} hitSlop={8}>
            <Text style={styles.link}>{t('consentReadPrivacy')}</Text>
          </Pressable>
          <Pressable onPress={() => open('/terms')} hitSlop={8}>
            <Text style={styles.link}>{t('consentReadTerms')}</Text>
          </Pressable>
        </View>

        <View style={styles.spacer} />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button
          title={busy ? t('consentWorking') : t('consentAgree')}
          onPress={() => void agree()}
          disabled={busy}
        />
        <Text style={styles.note}>{t('consentWithdrawNote')}</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  page: { paddingHorizontal: space.lg, gap: space.lg, flexGrow: 1 },
  title: { fontSize: 30, fontWeight: '300', color: colors.text, letterSpacing: -0.6 },
  blurb: { fontSize: 16, color: colors.textBody, lineHeight: 24 },
  links: { gap: space.md, paddingTop: space.xs },
  link: { ...typo.body, color: colors.accent },
  spacer: { flex: 1, minHeight: space.xl },
  note: { fontSize: 13, color: colors.textFaint, lineHeight: 19 },
  error: { color: colors.danger, fontSize: 14 },
});
