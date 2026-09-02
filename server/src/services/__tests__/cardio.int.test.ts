/**
 * Cardio.
 *
 * The coach prescribed 35 minutes of zone-2 twice a week and had no way to
 * know whether it happened; the week strip counted three lifts and dropped the
 * other two thirds of §4's week because there was nowhere to put it. These
 * tests are mostly about the tally being honest — both that it counts what
 * should count, and that it does not count a walk to the shops.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../../db';
import { anotherAthlete, daysAgo, phil, resetData, resetProfile } from '../../test/helpers';
import { cardioToday, deleteCardio, logCardio, recentCardio } from '../cardio';
import { getToday } from '../today';
import { getWeek } from '../week';

let sam: Ctx;

beforeEach(async () => {
  await resetData();
  await resetProfile();
  sam = await anotherAthlete();
});

describe('logging it', () => {
  it('records a zone-2 session with the place he was in', async () => {
    const session = await logCardio(phil, { kind: 'zone2', minutes: 35 });

    expect(session).toMatchObject({ kind: 'zone2', minutes: 35, counts: true });
    expect(session.contextName).toBe('Home');
  });

  it('takes distance and heart rate when he has them, and not when he does not', async () => {
    const withNumbers = await logCardio(phil, {
      kind: 'other',
      minutes: 40,
      description: 'easy run',
      distanceKm: 6.5,
      avgHr: 142,
      rpe: 4,
    });

    expect(withNumbers).toMatchObject({ distanceKm: 6.5, avgHr: 142, rpe: 4 });
    expect((await logCardio(phil, { kind: 'zone2', minutes: 35 })).distanceKm).toBeNull();
  });

  it.each([
    ['a kind nobody has heard of', { kind: 'yoga' as 'zone2' }, 'kind must be one of'],
    ['a session of no minutes', { minutes: 0 }, 'minutes must be between'],
    ['a session of ten hours', { minutes: 601 }, 'minutes must be between'],
    ['an RPE off the scale', { rpe: 11 }, 'RPE must be between'],
  ])('refuses %s', async (_label, override, message) => {
    await expect(
      logCardio(phil, { kind: 'zone2', minutes: 35, ...override }),
    ).rejects.toThrow(message);
  });

  it('undoes a mis-tap', async () => {
    const session = await logCardio(phil, { kind: 'zone2', minutes: 35 });

    await deleteCardio(phil, session.id);

    expect(await cardioToday(phil)).toEqual([]);
  });

  it('404s deleting one that is not there', async () => {
    await expect(deleteCardio(phil, 9999)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('will not let one athlete delete another\'s', async () => {
    const his = await logCardio(phil, { kind: 'zone2', minutes: 35 });

    await expect(deleteCardio(sam, his.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await cardioToday(phil)).toHaveLength(1);
  });
});

describe('what counts towards the week', () => {
  it('counts a zone-2 session', async () => {
    await logCardio(phil, { kind: 'zone2', minutes: 35 });

    expect((await getWeek(phil)).cardio).toMatchObject({ done: 1, target: 2, minutes: 35 });
  });

  it('counts football, which is the hard cardio session (§4)', async () => {
    await logCardio(phil, { kind: 'sport', minutes: 90, description: 'football' });

    expect((await getWeek(phil)).cardio.done).toBe(1);
  });

  it('does not let a walk to the shops complete the week', async () => {
    await logCardio(phil, { kind: 'walk', minutes: 45 });

    const week = await getWeek(phil);
    // The minutes are still his — they just do not tick the box.
    expect(week.cardio.done).toBe(0);
    expect(week.cardio.minutes).toBe(45);
  });

  it('does not count a ten-minute warm-up as a session', async () => {
    await logCardio(phil, { kind: 'zone2', minutes: 10 });

    expect((await getWeek(phil)).cardio.done).toBe(0);
  });

  it('puts the minutes on the day they were done', async () => {
    await logCardio(phil, { kind: 'zone2', minutes: 35, performedAt: daysAgo(2) });

    const week = await getWeek(phil);
    const day = week.days.find((entry) => entry.date === week.days[4]?.date);

    expect(day?.cardioMinutes).toBe(35);
    expect(day?.cardioSessions).toBe(1);
  });

  it('leaves a session older than the strip out of the tally', async () => {
    await logCardio(phil, { kind: 'zone2', minutes: 35, performedAt: daysAgo(9) });

    expect((await getWeek(phil)).cardio.done).toBe(0);
  });

  it('is per athlete', async () => {
    await logCardio(phil, { kind: 'zone2', minutes: 35 });

    expect((await getWeek(sam)).cardio.done).toBe(0);
  });
});

describe('Today', () => {
  it('shows what he has already done, so the screen stops offering it', async () => {
    await logCardio(phil, { kind: 'zone2', minutes: 35 });

    const today = await getToday(phil);

    expect(today.cardioToday).toHaveLength(1);
    expect(today.week.cardioSessions).toMatchObject({ done: 1, target: 2 });
  });

  it('agrees with the week strip', async () => {
    await logCardio(phil, { kind: 'zone2', minutes: 35 });
    await logCardio(phil, { kind: 'sport', minutes: 90, performedAt: daysAgo(3) });

    const [today, week] = await Promise.all([getToday(phil), getWeek(phil)]);

    expect(today.week.cardioSessions.done).toBe(week.cardio.done);
  });
});

describe('history', () => {
  it('lists newest first, windowed by days', async () => {
    await logCardio(phil, { kind: 'zone2', minutes: 35, performedAt: daysAgo(20) });
    await logCardio(phil, { kind: 'intervals', minutes: 25, performedAt: daysAgo(2) });

    expect((await recentCardio(phil, 14)).map((s) => s.kind)).toEqual(['intervals']);
    expect((await recentCardio(phil, 30)).map((s) => s.kind)).toEqual(['intervals', 'zone2']);
  });
});
