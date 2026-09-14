/**
 * The report for one finished session: gather, write, store, notify.
 *
 * WHY THIS IS NOT A JOB
 *
 * Every other generated text in the app is produced by the scheduler (§8),
 * because every other one answers to a clock. This one answers to an event —
 * the last set of the day — and a clock cannot know when that happened. A job
 * that swept for "sessions finished since I last looked" would deliver the
 * write-up at whatever the sweep interval is, which is the difference between
 * reading it in the car park and reading it after dinner.
 *
 * WHY IT IS NOT AWAITED
 *
 * The phone is holding a sync response open while it drains its queue, quite
 * possibly on gym wifi. A model call in that path would make finishing a
 * workout slower than logging one, and a model call that times out would make
 * finishing a workout *fail*, which is the one thing §11 says must never
 * depend on the network. So the finish returns and this runs behind it, on
 * its own connection, and every failure in here is logged and swallowed.
 *
 * WHAT MAKES IT SAFE TO RUN TWICE
 *
 * The unique constraint on (user_id, session_id) in migration 032, and
 * nothing else. A retried finish from the offline queue, a PATCH, and a
 * second device all converge on one row. The check before generating saves
 * the model call in the common case; the constraint is what makes it correct
 * when two arrive at once.
 */
import { type Ctx, ctxFor } from '../db';
import { notFound } from '../errors';
import { log } from '../logging';
import { sendPush } from '../push';
import { type SessionFacts, summariseSession, type Prescribed, type ReportSet } from '../domain/sessionReport';
import { writeSessionReport } from '../llm/sessionReport';
import { accessForAthlete } from './entitlements';
import { bestsBefore } from './records';
import { currentProgram, slotsFor } from './programs';
import { finishedSql } from './sessions';
import { getProfile } from './profile';

export type SessionReport = {
  sessionId: number;
  performedAt: string;
  dayName: string | null;
  facts: SessionFacts;
  headline: string;
  assessment: string;
  oneThing: string | null;
  createdAt: string;
};

type SetRow = { exercise_id: number; exercise_name: string; weight_kg: number; reps: number };

const toSet = (row: SetRow): ReportSet => ({
  exerciseId: row.exercise_id,
  exerciseName: row.exercise_name,
  weightKg: row.weight_kg,
  reps: row.reps,
});

async function setsOf(ctx: Ctx, sessionId: number): Promise<ReportSet[]> {
  const { rows } = await ctx.db.query<SetRow>(
    `select st.exercise_id, e.name as exercise_name, st.weight_kg, st.reps
     from sets st
     join exercises e on e.id = st.exercise_id
     where st.user_id = $1 and st.session_id = $2
     order by st.id`,
    [ctx.userId, sessionId],
  );
  return rows.map(toSet);
}

/**
 * The last time each of these movements was trained before this session.
 *
 * Per movement rather than per session, because that is the comparison an
 * athlete actually makes: "what did I squat last time" does not care whether
 * last time was this day of the programme or a free session where they
 * squatted anyway.
 */
async function previousOutings(
  ctx: Ctx,
  sessionId: number,
  performedAt: Date,
  exerciseIds: number[],
): Promise<{ exerciseId: number; performedAt: string; sets: ReportSet[] }[]> {
  if (exerciseIds.length === 0) return [];

  const { rows } = await ctx.db.query<SetRow & { exercise_id: number; performed_at: Date }>(
    `with last_outing as (
       select distinct on (st.exercise_id) st.exercise_id, st.session_id, s.performed_at
       from sets st
       join sessions s on s.id = st.session_id and s.user_id = st.user_id
       where st.user_id = $1 and st.exercise_id = any($2::int[])
         and s.id <> $3 and s.performed_at < $4 and st.reps > 0 and ${finishedSql('s')}
       order by st.exercise_id, s.performed_at desc
     )
     select l.exercise_id, l.performed_at, st.weight_kg, st.reps, e.name as exercise_name
     from last_outing l
     join sets st on st.session_id = l.session_id
                 and st.exercise_id = l.exercise_id
                 and st.user_id = $1
     join exercises e on e.id = st.exercise_id
     order by l.exercise_id, st.set_index`,
    [ctx.userId, exerciseIds, sessionId, performedAt],
  );

  const byExercise = new Map<number, { exerciseId: number; performedAt: string; sets: ReportSet[] }>();
  for (const row of rows) {
    const outing = byExercise.get(row.exercise_id) ?? {
      exerciseId: row.exercise_id,
      performedAt: row.performed_at.toISOString(),
      sets: [],
    };
    outing.sets.push(toSet(row));
    byExercise.set(row.exercise_id, outing);
  }

  return [...byExercise.values()];
}

/** The last finished outing of this same programme day, for the whole-session comparison. */
async function previousSameDay(
  ctx: Ctx,
  sessionId: number,
  template: string | null,
  performedAt: Date,
): Promise<{ performedAt: string; sets: ReportSet[] } | null> {
  // A free session belongs to no day, so there is no "last time this day came
  // round". Comparing it to the previous free session would compare two
  // sessions that may have nothing in common but the word.
  if (!template) return null;

  const { rows } = await ctx.db.query<{ id: number; performed_at: Date }>(
    `select s.id, s.performed_at
     from sessions s
     where s.user_id = $1 and s.template = $2 and s.id <> $3
       and s.performed_at < $4 and ${finishedSql('s')}
     order by s.performed_at desc
     limit 1`,
    [ctx.userId, template, sessionId, performedAt],
  );

  const previous = rows[0];
  if (!previous) return null;

  return {
    performedAt: previous.performed_at.toISOString(),
    sets: await setsOf(ctx, previous.id),
  };
}

/**
 * What the programme asked for — when the session came from a programme day
 * that still exists.
 *
 * A day the athlete has since left the programme of is not a failure to meet
 * a plan; there is no plan to read any more. Null, and the report simply does
 * not discuss adherence.
 */
async function prescribedFor(ctx: Ctx, template: string | null): Promise<Prescribed[] | null> {
  if (!template) return null;

  const program = await currentProgram(ctx);
  if (!program.days.some((day) => day.code === template)) return null;

  const slots = await slotsFor(ctx, program.id, template);
  return slots.map((slot) => ({
    exerciseId: slot.exerciseId,
    sets: slot.sets,
    range: slot.range,
  }));
}

/** Everything `summariseSession` needs, read once. */
export async function factsFor(ctx: Ctx, sessionId: number): Promise<{
  facts: SessionFacts;
  dayName: string | null;
  rpe: number | null;
  jointPain: boolean;
  performedAt: string;
}> {
  const { rows } = await ctx.db.query<{
    performed_at: Date;
    template: string | null;
    rpe: number | null;
    joint_pain: boolean;
  }>(
    `select performed_at, template, rpe, joint_pain
     from sessions where user_id = $1 and id = $2`,
    [ctx.userId, sessionId],
  );

  const session = rows[0];
  if (!session) throw notFound('No such session');

  const sets = await setsOf(ctx, sessionId);
  const exerciseIds = [...new Set(sets.map((set) => set.exerciseId))];

  const [previous, previousSession, prescribed, bests] = await Promise.all([
    previousOutings(ctx, sessionId, session.performed_at, exerciseIds),
    previousSameDay(ctx, sessionId, session.template, session.performed_at),
    prescribedFor(ctx, session.template),
    bestsBefore(ctx, sessionId),
  ]);

  return {
    facts: summariseSession({ sets, previous, previousSession, prescribed, bestsBefore: bests }),
    dayName: session.template,
    rpe: session.rpe,
    jointPain: session.joint_pain,
    performedAt: session.performed_at.toISOString(),
  };
}

type ReportRow = {
  session_id: number;
  performed_at: Date;
  template: string | null;
  facts: SessionFacts;
  headline: string;
  assessment: string;
  one_thing: string | null;
  created_at: Date;
};

const SELECT_REPORT = `
  select r.session_id, s.performed_at, s.template, r.facts, r.headline,
         r.assessment, r.one_thing, r.created_at
  from session_reports r
  join sessions s on s.id = r.session_id and s.user_id = r.user_id
  where r.user_id = $1
`;

const toReport = (row: ReportRow): SessionReport => ({
  sessionId: row.session_id,
  performedAt: row.performed_at.toISOString(),
  dayName: row.template,
  facts: row.facts,
  headline: row.headline,
  assessment: row.assessment,
  oneThing: row.one_thing,
  createdAt: row.created_at.toISOString(),
});

export async function reportFor(ctx: Ctx, sessionId: number): Promise<SessionReport | null> {
  const { rows } = await ctx.db.query<ReportRow>(`${SELECT_REPORT} and r.session_id = $2`, [
    ctx.userId,
    sessionId,
  ]);
  return rows[0] ? toReport(rows[0]) : null;
}

export async function latestReport(ctx: Ctx): Promise<SessionReport | null> {
  const { rows } = await ctx.db.query<ReportRow>(
    `${SELECT_REPORT} order by r.created_at desc limit 1`,
    [ctx.userId],
  );
  return rows[0] ? toReport(rows[0]) : null;
}

/**
 * Generate and store, or hand back the one that is already there.
 *
 * Returns null when the athlete has no trainer access (§17) or when the
 * session contains nothing worth writing up. A session with no sets is one
 * that was opened and walked away from, and a report saying so is worse than
 * no report.
 */
export async function createReportFor(ctx: Ctx, sessionId: number): Promise<SessionReport | null> {
  const existing = await reportFor(ctx, sessionId);
  if (existing) return existing;

  const access = await accessForAthlete(ctx);
  if (!access.coach) return null;

  const gathered = await factsFor(ctx, sessionId);
  if (gathered.facts.totalSets === 0) return null;

  const profile = await getProfile(ctx);
  const written = await writeSessionReport(ctx, gathered.facts, {
    dayName: gathered.dayName,
    rpe: gathered.rpe,
    jointPain: gathered.jointPain,
    locale: profile.locale,
  });

  await ctx.db.query(
    `insert into session_reports
       (user_id, session_id, facts, headline, assessment, one_thing)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (user_id, session_id) do nothing`,
    [
      ctx.userId,
      sessionId,
      JSON.stringify(gathered.facts),
      written.headline,
      written.assessment,
      written.oneThing,
    ],
  );

  return reportFor(ctx, sessionId);
}

/**
 * The call the finish path makes and does not wait for.
 *
 * Takes a user id rather than a Ctx on purpose: the Ctx that finished the
 * session belongs to a transaction that is about to be committed and its
 * client released. Reaching for it here would either use a connection that
 * has gone back to the pool or hold one open for the length of a model call.
 */
export function reportInBackground(userId: number, sessionId: number): void {
  void (async () => {
    try {
      const report = await createReportFor(ctxFor(userId), sessionId);
      if (!report) return;

      await sendPush(ctxFor(userId), {
        title: report.headline,
        body: report.oneThing ?? report.assessment,
        data: { screen: 'report', sessionId },
      });
    } catch (error) {
      // Swallowed on purpose. The session is finished and stored; a write-up
      // that failed to generate is a missing paragraph, not lost training.
      log.warn({ userId, sessionId, err: (error as Error).message }, 'session report failed');
    }
  })();
}
