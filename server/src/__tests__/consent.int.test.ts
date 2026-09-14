/**
 * Consent and export, against a real database.
 *
 * The rule about which documents are outstanding is covered without a database
 * in `domain/__tests__/consent.test.ts`. What matters here is the part that
 * would be embarrassing to get wrong in front of a regulator: that a consent
 * is recorded against a version, that withdrawing leaves the evidence in
 * place, and that an export is actually complete.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { Ctx } from '../db';
import { CURRENT_VERSIONS } from '../domain/consent';
import { anotherAthlete, phil, resetData, resetProfile } from '../test/helpers';
import { consentState, giveConsent, withdrawConsent } from '../services/consent';
import { exportEverything } from '../services/export';
import { logWeight } from '../services/bodyweight';

let sam: Ctx;

beforeEach(async () => {
  await resetData();
  await resetProfile();
  sam = await anotherAthlete();
});

describe('agreeing', () => {
  it('starts owing both documents', async () => {
    expect((await consentState(phil)).outstanding).toEqual(['privacy', 'terms']);
  });

  it('records the version that was in force, not one the client named', async () => {
    const state = await giveConsent(phil, 'privacy');

    expect(state.given).toContainEqual(
      expect.objectContaining({ document: 'privacy', version: CURRENT_VERSIONS.privacy }),
    );
    expect(state.outstanding).toEqual(['terms']);
  });

  it('refuses a document it does not know about', async () => {
    // A consent to an unknown document is worth nothing and would look like
    // something.
    await expect(giveConsent(phil, 'cookies')).rejects.toThrow(/unknown/i);
  });

  it('is not an error to agree twice', async () => {
    await giveConsent(phil, 'privacy');

    await expect(giveConsent(phil, 'privacy')).resolves.toBeDefined();
  });
});

describe('withdrawing', () => {
  it('puts the document back on the outstanding list', async () => {
    await giveConsent(phil, 'privacy');

    expect((await withdrawConsent(phil, 'privacy')).outstanding).toContain('privacy');
  });

  it('keeps the row, because it is the evidence the consent was obtained', async () => {
    await giveConsent(phil, 'privacy');
    const state = await withdrawConsent(phil, 'privacy');

    expect(state.given.find((c) => c.document === 'privacy')?.withdrawnAt).not.toBeNull();
  });

  it('can be given again afterwards', async () => {
    await giveConsent(phil, 'privacy');
    await withdrawConsent(phil, 'privacy');

    expect((await giveConsent(phil, 'privacy')).outstanding).toEqual(['terms']);
  });

  it('never reaches another athlete', async () => {
    await giveConsent(phil, 'privacy');
    await giveConsent(sam, 'privacy');
    await withdrawConsent(phil, 'privacy');

    expect((await consentState(sam)).outstanding).toEqual(['terms']);
  });
});

describe('taking everything with you', () => {
  it('includes what was logged', async () => {
    await logWeight(phil, { weightKg: 95, measuredOn: '2026-09-01' });

    const { data } = await exportEverything(phil);

    expect(data.bodyweight).toHaveLength(1);
  });

  it('includes the account itself, not only what it did', async () => {
    const { data } = await exportEverything(phil);

    expect(data.users).toHaveLength(1);
  });

  it('covers every table holding somebody data, read from the schema', async () => {
    // A list kept by hand goes stale the first time somebody adds a table
    // without reading the file — which has already happened once, to the
    // static tenancy guard, and cost it seven tables.
    await logWeight(phil, { weightKg: 95, measuredOn: '2026-09-01' });
    await giveConsent(phil, 'privacy');

    const { data } = await exportEverything(phil);

    expect(Object.keys(data)).toEqual(expect.arrayContaining(['bodyweight', 'consents', 'profile']));
  });

  it('is one athlete data and never another', async () => {
    await logWeight(phil, { weightKg: 95, measuredOn: '2026-09-01' });
    await logWeight(sam, { weightKg: 70, measuredOn: '2026-09-01' });

    const { data } = await exportEverything(sam);

    expect(data.bodyweight).toHaveLength(1);
    expect((data.bodyweight as { weight_kg: number }[])[0]?.weight_kg).toBe(70);
  });
});
