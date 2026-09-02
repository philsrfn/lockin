import { useState } from 'react';
import {
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
import type { Goal, OnboardingAnswers, OnboardingResult, Sex } from '../api/types';
import { Button } from './Button';
import { caps, colors, space, type as typo } from '../theme';

/**
 * Four screens, asked once.
 *
 * The app used to hand everyone Phil's targets — 2300 kcal and 190g of protein,
 * a 191cm man's numbers given to whoever installed it. These questions are the
 * minimum a resting-metabolism formula needs, and nothing more: no lifestyle
 * quiz, no motivation slider, no account to create.
 *
 * The last screen shows the numbers *and* where they came from. A target you
 * cannot explain is a target people stop believing after a bad week.
 */

type Step = 0 | 1 | 2 | 3;

const THIS_YEAR = new Date().getFullYear();

export function OnboardingScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>(0);

  const [name, setName] = useState('');
  const [sex, setSex] = useState<Sex | null>(null);
  const [birthYear, setBirthYear] = useState('');
  const [heightCm, setHeightCm] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [goal, setGoal] = useState<Goal>('lose');
  const [goalWeightKg, setGoalWeightKg] = useState('');
  const [days, setDays] = useState(3);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<OnboardingResult | null>(null);

  const year = Number(birthYear);
  const age = year >= 1900 ? THIS_YEAR - year : null;

  const canContinue =
    step === 0
      ? Boolean(sex) && age !== null && age >= 14 && age <= 100
      : step === 1
        ? Number(heightCm) >= 120 && Number(heightCm) <= 250 &&
          Number(weightKg) >= 30 && Number(weightKg) <= 300
        : true;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const answers: OnboardingAnswers = {
        name: name.trim() || null,
        sex: sex!,
        birthYear: year,
        heightCm: Number(heightCm),
        weightKg: Number(weightKg),
        goal,
        goalWeightKg: goal === 'maintain' || !goalWeightKg ? null : Number(goalWeightKg),
        trainingDaysPerWeek: days,
        // The server measures every "today" against this. The phone knows it.
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };

      setResult(await api<OnboardingResult>('/onboarding', { method: 'POST', body: answers, timeoutMs: 15_000 }));
      setStep(3);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.rail, { marginTop: insets.top + space.lg }]}>
        {[0, 1, 2, 3].map((index) => (
          <View key={index} style={[styles.railSegment, index <= step && styles.railSegmentDone]} />
        ))}
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}
        keyboardShouldPersistTaps="handled"
      >
        {step === 0 && (
          <>
            <Eyebrow>Who is training</Eyebrow>
            <Question>Let's get your numbers right.</Question>

            <Field label="Name">
              <Line
                value={name}
                onChange={setName}
                placeholder="Optional"
                autoCapitalize="words"
                text
              />
            </Field>

            <Field
              label="Sex"
              hint="The resting-metabolism formula uses it. It moves the daily number by about 160 kcal."
            >
              <Choice
                options={[
                  { value: 'female', label: 'Female' },
                  { value: 'male', label: 'Male' },
                ]}
                selected={sex}
                onSelect={(value) => setSex(value as Sex)}
              />
            </Field>

            <Field label="Born" hint={age ? `${age} years old.` : undefined}>
              <Line
                value={birthYear}
                onChange={setBirthYear}
                placeholder="YYYY"
                keyboardType="number-pad"
                maxLength={4}
              />
            </Field>
          </>
        )}

        {step === 1 && (
          <>
            <Eyebrow>Where you are now</Eyebrow>
            <Question>Two measurements.</Question>

            <Field label="Height">
              <Line value={heightCm} onChange={setHeightCm} placeholder="—" unit="cm" keyboardType="decimal-pad" />
            </Field>

            <Field
              label="Weight today"
              hint="The first point of your trend. The seven-day average is the number that counts, so a heavy morning does not matter."
            >
              <Line value={weightKg} onChange={setWeightKg} placeholder="—" unit="kg" keyboardType="decimal-pad" />
            </Field>
          </>
        )}

        {step === 2 && (
          <>
            <Eyebrow>What you are after</Eyebrow>
            <Question>And how often you can train.</Question>

            <Field label="Goal">
              <Choice
                options={[
                  { value: 'lose', label: 'Lose fat' },
                  { value: 'maintain', label: 'Hold' },
                  { value: 'gain', label: 'Build' },
                ]}
                selected={goal}
                onSelect={(value) => setGoal(value as Goal)}
              />
            </Field>

            {goal !== 'maintain' && (
              <Field label="Goal weight" hint="Optional. You can change it whenever.">
                <Line
                  value={goalWeightKg}
                  onChange={setGoalWeightKg}
                  placeholder="—"
                  unit="kg"
                  keyboardType="decimal-pad"
                />
              </Field>
            )}

            <Field
              label="Training days a week"
              hint="Weekly targets, not fixed weekdays — travel makes fixed days fail."
            >
              <Choice
                options={[1, 2, 3, 4, 5].map((count) => ({
                  value: String(count),
                  label: String(count),
                }))}
                selected={String(days)}
                onSelect={(value) => setDays(Number(value))}
              />
            </Field>

            {error && <Text style={styles.error}>{error}</Text>}
          </>
        )}

        {step === 3 && result && <Numbers result={result} />}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
        {step < 2 && (
          <Button title="Continue" onPress={() => setStep((step + 1) as Step)} disabled={!canContinue} />
        )}
        {step === 2 && (
          <Button title={saving ? 'Working it out…' : 'Set my targets'} onPress={submit} disabled={saving} />
        )}
        {step === 3 && <Button title="Start" onPress={onDone} />}
      </View>
    </KeyboardAvoidingView>
  );
}

/** The last screen: the numbers, and the arithmetic behind them. */
function Numbers({ result }: { result: OnboardingResult }) {
  const { profile, explanation } = result;
  const rate = Math.abs(explanation.weeklyRateKg);

  return (
    <>
      <Eyebrow>Your daily targets</Eyebrow>

      <View style={styles.targets}>
        <Target value={profile.calorieTarget} unit="kcal" label="Calories" />
        <Target value={profile.proteinTargetG} unit="g" label="Protein" hero />
        <Target value={profile.fatFloorG} unit="g" label="Fat, at least" />
      </View>

      <View style={styles.rule} />

      <Text style={styles.workingLabel}>{caps('Where these came from')}</Text>
      <Text style={styles.working}>
        Maintenance for you is about {explanation.maintenanceKcal} kcal a day, training{' '}
        {profile.trainingDaysPerWeek ?? 3} times a week.
        {rate > 0
          ? ` Eating ${profile.calorieTarget} puts you ${explanation.maintenanceKcal - profile.calorieTarget} under that — roughly ${rate.toFixed(2)} kg a week.`
          : ' Your target holds you there.'}
      </Text>
      <Text style={styles.working}>
        Protein is the number that matters most. Hit it and the rest is detail.
      </Text>

      {/*
        Anything the floors moved. Set apart by a label rather than by colour:
        amber means "on target" everywhere else in the app, and spending it here
        would make an explanation look like a warning — and compete with the
        one number on the screen that has earned it.
      */}
      {explanation.notes.length > 0 && (
        <>
          <Text style={[styles.workingLabel, styles.adjustedLabel]}>{caps('Adjusted')}</Text>
          {explanation.notes.map((note) => (
            <Text key={note} style={styles.note}>
              {note}
            </Text>
          ))}
        </>
      )}
    </>
  );
}

function Target({
  value,
  unit,
  label,
  hero = false,
}: {
  value: number;
  unit: string;
  label: string;
  hero?: boolean;
}) {
  return (
    <View style={styles.target}>
      <Text style={styles.targetLabel}>{caps(label)}</Text>
      <View style={styles.targetValue}>
        <Text style={[hero ? styles.targetHero : styles.targetNumber, typo.mono]}>{value}</Text>
        <Text style={styles.targetUnit}>{unit}</Text>
      </View>
    </View>
  );
}

const Eyebrow = ({ children }: { children: string }) => (
  <Text style={styles.eyebrow}>{caps(children)}</Text>
);

const Question = ({ children }: { children: string }) => (
  <Text style={styles.question}>{children}</Text>
);

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{caps(label)}</Text>
      {children}
      {hint && <Text style={styles.hint}>{hint}</Text>}
    </View>
  );
}

/**
 * A ruled line to write on, the way a paper form has one. `text` drops it from
 * the numeral scale to body size — a name set at 30pt reads as a heading, and
 * only the numbers earn that weight.
 */
function Line({
  value,
  onChange,
  placeholder,
  unit,
  keyboardType = 'default',
  maxLength,
  autoCapitalize = 'none',
  text = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  unit?: string;
  keyboardType?: 'default' | 'number-pad' | 'decimal-pad';
  maxLength?: number;
  autoCapitalize?: 'none' | 'words';
  text?: boolean;
}) {
  return (
    <View style={styles.line}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        keyboardType={keyboardType}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={[styles.lineInput, text ? styles.lineInputText : typo.mono]}
      />
      {unit && <Text style={styles.lineUnit}>{unit}</Text>}
    </View>
  );
}

function Choice({
  options,
  selected,
  onSelect,
}: {
  options: { value: string; label: string }[];
  selected: string | null;
  onSelect: (value: string) => void;
}) {
  return (
    <View style={styles.choice}>
      {options.map((option) => {
        const active = option.value === selected;
        return (
          <Pressable
            key={option.value}
            onPress={() => onSelect(option.value)}
            style={[styles.option, active && styles.optionActive]}
          >
            <Text style={[styles.optionText, active && styles.optionTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },

  rail: { flexDirection: 'row', gap: 3, paddingHorizontal: space.lg },
  railSegment: { flex: 1, height: 2, backgroundColor: colors.border },
  railSegmentDone: { backgroundColor: colors.text },

  content: { paddingHorizontal: space.lg, paddingTop: space.xl },

  eyebrow: { ...typo.label, color: colors.textFaint, marginBottom: space.sm },
  question: { ...typo.title, color: colors.text, marginBottom: space.xl },

  field: { marginBottom: space.xl },
  fieldLabel: { ...typo.label, color: colors.textDim, marginBottom: space.sm },
  hint: { ...typo.bodyDim, fontSize: 13, color: colors.textFaint, marginTop: space.sm, lineHeight: 19 },

  line: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: space.sm,
  },
  lineInput: { flex: 1, ...typo.numeral, color: colors.text, padding: 0 },
  lineInputText: { ...typo.body, fontSize: 20, fontWeight: '400' },
  lineUnit: { ...typo.body, color: colors.textFaint, marginLeft: space.sm, marginBottom: 4 },

  choice: { flexDirection: 'row', gap: space.sm },
  option: {
    flex: 1,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionActive: { borderColor: colors.text, backgroundColor: colors.text },
  optionText: { ...typo.body, color: colors.textDim },
  optionTextActive: { color: colors.bg, fontWeight: '600' },

  targets: { marginTop: space.lg, gap: space.lg },
  target: {},
  targetLabel: { ...typo.label, color: colors.textFaint, marginBottom: space.xs },
  targetValue: { flexDirection: 'row', alignItems: 'baseline', gap: space.sm },
  targetNumber: { ...typo.numeral, color: colors.text },
  targetHero: { ...typo.hero, fontSize: 56, letterSpacing: -2, color: colors.accent },
  targetUnit: { ...typo.body, color: colors.textFaint },

  rule: { height: 1, backgroundColor: colors.border, marginVertical: space.xl },

  workingLabel: { ...typo.label, color: colors.textFaint, marginBottom: space.sm },
  working: { ...typo.bodyDim, color: colors.textDim, lineHeight: 23, marginBottom: space.md },
  adjustedLabel: { marginTop: space.md },
  note: { ...typo.bodyDim, color: colors.text, lineHeight: 23, marginBottom: space.sm },

  error: { ...typo.bodyDim, color: colors.danger, marginTop: space.md },

  footer: { paddingHorizontal: space.lg, paddingTop: space.md },
});
