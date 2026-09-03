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
  // Short enough to sit on one line beside three others. German compounds are
  // long, and a label that wraps turns a calm row of numbers into a paragraph.
  sevenDayAvg: { de: 'Ø 7 TAGE', en: '7-DAY AVG' },
  thisWeekShort: { de: 'WOCHE', en: 'WEEK' },

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

  whereAreYou: { de: 'WO BIST DU', en: 'WHERE ARE YOU' },
  addPlace: { de: 'Ort hinzufügen', en: 'Add a place' },

  cardio: { de: 'CARDIO', en: 'CARDIO' },
  cardioTally: { de: 'Cardio', en: 'cardio' },
  logCardio: { de: 'Cardio eintragen', en: 'Log cardio' },
  minutes: { de: 'MINUTEN', en: 'MINUTES' },
  kindZone2: { de: 'Zone 2', en: 'Zone 2' },
  kindIntervals: { de: 'Intervalle', en: 'Intervals' },
  kindSport: { de: 'Sport', en: 'Sport' },
  kindWalk: { de: 'Gehen', en: 'Walk' },
  walkNote: {
    de: 'Zählt nicht für die Woche — Schritte sind Schritte.',
    en: 'Does not count towards the week — steps are steps.',
  },
  save: { de: 'Sichern', en: 'Save' },

  appleHealth: { de: 'APPLE HEALTH', en: 'APPLE HEALTH' },
  healthBlurb: {
    de: 'Schritte, Schlaf, Ruhepuls und das Gewicht von einer Waage — damit du sie nicht eintippen musst.',
    en: 'Steps, sleep, resting heart rate and weight from a scale — so you do not type them in.',
  },
  healthConnect: { de: 'Verbinden', en: 'Connect' },
  healthConnected: { de: 'Verbunden', en: 'Connected' },
  healthDisconnect: { de: 'Trennen', en: 'Disconnect' },
  healthUnsupported: {
    de: 'Auf diesem Gerät nicht verfügbar.',
    en: 'Not available on this device.',
  },
  healthNothing: {
    de: 'Noch nichts geteilt. In der Health-App kannst du festlegen, was lockin lesen darf.',
    en: 'Nothing shared yet. The Health app is where you choose what lockin may read.',
  },
  steps: { de: 'SCHRITTE', en: 'STEPS' },

  logWeight: { de: 'Heutiges Gewicht sichern', en: "Log today's weight" },
  saving: { de: 'Sichern…', en: 'Saving…' },
  numberThatCounts: { de: 'DIE ZAHL, DIE ZÄHLT', en: 'THE NUMBER THAT COUNTS' },
  sevenDayAverage: { de: '7-Tage-Schnitt', en: '7-day average' },
  ofSevenDays: { de: 'von 7 Tagen', en: 'of 7 days' },
  vsLastWeek: { de: 'ggü. letzter Woche', en: 'vs last week' },
  weightFootnote: {
    de: 'Tag zu Tag ist Wasser und Salz. Der Schnitt ist der Trend — beurteile den Fortschritt an dieser Linie, nicht an diesem Morgen.',
    en: 'Day to day is water and salt. The average is the trend — judge progress on this line, not on this morning.',
  },
  recent: { de: 'ZULETZT', en: 'RECENT' },
  offlineAverages: {
    de: 'Offline — die Schnitte unten können hinterherhinken.',
    en: 'Offline — the averages below may be behind.',
  },
  savedOnPhone: {
    de: 'Auf dem Handy gesichert — wird synchronisiert, sobald du Empfang hast.',
    en: 'Saved on the phone — it will sync when you have signal.',
  },

  progressTitle: { de: 'Fortschritt', en: 'Progress' },
  days: { de: 'Tage', en: 'days' },
  oneYear: { de: '1 Jahr', en: '1 year' },
  reviewWeekEnding: { de: 'RÜCKBLICK · WOCHE BIS', en: 'REVIEW · WEEK ENDING' },
  wentWell: { de: 'LIEF GUT', en: 'WENT WELL' },
  changeOneThing: { de: 'DIESE WOCHE: EINE SACHE', en: 'THIS WEEK, CHANGE ONE THING' },
  changedThisWeek: { de: 'diese Woche geändert', en: 'changed this week' },
  weight: { de: 'GEWICHT', en: 'WEIGHT' },
  aboveGoal: { de: 'über deinem Ziel von', en: 'above your goal of' },
  // A German noun keeps its capital. Lowercasing the shared label produced
  // "woche" under the number, which reads as a typo rather than as a caption.
  thisWeekLower: { de: 'Woche', en: 'this week' },
  backToTodayShort: { de: '‹ Heute', en: '‹ Today' },
  notEnoughWeighIns: { de: 'Noch zu wenige Wiegungen.', en: 'Not enough weigh-ins yet.' },
  training: { de: 'TRAINING', en: 'TRAINING' },
  sessions: { de: 'Einheiten', en: 'sessions' },
  sets: { de: 'Sätze', en: 'sets' },
  volumeLifted: { de: 'bewegt', en: 'volume lifted' },
  liftsHeading: { de: 'ÜBUNGEN', en: 'LIFTS' },
  oneSessionSoFar: {
    de: 'Erst eine Einheit — für eine Linie braucht es zwei.',
    en: 'One session so far — a line needs two.',
  },
  toolSetContext: { de: 'Ort gewechselt', en: 'switched city' },
  toolLogWeight: { de: 'Gewicht eingetragen', en: 'logged your weight' },
  toolLogSet: { de: 'Satz eingetragen', en: 'logged a set' },
  toolLogSession: { de: 'Einheit aktualisiert', en: 'updated the session' },
  toolLogMeal: { de: 'Mahlzeit eingetragen', en: 'logged a meal' },
  toolLogCardio: { de: 'Cardio eingetragen', en: 'logged cardio' },
  toolSwapExercise: { de: 'Übung getauscht', en: 'swapped an exercise' },
  toolAdjustTargets: { de: 'Ziele geändert', en: 'changed your targets' },
  toolAddRule: { de: 'Regel ergänzt', en: 'added a rule' },
  toolDeactivateRule: { de: 'Regel abgeschaltet', en: 'turned off a rule' },
  toolGetToday: { de: 'heute nachgesehen', en: 'checked today' },
  toolGetHistory: { de: 'Historie gelesen', en: 'read your history' },
  chatPlaceholder: { de: 'Wie war es?', en: 'How did that feel?' },

  gProtein: { de: 'g Protein', en: 'g protein' },
  stillToGo: { de: 'noch offen', en: 'still to go' },
  kcalLeftOf: { de: 'kcal übrig von', en: 'kcal left of' },
  toTheFatFloor: { de: 'bis zum Fett-Minimum', en: 'to the fat floor' },
  fatFloorCleared: { de: 'Fett-Minimum erreicht', en: 'fat floor cleared' },
  oneTap: { de: 'EIN TIPP', en: 'ONE TAP' },
  myFoods: { de: 'MEIN ESSEN', en: 'MY FOODS' },
  scan: { de: 'Scannen', en: 'Scan' },
  describeIt: { de: 'Beschreiben', en: 'Describe it' },
  whatsInTheFridge: { de: 'Was ist im Kühlschrank?', en: "What's in the fridge?" },
  enterByHand: { de: 'Von Hand eintragen', en: 'Enter by hand' },
  logIt: { de: 'Eintragen', en: 'Log it' },
  tapToLogHoldToEdit: {
    de: 'Tippen zum Eintragen · halten zum Bearbeiten',
    en: 'Tap to log · hold to edit',
  },
  thinking: { de: 'denkt nach', en: 'thinking' },

  signInBlurb: {
    de: 'Ein Trainer, der deine Woche kennt — dein Training, dein Essen, dein Gewicht, an einem Ort.',
    en: 'A trainer who knows your week — your training, your food, your weight, in one place.',
  },
  signInPrivacy: {
    de: 'Apple teilt deinen Namen und deine E-Mail nur einmal, und nur mit dieser App. Du kannst beides verbergen.',
    en: 'Apple shares your name and email once, and only with this app. You can hide both.',
  },
  signingIn: { de: 'Anmelden…', en: 'Signing in…' },
  useServerToken: { de: 'Ich habe ein Server-Token', en: 'I have a server token' },
  serverUrl: { de: 'SERVER-ADRESSE', en: 'SERVER URL' },
  bearerToken: { de: 'TOKEN', en: 'BEARER TOKEN' },
  connect: { de: 'Verbinden', en: 'Connect' },
  checking: { de: 'Prüfen…', en: 'Checking…' },
  signInFailed: {
    de: 'Die Anmeldung hat nicht geklappt. Versuch es nochmal.',
    en: 'That sign-in did not go through. Try again.',
  },
  signInOffline: {
    de: 'Der Server war nicht erreichbar. Prüf deine Verbindung.',
    en: 'Could not reach the server. Check your connection.',
  },
  signInUnavailable: {
    de: 'Anmelden mit Apple geht auf diesem Gerät nicht. Nimm das Server-Token.',
    en: 'Sign in with Apple is not available on this device. Use a server token.',
  },
  tokenRejected: {
    de: 'Das Token wurde abgelehnt. Vergleich es mit dem, das du bekommen hast.',
    en: 'That token was rejected. Check it against the one you were given.',
  },
  serverUnreachable: {
    de: 'Diese Adresse war nicht erreichbar. Prüf die URL und ob der Server läuft.',
    en: 'Could not reach that address. Check the URL and that the server is up.',
  },

  account: { de: 'KONTO', en: 'ACCOUNT' },
  signOut: { de: 'Abmelden', en: 'Sign out' },
  signOutConfirm: {
    de: 'Auf diesem Gerät abmelden? Deine Daten bleiben auf dem Server.',
    en: 'Sign out on this device? Your data stays on the server.',
  },
  cancel: { de: 'Abbrechen', en: 'Cancel' },
  deleteAccount: { de: 'Konto löschen', en: 'Delete account' },
  deleteAccountConfirm: {
    de: 'Alles löschen — Training, Essen, Gewicht, Verlauf. Das lässt sich nicht rückgängig machen.',
    en: 'Delete everything — training, food, weight, history. This cannot be undone.',
  },
  deleteAccountAction: { de: 'Alles löschen', en: 'Delete everything' },

  couldNotLoadHistory: {
    de: 'Deine Historie konnte nicht geladen werden',
    en: 'Could not load your history',
  },
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
