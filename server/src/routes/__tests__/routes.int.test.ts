/**
 * The HTTP surface: authentication, error mapping, and request correlation.
 *
 * The routes themselves are deliberately thin — the behaviour they wrap is
 * covered by the service tests. What is tested here is the layer around them,
 * which is where a mistake stops being a wrong number and starts being a
 * wrong person's data or an unanswerable support message.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from '../../index';
import { TEST_BEARER_TOKEN } from '../../test/database';
import { exerciseIdByName, resetData, resetProfile } from '../../test/helpers';
import { syncRootToken } from '../../services/users';

let app: FastifyInstance;

const auth = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };

beforeAll(async () => {
  // Authentication is a lookup against users.token_hash now, so the seeded
  // athlete has to actually own the token these tests present. This is what
  // start() does at boot with the deployed APP_BEARER_TOKEN.
  await syncRootToken(TEST_BEARER_TOKEN);
  app = await buildServer();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetData();
  await resetProfile();
});

describe('authentication', () => {
  it('lets the health check through unauthenticated, so a probe can see the database', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, db: true });
  });

  it('401s a request with no token', async () => {
    const response = await app.inject({ method: 'GET', url: '/today' });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Missing bearer token');
  });

  it('401s a wrong token without saying how it was wrong', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/today',
      headers: { authorization: 'Bearer not-the-token' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe('Invalid bearer token');
  });

  it('401s a token of a different length rather than throwing', async () => {
    // timingSafeEqual throws on a length mismatch; the token is hashed first
    // so both sides are always 32 bytes.
    const response = await app.inject({
      method: 'GET',
      url: '/today',
      headers: { authorization: 'Bearer x' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('401s a header that is not a bearer scheme', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/today',
      headers: { authorization: `Basic ${TEST_BEARER_TOKEN}` },
    });

    expect(response.statusCode).toBe(401);
  });

  it('protects writes as well as reads', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      payload: { template: 'A' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('is not fooled by a query string on a public path', async () => {
    expect((await app.inject({ method: 'GET', url: '/health?probe=1' })).statusCode).toBe(200);
  });
});

describe('request correlation', () => {
  it('stamps every response with an id', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f]{16}$/);
  });

  it('gives two requests different ids', async () => {
    const first = await app.inject({ method: 'GET', url: '/health' });
    const second = await app.inject({ method: 'GET', url: '/health' });

    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('adopts an id the client supplied, so a trace spans phone and server', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'phone-abc123' },
    });

    expect(response.headers['x-request-id']).toBe('phone-abc123');
  });

  it('ignores a supplied id that is not plain text — it goes straight into the log', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'a b\nlevel=error msg="fake"' },
    });

    expect(response.headers['x-request-id']).toMatch(/^[0-9a-f]{16}$/);
  });

  it('puts the id in the error body, so a screenshot is enough to find the request', async () => {
    const response = await app.inject({ method: 'GET', url: '/sessions/9999', headers: auth });

    expect(response.statusCode).toBe(404);
    expect(response.json().requestId).toBe(response.headers['x-request-id']);
  });

  it('puts it on an unauthenticated failure too', async () => {
    const response = await app.inject({ method: 'GET', url: '/today' });

    expect(response.json().requestId).toBe(response.headers['x-request-id']);
  });
});

describe('error mapping', () => {
  it('turns a service 404 into a 404 with its message', async () => {
    const response = await app.inject({ method: 'GET', url: '/sessions/9999', headers: auth });

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toBe('No session 9999');
  });

  it('turns a schema failure into a 400 naming the field', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: auth,
      payload: { template: 'Z' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('Invalid request');
    expect(response.json().details[0].path).toBe('template');
  });

  it('rejects an id that is not a positive integer', async () => {
    const response = await app.inject({ method: 'GET', url: '/sessions/abc', headers: auth });

    expect(response.statusCode).toBe(400);
  });

  it('404s an unknown route', async () => {
    const response = await app.inject({ method: 'GET', url: '/nope', headers: auth });

    expect(response.statusCode).toBe(404);
    expect(response.headers['x-request-id']).toBeTruthy();
  });
});

describe('the routes themselves', () => {
  it('creates a session and records a set against it', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/sessions',
      headers: auth,
      payload: { template: 'A' },
    });
    expect(created.statusCode).toBe(201);

    const sessionId = created.json().session.id;
    const set = await app.inject({
      method: 'POST',
      url: '/sets',
      headers: auth,
      payload: {
        sessionId,
        exerciseId: await exerciseIdByName('Back Squat'),
        setIndex: 1,
        weightKg: 90,
        reps: 8,
      },
    });

    expect(set.statusCode).toBe(201);
    expect(set.json().session.sets).toHaveLength(1);
  });

  it('answers the Today screen', async () => {
    const response = await app.inject({ method: 'GET', url: '/today', headers: auth });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      profile: { name: 'Phil', timezone: 'Europe/Berlin' },
      plan: { template: 'A' },
    });
  });

  it('logs a weigh-in and hands back the summary', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/bodyweight',
      headers: auth,
      payload: { weightKg: 98.6 },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().entry.weightKg).toBe(98.6);
  });

  it('refuses an implausible weight at the edge of the API, not in the database', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/bodyweight',
      headers: auth,
      payload: { weightKg: 994 },
    });

    expect(response.statusCode).toBe(400);
  });

  it('moves him to another timezone', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/profile',
      headers: auth,
      payload: { timezone: 'America/New_York' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().profile.timezone).toBe('America/New_York');
  });

  it('changes the language without touching the timezone', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/profile',
      headers: auth,
      payload: { locale: 'en-GB' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().profile.locale).toBe('en-GB');
    expect(response.json().profile.timezone).toBe('Europe/Berlin');
  });

  it('lets the language fall back to the device', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/profile',
      headers: auth,
      payload: { locale: null },
    });

    expect(response.json().profile.locale).toBeNull();
  });

  it('refuses something that is not a language tag', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/profile',
      headers: auth,
      payload: { locale: 'Deutsch bitte' },
    });

    expect(response.statusCode).toBe(400);
  });

  it('refuses a timezone the server does not know', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/profile',
      headers: auth,
      payload: { timezone: 'Europe/Atlantis' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('not a timezone');
  });

  it('answers the questionnaire and computes targets', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/onboarding',
      headers: auth,
      payload: {
        sex: 'female',
        birthYear: 1996,
        heightCm: 155,
        weightKg: 60,
        goal: 'lose',
        trainingDaysPerWeek: 3,
      },
    });

    expect(response.statusCode).toBe(200);
    const { profile, explanation } = response.json();
    expect(profile.onboarded).toBe(true);
    expect(profile.calorieTarget).toBeLessThan(1800);
    expect(explanation.maintenanceKcal).toBeGreaterThan(0);
  });

  it('rejects a questionnaire missing the body it needs', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/onboarding',
      headers: auth,
      payload: { sex: 'female', heightCm: 155 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().details.map((d: { path: string }) => d.path)).toContain('birthYear');
  });

  it('drains a sync batch', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sync',
      headers: auth,
      payload: {
        ops: [
          {
            clientId: '11111111-1111-4111-8111-111111111111',
            op: 'create_session',
            payload: { template: 'A' },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().results[0].status).toBe('applied');
  });
});
