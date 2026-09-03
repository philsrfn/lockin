/**
 * What a model call costs.
 *
 * §1: the LLM never computes a number that matters, and a bill is a number
 * that matters. Token counts come from the provider; turning them into money
 * is arithmetic and lives here, tested.
 *
 * Rates are per million tokens, in USD, and they are the one thing in this
 * file that can quietly go stale — providers reprice and nothing tells you.
 * So they are overridable from the environment, every total is reported with
 * the rate that produced it, and a model nobody has priced is counted as
 * unpriced rather than as free. A dashboard that says $0.00 because it did not
 * recognise the model is worse than one that says "3 calls, no rate set".
 */

export type Rate = {
  /** USD per million prompt tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
};

/**
 * Defaults are Flash-class list prices. Check them against the console before
 * trusting a total to the cent — `GEMINI_PRICE_<MODEL>=<in>/<out>` overrides
 * one, and the admin page prints whichever rate it used.
 */
export const DEFAULT_RATES: Record<string, Rate> = {
  'gemini-3.6-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-flash': { input: 0.3, output: 2.5 },
  'gemini-2.5-pro': { input: 1.25, output: 10 },
};

export type Priced = {
  usd: number;
  /** Tokens whose model carries no rate. Reported, never silently zeroed. */
  unpricedTokens: number;
};

export type Spend = {
  model: string;
  promptTokens: number;
  outputTokens: number;
};

/**
 * `rates` is passed rather than read from the environment so this stays pure —
 * the caller assembles the table once and the tests can hand it anything.
 */
export function costOf(spend: Spend, rates: Record<string, Rate> = DEFAULT_RATES): Priced {
  const rate = rates[spend.model] ?? rates[normalise(spend.model)];

  if (!rate) {
    return { usd: 0, unpricedTokens: spend.promptTokens + spend.outputTokens };
  }

  return {
    usd: (spend.promptTokens / 1e6) * rate.input + (spend.outputTokens / 1e6) * rate.output,
    unpricedTokens: 0,
  };
}

export function totalCost(spends: Spend[], rates: Record<string, Rate> = DEFAULT_RATES): Priced {
  return spends.reduce<Priced>(
    (running, spend) => {
      const priced = costOf(spend, rates);
      return {
        usd: running.usd + priced.usd,
        unpricedTokens: running.unpricedTokens + priced.unpricedTokens,
      };
    },
    { usd: 0, unpricedTokens: 0 },
  );
}

/**
 * Providers append dated suffixes to a model string — `gemini-3.6-flash-002`
 * bills at the same rate as `gemini-3.6-flash`. Matching the stem means a
 * point release does not silently become unpriced.
 */
function normalise(model: string): string {
  return model.replace(/-\d{3,}$/, '').replace(/-(preview|exp|latest)(-.*)?$/, '');
}

/** Rates from `GEMINI_PRICE_<MODEL>` overrides, merged over the defaults. */
export function ratesFromEnv(env: Record<string, string | undefined>): Record<string, Rate> {
  const rates: Record<string, Rate> = { ...DEFAULT_RATES };

  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('GEMINI_PRICE_') || !value) continue;

    const parts = value.split('/').map(Number);
    const [input, output] = parts;
    if (parts.length !== 2) continue;
    if (input === undefined || output === undefined) continue;
    if (!Number.isFinite(input) || !Number.isFinite(output) || input < 0 || output < 0) continue;

    // GEMINI_PRICE_GEMINI_3_6_FLASH -> gemini-3.6-flash. Underscores become
    // hyphens, and a hyphen between two digits becomes the decimal point that
    // an environment variable name cannot carry.
    const model = key
      .slice('GEMINI_PRICE_'.length)
      .toLowerCase()
      .replace(/_/g, '-')
      .replace(/(\d)-(\d)/g, '$1.$2');

    rates[model] = { input, output };
  }

  return rates;
}

/** Money, for a page read at a glance. Sub-cent totals still have to be visible. */
export function formatUsd(usd: number): string {
  if (usd === 0) return '$0';
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}
