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
import { type Queryable, pool, queryOne } from '../db';
import { checkTrainingDays } from '../domain/safety';
import { WEEKLY_TARGETS } from '../domain/templates';
import { today as todayDate } from '../services/bodyweight';
import { activeContext } from '../services/contexts';
import { getWeek } from '../services/week';
import { listExercises } from '../services/exercises';
import { recentSessions } from '../services/sessions';
import { upcomingTemplate } from '../services/workouts';
import { assembleContext } from './context';
import { geminiProvider } from './gemini';
import { LlmError } from './provider';

export type CoachSwap = { from: string; to: string; reason: string };

export type CoachNote = {
  forDate: string;
  sessionType: 'strength' | 'cardio' | 'rest';
  template: 'A' | 'B' | 'C' | null;
  headline: string;
  body: string;
  swaps: CoachSwap[];
};

const RESPONSE_SCHEMA = {
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
      enum: ['A', 'B', 'C'],
      description: 'Only when sessionType is strength. Normally the next in rotation.',
    },
    headline: {
      type: 'string',
      description: 'Under 8 words. What today is, in his trainer\'s voice.',
    },
    body: {
      type: 'string',
      description:
        'Two or three sentences at most. Why today looks like this, given the last two ' +
        'weeks. Direct and warm. No pep talk, no moralising, no restating the numbers ' +
        'he can already see on screen.',
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
};

const INSTRUCTION = `You are Phil's personal trainer, deciding what today should be.

His weekly targets are 3 strength sessions, 2 zone-2 treadmill sessions of 35
minutes, and a 9-10k daily step average. Not fixed weekdays — he travels, and
fixed days fail.

Decide whether today is a lifting day, a treadmill day, or a rest day. Weigh:
- how many strength sessions he has already done in the last 7 days
- how recently he lifted, and how hard it was (RPE)
- any joint pain flags
- whether he is still in the two-week ramp-in

Rest is a real answer. Two rest days a week is a floor, not a target. If he
lifted yesterday at RPE 9, today is not another lift.

Then write a headline and two or three sentences. You are talking to someone
you have trained for months: no preamble, no "great job", no explaining what
progressive overload is. If something in the last two weeks is worth naming —
a stall, a jump, three sessions in four days, a week of no weigh-ins — name it.

Do not state working weights. He can see them on screen and they are computed
for you, not by you.`;

type NoteRow = {
  for_date: string;
  session_type: string;
  template: string | null;
  headline: string;
  body: string;
  swaps: CoachSwap[];
  context_name: string | null;
};

const toNote = (row: NoteRow): CoachNote => ({
  forDate: row.for_date,
  sessionType: row.session_type as CoachNote['sessionType'],
  template: (row.template as CoachNote['template']) ?? null,
  headline: row.headline,
  body: row.body,
  swaps: row.swaps ?? [],
});

export async function cachedNote(date: string, db: Queryable = pool): Promise<CoachNote | null> {
  const { rows } = await db.query<NoteRow>(
    `select for_date, session_type, template, headline, body, swaps, context_name
     from coach_notes where for_date = $1`,
    [date],
  );
  return rows[0] ? toNote(rows[0]) : null;
}

/**
 * Validates the model's choices against reality before anything is stored.
 * The model proposes; code disposes.
 */
async function sanitise(
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
    template = ['A', 'B', 'C'].includes(String(raw.template))
      ? (raw.template as CoachNote['template'])
      : await upcomingTemplate();
  }

  // A swap must stay inside the movement pattern, and both names must exist.
  const exercises = await listExercises();
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
export async function generateNote(date: string = todayDate()): Promise<CoachNote> {
  const [context, sessions, week] = await Promise.all([
    activeContext(),
    recentSessions(7),
    getWeek(),
  ]);
  // Calendar days, matching the strip on the home screen. A rolling window made
  // the coach claim three sessions while the screen beside it showed two.
  const strengthThisWeek = week.strength.done;

  const output = await geminiProvider.generate({
    systemInstruction: INSTRUCTION,
    history: [
      {
        role: 'user',
        text:
          `${await assembleContext()}\n\n` +
          `Weekly targets: ${WEEKLY_TARGETS.strengthSessions} strength, ` +
          `${WEEKLY_TARGETS.zone2Sessions} × ${WEEKLY_TARGETS.zone2Minutes}min zone-2, ` +
          `${WEEKLY_TARGETS.stepsPerDay} steps/day.\n\n` +
          // Given as a fact rather than left to be counted off the session
          // list. Asked to work it out itself, it said "all three" on a week
          // with two — contradicting the strip directly beside it, and
          // breaking §1 for exactly the reason §1 exists.
          `Strength sessions finished so far this week: ${strengthThisWeek} of ` +
          `${WEEKLY_TARGETS.strengthSessions}. Use this number; do not count them yourself.\n\n` +
          'Decide what today is.',
      },
    ],
    responseSchema: RESPONSE_SCHEMA,
    model: 'fast',
    maxOutputTokens: 3000,
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(output.text) as Record<string, unknown>;
  } catch {
    throw new LlmError('The coach returned something that was not JSON', true);
  }

  const note = await sanitise(parsed as never, strengthThisWeek);

  await pool.query(
    `insert into coach_notes (for_date, session_type, template, headline, body, swaps, context_name)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (for_date) do update
       set session_type = excluded.session_type,
           template     = excluded.template,
           headline     = excluded.headline,
           body         = excluded.body,
           swaps        = excluded.swaps,
           context_name = excluded.context_name,
           created_at   = now()`,
    [
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
 * The note for today, generated at most once unless forced — or unless he has
 * moved city since it was written, which changes the gym and the food rules.
 */
export async function noteForToday(options: { force?: boolean } = {}): Promise<CoachNote | null> {
  const date = todayDate();

  if (!options.force) {
    const cached = await cachedNote(date);
    if (cached) {
      const stale = await queryOne<{ context_name: string | null }>(
        'select context_name from coach_notes where for_date = $1',
        [date],
      );
      const context = await activeContext();
      if (stale?.context_name === (context?.name ?? null)) return cached;
    }
  }

  return generateNote(date);
}
