import { type Ctx, transactionFor } from '../db';
import { badRequest, notFound } from '../errors';
import { type TemplateId, isTemplateId } from '../domain/templates';
import { dayIn, dayRangeIn } from '../domain/time';
import { athleteZone } from './clock';

export type SetRecord = {
  id: number;
  exerciseId: number;
  exerciseName: string;
  setIndex: number;
  weightKg: number;
  reps: number;
  rir: number | null;
};

export type Session = {
  id: number;
  performedAt: string;
  contextId: number | null;
  contextName: string | null;
  template: TemplateId | null;
  rpe: number | null;
  notes: string | null;
  jointPain: boolean;
  /** A session is open until it is finished with an RPE. */
  finished: boolean;
  sets: SetRecord[];
};

type SessionRow = {
  id: number;
  performed_at: Date;
  context_id: number | null;
  context_name: string | null;
  template: string | null;
  rpe: number | null;
  notes: string | null;
  joint_pain: boolean;
};

type SetRow = {
  id: number;
  session_id: number;
  exercise_id: number;
  exercise_name: string;
  set_index: number;
  weight_kg: number;
  reps: number;
  rir: number | null;
};

/**
 * Ends with the tenant predicate, so every caller appends `and ...` and $1 is
 * always the user. A query that forgets it does not compile.
 */
const SELECT_SESSION = `
  select s.id, s.performed_at, s.context_id, c.name as context_name,
         s.template, s.rpe, s.notes, s.joint_pain
  from sessions s
  left join contexts c on c.id = s.context_id
  where s.user_id = $1
`;

const SELECT_SETS = `
  select st.id, st.session_id, st.exercise_id, e.name as exercise_name,
         st.set_index, st.weight_kg, st.reps, st.rir
  from sets st
  join exercises e on e.id = st.exercise_id
  where st.user_id = $1 and st.session_id = any($2::int[])
  order by st.session_id, st.set_index
`;

function toSession(row: SessionRow, sets: SetRecord[]): Session {
  return {
    id: row.id,
    performedAt: row.performed_at.toISOString(),
    contextId: row.context_id,
    contextName: row.context_name,
    template: isTemplateId(row.template) ? row.template : null,
    rpe: row.rpe,
    notes: row.notes,
    jointPain: row.joint_pain,
    finished: row.rpe !== null,
    sets,
  };
}

const toSetRecord = (row: SetRow): SetRecord => ({
  id: row.id,
  exerciseId: row.exercise_id,
  exerciseName: row.exercise_name,
  setIndex: row.set_index,
  weightKg: row.weight_kg,
  reps: row.reps,
  rir: row.rir,
});

async function attachSets(ctx: Ctx, rows: SessionRow[]): Promise<Session[]> {
  if (rows.length === 0) return [];

  const { rows: setRows } = await ctx.db.query<SetRow>(SELECT_SETS, [
    ctx.userId,
    rows.map((row) => row.id),
  ]);

  const bySession = new Map<number, SetRecord[]>();
  for (const setRow of setRows) {
    const list = bySession.get(setRow.session_id) ?? [];
    list.push(toSetRecord(setRow));
    bySession.set(setRow.session_id, list);
  }

  return rows.map((row) => toSession(row, bySession.get(row.id) ?? []));
}

export async function getSession(ctx: Ctx, id: number): Promise<Session> {
  const { rows } = await ctx.db.query<SessionRow>(`${SELECT_SESSION} and s.id = $2`, [
    ctx.userId,
    id,
  ]);
  const row = rows[0];
  // Someone else's session id reads as missing, which is the only honest
  // answer: he cannot tell whether it exists, and it is not his either way.
  if (!row) throw notFound(`No session ${id}`);
  const [session] = await attachSets(ctx, [row]);
  return session!;
}

export async function listSessions(ctx: Ctx, limit = 20): Promise<Session[]> {
  const { rows } = await ctx.db.query<SessionRow>(
    `${SELECT_SESSION} order by s.performed_at desc limit $2`,
    [ctx.userId, Math.min(Math.max(limit, 1), 200)],
  );
  return attachSets(ctx, rows);
}

/** The session still in progress, if he started one and has not finished it. */
export async function openSession(ctx: Ctx): Promise<Session | null> {
  const { rows } = await ctx.db.query<SessionRow>(
    `${SELECT_SESSION} and s.rpe is null order by s.performed_at desc limit 1`,
    [ctx.userId],
  );
  const row = rows[0];
  if (!row) return null;
  const [session] = await attachSets(ctx, [row]);
  return session ?? null;
}

export type CreateSessionInput = {
  performedAt?: string;
  contextId?: number;
  template: TemplateId;
};

export async function createSession(ctx: Ctx, input: CreateSessionInput): Promise<Session> {
  const run = async (inner: Ctx) => {
    // Default to whichever city he last switched to, so starting a workout is
    // one tap and never asks a question he already answered.
    const contextId =
      input.contextId ??
      (
        await inner.db.query<{ id: number }>(
          'select id from contexts where user_id = $1 and is_active limit 1',
          [inner.userId],
        )
      ).rows[0]?.id ??
      null;

    const { rows } = await inner.db.query<{ id: number }>(
      `insert into sessions (user_id, performed_at, context_id, template)
       values ($1, coalesce($2::timestamptz, now()), $3, $4)
       returning id`,
      [inner.userId, input.performedAt ?? null, contextId, input.template],
    );

    return getSession(inner, rows[0]!.id);
  };

  // The sync queue already opened one; joining it is what makes a failed op
  // roll back cleanly.
  return ctx.inTransaction ? run(ctx) : transactionFor(ctx, run);
}

export type FinishSessionInput = {
  rpe?: number | null;
  notes?: string | null;
  jointPain?: boolean;
};

/** Closing out a session: RPE, an optional note, and the joint pain flag. */
export async function finishSession(
  ctx: Ctx,
  id: number,
  input: FinishSessionInput,
): Promise<Session> {
  if (input.rpe != null && (input.rpe < 1 || input.rpe > 10)) {
    throw badRequest('RPE must be between 1 and 10');
  }

  const { rowCount } = await ctx.db.query(
    `update sessions
     set rpe        = coalesce($3, rpe),
         notes      = coalesce($4, notes),
         joint_pain = coalesce($5, joint_pain)
     where id = $2 and user_id = $1`,
    [ctx.userId, id, input.rpe ?? null, input.notes ?? null, input.jointPain ?? null],
  );

  if (!rowCount) throw notFound(`No session ${id}`);
  return getSession(ctx, id);
}

/** Sessions in the last `days` days, newest first. Feeds adherence and gates. */
export async function recentSessions(ctx: Ctx, days: number): Promise<Session[]> {
  const { rows } = await ctx.db.query<SessionRow>(
    `${SELECT_SESSION}
     and s.performed_at >= now() - ($2 || ' days')::interval
     order by s.performed_at desc`,
    [ctx.userId, days],
  );
  return attachSets(ctx, rows);
}

/**
 * Sessions performed today, newest first. Today needs this to stop offering a
 * workout he has already done — the plan card sitting there after a finished
 * session reads as "you still owe me this".
 */
export async function sessionsToday(ctx: Ctx, zone?: string): Promise<Session[]> {
  // Explicit bounds rather than `performed_at::date = current_date`: that cast
  // reads the database session's timezone, which has nothing to do with where
  // he is.
  const timezone = zone ?? (await athleteZone(ctx));
  const { from, until } = dayRangeIn(timezone, dayIn(timezone));

  const { rows } = await ctx.db.query<SessionRow>(
    `${SELECT_SESSION}
     and s.performed_at >= $2 and s.performed_at < $3
     order by s.performed_at desc`,
    [ctx.userId, from, until],
  );
  return attachSets(ctx, rows);
}

export async function firstSessionAt(ctx: Ctx): Promise<Date | null> {
  const { rows } = await ctx.db.query<{ performed_at: Date }>(
    'select performed_at from sessions where user_id = $1 order by performed_at asc limit 1',
    [ctx.userId],
  );
  return rows[0]?.performed_at ?? null;
}
