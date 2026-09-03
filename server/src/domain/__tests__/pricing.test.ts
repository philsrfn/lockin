import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATES,
  costOf,
  formatUsd,
  ratesFromEnv,
  totalCost,
} from '../pricing';

const RATES = { 'test-flash': { input: 1, output: 10 } };

describe('costOf', () => {
  it('charges input and output at their own rates', () => {
    const priced = costOf(
      { model: 'test-flash', promptTokens: 1_000_000, outputTokens: 100_000 },
      RATES,
    );

    expect(priced.usd).toBeCloseTo(1 + 1, 6);
    expect(priced.unpricedTokens).toBe(0);
  });

  it('handles the small numbers this app actually produces', () => {
    // One chat turn: a few thousand tokens, a fraction of a cent.
    const priced = costOf({ model: 'test-flash', promptTokens: 4000, outputTokens: 300 }, RATES);

    expect(priced.usd).toBeCloseTo(0.004 + 0.003, 6);
  });

  it('reports an unknown model as unpriced rather than free', () => {
    // The failure that matters: a dashboard reading $0.00 because it did not
    // recognise the model, which looks exactly like not having spent anything.
    const priced = costOf({ model: 'something-new', promptTokens: 900, outputTokens: 100 }, RATES);

    expect(priced.usd).toBe(0);
    expect(priced.unpricedTokens).toBe(1000);
  });

  it('prices a dated point release at its stem rate', () => {
    const exact = costOf({ model: 'test-flash', promptTokens: 1e6, outputTokens: 0 }, RATES);
    const dated = costOf({ model: 'test-flash-002', promptTokens: 1e6, outputTokens: 0 }, RATES);
    const preview = costOf({ model: 'test-flash-preview', promptTokens: 1e6, outputTokens: 0 }, RATES);

    expect(dated.usd).toBe(exact.usd);
    expect(preview.usd).toBe(exact.usd);
    expect(dated.unpricedTokens).toBe(0);
  });

  it('ships rates for the models the app is configured to use', () => {
    expect(DEFAULT_RATES['gemini-3.6-flash']).toBeDefined();
    for (const rate of Object.values(DEFAULT_RATES)) {
      expect(rate.output).toBeGreaterThan(rate.input);
    }
  });
});

describe('totalCost', () => {
  it('adds up a mixed day', () => {
    const total = totalCost(
      [
        { model: 'test-flash', promptTokens: 1e6, outputTokens: 0 },
        { model: 'test-flash', promptTokens: 0, outputTokens: 1e5 },
        { model: 'mystery', promptTokens: 500, outputTokens: 500 },
      ],
      RATES,
    );

    expect(total.usd).toBeCloseTo(2, 6);
    expect(total.unpricedTokens).toBe(1000);
  });

  it('is zero for a day with no calls', () => {
    expect(totalCost([], RATES)).toEqual({ usd: 0, unpricedTokens: 0 });
  });
});

describe('ratesFromEnv', () => {
  it('turns an env name back into a model string', () => {
    const rates = ratesFromEnv({ GEMINI_PRICE_GEMINI_3_6_FLASH: '0.5/4' });

    expect(rates['gemini-3.6-flash']).toEqual({ input: 0.5, output: 4 });
  });

  it('overrides a default rather than sitting beside it', () => {
    const rates = ratesFromEnv({ GEMINI_PRICE_GEMINI_2_5_PRO: '2/20' });

    expect(rates['gemini-2.5-pro']).toEqual({ input: 2, output: 20 });
    expect(rates['gemini-3.6-flash']).toEqual(DEFAULT_RATES['gemini-3.6-flash']);
  });

  it('keeps the defaults when nothing is set', () => {
    expect(ratesFromEnv({})).toEqual(DEFAULT_RATES);
  });

  it('ignores malformed values instead of pricing at NaN', () => {
    // A typo here would otherwise make every total NaN, which on a page reads
    // as a bug in the dashboard rather than a bug in the config.
    const rates = ratesFromEnv({
      GEMINI_PRICE_A: 'free',
      GEMINI_PRICE_B: '1',
      GEMINI_PRICE_C: '-1/2',
      GEMINI_PRICE_D: '',
    });

    expect(rates).toEqual(DEFAULT_RATES);
  });

  it('ignores unrelated environment variables', () => {
    expect(ratesFromEnv({ DATABASE_URL: 'postgres://x', PATH: '/usr/bin' })).toEqual(DEFAULT_RATES);
  });
});

describe('formatUsd', () => {
  it('keeps a fraction of a cent visible', () => {
    // Most days will be a few cents. Rounding to 2dp would print $0.00 for a
    // real spend, which is the number somebody would then act on.
    expect(formatUsd(0.0034)).toBe('$0.0034');
    expect(formatUsd(0.42)).toBe('$0.420');
    expect(formatUsd(12.5)).toBe('$12.50');
    expect(formatUsd(0)).toBe('$0');
  });
});
