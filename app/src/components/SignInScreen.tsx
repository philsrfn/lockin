import { useEffect, useState } from 'react';
import * as AppleAuthentication from 'expo-apple-authentication';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { currentBaseUrl, saveConfig } from '../api/config';
import { SignInCancelled, appleSignInAvailable, signInWithApple } from '../auth/apple';
import { t } from '../lib/locale';
import { Button } from './Button';
import { colors, radius, space, type as typo } from '../theme';

/** Also the datum the correction bar is positioned against. */
const WORDMARK = 40;

/**
 * The first screen anybody sees. One button.
 *
 * The manual path underneath is not a fallback for ordinary use — it is how
 * Phil's own token still works, and how a build pointed at a different backend
 * gets there. It stays folded away, because asking a new athlete for a bearer
 * token is asking them to leave.
 */
export function SignInScreen({
  onDone,
}: {
  /** `admitted` is false while the account waits to be let in. */
  onDone: (needsOnboarding: boolean, admitted: boolean) => void;
}) {
  const insets = useSafeAreaInsets();
  const [appleReady, setAppleReady] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  // The host is baked into release builds, so most athletes never see a URL.
  const [url, setUrl] = useState(currentBaseUrl() || 'https://');
  const [token, setToken] = useState('');

  useEffect(() => {
    void appleSignInAvailable().then(setAppleReady);
  }, []);

  async function withApple() {
    setBusy(true);
    setError(null);
    try {
      const result = await signInWithApple(url);
      onDone(!result.onboarded, result.approved);
    } catch (caught) {
      if (caught instanceof SignInCancelled) return;
      const status = (caught as { status?: number }).status;
      setError(status === 0 ? t('signInOffline') : t('signInFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function withToken() {
    setBusy(true);
    setError(null);
    try {
      await saveConfig(url, token);
      // Any authenticated route will do; /profile is the cheapest, and its
      // answer says whether the questionnaire still needs asking.
      const { profile } = await api<{ profile: { onboarded?: boolean } }>('/profile', {
        timeoutMs: 15_000,
      });
      // A token handed over by hand belongs to an account somebody already
      // let in; if it did not, /profile would have refused it above.
      onDone(!profile.onboarded, true);
    } catch (caught) {
      const status = (caught as { status?: number }).status;
      setError(
        status === 401
          ? t('tokenRejected')
          : status === 0
            ? t('serverUnreachable')
            : `Something went wrong (${status ?? '?'}).`,
      );
    } finally {
      setBusy(false);
    }
  }

  const hostReady = url.startsWith('http') && url.length > 'https://'.length;

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.masthead}>
          {/* The app icon's mark, reused rather than redrawn — the padlock whose
              keyhole is a dumbbell. This is the screen where it has to explain
              itself, so it is given room above the name. */}
          <Image
            source={require('../../assets/splash-icon.png')}
            style={styles.mark}
            resizeMode="contain"
          />
          {/*
            The word this screen would otherwise be titled, corrected into the
            app's name. It only works here — on any other screen there is no
            "login" for it to be a correction of, which is why the wordmark
            everywhere else is left alone.
          */}
          <View style={styles.wordmarkRow}>
            <Text style={styles.wordmark}>lo</Text>
            <View>
              <Text style={[styles.wordmark, styles.struck]}>g</Text>
              {/* Drawn rather than textDecorationLine, which renders a hairline
                  at this weight and reads as a typo instead of a correction. */}
              <View style={styles.strike} />
            </View>
            <Text style={styles.wordmark}>ckin</Text>
          </View>
          <Text style={styles.blurb}>{t('signInBlurb')}</Text>
        </View>

        {/* Shown only when the build does not know its backend — a dev build
            pointed somewhere new, never a TestFlight install. */}
        {!currentBaseUrl() || manual ? (
          <View style={styles.field}>
            <Text style={styles.label}>{t('serverUrl')}</Text>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              style={styles.input}
            />
          </View>
        ) : null}

        {manual ? (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>{t('bearerToken')}</Text>
              <TextInput
                value={token}
                onChangeText={setToken}
                placeholderTextColor={colors.textFaint}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={styles.input}
              />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            {/*
              An outline while it waits, a solid slab once it can be pressed.
              The app's disabled primary is a bone fill at 28% — a mid-grey
              block, which on this empty a page is the loudest thing on it, and
              it is the one thing you cannot tap.
            */}
            <Button
              title={busy ? t('checking') : t('connect')}
              onPress={withToken}
              variant={token.trim() && hostReady ? 'primary' : 'secondary'}
              disabled={busy || !token.trim() || !hostReady}
            />
          </>
        ) : (
          <>
            {error ? <Text style={styles.error}>{error}</Text> : null}

            {appleReady === null ? (
              <ActivityIndicator color={colors.textFaint} style={styles.spinner} />
            ) : appleReady === false ? (
              // No Apple ID on this device — a simulator, usually. The token
              // path stops being an afterthought here and becomes the way in,
              // so it is given a button rather than the quiet link below.
              <View style={styles.unavailable}>
                <Text style={styles.body}>{t('signInUnavailable')}</Text>
                <Button title={t('useServerToken')} variant="secondary" onPress={() => setManual(true)} />
              </View>
            ) : (
              <View>
                {/* Apple's own button, as the guidelines require. Square, to
                    match everything else on the page. */}
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                  cornerRadius={0}
                  style={[styles.appleButton, (busy || !hostReady) && styles.busy]}
                  onPress={() => {
                    if (!busy && hostReady) void withApple();
                  }}
                />
                {busy ? <Text style={styles.busyLabel}>{t('signingIn')}</Text> : null}
              </View>
            )}

            {/* Only alongside the Apple button. Under a message saying Apple
                sign-in is unavailable it would contradict itself. */}
            {appleReady ? <Text style={styles.privacy}>{t('signInPrivacy')}</Text> : null}
          </>
        )}

        {manual || appleReady ? (
          <Pressable onPress={() => { setManual(!manual); setError(null); }} hitSlop={12}>
            <Text style={styles.link}>{manual ? '\u2039 Apple' : t('useServerToken')}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.lg, paddingTop: space.xxl },
  masthead: { gap: space.md, marginBottom: space.md },
  mark: { width: 68, height: 68, marginBottom: space.xs },
  wordmark: { fontSize: WORDMARK, fontWeight: '300', color: colors.text, letterSpacing: -1.5 },
  // Faint, so "lockin" is what gets read. The g only has to be legible enough
  // that the bar across it reads as a correction rather than a smudge.
  struck: { color: colors.textFaint },
  wordmarkRow: { flexDirection: 'row', alignItems: 'baseline' },
  // The one spot of amber on this screen. There are no numbers here for it to
  // mean "on target", so it is free to mean "this word, not that one".
  strike: {
    position: 'absolute',
    left: -2,
    right: -2,
    // Through the middle of the bowl. Measured against the font size rather
    // than hard-coded, because at the wrong height it reads as a line above
    // the letter instead of a line through it.
    top: WORDMARK * 0.7,
    height: 3,
    backgroundColor: colors.accent,
  },
  blurb: { fontSize: 16, color: colors.textDim, lineHeight: 24 },
  body: { fontSize: 15, color: colors.textDim, lineHeight: 22 },
  privacy: { fontSize: 13, color: colors.textFaint, lineHeight: 19 },
  appleButton: { height: 56, width: '100%' },
  busy: { opacity: 0.4 },
  unavailable: { gap: space.lg },
  busyLabel: { ...typo.label, color: colors.textFaint, marginTop: space.md },
  spinner: { alignSelf: 'flex-start', height: 56 },
  field: { gap: space.sm },
  label: { ...typo.label, color: colors.textFaint },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: space.lg,
    color: colors.text,
    fontSize: 16,
  },
  link: { fontSize: 14, color: colors.textFaint, paddingVertical: space.sm },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
