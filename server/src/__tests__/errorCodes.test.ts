/**
 * The codes are a contract with the app, not a detail of the message.
 *
 * `app/src/lib/apiError.ts` maps each one to a sentence in German and
 * English. A code renamed on this side and not that one does not throw
 * anywhere — it silently goes back to showing the athlete the English
 * message, which is the thing this whole mechanism exists to stop. So the two
 * lists are checked against each other here.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(import.meta.dirname, '..', '..', '..', path), 'utf8');

/**
 * Every code the server actually sends, read out of the source.
 *
 * Two shapes: the helpers in `errors.ts` take one as their second argument,
 * and the error handler sends one directly for a schema rejection — that one
 * never passes through `badRequest`, because zod threw before any service ran.
 */
const thrown = (): string[] => {
  const files = [
    'server/src/services/barcode.ts',
    'server/src/services/programs.ts',
    'server/src/services/fridge.ts',
    'server/src/routes/index.ts',
    'server/src/index.ts',
  ];
  const found = new Set<string>();
  for (const file of files) {
    const source = read(file);
    for (const match of source.matchAll(/(?:badRequest|notFound|conflict|unauthorized)\([\s\S]*?,\s*'([a-z_]+)'\)/g)) {
      found.add(match[1]!);
    }
    for (const match of source.matchAll(/^\s*code: '([a-z_]+)',$/gm)) {
      found.add(match[1]!);
    }
  }
  return [...found].sort();
};

/** Every code the app has words for. */
const mapped = (): string[] => {
  const source = read('app/src/lib/apiError.ts');
  const block = source.slice(source.indexOf('const CODES'), source.indexOf('};', source.indexOf('const CODES')));
  return [...block.matchAll(/^\s{2}([a-z_]+):/gm)].map((match) => match[1]!).sort();
};

describe('the error codes the app translates', () => {
  it('finds the codes at all, so an empty pass cannot look like a pass', () => {
    expect(thrown().length).toBeGreaterThan(5);
    expect(mapped().length).toBeGreaterThan(5);
  });

  it('has words for every code the server throws', () => {
    const missing = thrown().filter((code) => !mapped().includes(code));

    expect(missing, 'add these to CODES in app/src/lib/apiError.ts').toEqual([]);
  });

  it('does not map a code nothing throws any more', () => {
    // `offline` is the app's own: it is what a dropped connection is called,
    // and no server can send it because no server was reached.
    const stale = mapped().filter((code) => code !== 'offline' && !thrown().includes(code));

    expect(stale, 'these are mapped but never sent').toEqual([]);
  });
});
