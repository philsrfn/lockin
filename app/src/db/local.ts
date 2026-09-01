/**
 * Local SQLite. Mid-workout this is the source of truth, not the server.
 *
 * A set is written here and rendered before anything touches the network. The
 * queue drains to the backend whenever it can. Losing a set to a dead bar of
 * signal in a basement gym is the one failure this app cannot have.
 */
import * as SQLite from 'expo-sqlite';

const db = SQLite.openDatabaseSync('lockin.db');

db.execSync(`
  pragma journal_mode = WAL;

  create table if not exists local_sessions (
    client_id     text primary key,
    server_id     integer,
    template      text not null,
    performed_at  text not null,
    finished      integer not null default 0
  );

  create table if not exists local_sets (
    client_id          text primary key,
    session_client_id  text not null,
    exercise_id        integer not null,
    set_index          integer not null,
    weight_kg          real not null,
    reps               integer not null,
    rir                integer,
    logged_at          text not null
  );

  create unique index if not exists local_sets_natural_key
    on local_sets (session_client_id, exercise_id, set_index);

  create table if not exists sync_queue (
    client_id   text primary key,
    op          text not null,
    payload     text not null,
    created_at  text not null,
    attempts    integer not null default 0,
    last_error  text
  );

  create table if not exists cache (
    key         text primary key,
    value       text not null,
    updated_at  text not null
  );
`);

export type LocalSession = {
  clientId: string;
  serverId: number | null;
  template: string;
  performedAt: string;
  finished: boolean;
};

export type LocalSet = {
  clientId: string;
  sessionClientId: string;
  exerciseId: number;
  setIndex: number;
  weightKg: number;
  reps: number;
  rir: number | null;
};

type SessionRow = {
  client_id: string;
  server_id: number | null;
  template: string;
  performed_at: string;
  finished: number;
};

type SetRow = {
  client_id: string;
  session_client_id: string;
  exercise_id: number;
  set_index: number;
  weight_kg: number;
  reps: number;
  rir: number | null;
};

const toSession = (row: SessionRow): LocalSession => ({
  clientId: row.client_id,
  serverId: row.server_id,
  template: row.template,
  performedAt: row.performed_at,
  finished: row.finished === 1,
});

const toSet = (row: SetRow): LocalSet => ({
  clientId: row.client_id,
  sessionClientId: row.session_client_id,
  exerciseId: row.exercise_id,
  setIndex: row.set_index,
  weightKg: row.weight_kg,
  reps: row.reps,
  rir: row.rir,
});

export function insertSession(session: LocalSession): void {
  db.runSync(
    `insert or replace into local_sessions
       (client_id, server_id, template, performed_at, finished)
     values (?, ?, ?, ?, ?)`,
    [
      session.clientId,
      session.serverId,
      session.template,
      session.performedAt,
      session.finished ? 1 : 0,
    ],
  );
}

/** The workout still in progress, if there is one. */
export function openLocalSession(): LocalSession | null {
  const row = db.getFirstSync<SessionRow>(
    `select * from local_sessions where finished = 0 order by performed_at desc limit 1`,
  );
  return row ? toSession(row) : null;
}

export function findSessionByServerId(serverId: number): LocalSession | null {
  const row = db.getFirstSync<SessionRow>(
    'select * from local_sessions where server_id = ? limit 1',
    [serverId],
  );
  return row ? toSession(row) : null;
}

export function setSessionServerId(clientId: string, serverId: number): void {
  db.runSync('update local_sessions set server_id = ? where client_id = ?', [serverId, clientId]);
}

export function markSessionFinished(clientId: string): void {
  db.runSync('update local_sessions set finished = 1 where client_id = ?', [clientId]);
}

export function insertSet(set: LocalSet): void {
  db.runSync(
    `insert or replace into local_sets
       (client_id, session_client_id, exercise_id, set_index, weight_kg, reps, rir, logged_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      set.clientId,
      set.sessionClientId,
      set.exerciseId,
      set.setIndex,
      set.weightKg,
      set.reps,
      set.rir,
      new Date().toISOString(),
    ],
  );
}

export function setsForSession(sessionClientId: string): LocalSet[] {
  return db
    .getAllSync<SetRow>(
      'select * from local_sets where session_client_id = ? order by exercise_id, set_index',
      [sessionClientId],
    )
    .map(toSet);
}

export function deleteSet(clientId: string): void {
  db.runSync('delete from local_sets where client_id = ?', [clientId]);
}

/** Last known good API payloads, so a cold start with no signal still renders. */
export function cacheWrite(key: string, value: unknown): void {
  db.runSync('insert or replace into cache (key, value, updated_at) values (?, ?, ?)', [
    key,
    JSON.stringify(value),
    new Date().toISOString(),
  ]);
}

export function cacheRead<T>(key: string): T | null {
  const row = db.getFirstSync<{ value: string }>('select value from cache where key = ?', [key]);
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return null;
  }
}

export const database = db;
