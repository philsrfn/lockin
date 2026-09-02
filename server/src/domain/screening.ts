/**
 * The check that runs before the app sets anybody a calorie target. Pure.
 *
 * An app that sets calorie targets will be used by people with eating
 * disorders. That is not a hypothetical to design around later — it is a
 * certainty the moment it leaves one person's phone, and the cost of getting
 * it wrong is not a bad review.
 *
 * The rules here are deliberately blunt and few. They do not diagnose anybody
 * and they do not lecture: they refuse to hand out a deficit in the situations
 * where a deficit is the wrong answer, say plainly why, and point at somebody
 * qualified. §5's "never moralise about food" applies to this file more than
 * to any other.
 */

import type { Goal, Sex } from './targets';

export type ScreeningInput = {
  sex: Sex;
  heightCm: number;
  weightKg: number;
  ageYears: number;
  goal: Goal;
};

export type Concern = 'underweight' | 'minor' | 'goal_below_healthy';

export type Screening = {
  /** What the app will actually do, which may not be what was asked for. */
  goal: Goal;
  concerns: Concern[];
  /** Said to the athlete, in their own screen. Empty when nothing was changed. */
  notes: string[];
  /** True when a professional should be involved before an app is. */
  signpost: boolean;
};

/** Below this, a deficit is not a training decision. */
export const UNDERWEIGHT_BMI = 18.5;

/** Below this, calorie targets belong to a doctor, not to an app. */
export const MINIMUM_AGE_FOR_DEFICIT = 18;

export function bmi(heightCm: number, weightKg: number): number {
  const metres = heightCm / 100;
  return weightKg / (metres * metres);
}

/**
 * The one thing this file says out loud. Written to be useful rather than
 * frightening: no diagnosis, no statistics, no "you may be suffering from".
 */
export const SUPPORT_NOTE =
  'If food or your weight is taking up more of your head than you want it to, ' +
  'a doctor or a registered dietitian is the right person for that — more than ' +
  'this app is. Nothing here changes while you sort it out.';

/**
 * Decides what goal the app will pursue, which is not always the one asked
 * for. A refusal is always explained, and always leaves something the athlete
 * can still do — training does not stop because the target changed.
 */
export function screen(input: ScreeningInput): Screening {
  const concerns: Concern[] = [];
  const notes: string[] = [];
  let goal = input.goal;

  const index = bmi(input.heightCm, input.weightKg);

  if (index < UNDERWEIGHT_BMI) {
    concerns.push('underweight');
    if (goal === 'lose') {
      goal = 'maintain';
      notes.push(
        `At ${input.heightCm}cm and ${input.weightKg}kg you are already below the ` +
          'healthy weight range, so this sets you targets to hold rather than to lose. ' +
          'Training and protein still do their job at maintenance.',
      );
    }
  }

  if (input.ageYears < MINIMUM_AGE_FOR_DEFICIT) {
    concerns.push('minor');
    if (goal === 'lose') {
      goal = 'maintain';
      notes.push(
        'While you are still growing, a calorie deficit is a decision for a doctor ' +
          'rather than for an app. Targets are set to maintenance. Lifting and eating ' +
          'enough protein are the parts that matter most at your age anyway.',
      );
    }
  }

  const signpost = concerns.includes('underweight');
  if (signpost) notes.push(SUPPORT_NOTE);

  return { goal, concerns, notes, signpost };
}

/**
 * A goal weight that would take somebody below a healthy BMI. Separate from
 * §7's hard floor, which clamps the number — this is what to *say* about it.
 */
export function goalWeightConcern(heightCm: number, goalWeightKg: number): Concern | null {
  return bmi(heightCm, goalWeightKg) < UNDERWEIGHT_BMI ? 'goal_below_healthy' : null;
}
