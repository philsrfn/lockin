import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ApiError, api } from '../src/api/client';
import type { Rule, RuleTier } from '../src/api/types';
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

  const load = useCallback(async () => {
    try {
      const { rules: fetched } = await api<{ rules: Rule[] }>('/rules');
      setRules(fetched);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not load your rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
            placeholder="Only in one place? Name it (optional)"
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
  // Six characters read off a screen: spaced out, so a mistyped one is
  // visible before the button is pressed.
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
