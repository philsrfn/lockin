import { describe, expect, it } from 'vitest';
import { MAX_DAILY_CREDIT_KCAL, cardioCreditKcal, netBurnKcal } from '../cardioBurn';

const run45 = { kind: 'zone2', minutes: 45 };

describe('what a session cost', () => {
  it('is net of the metabolism that was running anyway', () => {
    // 7 METs gross for zone 2; the one that would have burned sitting still
    // is already inside BMR, and counting it twice is food nobody earned.
    // (7 − 1) × 95 × 0.75 = 427.5, so 428.
    expect(netBurnKcal(run45, 95)).toBe(428);
  });

  it('scales with the body doing it', () => {
    expect(netBurnKcal(run45, 60)).toBeLessThan(netBurnKcal(run45, 95));
  });

  it('rates intervals above steady work and a walk below both', () => {
    const hour = (kind: string) => netBurnKcal({ kind, minutes: 60 }, 80);

    expect(hour('intervals')).toBeGreaterThan(hour('zone2'));
    expect(hour('zone2')).toBeGreaterThan(hour('walk'));
  });

  it('treats a kind it does not know as light rather than generous', () => {
    const hour = (kind: string) => netBurnKcal({ kind, minutes: 60 }, 80);

    expect(hour('kitesurfing')).toBeLessThan(hour('zone2'));
  });

  it('is nothing for a session of no minutes', () => {
    expect(netBurnKcal({ kind: 'zone2', minutes: 0 }, 95)).toBe(0);
  });
});

describe('what it adds to the day', () => {
  it('subtracts what the target already assumed', () => {
    // Somebody training three days a week carries 350 × 3 / 7 = 150 kcal of
    // training in every day's target already. A 428 kcal run is worth the
    // difference, not the whole thing.
    expect(cardioCreditKcal([run45], 95, 150)).toBe(278);
  });

  it('subtracts it once for the day, not once per session', () => {
    const two = cardioCreditKcal([run45, run45], 95, 150);

    expect(two).toBe(428 * 2 - 150);
  });

  it('never goes negative on a day the allowance already covers', () => {
    // A ten-minute walk on a day that already assumed a session is not a debt.
    expect(cardioCreditKcal([{ kind: 'walk', minutes: 10 }], 95, 150)).toBe(0);
  });

  it('gives the whole thing to somebody whose target assumed no training', () => {
    expect(cardioCreditKcal([run45], 95, 0)).toBe(428);
  });

  it('stops trusting the estimate past a point', () => {
    // Three hours of football is where a MET table stops describing a person.
    const long = [{ kind: 'sport', minutes: 180 }];

    expect(cardioCreditKcal(long, 95, 0)).toBe(MAX_DAILY_CREDIT_KCAL);
  });

  it('is nothing when the body is unknown', () => {
    // Every number here scales with weight. A guessed body is a guessed meal.
    expect(cardioCreditKcal([run45], null, 0)).toBe(0);
  });

  it('is nothing on a day with no cardio', () => {
    expect(cardioCreditKcal([], 95, 150)).toBe(0);
  });
});
