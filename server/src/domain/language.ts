/**
 * What language to write to the athlete in. Pure.
 *
 * The interface is translated; the trainer was not, and a German athlete being
 * coached in English by an app whose own labels are German is a seam you can
 * feel. This is the one line of prompt that closes it.
 */

/** 'de-DE' → 'German'. Falls back to English, which every model handles. */
export function languageName(locale: string | null | undefined): string {
  if (!locale) return 'English';
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(locale.split('-')[0]!);
    return name && name !== locale ? name : 'English';
  } catch {
    return 'English';
  }
}

/** The instruction block. Kept short — it is repeated in every request. */
export function languageInstruction(locale: string | null | undefined): string {
  return `Write to him in ${languageName(locale)}.`;
}
