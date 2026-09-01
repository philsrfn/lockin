import type { TextStyle } from 'react-native';

/**
 * One dark theme. Read in a gym, at arm's length, often one-handed and sweaty:
 * high contrast, large numbers, generous touch targets.
 */

export const colors = {
  bg: '#0B0D10',
  surface: '#151A21',
  surfaceHigh: '#1D242E',
  border: '#2A3340',

  text: '#F2F5F9',
  textDim: '#8D97A8',
  textFaint: '#5A6474',

  /** Protein, progress, go. */
  accent: '#4ADE80',
  accentDeep: '#173A26',

  warn: '#FBBF24',
  warnDeep: '#3A2E0B',
  danger: '#F87171',
  dangerDeep: '#3A1717',
} as const;

export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

/**
 * Tabular numerals, so a weight or a rep count does not jitter as it changes.
 * Declared separately because `as const` would freeze the array and TextStyle
 * wants a mutable one.
 */
const mono: TextStyle = { fontVariant: ['tabular-nums'] };

export const type = {
  /** Section headings: small, wide, dim. */
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2 },
  body: { fontSize: 16, fontWeight: '500' },
  bodyDim: { fontSize: 15, fontWeight: '400' },
  title: { fontSize: 20, fontWeight: '700' },
  /** The one number that matters on a screen. */
  hero: { fontSize: 44, fontWeight: '800', letterSpacing: -1 },
  numeral: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  mono,
} as const;
