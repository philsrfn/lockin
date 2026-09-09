/**
 * Nothing the model reads may assume the athlete is a man.
 *
 * This is not a style rule. Tool descriptions, prompt templates and schema
 * descriptions are *input to Gemini* — the same words that tell it what
 * `log_meal` does also told it, in fifteen places, that its athlete was a he.
 * The app has been multi-user since migration 011, so for everybody except
 * user 1 that was simply false, and it was false in the one place nobody
 * looks: the schema, not the screen.
 *
 * A static guard rather than a review habit, for the same reason
 * `__tests__/tenancy.test.ts` is one. This is the mistake that costs nothing
 * to make, reads fine in the diff, and never throws.
 *
 * Comments are exempt: they are read by people, and a comment recounting what
 * went wrong for one particular athlete is allowed to name him.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const LLM = join(import.meta.dirname, '..');

const GENDERED = /\b(he|him|his|she|her|hers|himself|herself)\b/gi;

/** Every .ts under llm/, tests excluded. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sources(path));
    else if (entry.name.endsWith('.ts')) out.push(path);
  }
  return out;
}

/**
 * Comments removed, so only what ships to the model is left.
 *
 * `://` is spared because a URL is not a comment, and the model-facing text
 * in these files contains a couple of them.
 */
const withoutComments = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

describe('what the model is told about the athlete', () => {
  const files = sources(LLM);

  it('reads the whole directory, so an empty pass cannot look like a pass', () => {
    expect(files.length).toBeGreaterThan(5);
    expect(files.some((path) => path.endsWith('tools.ts'))).toBe(true);
  });

  it('never assumes a gender', () => {
    const offences: string[] = [];

    for (const path of files) {
      const code = withoutComments(readFileSync(path, 'utf8'));
      for (const [index, line] of code.split('\n').entries()) {
        const found = line.match(GENDERED);
        if (found) offences.push(`${path.split('/src/')[1]}:${index + 1}  ${found.join(', ')}  —  ${line.trim()}`);
      }
    }

    expect(offences, 'use they/them — this text is what Gemini reads').toEqual([]);
  });
});
