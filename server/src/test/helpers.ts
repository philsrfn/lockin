/**
 * Fixtures for the integration tests. Deliberately thin: these build rows the
 * way the app builds them — through the services — so a test can never set up
 * state the application itself could not produce.
 */
import { pool } from '../db';

/**
 * Tables the tests write to. Reference data (profile, contexts, exercises,
 * rules) is left alone: it comes from the seed migration, and a test that needs
 * it changed should change it and say so.
 */
const TRANSACTIONAL_TABLES = [
  'sets',
  'sessions',
  'bodyweight',
  'meals',
  'foods',
  'fridge_inventory',
  'chat_messages',
  'sync_log',
  'coach_notes',
  'job_runs',
  'push_tokens',
  'weekly_reviews',
];

/** Between tests. Keeps ids predictable by restarting the sequences. */
export async function resetData(): Promise<void> {
  await pool.query(
    `truncate ${TRANSACTIONAL_TABLES.join(', ')} restart identity cascade`,
  );
}

/** Back to the seeded targets, for tests that move them. */
export async function resetProfile(): Promise<void> {
  await pool.query(
    `update profile
     set calorie_target = 2300, protein_target_g = 190, fat_floor_g = 70,
         goal_weight_kg = 80, height_cm = 191, name = 'Phil',
         timezone = 'Europe/Berlin'
     where id = 1`,
  );
}

export async function exerciseIdByName(name: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    'select id from exercises where name = $1',
    [name],
  );
  if (!rows[0]) throw new Error(`No seeded exercise named ${name}`);
  return rows[0].id;
}

export async function contextIdByName(name: string): Promise<number> {
  const { rows } = await pool.query<{ id: number }>(
    'select id from contexts where name = $1',
    [name],
  );
  if (!rows[0]) throw new Error(`No seeded context named ${name}`);
  return rows[0].id;
}

/** An ISO instant `days` before now, at 12:00 local — never near a day boundary. */
export function daysAgo(days: number, hour = 12): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

/** A YYYY-MM-DD `days` before today, in the machine's local zone. */
export function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toLocaleDateString('sv-SE');
}
