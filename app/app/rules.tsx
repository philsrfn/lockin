import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, api } from '../src/api/client';
import type { Program, Rule, RuleTier } from '../src/api/types';
import { isHealthConnected, setHealthConnected } from '../src/api/config';
import { type Account, deleteAccount, loadAccount, signOut } from '../src/auth/session';
import { isSupported, requestPermission } from '../src/health';
import { syncNow } from '../src/health/sync';
import { t } from '../src/lib/locale';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Screen } from '../src/components/Screen';
import { colors, radius, space, type as typo } from '../src/theme';

const TIERS: { tier: RuleTier; title: string; blurb: string }[] = [
  { tier: 'hard', title: 'HARD', blurb: 'Always true. A plan that breaks one is rejected.' },
  { tier: 'soft', title: 'SOFT', blurb: 'Preferences. Followed unless there is a reason not to.' },
  { tier: 'never', title: 'NEVER', blurb: 'Lines that are not crossed.' },
];

/**
 * The rules editor (§11). Three tiered lists, add, reword, deactivate.
 *
 * Rules marked "enforced" have a validator behind them — the wording is what he
 * reads, the check is fixed in code. Anything he adds here reaches the trainer
 * through the system instruction but has no validator, and the screen says so
 * rather than implying a guarantee it cannot make.
 */
export default function RulesScreen() {
  const router = useRouter();
  const [rules, setRules] = useState<Rule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [adding, setAdding] = useState<RuleTier | null>(null);
  const [loading, setLoading] = useState(true);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [current, setCurrent] = useState<Program | null>(null);
  const [health, setHealth] = useState<'off' | 'on' | 'unsupported'>('off');
  const [healthNote, setHealthNote] = useState<string | null>(null);
  const [account, setAccount] = useState<Account | null>(null);

  const load = useCallback(async () => {
    try {
      const [ruleResult, programResult] = await Promise.all([
        api<{ rules: Rule[] }>('/rules'),
        api<{ programs: Program[]; current: Program }>('/programs'),
      ]);
      setRules(ruleResult.rules);
      setPrograms(programResult.programs);
      setCurrent(programResult.current);
      setError(null);
      // Its own request, and allowed to fail quietly: not knowing which kind of
      // account this is should not put an error across the rules.
      void loadAccount().then(setAccount).catch(() => undefined);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load your rules');
    } finally {
      setLoading(false);
    }
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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isSupported()) return setHealth('unsupported');
    void isHealthConnected().then((on) => setHealth(on ? 'on' : 'off'));
  }, []);

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

  async function toggle(rule: Rule) {
    await api(`/rules/${rule.id}`, { method: 'PATCH', body: { active: !rule.active } });
    await load();
  }

  return (
    <Screen onRefresh={load} refreshing={false}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <Text style={styles.back}>{t('backToTodayShort')}</Text>
        </Pressable>
        <Text style={styles.title}>Rules</Text>
        <Text style={styles.subtitle}>
          What the trainer must respect. Hold a rule to edit it.
        </Text>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {loading ? <Text style={styles.dim}>Loading…</Text> : null}

      {/*
        Three programmes, not a builder (§14). Switching keeps every session
        already logged; the rotation just starts at the top of the new one.
      */}
      {programs.length > 0 ? (
        <Card label="PROGRAMME">
          <Text style={styles.blurb}>
            An ordered list of days that rotates. How often it rotates is how often you train.
          </Text>
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

      {TIERS.map(({ tier, title, blurb }) => {
        const mine = rules.filter((rule) => rule.tier === tier);
        return (
          <Card key={tier} label={title}>
            <Text style={styles.blurb}>{blurb}</Text>
            {mine.length === 0 ? (
              <Text style={styles.dim}>Nothing here yet.</Text>
            ) : (
              mine.map((rule) => (
                <Pressable
                  key={rule.id}
                  onLongPress={() => setEditing(rule)}
                  delayLongPress={450}
                  style={styles.ruleRow}
                >
                  <Pressable onPress={() => toggle(rule)} hitSlop={8} style={styles.check}>
                    <Text style={[styles.checkMark, !rule.active && styles.checkOff]}>
                      {rule.active ? '✓' : '○'}
                    </Text>
                  </Pressable>
                  <View style={styles.ruleBody}>
                    <Text style={[styles.ruleText, !rule.active && styles.ruleOff]}>
                      {rule.text}
                    </Text>
                    <View style={styles.tags}>
                      {rule.scope ? <Text style={styles.tag}>{rule.scope} only</Text> : null}
                      {rule.code ? (
                        <Text style={[styles.tag, styles.tagEnforced]}>enforced in code</Text>
                      ) : (
                        <Text style={styles.tag}>guidance only</Text>
                      )}
                    </View>
                  </View>
                </Pressable>
              ))
            )}
            <Button
              title={`Add a ${tier} rule`}
              variant="secondary"
              onPress={() => setAdding(tier)}
            />
          </Card>
        );
      })}

      {account ? (
        <Card label={t('account')}>
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

      <Text style={styles.footnote}>
        "Enforced in code" means a validator checks it and rejects anything that breaks it. Rules
        you add reach the trainer as instructions — it will follow them, but nothing blocks a
        mistake.
      </Text>

      <RuleSheet
        rule={editing}
        addingTier={adding}
        onClose={() => {
          setEditing(null);
          setAdding(null);
        }}
        onSaved={async () => {
          setEditing(null);
          setAdding(null);
          await load();
        }}
      />
    </Screen>
  );
}

function RuleSheet({
  rule,
  addingTier,
  onClose,
  onSaved,
}: {
  rule: Rule | null;
  addingTier: RuleTier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState('');
  const [scope, setScope] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visible = rule !== null || addingTier !== null;

  useEffect(() => {
    setText(rule?.text ?? '');
    setScope(rule?.scope ?? '');
    setError(null);
  }, [rule, addingTier]);

  async function save() {
    if (text.trim().length < 3) return;
    setBusy(true);
    setError(null);
    try {
      if (rule) {
        await api(`/rules/${rule.id}`, {
          method: 'PATCH',
          body: { text: text.trim(), scope: scope.trim() || null },
        });
      } else if (addingTier) {
        await api('/rules', {
          method: 'POST',
          body: { tier: addingTier, text: text.trim(), scope: scope.trim() || null },
        });
      }
      onSaved();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.sheetLabel}>
            {rule ? `EDIT ${rule.tier.toUpperCase()} RULE` : `NEW ${addingTier?.toUpperCase()} RULE`}
          </Text>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Say it the way you would say it out loud"
            placeholderTextColor={colors.textFaint}
            style={[styles.input, styles.multiline]}
            multiline
            autoFocus={!rule}
          />
          <TextInput
            value={scope}
            onChangeText={setScope}
            placeholder="Only in one city? Home, Münster… (optional)"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
          />
          {rule?.code ? (
            <Text style={styles.note}>
              A validator enforces this one. You can reword it; the check behind it stays.
            </Text>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Button
            title={busy ? 'Saving…' : 'Save'}
            onPress={save}
            disabled={busy || text.trim().length < 3}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { gap: space.xs },
  back: { ...typo.body, color: colors.textDim, marginBottom: space.sm },
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
  title: { fontSize: 30, fontWeight: '300', color: colors.text },
  subtitle: { ...typo.bodyDim, color: colors.textDim },
  blurb: { fontSize: 13, color: colors.textFaint, marginTop: -space.xs },

  ruleRow: { flexDirection: 'row', gap: space.md, paddingVertical: space.sm },
  check: { width: 28, alignItems: 'center', paddingTop: 2 },
  checkMark: { fontSize: 18, color: colors.accent, fontWeight: '400' },
  checkOff: { color: colors.textFaint },
  ruleBody: { flex: 1, gap: space.xs },
  ruleText: { ...typo.body, color: colors.text, lineHeight: 21 },
  ruleOff: { color: colors.textFaint, textDecorationLine: 'line-through' },
  tags: { flexDirection: 'row', gap: space.sm, flexWrap: 'wrap' },
  tag: { fontSize: 11, color: colors.textFaint, textTransform: 'uppercase', letterSpacing: 0.6 },
  tagEnforced: { color: colors.accent },

  dim: { ...typo.bodyDim, color: colors.textFaint },
  error: { color: colors.danger, fontSize: 14 },
  footnote: { fontSize: 13, color: colors.textFaint, lineHeight: 19 },
  accountName: { ...typo.body, color: colors.text },
  destructive: { fontSize: 14, color: colors.danger, paddingVertical: space.sm },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    padding: space.lg,
    paddingBottom: space.xxl + space.lg,
    gap: space.md,
  },
  sheetLabel: { ...typo.label, color: colors.textFaint },
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
  multiline: { minHeight: 96, paddingTop: space.md, textAlignVertical: 'top' },
  note: { fontSize: 13, color: colors.warn, lineHeight: 19 },
});
