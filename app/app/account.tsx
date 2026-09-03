import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, api } from '../src/api/client';
import type { Program } from '../src/api/types';
import { isHealthConnected, setHealthConnected } from '../src/api/config';
import {
  type Account,
  approveBrowser,
  deleteAccount,
  loadAccount,
  signOut,
} from '../src/auth/session';
import {
  SignInCancelled,
  appleSignInAvailable,
  linkAppleToThisAccount,
  unlinkApple,
} from '../src/auth/apple';
import { isSupported, requestPermission } from '../src/health';
import { syncNow } from '../src/health/sync';
import { t } from '../src/lib/locale';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Screen } from '../src/components/Screen';
import { colors, radius, space, type as typo } from '../src/theme';

/**
 * Everything about the athlete rather than about the training: who they are,
 * which devices are signed in, what the app is allowed to read, and which
 * programme they are on.
 *
 * All of this used to sit under Rules, which meant the screen for "what the
 * trainer must respect" also held the sign-out button and the Apple ID. Rules
 * are now only rules.
 */
export default function AccountScreen() {
  const router = useRouter();
  const [account, setAccount] = useState<Account | null>(null);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [current, setCurrent] = useState<Program | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [health, setHealth] = useState<'off' | 'on' | 'unsupported'>('off');
  const [healthNote, setHealthNote] = useState<string | null>(null);

  const [appleReady, setAppleReady] = useState(false);
  const [linkState, setLinkState] = useState<'idle' | 'busy' | 'failed'>('idle');

  const [pairCode, setPairCode] = useState('');
  const [pairState, setPairState] = useState<'idle' | 'busy' | 'done' | 'rejected'>('idle');

  const load = useCallback(async () => {
    try {
      const [accountResult, programResult] = await Promise.all([
        loadAccount(),
        api<{ programs: Program[]; current: Program }>('/programs'),
      ]);
      setAccount(accountResult);
      setPrograms(programResult.programs);
      setCurrent(programResult.current);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : t('couldNotLoadAccount'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void appleSignInAvailable().then(setAppleReady);
  }, []);

  useEffect(() => {
    if (!isSupported()) return setHealth('unsupported');
    void isHealthConnected().then((on) => setHealth(on ? 'on' : 'off'));
  }, []);

  async function chooseProgram(program: Program) {
    if (program.id === current?.id) return;
    setCurrent(program);
    try {
      await api('/programs/choose', { method: 'POST', body: { programId: program.id } });
    } finally {
      await load();
    }
  }

  async function connectHealth() {
    const state = await requestPermission();
    if (state === 'unavailable') return setHealth('unsupported');

    await setHealthConnected(true);
    setHealth('on');
    try {
      await syncNow();
      setHealthNote(null);
    } catch {
      // iOS never says what was declined, so an empty first sync is the only
      // signal we get — and the Health app is where it is actually changed.
      setHealthNote(t('healthNothing'));
    }
  }

  async function disconnectHealth() {
    await setHealthConnected(false);
    setHealth('off');
    setHealthNote(null);
  }

  return (
    <Screen onRefresh={load} refreshing={false}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>{t('backToTodayShort')}</Text>
        </Pressable>
        <Text style={styles.title}>{t('accountTitle')}</Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {account ? (
        <Card label={t('signedInAs')}>
          <Text style={styles.accountName}>
            {account.user.name ?? account.user.email ?? 'Signed in'}
          </Text>
          {account.user.name && account.user.email ? (
            <Text style={styles.blurb}>{account.user.email}</Text>
          ) : null}
          <Button
            title={t('signOut')}
            variant="secondary"
            onPress={() =>
              Alert.alert(t('signOut'), t('signOutConfirm'), [
                { text: t('cancel'), style: 'cancel' },
                { text: t('signOut'), style: 'destructive', onPress: () => void signOut() },
              ])
            }
          />
          {/*
            Required of any app that offers Sign in with Apple, and right
            regardless. Offered only where it is this person's to do — a token
            handed over by whoever runs the server is withdrawn by them.
          */}
          {account.kind === 'apple' ? (
            <Pressable
              onPress={() =>
                Alert.alert(t('deleteAccount'), t('deleteAccountConfirm'), [
                  { text: t('cancel'), style: 'cancel' },
                  {
                    text: t('deleteAccountAction'),
                    style: 'destructive',
                    onPress: () => void deleteAccount(),
                  },
                ])
              }
              hitSlop={8}
            >
              <Text style={styles.destructive}>{t('deleteAccount')}</Text>
            </Pressable>
          ) : null}
        </Card>
      ) : null}

      {/*
        The step that makes a hand-issued token and an Apple ID the same
        person. Without it, signing in with Apple on a new phone creates a
        second, empty account and leaves the training history on the old one.
      */}
      {account && !account.appleLinked && appleReady ? (
        <Card label={t('appleId')}>
          <Text style={styles.blurb}>{t('linkAppleBlurb')}</Text>
          {linkState === 'failed' ? <Text style={styles.error}>{t('linkFailed')}</Text> : null}
          <Button
            title={linkState === 'busy' ? t('linking') : t('linkApple')}
            variant="secondary"
            disabled={linkState === 'busy'}
            onPress={() => {
              setLinkState('busy');
              void linkAppleToThisAccount()
                .then(() => {
                  setLinkState('idle');
                  return load();
                })
                .catch((caught) => {
                  // Backing out of Apple's sheet is not a failure to report.
                  setLinkState(caught instanceof SignInCancelled ? 'idle' : 'failed');
                });
            }}
          />
        </Card>
      ) : null}

      {account?.appleLinked ? (
        <Card label={t('appleId')}>
          <Text style={styles.approved}>{t('appleLinkedOn')}</Text>
          {/* Only where a token is the fallback; the server refuses to leave
              an account with no way in, and the app should not offer it. */}
          {account.kind === 'root' ? (
            <Pressable onPress={() => void unlinkApple().then(load)} hitSlop={8}>
              <Text style={styles.destructive}>{t('unlinkApple')}</Text>
            </Pressable>
          ) : null}
        </Card>
      ) : null}

      {/*
        Passive data is the antidote to logging fatigue, which is the main
        reason fitness apps are deleted in week three.
      */}
      <Card label={t('appleHealth')}>
        <Text style={styles.blurb}>{t('healthBlurb')}</Text>
        {health === 'unsupported' ? (
          <Text style={styles.dim}>{t('healthUnsupported')}</Text>
        ) : (
          <>
            {healthNote ? <Text style={styles.dim}>{healthNote}</Text> : null}
            <Button
              title={health === 'on' ? t('healthDisconnect') : t('healthConnect')}
              variant="secondary"
              onPress={() => void (health === 'on' ? disconnectHealth() : connectHealth())}
            />
          </>
        )}
      </Card>

      {/*
        Three programmes, not a builder (§14). Switching keeps every session
        already logged; the rotation just starts at the top of the new one.
      */}
      {programs.length > 0 ? (
        <Card label={t('programme')}>
          <Text style={styles.blurb}>{t('programmeBlurb')}</Text>
          {programs.map((program) => {
            const chosen = program.id === current?.id;
            return (
              <Pressable
                key={program.id}
                onPress={() => void chooseProgram(program)}
                style={styles.program}
              >
                <View style={styles.programHead}>
                  <Text style={[styles.programName, chosen && styles.programNameOn]}>
                    {program.name}
                  </Text>
                  {chosen ? <Text style={styles.programCheck}>✓</Text> : null}
                </View>
                <Text style={styles.programDays}>
                  {program.days.map((day) => day.name).join(' · ')}
                </Text>
                {chosen ? <Text style={styles.programBlurb}>{program.description}</Text> : null}
              </Pressable>
            );
          })}
        </Card>
      ) : null}

      {/*
        The admin panel has no Sign in with Apple of its own, so the phone —
        which does — vouches for the browser. Shown only to an admin; for
        everybody else this section does not exist.
      */}
      {account?.isAdmin ? (
        <Card label={t('admin')}>
          <Text style={styles.blurb}>{t('adminBlurb')}</Text>
          <Text style={styles.label}>{t('pairingCode')}</Text>
          <TextInput
            value={pairCode}
            onChangeText={(text) => {
              setPairCode(text.toUpperCase());
              setPairState('idle');
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            style={[styles.input, styles.code]}
          />
          {pairState === 'done' ? (
            <Text style={styles.approved}>{t('browserApproved')}</Text>
          ) : null}
          {pairState === 'rejected' ? <Text style={styles.error}>{t('codeRejected')}</Text> : null}
          <Button
            title={pairState === 'busy' ? t('checking') : t('approveBrowser')}
            variant="secondary"
            disabled={pairCode.trim().length < 6 || pairState === 'busy'}
            onPress={() => {
              setPairState('busy');
              void approveBrowser(pairCode)
                .then((claimed) => {
                  setPairState(claimed ? 'done' : 'rejected');
                  if (claimed) setPairCode('');
                })
                .catch(() => setPairState('rejected'));
            }}
          />
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.sm },
  back: { ...typo.body, color: colors.textDim },
  title: { fontSize: 30, fontWeight: '300', color: colors.text },

  blurb: { fontSize: 13, color: colors.textFaint, lineHeight: 19 },
  dim: { ...typo.bodyDim, color: colors.textFaint },
  label: { ...typo.label, color: colors.textFaint },
  error: { color: colors.danger, fontSize: 14 },

  accountName: { ...typo.body, color: colors.text },
  approved: { fontSize: 14, color: colors.accent },
  destructive: { fontSize: 14, color: colors.danger, paddingVertical: space.sm },

  program: {
    paddingVertical: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  programHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  programName: { ...typo.body, color: colors.textDim },
  programNameOn: { color: colors.text, fontWeight: '600' },
  programDays: { ...typo.bodyDim, fontSize: 13, color: colors.textFaint, marginTop: space.xs },
  programBlurb: {
    ...typo.bodyDim,
    fontSize: 13,
    color: colors.textDim,
    lineHeight: 19,
    marginTop: space.sm,
  },
  programCheck: { ...typo.body, color: colors.accent },

  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: space.lg,
    color: colors.text,
    fontSize: 16,
  },
  // Six characters read off a screen: spaced out, so a mistyped one is
  // visible before the button is pressed.
  code: { fontSize: 24, letterSpacing: 8, textAlign: 'center' },
});
