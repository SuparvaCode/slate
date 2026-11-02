/**
 * Repairs model JSON that holds LaTeX written with single backslashes. Port of jsonfix.py.
 *
 * Models often write "\\frac{3}{4}" as "\frac{3}{4}" inside a JSON string. JSON then reads \f as a
 * form feed, leaving "rac{3}{4}" (likewise \beta, \times, \theta, \right), and rejects the whole
 * object on escapes JSON lacks, such as \sqrt or \pi. A lone backslash before a letter or a symbol
 * is doubled, except for a real \uXXXX escape, a \r\n line break, and a \n that is not the start of
 * a LaTeX command.
 */

/** LaTeX commands that start with \n, so a \n in front of them is a command, not a newline. */
export const N_COMMANDS =
  'abla|atural|e|earrow|eg|eq|exists|ewline|geq|gtr|i|leq|less|mid|ot|otin|' +
  'olimits|onumber|ormalsize|parallel|sim|cong|subseteq|supseteq|u|warrow';

// A backslash after an even run of backslashes (so not itself escaped), before anything but the
// escapes that are never LaTeX: \" \/ and \\.
const LONE = /(?<!\\)((?:\\\\)*)\\(?=[^"/\\])/g;
const UNICODE = /^u[0-9a-fA-F]{4}/;
const N_COMMAND = new RegExp(`^n(?:${N_COMMANDS})(?![a-zA-Z])`);

export function repairLatexJson(text: string): string {
  return text.replace(LONE, (match: string, run: string, offset: number) => {
    const rest = text.slice(offset + match.length);
    if (UNICODE.test(rest) || rest.startsWith('r\\n')) return match;
    if (rest.startsWith('n') && !N_COMMAND.test(rest)) return match;
    return `${run}\\\\`;
  });
}
