import type { TextStyle } from 'react-native';

/**
 * lockin is read at arm's length in a gym, and at 07:30 in bed.
 *
 * It began as a printed ledger — flat ink on paper, structure from hairlines
 * alone. That was distinctive and it was also hard to use: nothing looked
 * tappable, sections ran together, and the primary action was a white slab
 * that read as disabled when it was disabled. So the paper is gone and the
 * ink stayed.
 *
 * Depth comes from lightness, not shadow. A shadow on near-black is mud;
 * a surface one step lighter than the page reads instantly as an object on it.
 * Three steps is the whole system: page, card, control.
 *
 * Bone on near-black rather than white on pure black: warmer, and it does not
 * glare at either hour.
 */

export const colors = {
  /** The page. Near-black, a touch warm — pure black is a void; this is ink. */
  bg: '#0B0B0C',
  /** A card on the page. One step up is all it takes to read as an object. */
  surface: '#141417',
  /** A control on a card. Two steps up, and never used on the page directly. */
  surfaceHigh: '#1F1F23',
  /** Dividers inside a card. Structure, not enclosure. */
  border: '#2A2A30',

  /** Bone, not white. Paper rather than screen. */
  text: '#EDEAE3',
  /**
   * Long-form reading. Between `text` and `textDim`, and the gap it fills is
   * real: a paragraph set in bone is heavy on this ground, and one set in
   * textDim makes the primary content of a screen its faintest element — the
   * trainer's replies were both in turn.
   */
  textBody: '#C6C1B8',
  textDim: '#918D85',
  textFaint: '#57544E',

  /**
   * The one colour. Amber because every other training app is green, and
   * because it is the colour of something finished rather than something
   * permitted.
   *
   * It carries two jobs — the primary action, and a number on target — which
   * would be one too many if they looked alike. They do not: an action is a
   * filled amber shape, a state is amber text. Fill means press me.
   */
  accent: '#E8A33D',
  /** Amber at low opacity, for a control that is tinted rather than filled. */
  accentSoft: 'rgba(232, 163, 61, 0.14)',
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
 * Corners are round, and the amount says what a thing is: a chip, a control,
 * or a surface holding others. Square corners read as a table cell, which is
 * what made every button in this app look like a region rather than a target.
 */
export const radius = {
  /** Chips, tags, small toggles. */
  sm: 10,
  /** Buttons and inputs — anything a thumb lands on. */
  md: 14,
  /** Cards. Generous, because they hold other things. */
  lg: 22,
  pill: 999,
} as const;

/** Tabular numerals everywhere: a changing figure must not shift the layout. */
const mono: TextStyle = { fontVariant: ['tabular-nums'] };

export const type = {
  /**
   * Section headings. Small, wide, quiet — they name the thing and then stop.
   */
  /**
   * Section headings. Small, wide, quiet — they name the thing and then stop.
   *
   * The tracking was 1.8, which at 11pt is wide enough that a heading reads
   * as a texture rather than a word, and there are three or four on most
   * screens. At 1.1 they still read as labels and stop being the most
   * distinctive thing on the page.
   */
  label: { fontSize: 11, fontWeight: '600', letterSpacing: 1.1 },
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
 * The tab bar's own height, above the home indicator. Icons and labels now, so
 * it is taller than the label-only bar it replaced. Screens allow for it
 * because the safe-area inset does not.
 */
export const tabBarHeight = 68;

/** Small caps, spaced. Used for every label in the app. */
export const caps = (value: string) => value.toUpperCase();
