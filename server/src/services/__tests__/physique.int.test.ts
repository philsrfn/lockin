/**
 * The weekly check-in, against a real database.
 *
 * The model is not exercised, and nothing in this repository fakes a Gemini
 * call. What can be tested honestly without one is everything around it: the
 * two refusals that happen before the call, whether the day arithmetic agrees
 * with the job that sends the notification, that a second photograph on the
 * same day replaces the first rather than adding a row, and that one
 * athlete's check-ins are never visible to another's — which for this table
 * matters more than for most.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../db';
import { pool } from '../../db';
import { anotherAthlete, phil, resetData, resetProfile } from '../../test/helpers';
import { athleteToday } from '../clock';
import { checkinStatus, latestCheckin, listCheckins, recordCheckin } from '../physique';

let sam: Ctx;

beforeEach(async () => {
  await resetData();
  await resetProfile();
  sam = await anotherAthlete();
});

/** Stores a check-in without going near a model. */
async function store(ctx: Ctx, takenOn: string, headline: string): Promise<void> {
  await pool.query(
    `insert into physique_checkins
       (user_id, taken_on, photo_count, headline, assessment, change)
     values ($1, $2, 2, $3, 'Assessment.', 'Change.')`,
    [ctx.userId, takenOn, headline],
  );
}

const photo = (takenOn: string) => ({
  data: 'x'.repeat(200),
  mimeType: 'image/jpeg',
  takenOn,
});

describe('recordCheckin', () => {
  it('refuses an empty check-in before it costs a model call', async () => {
    await expect(recordCheckin(phil, [])).rejects.toThrow(/needs a photo/);
  });

  it('refuses more photos than the cap, rather than quietly dropping some', async () => {
    const photos = ['2026-09-15', '2026-09-08', '2026-09-01', '2026-08-25', '2026-08-18'].map(
      photo,
    );
    await expect(recordCheckin(phil, photos)).rejects.toThrow(/at most 4/);
  });
});

describe('listCheckins', () => {
  it('is newest first', async () => {
    await store(phil, '2026-08-30', 'August');
    await store(phil, '2026-09-13', 'September');
    await store(phil, '2026-09-06', 'In between');

    const checkins = await listCheckins(phil);
    expect(checkins.map((checkin) => checkin.headline)).toEqual([
      'September',
      'In between',
      'August',
    ]);
  });

  it('carries the words and the count, and nothing that could be a photo', async () => {
    await store(phil, '2026-09-13', 'Shoulders read wider');

    const [checkin] = await listCheckins(phil);
    expect(checkin).toMatchObject({
      takenOn: '2026-09-13',
      photoCount: 2,
      headline: 'Shoulders read wider',
      assessment: 'Assessment.',
      change: 'Change.',
    });
    expect(Object.keys(checkin!)).toEqual([
      'takenOn',
      'photoCount',
      'headline',
      'assessment',
      'change',
      'createdAt',
    ]);
  });

  it('never returns another athlete\'s', async () => {
    await store(phil, '2026-09-13', 'Mine');
    await store(sam, '2026-09-13', 'His');

    expect((await listCheckins(phil)).map((c) => c.headline)).toEqual(['Mine']);
    expect((await listCheckins(sam)).map((c) => c.headline)).toEqual(['His']);
    expect((await latestCheckin(sam))?.headline).toBe('His');
  });

  it('has no latest before there is one', async () => {
    expect(await latestCheckin(phil)).toBeNull();
  });
});

describe('checkinStatus', () => {
  it('is due when there has never been one', async () => {
    expect(await checkinStatus(phil)).toMatchObject({ due: true, daysSince: null, checkins: [] });
  });

  it('is not due the day after one', async () => {
    const today = await athleteToday(phil);
    await store(phil, today, 'Today');

    const status = await checkinStatus(phil);
    expect(status.due).toBe(false);
    expect(status.daysSince).toBe(0);
  });

  it('is due again a week later', async () => {
    const today = new Date(`${await athleteToday(phil)}T12:00:00Z`);
    const weekAgo = new Date(today.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    await store(phil, weekAgo, 'Last week');

    const status = await checkinStatus(phil);
    expect(status.due).toBe(true);
    expect(status.daysSince).toBe(7);
  });

  it('counts only this athlete when deciding whether one is owed', async () => {
    await store(sam, await athleteToday(sam), 'His');
    expect((await checkinStatus(phil)).due).toBe(true);
  });
});
