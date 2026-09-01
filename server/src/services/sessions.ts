import type { PoolClient } from 'pg';
import { type Queryable, pool, transaction } from '../db';
import { badRequest, notFound } from '../errors';
import { type TemplateId, isTemplateId } from '../domain/templates';

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

const SELECT_SESSION = `
  select s.id, s.performed_at, s.context_id, c.name as context_name,
         s.template, s.rpe, s.notes, s.joint_pain
  from sessions s
  left join contexts c on c.id = s.context_id
`;

const SELECT_SETS = `
  select st.id, st.session_id, st.exercise_id, e.name as exercise_name,
         st.set_index, st.weight_kg, st.reps, st.rir
  from sets st
  join exercises e on e.id = st.exercise_id
  where st.session_id = any($1::int[])
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

async function attachSets(rows: SessionRow[], db: Queryable): Promise<Session[]> {
  if (rows.length === 0) return [];

  const { rows: setRows } = await db.query<SetRow>(SELECT_SETS, [rows.map((row) => row.id)]);

  const bySession = new Map<number, SetRecord[]>();
  for (const setRow of setRows) {
    const list = bySession.get(setRow.session_id) ?? [];
    list.push(toSetRecord(setRow));
    bySession.set(setRow.session_id, list);
  }

  return rows.map((row) => toSession(row, bySession.get(row.id) ?? []));
}

export async function getSession(id: number, db: Queryable = pool): Promise<Session> {
  const { rows } = await db.query<SessionRow>(`${SELECT_SESSION} where s.id = $1`, [id]);
  const row = rows[0];
  if (!row) throw notFound(`No session ${id}`);
  const [session] = await attachSets([row], db);
  return session!;
}

export async function listSessions(limit = 20, db: Queryable = pool): Promise<Session[]> {
  const { rows } = await db.query<SessionRow>(
    `${SELECT_SESSION} order by s.performed_at desc limit $1`,
    [Math.min(Math.max(limit, 1), 200)],
  );
  return attachSets(rows, db);
}

/** The session still in progress, if he started one and has not finished it. */
export async function openSession(db: Queryable = pool): Promise<Session | null> {
  const { rows } = await db.query<SessionRow>(
    `${SELECT_SESSION} where s.rpe is null order by s.performed_at desc limit 1`,
  );
  const row = rows[0];
  if (!row) return null;
  const [session] = await attachSets([row], db);
  return session ?? null;
}

export type CreateSessionInput = {
  performedAt?: string;
  contextId?: number;
  template: TemplateId;
};

export async function createSession(
  input: CreateSessionInput,
  client?: PoolClient,
): Promise<Session> {
  const run = async (db: PoolClient) => {
    // Default to whichever city he last switched to, so starting a workout is
    // one tap and never asks a question he already answered.
    const contextId =
      input.contextId ??
      (
        await db.query<{ id: number }>('select id from contexts where is_active limit 1')
      ).rows[0]?.id ??
      null;

    const { rows } = await db.query<{ id: number }>(
      `insert into sessions (performed_at, context_id, template)
       values (coalesce($1::timestamptz, now()), $2, $3)
       returning id`,
      [input.performedAt ?? null, contextId, input.template],
    );

    return getSession(rows[0]!.id, db);
  };

  return client ? run(client) : transaction(run);
}

export type FinishSessionInput = {
  rpe?: number | null;
  notes?: string | null;
  jointPain?: boolean;
};

/** Closing out a session: RPE, an optional note, and the joint pain flag. */
export async function finishSession(
  id: number,
  input: FinishSessionInput,
  db: Queryable = pool,
): Promise<Session> {
  if (input.rpe != null && (input.rpe < 1 || input.rpe > 10)) {
    throw badRequest('RPE must be between 1 and 10');
  }

  const { rowCount } = await db.query(
    `update sessions
     set rpe        = coalesce($2, rpe),
         notes      = coalesce($3, notes),
         joint_pain = coalesce($4, joint_pain)
     where id = $1`,
    [id, input.rpe ?? null, input.notes ?? null, input.jointPain ?? null],
  );

  if (!rowCount) throw notFound(`No session ${id}`);
  return getSession(id, db);
}

/** Sessions in the last `days` days, newest first. Feeds adherence and gates. */
export async function recentSessions(days: number, db: Queryable = pool): Promise<Session[]> {
  const { rows } = await db.query<SessionRow>(
    `${SELECT_SESSION}
     where s.performed_at >= now() - ($1 || ' days')::interval
     order by s.performed_at desc`,
    [days],
  );
  return attachSets(rows, db);
}

export async function firstSessionAt(db: Queryable = pool): Promise<Date | null> {
  const { rows } = await db.query<{ performed_at: Date }>(
    'select performed_at from sessions order by performed_at asc limit 1',
  );
  return rows[0]?.performed_at ?? null;
}
