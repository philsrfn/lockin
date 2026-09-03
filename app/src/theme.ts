import type { TextStyle } from 'react-native';

/**
 * lockin is a training ledger, and it is set like one.
 *
 * The design is the numbers. Everything else — labels, rules, chrome — gets out
 * of their way. No cards, no borders, no rounded boxes: structure comes from
 * hairlines and vertical rhythm, the way it does on a printed page.
 *
 * Read at arm's length in a gym, and at 07:30 in bed. Bone on near-black rather
 * than white on pure black: warmer, and it does not glare at either hour.
 */

export const colors = {
  /** Near-black, a touch warm. Pure black is a void; this is ink. */
  bg: '#0B0B0C',
  /** Only for things you type into. Almost everything else sits on the ground. */
  surface: '#131315',
  surfaceHigh: '#1A1A1D',
  /** Hairlines. Structure without boxes. */
  border: '#232326',

  /** Bone, not white. Paper rather than screen. */
  text: '#EDEAE3',
  textDim: '#918D85',
  textFaint: '#57544E',

  /**
   * One signal, spent sparingly — a number on target, a session done. Amber
   * because every other training app is green, and because it is the colour of
   * something finished rather than something permitted.
   */
  accent: '#E8A33D',
  accentDeep: '#2A1E0B',

  warn: '#E8A33D',
  warnDeep: '#2A1E0B',
  /** Reserved for the body: joint pain, safety floors. Never for emphasis. */
  danger: '#C9455A',
  dangerDeep: '#2B1016',
} as const;

/** A 4pt rhythm. Generous at the top end — air is most of the design. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 20,
  xl: 32,
  xxl: 48,
} as const;

/**
 * Corners are square. A radius is a box asking to be noticed, and nothing here
 * should be. The two exceptions are the progress rail and the context chip.
 */
export const radius = {
  sm: 0,
  md: 0,
  lg: 0,
  pill: 999,
} as const;

/** Tabular numerals everywhere: a changing figure must not shift the layout. */
const mono: TextStyle = { fontVariant: ['tabular-nums'] };

export const type = {
  /**
   * Section headings. Small, wide, quiet — they name the thing and then stop.
   */
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 1.8 },
  body: { fontSize: 16, fontWeight: '400' },
  bodyDim: { fontSize: 15, fontWeight: '400' },
  title: { fontSize: 22, fontWeight: '600', letterSpacing: -0.2 },

  /** The number the screen is about. One per screen, no more. */
  hero: { fontSize: 76, fontWeight: '300', letterSpacing: -3.5 },
  /** A number that matters, but is not the point of the screen. */
  numeral: { fontSize: 30, fontWeight: '400', letterSpacing: -0.8 },
  mono,
} as const;

/**
 * The tab bar's own height, above the home indicator. Labels only, no icons.
 * Screens allow for it because the safe-area inset does not.
 */
export const tabBarHeight = 52;

/** Small caps, spaced. Used for every label in the app. */
export const caps = (value: string) => value.toUpperCase();
