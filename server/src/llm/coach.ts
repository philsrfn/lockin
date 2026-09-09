/**
 * What today actually is.
 *
 * Phase 1 always showed a strength session, because template rotation has no
 * concept of a rest day. His weekly targets are 3 strength, 2 zone-2 and a
 * step average — four days a week are not lifting days, and an app that offers
 * a barbell session every single day gets ignored.
 *
 * So the model picks: lift, treadmill, or rest, and says why. It does NOT pick
 * loads — those come from domain/progression.ts and are handed to it. Its
 * choices are validated here before anything is stored: an invalid template is
 * replaced with the rotation, a swap across movement patterns is dropped, and
 * a sixth training day is refused by the §7 rest-day floor.
 */
import type { Ctx } from '../db';
import { noteStillFits } from '../domain/coachNote';
import { checkTrainingDays } from '../domain/safety';
import { WEEKLY_TARGETS } from '../domain/program';
import { athleteToday } from '../services/clock';
import { activeContext } from '../services/contexts';
import { getWeek } from '../services/week';
import { listExercises } from '../services/exercises';
import { recentSessions } from '../services/sessions';
import { type Program, currentProgram } from '../services/programs';
import { upcomingTemplate } from '../services/workouts';
import { assembleContext } from './context';
import { generateFor } from './metered';
import { LlmError } from './provider';

export type CoachSwap = { from: string; to: string; reason: string };

export type CoachNote = {
  forDate: string;
  sessionType: 'strength' | 'cardio' | 'rest';
  /** A day code from their programme, or null on a cardio or rest day. */
  template: string | null;
  headline: string;
  body: string;
  swaps: CoachSwap[];
};

/**
 * Built per request, because the days it may choose from are the days of the
 * programme they are running. Handing it a fixed A/B/C would let it name a day
 * that does not exist for anyone on upper/lower.
 */
const responseSchema = (dayCodes: string[]) => ({
  type: 'object',
  properties: {
    sessionType: {
      type: 'string',
      enum: ['strength', 'cardio', 'rest'],
      description:
        'strength = lift, cardio = zone-2 treadmill 35min, rest = genuinely nothing',
    },
    template: {
      type: 'string',
      enum: dayCodes,
      description: 'Only when sessionType is strength. Normally the next in rotation.',
    },
    headline: {
      type: 'string',
      description: 'Under 8 words. What today is, in their trainer\'s voice.',
    },
    body: {
      type: 'string',
      description:
        'Two or three sentences at most. Why today looks like this, given the last two ' +
        'weeks. Direct and warm. No pep talk, no moralising, no restating the numbers ' +
        'they can already see on screen.',
    },
    swaps: {
      type: 'array',
      description: 'Exercise substitutions, only when there is a real reason. Usually empty.',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['from', 'to', 'reason'],
      },
    },
  },
  required: ['sessionType', 'headline', 'body'],
});

const INSTRUCTION = `You are the athlete's personal trainer, deciding what today should be.

Their weekly targets are 3 strength sessions, 2 zone-2 treadmill sessions of
35 minutes, and a 9-10k daily step average. Not fixed weekdays — people
travel, and fixed days fail.

Decide whether today is a lifting day, a treadmill day, or a rest day. Weigh:
- how many strength sessions they have already done in the last 7 days
- how recently they lifted, and how hard it was (RPE)
- any joint pain flags
- whether they are still in the two-week ramp-in

Rest is a real answer. Two rest days a week is a floor, not a target. If they
lifted yesterday at RPE 9, today is not another lift.

Then write a headline and two or three sentences. You are talking to someone
you have trained for months: no preamble, no "great job", no explaining what
progressive overload is. If something in the last two weeks is worth naming —
a stall, a jump, three sessions in four days, a week of no weigh-ins — name it.

Do not state working weights. The athlete can see them on screen, and they
are computed for you, not by you.

Never comment on how they look, and never describe a day of eating as good or
bad. If the numbers are short, say what to do next, not what went wrong.`;

type NoteRow = {
  for_date: string;
  session_type: string;
  template: string | null;
  headline: string;
  body: string;
  swaps: CoachSwap[];
  context_name: string | null;
};

/**
 * The place it was written for, carried alongside rather than inside the
 * note: every reader has to decide whether the note still fits (see
 * `domain/coachNote.ts`), and none of them should show it on screen.
 */
export type CachedCoachNote = CoachNote & { forContext: string | null };

const toNote = (row: NoteRow): CachedCoachNote => ({
  forDate: row.for_date,
  sessionType: row.session_type as CoachNote['sessionType'],
  template: (row.template as CoachNote['template']) ?? null,
  headline: row.headline,
  body: row.body,
  swaps: row.swaps ?? [],
  forContext: row.context_name,
});

export async function cachedNote(ctx: Ctx, date: string): Promise<CachedCoachNote | null> {
  const { rows } = await ctx.db.query<NoteRow>(
    `select for_date, session_type, template, headline, body, swaps, context_name
     from coach_notes where user_id = $1 and for_date = $2`,
    [ctx.userId, date],
  );
  return rows[0] ? toNote(rows[0]) : null;
}

/**
 * Validates the model's choices against reality before anything is stored.
 * The model proposes; code disposes.
 */
async function sanitise(
  ctx: Ctx,
  program: Program,
  raw: {
    sessionType?: string;
    template?: string;
    headline?: string;
    body?: string;
    swaps?: CoachSwap[];
  },
  strengthThisWeek: number,
): Promise<Omit<CoachNote, 'forDate'>> {
  let sessionType: CoachNote['sessionType'] =
    raw.sessionType === 'cardio' || raw.sessionType === 'rest' ? raw.sessionType : 'strength';

  // §7 rest-day floor. Six training days in a week is refused in code, whatever
  // the model thought.
  if (sessionType !== 'rest' && !checkTrainingDays(strengthThisWeek + 1).ok) {
    sessionType = 'rest';
  }

  let template: CoachNote['template'] = null;
  if (sessionType === 'strength') {
    // The model may name a day; it may only name one that exists in the
    // programme they are actually running. Anything else falls back to the
    // rotation, which is the answer it should have given.
    const named = program.days.find((day) => day.code === String(raw.template));
    template = named ? named.code : await upcomingTemplate(ctx, program);
  }

  // A swap must stay inside the movement pattern, and both names must exist.
  const exercises = await listExercises(ctx.db);
  const byName = new Map(exercises.map((exercise) => [exercise.name.toLowerCase(), exercise]));
  const swaps = (raw.swaps ?? []).filter((swap) => {
    const from = byName.get(String(swap.from).toLowerCase());
    const to = byName.get(String(swap.to).toLowerCase());
    return Boolean(from && to && from.pattern === to.pattern);
  });

  return {
    sessionType,
    template,
    headline: (raw.headline ?? '').trim() || 'Today',
    body: (raw.body ?? '').trim(),
    swaps,
  };
}

/** Generates the note, validates it, stores it. */
export async function generateNote(ctx: Ctx, forDate?: string): Promise<CoachNote> {
  const date = forDate ?? (await athleteToday(ctx));
  const [context, sessions, week, program] = await Promise.all([
    activeContext(ctx),
    recentSessions(ctx, 7),
    getWeek(ctx),
    currentProgram(ctx),
  ]);
  // Calendar days, matching the strip on the home screen. A rolling window made
  // the coach claim three sessions while the screen beside it showed two.
  const strengthThisWeek = week.strength.done;

  const output = await generateFor(ctx, {
      purpose: 'coach_note',
    systemInstruction: INSTRUCTION,
    history: [
      {
        role: 'user',
        text:
          `${await assembleContext(ctx)}\n\n` +
          `Weekly targets: ${WEEKLY_TARGETS.strengthSessions} strength, ` +
          `${WEEKLY_TARGETS.zone2Sessions} × ${WEEKLY_TARGETS.zone2Minutes}min zone-2, ` +
          `${WEEKLY_TARGETS.stepsPerDay} steps/day.\n\n` +
          // Given as a fact rather than left to be counted off the session
          // list. Asked to work it out itself, it said "all three" on a week
          // with two — contradicting the strip directly beside it, and
          // breaking §1 for exactly the reason §1 exists.
          `Strength sessions finished so far this week: ${strengthThisWeek} of ` +
          `${WEEKLY_TARGETS.strengthSessions}. Cardio sessions: ${week.cardio.done} of ` +
          `${week.cardio.target}, ${week.cardio.minutes} minutes logged. ` +
          'Use these numbers; do not count them yourself.\n\n' +
          `They are running ${program.name}: ` +
          `${program.days.map((day) => `${day.code} (${day.name})`).join(', ')}.\n\n` +
          'Decide what today is.',
      },
    ],
    responseSchema: responseSchema(program.days.map((day) => day.code)),
    model: 'fast',
    maxOutputTokens: 3000,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(output.text) as Record<string, unknown>;
  } catch {
    throw new LlmError('The coach returned something that was not JSON', true);
  }

  const note = await sanitise(ctx, program, parsed as never, strengthThisWeek);

  await ctx.db.query(
    `insert into coach_notes
       (user_id, for_date, session_type, template, headline, body, swaps, context_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (user_id, for_date) do update
       set session_type = excluded.session_type,
           template     = excluded.template,
           headline     = excluded.headline,
           body         = excluded.body,
           swaps        = excluded.swaps,
           context_name = excluded.context_name,
           created_at   = now()`,
    [
      ctx.userId,
      date,
      note.sessionType,
      note.template,
      note.headline,
      note.body,
      JSON.stringify(note.swaps),
      context?.name ?? null,
    ],
  );

  return { forDate: date, ...note };
}

/**
 * The note for today, generated at most once unless forced.
 *
 * Twice it is not the note that changed but the world under it, and both are
 * cheap to detect and expensive to get wrong:
 *
 * - **They moved city.** A different gym and different food rules.
 * - **They changed programme.** The note names a session — "Einheit B" — and
 *   after a switch that day may not exist any more. Left alone the card said
 *   B while the plan underneath it said Push, which is the app disagreeing
 *   with itself about the one thing the screen is for. Now that programmes
 *   are something an athlete builds rather than a choice made once at signup,
 *   this stopped being a rare case.
 */
export async function noteForToday(
  ctx: Ctx,
  options: { force?: boolean } = {},
): Promise<CoachNote | null> {
  const date = await athleteToday(ctx);

  if (!options.force) {
    const cached = await cachedNote(ctx, date);
    if (cached) {
      const context = await activeContext(ctx);
      const program = await currentProgram(ctx);

      const fits = noteStillFits(
        { template: cached.template, contextName: cached.forContext },
        { contextName: context?.name ?? null, dayCodes: program.days.map((day) => day.code) },
      );
      if (fits) return cached;
    }
  }

  return generateNote(ctx, date);
}
