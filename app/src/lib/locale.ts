/**
 * The language the interface speaks.
 *
 * lockin was written for one German athlete, so the greeting and the date on
 * the masthead were German literals. That is exactly the sort of thing that
 * makes an app feel like somebody else's — a friend in Boston opening it to
 * "Guten Abend" is being shown around a house rather than handed the keys.
 *
 * Deliberately not an i18n framework. There are two audiences and about six
 * phrases; a library, a bundle format and a translation pipeline would be more
 * machinery than the words justify. When there is a third language, this file
 * grows a column.
 */

export type Language = 'de' | 'en';

/**
 * The athlete's own choice, when they have made one. Held in a module variable
 * so formatting stays synchronous — every screen calls these functions while
 * rendering — and mirrored into the keychain so the first paint after a cold
 * start is already in the right language rather than flickering into it.
 */
let preferred: string | null = null;

export function setPreferredLocale(locale: string | null): void {
  preferred = locale;
}

export function preferredLocale(): string | null {
  return preferred;
}

/**
 * What the phone is set to. A fallback, not the answer: it says what the
 * device speaks, not what the person wants the coach to speak.
 */
export function systemLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en-GB';
  } catch {
    return 'en-GB';
  }
}

/** The locale to format dates and numbers in. */
export function deviceLocale(): string {
  return preferred ?? systemLocale();
}

/** Which of the languages we actually have words for. */
export function language(): Language {
  return deviceLocale().toLowerCase().startsWith('de') ? 'de' : 'en';
}

type Phrase = Record<Language, string>;

const PHRASES = {
  thisWeek: { de: 'Diese Woche', en: 'This week' },
  today: { de: 'Heute', en: 'Today' },
  lifts: { de: 'Einheiten', en: 'lifts' },
  weighIns: { de: 'Wiegen', en: 'weigh-ins' },
  proteinLeft: { de: 'g Protein übrig', en: 'g protein left' },
  kcalLeft: { de: 'KCAL ÜBRIG', en: 'KCAL LEFT' },
  sevenDayAvg: { de: '7-TAGE-SCHNITT', en: '7-DAY AVG' },
  thisWeekShort: { de: 'DIESE WOCHE', en: 'THIS WEEK' },

  tabToday: { de: 'HEUTE', en: 'TODAY' },
  tabTrainer: { de: 'TRAINER', en: 'TRAINER' },
  tabFood: { de: 'ESSEN', en: 'FOOD' },
  tabWeight: { de: 'GEWICHT', en: 'WEIGHT' },

  progress: { de: 'FORTSCHRITT', en: 'PROGRESS' },
  rules: { de: 'REGELN', en: 'RULES' },
  backToToday: { de: 'ZURÜCK ZU HEUTE', en: 'BACK TO TODAY' },

  start: { de: 'Los', en: 'Start' },
  resume: { de: 'Weiter', en: 'Resume' },
  trainAgain: { de: 'Nochmal', en: 'Train again' },
  liftAnyway: { de: 'Trotzdem', en: 'Lift anyway' },
} satisfies Record<string, Phrase>;

export function t(key: keyof typeof PHRASES): string {
  return PHRASES[key][language()];
}

/** Greetings that shift through the day, so ten a day does not wear thin. */
const GREETINGS: Record<Language, { night: string; morning: string; day: string; evening: string }> = {
  de: {
    night: 'Noch wach',
    morning: 'Guten Morgen',
    day: 'Hallo',
    evening: 'Guten Abend',
  },
  en: {
    night: 'Still up',
    morning: 'Good morning',
    day: 'Hello',
    evening: 'Good evening',
  },
};

export function greetingWords(now: Date = new Date()): { text: string; question: boolean } {
  const words = GREETINGS[language()];
  const hour = now.getHours();
  if (hour < 5) return { text: words.night, question: true };
  if (hour < 11) return { text: words.morning, question: false };
  if (hour < 18) return { text: words.day, question: false };
  if (hour < 22) return { text: words.evening, question: false };
  return { text: words.night, question: true };
}
