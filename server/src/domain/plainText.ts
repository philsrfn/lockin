/**
 * Markdown out of a reply that is printed as plain text.
 *
 * The trainer persona says it plainly — "no markdown, no bold, no bullet
 * lists. The app prints what you write, so asterisks arrive as asterisks" —
 * and the model ignores it about one turn in seven. What the athlete sees is
 * `**190 g Protein**`, in the app's most-used screen.
 *
 * §1.3: hard rules are enforced by validators, not by prompts. Prompts drift;
 * this does not. The persona keeps the instruction, because a model that
 * writes plainly in the first place writes better sentences than one whose
 * asterisks are swept up afterwards — but the sweeping happens either way.
 *
 * Conservative on purpose. It removes what renders as visible rubbish and
 * leaves everything else, because a trainer's reply is full of things that
 * look like markup and are not: `3*8`, `2 x 5 @ 80kg`, an underscore in a
 * name.
 */

/**
 * Emphasis around content that starts and ends with a non-space.
 *
 * `pattern` is the marker as a regex, `char` the same thing as a literal for
 * the character class — they differ for `*`, which has to be escaped in one
 * place and not the other.
 *
 * `intraword` guards the underscore rules. Markdown itself refuses emphasis
 * inside a word for underscores and allows it for asterisks, and it is right
 * to: without that guard `snake_case_name` comes out as `snakecasename`, and
 * exercise ids and tool names in a reply are full of them.
 */
const paired = (pattern: string, char: string, intraword = true): RegExp => {
  const open = intraword ? '' : '(?<![\\w])';
  const close = intraword ? '' : '(?![\\w])';
  return new RegExp(
    `${open}${pattern}(?![\\s${char}])([^\\n]*?[^\\s${char}])${pattern}${close}`,
    'g',
  );
};

const RULES: [RegExp, string][] = [
  // Longest markers first: `**x**` must not be seen as `*` + `*x*` + `*`.
  [paired('\\*\\*', '\\*'), '$1'],
  [paired('__', '_', false), '$1'],
  [paired('\\*', '\\*'), '$1'],
  [paired('_', '_', false), '$1'],
  [/`([^`\n]+)`/g, '$1'],
  // Headings: the hashes go, the words stay.
  [/^#{1,6}[ \t]+/gm, ''],
  // A list it was told not to make. The marker is what looks broken, not the
  // list — an asterisk at the start of a line reads as emphasis nobody closed.
  [/^[ \t]*[*+-][ \t]+/gm, '• '],
];

export function plainText(text: string): string {
  return RULES.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text);
}
