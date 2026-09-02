/**
 * Onboarding: where a stranger's numbers come from.
 *
 * Phil's targets were typed into a seed migration because there was one athlete
 * and he already knew them. Everything here is about the case that used to be
 * impossible — somebody who is not a 191 cm man cutting from 100 kg — and the
 * assertions are mostly of the form "this number is not Phil's".
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../db';
import { anotherAthlete, phil, resetData, resetProfile } from '../../test/helpers';
import { summary } from '../bodyweight';
import { completeOnboarding } from '../onboarding';
import { getProfile, updateTargets } from '../profile';
import { listRules } from '../rules';

let sam: Ctx;

const SMALL = {
  name: 'Sam',
  sex: 'female',
  birthYear: 1996,
  heightCm: 155,
  weightKg: 60,
  goal: 'lose',
  trainingDaysPerWeek: 3,
} as const;

const LARGE = {
  name: 'Max',
  sex: 'male',
  birthYear: 1996,
  heightCm: 191,
  weightKg: 100,
  goal: 'lose',
  trainingDaysPerWeek: 3,
} as const;

beforeEach(async () => {
  await resetData();
  await resetProfile();
  sam = await anotherAthlete();
});

describe('before it is answered', () => {
  it('marks a new athlete as not onboarded', async () => {
    expect((await getProfile(sam)).onboarded).toBe(false);
  });

  it('leaves the athlete who predates onboarding alone', async () => {
    // Phil already has real targets. Sending him back through a questionnaire
    // for data he has had for months would be the app forgetting him.
    expect((await getProfile(phil)).onboarded).toBe(true);
    expect((await getProfile(phil)).calorieTarget).toBe(2300);
  });
});

describe('completeOnboarding', () => {
  it('computes targets rather than handing out the placeholders', async () => {
    const result = await completeOnboarding(sam, SMALL);

    expect(result.profile.onboarded).toBe(true);
    expect(result.profile.calorieTarget).not.toBe(2300);
    expect(result.profile.proteinTargetG).not.toBe(170);
    expect(result.explanation.maintenanceKcal).toBeGreaterThan(0);
  });

  it('gives a 155cm woman numbers that fit her, not Phil\'s', async () => {
    const { profile } = await completeOnboarding(sam, SMALL);

    // Every one of these was impossible under the seeded constants: the old
    // floors were 1800 kcal and 160g protein.
    expect(profile.calorieTarget).toBeLessThan(1800);
    expect(profile.calorieTarget).toBeGreaterThan(1200);
    expect(profile.proteinTargetG).toBeLessThan(160);
    expect(profile.proteinTargetG).toBeGreaterThan(90);
    expect(profile.fatFloorG).toBeGreaterThanOrEqual(40);
  });

  it('gives a 191cm man cutting from 100kg something close to Phil\'s numbers', async () => {
    const { profile } = await completeOnboarding(sam, LARGE);

    expect(profile.calorieTarget).toBeGreaterThan(2000);
    expect(profile.calorieTarget).toBeLessThan(2700);
    expect(profile.proteinTargetG).toBeGreaterThan(170);
  });

  it('records the answers, so the numbers can be recomputed later', async () => {
    const { profile } = await completeOnboarding(sam, SMALL);

    expect(profile).toMatchObject({
      sex: 'female',
      birthYear: 1996,
      heightCm: 155,
      goal: 'lose',
      trainingDaysPerWeek: 3,
    });
    expect(profile.activityLevel).toBe('light');
    expect(profile.weeklyRateKg).toBeLessThan(0);
  });

  it('starts the weight trend from the stated weight', async () => {
    await completeOnboarding(sam, SMALL);

    const trend = await summary(sam);
    expect(trend.latest?.weightKg).toBe(60);
    expect(trend.average7?.avgKg).toBe(60);
  });

  it('rewrites the protein rule with her own floor', async () => {
    await completeOnboarding(sam, SMALL);

    const rule = (await listRules(sam)).find((entry) => entry.code === 'min_daily_protein');

    // The seeded text names 160g — Phil's floor, and close to 3g per kilo for
    // her. A rule the validator enforces has to be one she can satisfy.
    expect(rule?.text).not.toContain('160g');
    expect(rule?.text).toMatch(/under \d+g protein/);
  });

  it('leaves Phil\'s rules and targets untouched', async () => {
    await completeOnboarding(sam, SMALL);

    expect((await getProfile(phil)).calorieTarget).toBe(2300);
    expect(
      (await listRules(phil)).find((rule) => rule.code === 'min_daily_protein')?.text,
    ).toContain('160g');
  });

  it('records the language she reads, and leaves it to the device when she does not say', async () => {
    expect((await getProfile(sam)).locale).toBeNull();

    const withLocale = await completeOnboarding(sam, { ...SMALL, locale: 'en-GB' });
    expect(withLocale.profile.locale).toBe('en-GB');

    // Answering again without a locale must not wipe the one she has.
    const again = await completeOnboarding(sam, SMALL);
    expect(again.profile.locale).toBe('en-GB');
  });

  it('leaves Phil reading German', async () => {
    // Every row that predates onboarding is his, and his app has always been
    // in German. Detecting the device instead would have switched it on him.
    expect((await getProfile(phil)).locale).toBe('de');
  });

  it('moves her to the timezone she gave', async () => {
    const { profile } = await completeOnboarding(sam, { ...SMALL, timezone: 'America/New_York' });

    expect(profile.timezone).toBe('America/New_York');
  });

  it('holds maintenance at maintenance', async () => {
    const result = await completeOnboarding(sam, { ...SMALL, goal: 'maintain' });

    expect(result.profile.calorieTarget).toBe(result.explanation.maintenanceKcal);
    expect(result.profile.weeklyRateKg).toBe(0);
  });

  it('puts a bulk above maintenance', async () => {
    const result = await completeOnboarding(sam, { ...SMALL, goal: 'gain' });

    expect(result.profile.calorieTarget).toBeGreaterThan(result.explanation.maintenanceKcal);
  });
});

describe('what it refuses', () => {
  it('caps six training days and says why', async () => {
    const result = await completeOnboarding(sam, { ...SMALL, trainingDaysPerWeek: 6 });

    expect(result.profile.trainingDaysPerWeek).toBe(5);
    expect(result.explanation.notes.join(' ')).toContain('rest days');
  });

  it('clamps a goal weight under BMI 20 and says why', async () => {
    const result = await completeOnboarding(sam, { ...SMALL, goalWeightKg: 40 });

    // 20 × 1.55² = 48.05
    expect(result.profile.goalWeightKg).toBeGreaterThanOrEqual(48);
    expect(result.explanation.notes.join(' ')).toContain('BMI');
  });

  it('keeps a sensible goal weight as given', async () => {
    const result = await completeOnboarding(sam, { ...SMALL, goalWeightKg: 55 });

    expect(result.profile.goalWeightKg).toBe(55);
    // Her deficit is still moderated — a small person's maintenance leaves
    // little room — but nothing was said about her goal weight.
    expect(result.explanation.notes.join(' ')).not.toContain('BMI');
  });

  it('clamps a loss rate faster than she should lose', async () => {
    const result = await completeOnboarding(sam, { ...SMALL, weeklyRateKg: 1.5 });

    expect(Math.abs(result.profile.weeklyRateKg!)).toBeLessThan(0.7);
    expect(result.explanation.notes.join(' ')).toContain('bodyweight');
  });

  it.each([
    ['a height that is a typo', { heightCm: 17 }, 'heightCm must be'],
    ['a weight that is a typo', { weightKg: 6 }, 'weightKg must be'],
    ['a birth year that makes no sense', { birthYear: 2030 }, 'birthYear'],
    ['a zone the server does not know', { timezone: 'Europe/Atlantis' }, 'not a timezone'],
  ])('rejects %s', async (_label, override, message) => {
    await expect(completeOnboarding(sam, { ...SMALL, ...override })).rejects.toThrow(message);
  });

  it('writes nothing when the answers are rejected', async () => {
    await expect(completeOnboarding(sam, { ...SMALL, heightCm: 17 })).rejects.toThrow();

    expect((await getProfile(sam)).onboarded).toBe(false);
  });
});

describe('when a deficit is the wrong answer', () => {
  const UNDERWEIGHT = {
    sex: 'female',
    birthYear: 1996,
    heightCm: 165,
    weightKg: 47,
    goal: 'lose',
    trainingDaysPerWeek: 3,
  } as const;

  it('sets an underweight athlete to maintain rather than to lose', async () => {
    const result = await completeOnboarding(sam, UNDERWEIGHT);

    expect(result.profile.goal).toBe('maintain');
    expect(result.profile.calorieTarget).toBe(result.explanation.maintenanceKcal);
  });

  it('says why, and points at somebody qualified', async () => {
    const result = await completeOnboarding(sam, UNDERWEIGHT);
    const said = result.explanation.notes.join(' ');

    expect(said).toContain('below the healthy weight range');
    expect(said).toContain('dietitian');
    // No diagnosis and no scare words.
    expect(said).not.toMatch(/disorder|anorexi|suffer/i);
  });

  it('leaves them something they can still do', async () => {
    const result = await completeOnboarding(sam, UNDERWEIGHT);

    expect(result.explanation.notes.join(' ')).toContain('Training and protein');
    expect(result.profile.proteinTargetG).toBeGreaterThan(0);
  });

  it('does not stand in the way of them gaining', async () => {
    const result = await completeOnboarding(sam, { ...UNDERWEIGHT, goal: 'gain' });

    expect(result.profile.goal).toBe('gain');
    expect(result.profile.calorieTarget).toBeGreaterThan(result.explanation.maintenanceKcal);
  });

  it('will not put somebody still growing in a deficit', async () => {
    const result = await completeOnboarding(sam, {
      ...UNDERWEIGHT,
      weightKg: 68,
      birthYear: new Date().getFullYear() - 16,
    });

    expect(result.profile.goal).toBe('maintain');
    expect(result.explanation.notes.join(' ')).toContain('doctor');
  });

  it('refuses to be talked below maintenance afterwards', async () => {
    await completeOnboarding(sam, UNDERWEIGHT);

    // This is the path the trainer's adjust_calorie_target tool takes.
    const result = await updateTargets(sam, { calorieTarget: 1200 });

    expect(result.profile.calorieTarget).toBeGreaterThan(1200);
    expect(result.refusals.join(' ')).toContain('below maintenance');
    expect(result.refusals.join(' ')).toContain('dietitian');
  });

  it('lets an athlete in the healthy range cut normally', async () => {
    await completeOnboarding(sam, { ...UNDERWEIGHT, weightKg: 62 });

    const result = await updateTargets(sam, { calorieTarget: 1600 });

    expect(result.profile.calorieTarget).toBe(1600);
    expect(result.refusals).toEqual([]);
  });
});

describe('answering it again', () => {
  it('recomputes from the new answers', async () => {
    const first = await completeOnboarding(sam, SMALL);
    const second = await completeOnboarding(sam, { ...SMALL, goal: 'maintain' });

    expect(second.profile.calorieTarget).toBeGreaterThan(first.profile.calorieTarget);
    expect(second.profile.goal).toBe('maintain');
  });

  it('does not add a second weigh-in for the same day', async () => {
    await completeOnboarding(sam, SMALL);
    await completeOnboarding(sam, { ...SMALL, weightKg: 59.5 });

    const trend = await summary(sam);
    expect(trend.average7?.sampleCount).toBe(1);
    expect(trend.latest?.weightKg).toBe(59.5);
  });
});
