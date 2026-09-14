/**
 * The paragraph that arrives ten minutes after the last set.
 *
 * Every number in it was decided by `domain/sessionReport.ts` and is handed
 * over as a finished fact. The model's entire job is to choose which two of
 * them matter and say so in the trainer's voice — §1, and the reason this
 * file contains no arithmetic at all.
 *
 * WHY IT IS ALLOWED TO SAY NOTHING
 *
 * `oneThing` is optional in the schema and nullable in the table. A first
 * session, or one with no comparison available, gives no honest basis for
 * advice, and a trainer that produces a tip anyway produces filler. Filler is
 * what makes somebody stop reading the ones that matter.
 */
import type { Ctx } from '../db';
import { generateFor } from './metered';
import { LlmError } from './provider';
import type { SessionFacts } from '../domain/sessionReport';
import { languageInstruction } from '../domain/language';

export type WrittenReport = {
  headline: string;
  assessment: string;
  oneThing: string | null;
  model: string;
};

const SCHEMA = {
  type: 'object',
  properties: {
    headline: {
      type: 'string',
      description:
        'One short line, read on a lock screen. Under 60 characters. Name the single best thing about the session — a record, a movement that went up, or simply that it happened. Never a greeting, never a question.',
    },
    assessment: {
      type: 'string',
      description:
        'Three or four sentences on how the session actually went, using only the numbers given. Name specific movements and loads. If something went backwards, say so plainly rather than working around it.',
    },
    oneThing: {
      type: 'string',
      description:
        'One concrete thing to do differently next time this day comes round. Leave empty if the session gives no honest basis for advice — a first outing has nothing to compare against.',
    },
  },
  required: ['headline', 'assessment'],
};

const INSTRUCTION = `You are the athlete's strength coach, writing up the session they just finished.

You are given the numbers already computed. Use them; never recompute them, never
invent one that is not there. If a figure is absent it is absent because it could
not honestly be known — say nothing rather than filling the gap.

Direct and warm. No moralising, no exclamation marks, no re-explaining what a set
is. They have trained for months. Short sentences: this is read on a phone in a
car park.

Volume is a crude measure and you should treat it as one. A session of pull-ups
carries no load at all in these figures, so never call such a session light.`;

/**
 * The facts, as lines a model reads.
 *
 * Prose rather than JSON: the same numbers handed over as `{"deltaKg": -40}`
 * come back described as a decline in a way that reads like a diagnosis. Told
 * as "you did 40kg less total work than last Tuesday", the model tends to
 * weigh it the way a person would.
 */
export function brief(facts: SessionFacts, context: { dayName: string | null; rpe: number | null; jointPain: boolean }): string[] {
  const lines: string[] = [
    context.dayName ? `Session: ${context.dayName}.` : 'Session: a free session, not a programme day.',
    `${facts.totalSets} sets across ${facts.exerciseCount} movements, ${facts.totalReps} reps, ${facts.volumeKg}kg of total work.`,
  ];

  if (context.rpe != null) lines.push(`They rated it ${context.rpe} out of 10 for effort.`);
  if (context.jointPain) {
    lines.push(
      'They flagged joint pain. Acknowledge it once, tell them the load will come down, and do not diagnose it.',
    );
  }

  if (facts.versusLast) {
    // Spelled out rather than signed. "-40kg" invites the model to read a
    // minus sign as a verdict; "40kg less work than last time" is the same
    // fact with the judgement left to the sentence it ends up in.
    const { deltaKg, deltaPct, volumeKg } = facts.versusLast;
    const direction = deltaKg === 0 ? 'exactly the same as' : deltaKg > 0 ? 'more than' : 'less than';
    lines.push(
      `Last time this day came round they did ${volumeKg}kg of work. Today is ${Math.abs(deltaKg)}kg ${direction} that, ${Math.abs(deltaPct)}%.`,
    );
  } else {
    lines.push('There is no previous outing of this day to compare against.');
  }

  if (facts.plan) {
    lines.push(
      `The plan asked for ${facts.plan.setsPlanned} sets across ${facts.plan.exercisesPlanned} movements; they did ${facts.plan.setsDone} sets across ${facts.plan.exercisesDone} of them.`,
    );
  } else {
    lines.push('This session had no prescription, so there is nothing it failed or met.');
  }

  for (const exercise of facts.exercises) {
    const parts = [`${exercise.name}: ${exercise.sets} sets, top set ${exercise.topSet.weightKg}kg x ${exercise.topSet.reps}`];

    if (exercise.previous) {
      parts.push(
        `last time ${exercise.previous.topSet.weightKg}kg x ${exercise.previous.topSet.reps}`,
      );
      if (exercise.estimatedMaxDeltaKg != null && exercise.estimatedMaxDeltaKg !== 0) {
        parts.push(
          `estimated max ${exercise.estimatedMaxDeltaKg > 0 ? 'up' : 'down'} ${Math.abs(exercise.estimatedMaxDeltaKg)}kg`,
        );
      } else {
        parts.push('no change in estimated max');
      }
    } else {
      parts.push('first time on this movement, nothing to compare');
    }

    if (exercise.inRange === false) parts.push('some sets fell outside the prescribed rep range');

    lines.push(`${parts.join(', ')}.`);
  }

  for (const record of facts.records) {
    lines.push(
      record.kind === 'heaviest'
        ? `PERSONAL RECORD: heaviest ever ${record.name}, ${record.weightKg}kg x ${record.reps}.`
        : `PERSONAL RECORD: best ever ${record.name} set by estimated max, ${record.weightKg}kg x ${record.reps}.`,
    );
  }

  return lines;
}

export async function writeSessionReport(
  ctx: Ctx,
  facts: SessionFacts,
  context: { dayName: string | null; rpe: number | null; jointPain: boolean; locale: string | null },
): Promise<WrittenReport> {
  const output = await generateFor(ctx, {
    purpose: 'session_report',
    systemInstruction: `${INSTRUCTION}\n\n${languageInstruction(context.locale)}`,
    history: [{ role: 'user', text: brief(facts, context).join('\n') }],
    responseSchema: SCHEMA,
    // Fast, not smart. This is a retelling of figures that are already
    // decided, it has to land while they are still in the car park, and it
    // runs after every single session — which is the one place in the app
    // where the cost of a model call is multiplied by how well it is going.
    model: 'fast',
    /**
     * 4000, and not the 1200 this was written with.
     *
     * The reply is three or four sentences, so 1200 looked generous. It is
     * not: on a thinking model the budget covers the reasoning as well as the
     * answer, and this prompt spent about 1150 tokens thinking before it
     * wrote a word. The reply came back cut off mid-JSON and the whole report
     * was discarded as malformed — 287 tokens of prompt paid for, nothing to
     * show. Sized like the other structured calls in this directory.
     */
    maxOutputTokens: 4000,
    temperature: 0.5,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(output.text) as Record<string, unknown>;
  } catch {
    throw new LlmError('The session report came back malformed', true);
  }

  const oneThing = String(parsed.oneThing ?? '').trim();

  return {
    headline: String(parsed.headline ?? '').trim(),
    assessment: String(parsed.assessment ?? '').trim(),
    oneThing: oneThing || null,
    model: output.model,
  };
}
