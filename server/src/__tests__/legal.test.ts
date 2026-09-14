/**
 * Rendering the notices.
 *
 * They are the text somebody agreed to, and `consents` stores which version.
 * A renderer that quietly mangles a sentence makes the stored version point at
 * something other than what was on screen, which is the one property this
 * whole arrangement exists to have.
 */
import { describe, expect, it } from 'vitest';
import { legalPage } from '../legal';

const privacy = legalPage('privacy.de.md');
const terms = legalPage('terms.de.md');

describe('the notices as pages', () => {
  it('takes its title from the document', () => {
    expect(privacy).toContain('<title>Datenschutzerklärung · lockin</title>');
    expect(terms).toContain('<title>Nutzungsbedingungen · lockin</title>');
  });

  it('keeps the version on a line of its own', async () => {
    // It was being swallowed into the sentence after it, because a blank line
    // did not end the paragraph. Read from the consent module rather than
    // written out, so bumping a notice does not mean editing this test too —
    // the assertion below already checks the two agree.
    const { CURRENT_VERSIONS } = await import('../domain/consent');

    expect(privacy).toContain(`<p><strong>Fassung ${CURRENT_VERSIONS.privacy}</strong></p>`);
  });

  it('carries the version the consent records', async () => {
    const { CURRENT_VERSIONS } = await import('../domain/consent');

    expect(privacy).toContain(CURRENT_VERSIONS.privacy);
    expect(terms).toContain(CURRENT_VERSIONS.terms);
  });

  it('says the two things a store listing is checked for', () => {
    // Special-category data with a named basis, and a clear statement that
    // this is not medical advice.
    expect(privacy).toMatch(/Art\. 9/);
    expect(terms).toMatch(/[Kk]eine medizinische Beratung/);
  });

  it('names every processor the code actually talks to', () => {
    for (const processor of ['Google', 'Apple', 'OpenFoodFacts', 'Hetzner']) {
      expect(privacy).toContain(processor);
    }
  });

  it('escapes rather than trusting the markdown', () => {
    expect(privacy).not.toMatch(/<script/i);
  });

  it('renders bullets as a list, not as stray hyphens', () => {
    expect(privacy).toContain('<ul>');
    expect(privacy).not.toMatch(/<p>- /);
  });
});
