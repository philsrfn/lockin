/**
 * Every user-facing string goes through `locale.ts` — §14, and the rule the
 * app keeps quietly breaking.
 *
 * Three sweeps have now found leftovers: 71 in the first pass, ten on the
 * Rules screen, and five more after that — including the §7 joint-pain
 * warning, which is the most important sentence the home screen can say and
 * had been sitting there in English. They hide because a literal in JSX looks
 * exactly like a literal that was meant to be there.
 *
 * So a guard, like `server/src/llm/__tests__/pronouns.test.ts`. It reads the
 * screens rather than running them, which is all this test runner can do —
 * and is enough, because what it is looking for is text that never reached
 * `t()` at all.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(import.meta.dirname, '..', '..', '..');

function screens(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...screens(path));
    else if (entry.name.endsWith('.tsx')) out.push(path);
  }
  return out;
}

/** Comments are prose for people and may say anything. */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** A quoted string handed to something that renders it. */
const RENDERED_LITERAL =
  /(?:caps\(|<Text[^>]*>\s*|title=\{?|placeholder=\{?|accessibilityLabel=\{?)['"]([A-Z][^'"]{2,60})['"]/g;

/**
 * Bare prose between tags: `<Text style={…}>Joint pain twice running</Text>`,
 * which is how the §7 warning survived every earlier sweep. Three words or
 * more, so a unit like `kg` or a bare `·` does not trip it.
 */
const JSX_TEXT = />\s*([A-Z][a-z]+(?:[ \n][a-zA-Z][\w'’-]*){2,})/g;

describe('user-facing text', () => {
  const files = screens(join(APP, 'app')).concat(screens(join(APP, 'src')));

  it('reads the screens, so an empty pass cannot look like a pass', () => {
    expect(files.length).toBeGreaterThan(15);
    expect(files.some((path) => path.endsWith('index.tsx'))).toBe(true);
  });

  it('always goes through locale.ts', () => {
    const offences: string[] = [];

    for (const path of files) {
      const code = withoutComments(readFileSync(path, 'utf8'));
      const where = path.split('/app/').slice(1).join('/app/');

      for (const match of code.matchAll(RENDERED_LITERAL)) {
        offences.push(`${where}: ${JSON.stringify(match[1])}`);
      }
      for (const match of code.matchAll(JSX_TEXT)) {
        offences.push(`${where}: ${JSON.stringify(match[1]!.replace(/\s+/g, ' '))}`);
      }
    }

    expect(offences, 'move these into locale.ts, German and English').toEqual([]);
  });
});
