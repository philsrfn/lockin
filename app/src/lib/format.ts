import { deviceLocale, greetingWords } from './locale';

/** Display formatting. The domain returns full precision; rounding happens here. */

export function kg(value: number | null | undefined, decimals = 1): string {
  if (value == null) return '—';
  return value.toFixed(decimals).replace(/\.0$/, '');
}

export function signedKg(value: number | null | undefined, decimals = 1): string {
  if (value == null) return '—';
  const rounded = Number(value.toFixed(decimals));
  if (rounded === 0) return '±0';
  return `${rounded > 0 ? '+' : '−'}${Math.abs(rounded).toFixed(decimals)}`;
}

/**
 * The masthead date, in the reader's own language. It is the one moment of the
 * interface that should feel like it belongs to a person rather than to a
 * product — which is precisely why it cannot be hardcoded to somebody else's.
 *
 * Intl orders the day and the month: German writes "2. September", British
 * English "2 September", American English "September 2". Assembling that by
 * hand would only get it wrong somewhere.
 */
export function longDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  const locale = deviceLocale();
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(date);
  const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(date);
  return `${weekday} · ${dayMonth}`;
}

/** Two letters, for the week strip. Derived from the date, not from the server. */
export function weekdayShort(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  return new Intl.DateTimeFormat(deviceLocale(), { weekday: 'short' })
    .format(date)
    .replace(/[.,]/g, '')
    .slice(0, 2);
}

export function shortDate(iso: string): string {
  return new Intl.DateTimeFormat(deviceLocale(), {
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${iso}T12:00:00`));
}

export function clock(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** "3×8 @ 90kg", or "3×8" when the weight is not known yet. */
export function prescriptionLine(sets: number, reps: number, weightKg: number | null): string {
  return weightKg == null ? `${sets}×${reps}` : `${sets}×${reps} @ ${kg(weightKg)}kg`;
}

/** Collapses [12,12,10] @ 90 into "12·12·10 @ 90kg". */
export function performedLine(sets: { weightKg: number; reps: number }[]): string {
  if (sets.length === 0) return '';
  const reps = sets.map((set) => set.reps).join('·');
  const weights = [...new Set(sets.map((set) => set.weightKg))];
  const weight = weights.length === 1 ? `${kg(weights[0])}kg` : `${kg(Math.min(...weights))}–${kg(Math.max(...weights))}kg`;
  return `${reps} @ ${weight}`;
}

/**
 * The trainer writes for a phone, not for a renderer. It still reaches for
 * **bold** and bullet markers occasionally, and printing those raw put
 * asterisks in the middle of sentences. Stripped rather than rendered: this is
 * a chat, and a message with three weights of type in it is not calmer for it.
 */
export function plainText(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\s)\*(\S.*?\S|\S)\*(?=\s|$)/g, '$1$2')
    .replace(/(^|\s)_(\S.*?\S|\S)_(?=\s|$)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '· ')
    .replace(/`([^`]+)`/g, '$1');
}

/**
 * The one line of the interface that speaks to the reader directly. It shifts
 * through the day so that seeing it ten times does not wear the way a fixed
 * "Hello" would.
 */
export function greeting(name: string | null, now: Date = new Date()): string {
  const { text, question } = greetingWords(now);
  const who = name ? `, ${name}` : '';
  return `${text}${who}${question ? '?' : ''}`;
}

/**
 * A week, as a heading. "21.–27. Aug." rather than "21. Aug. – 27. Aug.":
 * the long form is nearly twice the width and collides with the tally beside
 * it. The month is repeated only when the week actually crosses one.
 */
export function dateRange(fromIso: string, toIso: string): string {
  const from = new Date(`${fromIso}T12:00:00`);
  const to = new Date(`${toIso}T12:00:00`);

  if (from.getMonth() === to.getMonth()) {
    // Day alone for the first date — German gets its ordinal dot from Intl,
    // English does not, and neither needs the month said twice.
    const day = new Intl.DateTimeFormat(deviceLocale(), { day: 'numeric' }).format(from);
    return `${day}–${shortDate(toIso)}`;
  }

  return `${shortDate(fromIso)} – ${shortDate(toIso)}`;
}
