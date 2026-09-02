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
 * The one line of the interface that speaks to the reader directly. It shifts
 * through the day so that seeing it ten times does not wear the way a fixed
 * "Hello" would.
 */
export function greeting(name: string | null, now: Date = new Date()): string {
  const { text, question } = greetingWords(now);
  const who = name ? `, ${name}` : '';
  return `${text}${who}${question ? '?' : ''}`;
}
