/** Shaping what the solver writes: side-by-side columns, and answers to "z = ?". Port of answers.py. */

export const MAX_COLUMNS = 3;
export const MAX_LINES = 8;
export const MAX_HEADING = 24;

export interface Column {
  heading: string;
  lines: string[];
}

// "z = ?" : one unknown, named, with a question mark where the value goes.
const UNKNOWN = /^\s*([A-Za-z](?:_\{?\w+\}?)?)\s*=\s*\?\s*$/;

/** Python's str() for the values a model can send in JSON. */
export function pyStr(v: unknown): string {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return String(v);
  return JSON.stringify(v);
}

const isDict = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Columns the model sent, made safe to draw. Keeps at most three columns of eight short lines.
 * Fewer than two usable columns means the working was not really side by side.
 */
export function cleanColumns(raw: unknown): Column[] {
  if (!Array.isArray(raw)) return [];
  const cols: Column[] = [];
  for (const item of raw) {
    if (!isDict(item)) continue;
    const lines = item.lines;
    if (!Array.isArray(lines)) continue;
    const clean: string[] = [];
    for (const line of lines) {
      const text = pyStr(line).replace(/\\\\|\r|\n/g, ' ').trim();
      if (text) clean.push(...splitChain(text.slice(0, 200)));
    }
    if (!clean.length) continue;
    const heading = pyStr(item.heading || '').replace(/\s+/g, ' ').trim().slice(0, MAX_HEADING);
    cols.push({ heading, lines: clean.slice(0, MAX_LINES) });
  }
  const kept = cols.slice(0, MAX_COLUMNS);
  return kept.length >= 2 ? kept : [];
}

export const endsWithQuestion = (written: string): boolean => written.trimEnd().endsWith('?');

/** The user stopped at "=" and left room for what comes next. */
export const endsWithEquals = (written: string): boolean => written.trimEnd().endsWith('=');

// The reader separates lines with a double backslash or a single one before a space.
const LINE_BREAK = /\\\\|\\(?=\s)/;

export function lastLine(written: string): string {
  const parts = written.split(LINE_BREAK);
  return parts[parts.length - 1];
}

/** "z = ?" asks for z, so the answer is written "z = 780", not a bare "780". */
export function nameUnknown(written: string, answer: string): string {
  const m = UNKNOWN.exec(lastLine(written));
  const text = answer.trim();
  if (!m || !text || text.includes('=')) return answer;
  return `${m[1]} = ${text}`;
}

const TEXT_WRAPPER = /\\(?:text|mathrm|textbf|textit)\s*\{([^{}]*)\}/g;
const MATH_SIGNS = /[0-9+\-=*/^<>_]|\\(?!(?:text|mathrm|textbf|textit)\b)[A-Za-z]+/;

/** Whether something the user typed is a maths problem rather than a note. */
export const looksLikeMath = (text: string): boolean => MATH_SIGNS.test(text.replace(TEXT_WRAPPER, ' '));

/** The words in a typed note, without any \text{...} wrapper. */
export const plainText = (text: string): string => text.replace(TEXT_WRAPPER, '$1').replace(/\s+/g, ' ').trim();

/** The name a "z = ?" question asks for, or null when the last line is not that shape. */
export function questionUnknown(written: string): string | null {
  const m = UNKNOWN.exec(lastLine(written));
  return m ? m[1] : null;
}

/** Splits on a character that is not inside braces, brackets or parentheses. */
export function topSplit(text: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if ('{(['.includes(ch)) depth += 1;
    else if ('})]'.includes(ch)) depth -= 1;
    if (ch === sep && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts;
}

/** "F = ?" asks for one value, so "F = ma = 2 \cdot 3 = 6 N" becomes "F = 6 N". */
export function trimChain(written: string, answer: string): string {
  const unknown = questionUnknown(written);
  const text = answer.trim();
  if (!unknown || !text) return answer;
  if (topSplit(text, ',').length > 1 || text.includes('\\quad') || text.includes('\\text{or}') || text.includes('\\begin')) return answer;
  const parts = topSplit(text, '=');
  if (parts.length < 3 || !parts[parts.length - 1].trim()) return answer;
  let last = parts[parts.length - 1].trim();
  if (last.includes('\\approx')) {
    const bits = last.split('\\approx');
    last = bits[bits.length - 1].trim() || last;
  }
  return `${unknown} = ${last}`;
}

const PLAIN = /^[A-Za-z0-9_+\-*/^().,= ]*$/;
const SPACING = /\\(?:,|;|:|!|quad|qquad| )|~/g;
const UNITS = /\\(?:text|mathrm)\s*\{[^{}]*\}/g;

/** The machine-readable form of an answer, when it is plain enough to read safely. */
export function exprFromLatex(latex: string): string {
  let text = latex.replace(UNITS, ' ').replace(SPACING, ' ').trim();
  if (text && !text.includes(',') && text.includes('=')) text = text.slice(text.lastIndexOf('=') + 1).trim();
  if (!text || !PLAIN.test(text)) return '';
  return text;
}

/** A long "a = b = c" chain becomes short lines: "a = b", then "= c" under it. */
export function splitChain(line: string): string[] {
  const text = line.trim();
  if (!text || text.includes('\\begin')) return [line];
  const parts = topSplit(text, '=').map((p) => p.trim());
  if (parts.length && parts[0] === '' && parts.length >= 3) {
    if (parts.slice(1).some((p) => p === '')) return [line];
    return parts.slice(1).map((p) => `= ${p}`);
  }
  if (parts.length < 3 || parts.some((p) => p === '')) return [line];
  // "x - 2 = 0 or x - 3 = 0" and "x = 2, x = 3" are several equations side by side, not one
  // chain: splitting them would cut "0 or x - 3" from its "= 0".
  if (parts.slice(1, -1).some(joinsEquations)) return [line];
  return [`${parts[0]} = ${parts[1]}`, ...parts.slice(2).map((p) => `= ${p}`)];
}

const JOINERS =
  /\\text\{\s*(?:or|and)\s*\}|(?<![a-zA-Z\\])(?:or|and)(?![a-zA-Z])|\\(?:quad|qquad|implies|Rightarrow|Longrightarrow|iff|Leftrightarrow|therefore)(?![a-zA-Z])|\\\\/;

/** True when the middle of a chain holds a separator between two equations. */
export function joinsEquations(part: string): boolean {
  // "\," and "\;" are LaTeX spacing, not separators.
  const p = part.replaceAll('\\,', ' ').replaceAll('\\;', ' ');
  if (topSplit(p, ',').length > 1 || topSplit(p, ';').length > 1) return true;
  return JOINERS.test(p);
}

export function splitChains(lines: string[]): string[] {
  return lines.flatMap((l) => splitChain(l));
}
