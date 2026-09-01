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

export function longDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
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
