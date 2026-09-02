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
 * The masthead date, in German. His app, his language — and it is the one
 * moment of the interface that should feel like it belongs to a person rather
 * than to a product.
 */
export function longDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  const weekday = date.toLocaleDateString('de-DE', { weekday: 'long' });
  const day = date.getDate();
  const month = date.toLocaleDateString('de-DE', { month: 'long' });
  return `${weekday} · ${day}. ${month}`;
}

export function shortDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
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
 * The one line of the interface that speaks to him directly, in German like
 * the date beside it. It shifts through the day so that seeing it ten times
 * does not wear the way a fixed "Hello" would.
 */
export function greeting(name: string | null, now: Date = new Date()): string {
  const hour = now.getHours();
  const who = name ? `, ${name}` : '';
  if (hour < 5) return `Noch wach${who}?`;
  if (hour < 11) return `Guten Morgen${who}`;
  if (hour < 18) return `Hallo${who}`;
  if (hour < 22) return `Guten Abend${who}`;
  return `Noch wach${who}?`;
}
