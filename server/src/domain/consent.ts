/**
 * What somebody has to have agreed to before the app may hold their data.
 *
 * Training history, body weight and anything Apple Health sends are Article 9
 * data — a special category under the GDPR, next to biometrics and medical
 * records. The lawful basis for holding it is explicit consent, and explicit
 * means they were shown what they were agreeing to.
 *
 * Versions are dates because that is how the question arrives: not "which
 * number of the privacy notice" but "which notice was that, in March". A
 * version bump means everybody is asked again — which is the cost of changing
 * the document, and the reason not to change it carelessly.
 */

export const DOCUMENTS = ['privacy', 'terms'] as const;
export type ConsentDocument = (typeof DOCUMENTS)[number];

/**
 * The versions in force. Bumping one of these makes every existing consent
 * stale, and `missingConsents` starts naming it again.
 */
export const CURRENT_VERSIONS: Record<ConsentDocument, string> = {
  privacy: '2026-09-13',
  terms: '2026-09-13',
};

export type GivenConsent = {
  document: string;
  version: string;
  withdrawnAt: Date | string | null;
};

/**
 * Which documents this person still owes agreement to.
 *
 * A consent that was withdrawn does not count, and neither does one given to
 * an older version — the second is the whole reason the version is stored.
 */
export function missingConsents(given: readonly GivenConsent[]): ConsentDocument[] {
  return DOCUMENTS.filter(
    (document) =>
      !given.some(
        (consent) =>
          consent.document === document &&
          consent.version === CURRENT_VERSIONS[document] &&
          consent.withdrawnAt == null,
      ),
  );
}

/** Nothing outstanding. What the app checks before it lets somebody in. */
export const hasAgreedToEverything = (given: readonly GivenConsent[]): boolean =>
  missingConsents(given).length === 0;
