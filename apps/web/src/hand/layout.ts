/**
 * Lays out a small subset of LaTeX as positioned glyphs, in em units with the baseline at y = 0.
 * Only what answers actually contain: numbers, variables, operators, fractions, powers,
 * roots, text and line breaks.
 */

import type { Column } from '../types';
import { GLYPHS, XH, hasGlyph } from './glyphs';

export interface LaidGlyph {
  ch: string;
  x: number;
  y: number;
  /** Scale relative to the base font size (powers and fraction parts are smaller). */
  s: number;
}

/** A drawn line: fraction bars, the bar over a root, and the dividers between columns. */
export interface LaidRule {
  x1: number;
  y1: number;
  x2: number;
  /** Set for a vertical line from (x1, y1) down to (x1, y2). */
  y2?: number;
  s: number;
}

export interface Laid {
  glyphs: LaidGlyph[];
  rules: LaidRule[];
  w: number;
  /** Distance from the first baseline to the last. */
  lines: number;
  /** Where the final answer sits, so it can be boxed: its baseline and horizontal extent, in em. */
  final?: { x0: number; x1: number; y: number };
}

const SYMBOLS: Record<string, string> = {
  times: '×', cdot: '·', div: '÷', pm: '±', approx: '≈', neq: '≠', ne: '≠',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', infty: '∞', pi: 'π', theta: 'θ',
  alpha: 'α', beta: 'β', Delta: 'Δ', mu: 'μ', degree: '°', circ: '°',
  lambda: 'λ', sigma: 'σ', phi: 'φ', varphi: 'φ', omega: 'ω', tau: 'τ',
  sum: '∑', int: '∫', to: '→', rightarrow: '→', cdots: '·', ldots: '·',
  left: '', right: '', displaystyle: '', ',': ' ', ';': ' ', ':': ' ', '!': '', ' ': ' ',
  quad: ' ', qquad: ' ',
  // The hand has one arrow; implication arrows are written with it.
  Rightarrow: '→', implies: '→', Longrightarrow: '→', longrightarrow: '→', mapsto: '→',
  // No glyph for these: the answer is typeset instead (see `undrawable`).
  therefore: '∴', because: '∵', iff: '⇔', Leftrightarrow: '⇔', leftarrow: '←', Leftarrow: '⇐',
};

/** Commands written as their own name in letters: \sin is "sin". */
const OPERATORS = new Set([
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'lg', 'exp', 'lim', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'lcm', 'deg', 'arg',
  'dim', 'ker', 'mod', 'bmod', 'pmod', 'Pr',
]);

/** Commands that only change how big a bracket is drawn; they have nothing to write. */
const SIZING = new Set([
  'big', 'Big', 'bigg', 'Bigg', 'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr', 'Biggl', 'Biggr',
  'left', 'right', 'middle', 'displaystyle', 'textstyle', 'limits', 'nolimits',
]);

/** Commands that only style their argument; the argument is written as it is. */
const WRAPPERS = new Set([
  'mathbf', 'boldsymbol', 'mathit', 'mathsf', 'mathcal', 'mathbb', 'overline', 'underline',
  'hat', 'vec', 'bar', 'tilde', 'dot', 'boxed',
]);

const SUB = 0.62; // scale of powers, indices and fraction parts
const SPACE = 0.3;
const OP_PAD = 0.07;
const OPS = new Set(['+', '-', '=', '×', '·', '÷', '±', '≈', '≠', '≤', '≥', '<', '>', '→']);

/** Lookalike characters models often write, mapped to the ones the hand can draw. */
const ALIASES: Record<string, string> = {
  '⋅': '·', '∙': '·', '•': '·', '−': '-', '–': '-', '—': '-', '＝': '=', '∗': '*',
  '′': "'", '’': "'", '‘': "'", '“': '"', '”': '"',
};
const canon = (ch: string) => ALIASES[ch] ?? ch;

type Tok =
  | { t: 'ch'; v: string }
  | { t: 'sym'; v: string }
  | { t: 'sup' | 'sub' | 'sqrt' | 'text'; body: Tok[] }
  | { t: 'frac'; num: Tok[]; den: Tok[] }
  | { t: 'br' };

/** Reads a {...} group, or a single token if there are no braces. */
function readGroup(src: string, i: number): [string, number] {
  while (src[i] === ' ') i++;
  if (src[i] !== '{') {
    if (src[i] === '\\') {
      let j = i + 1;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      return [src.slice(i, Math.max(j, i + 2)), Math.max(j, i + 2)];
    }
    return [src[i] ?? '', i + 1];
  }
  let depth = 0;
  let j = i;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) break;
  }
  return [src.slice(i + 1, j), j + 1];
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];

    if (c === '\\') {
      if (src[i + 1] === '\\') {
        out.push({ t: 'br' });
        i += 2;
        continue;
      }
      let j = i + 1;
      while (j < src.length && /[a-zA-Z]/.test(src[j])) j++;
      let name = src.slice(i + 1, j);
      if (!name) {
        name = src[i + 1] ?? '';
        j = i + 2;
      }
      i = j;
      if (SIZING.has(name)) {
        // \left. and \right. are invisible delimiters: skip the dot too.
        if ((name === 'left' || name === 'right') && src[i] === '.') i++;
        continue;
      }
      if (WRAPPERS.has(name)) {
        const [a, ia] = readGroup(src, i);
        i = ia;
        out.push(...tokenize(a));
        continue;
      }
      if (name === 'frac' || name === 'tfrac' || name === 'dfrac') {
        const [a, ia] = readGroup(src, i);
        const [b, ib] = readGroup(src, ia);
        i = ib;
        out.push({ t: 'frac', num: tokenize(a), den: tokenize(b) });
      } else if (name === 'sqrt') {
        if (src[i] === '[') i = src.indexOf(']', i) + 1 || i; // ignore the index of a root
        const [a, ia] = readGroup(src, i);
        i = ia;
        out.push({ t: 'sqrt', body: tokenize(a) });
      } else if (name === 'text' || name === 'mathrm' || name === 'operatorname') {
        const [a, ia] = readGroup(src, i);
        i = ia;
        out.push({ t: 'text', body: [...a].map((ch) => ({ t: 'ch' as const, v: ch })) });
      } else {
        const sym = SYMBOLS[name];
        if (sym === undefined && (OPERATORS.has(name) || name.length === 1)) {
          for (const ch of name) out.push({ t: 'ch', v: ch });
        } else if (sym === undefined) {
          // Any other command spelled out would write its name ("Rightarrow") as the answer.
          // As an unknown symbol it is caught by `undrawable`, and the answer is typeset.
          out.push({ t: 'sym', v: `\\${name}` });
        } else if (sym) {
          out.push({ t: 'sym', v: sym });
        }
      }
      continue;
    }

    if (c === '^' || c === '_') {
      const [a, ia] = readGroup(src, i + 1);
      i = ia;
      out.push({ t: c === '^' ? 'sup' : 'sub', body: tokenize(a) });
      continue;
    }

    if (c === '{' || c === '}' || c === '$') {
      i++;
      continue;
    }

    out.push({ t: 'ch', v: c });
    i++;
  }
  return out;
}

interface Row {
  glyphs: LaidGlyph[];
  rules: LaidRule[];
  w: number;
}

const widthOf = (ch: string, s: number) => (GLYPHS[ch]?.w ?? GLYPHS['?'].w) * s;

/** Lays out tokens left to right at scale `s`, with the baseline at y = 0. */
function layRow(toks: Tok[], s: number): Row {
  const glyphs: LaidGlyph[] = [];
  const rules: LaidRule[] = [];
  let x = 0;
  let prevOp = true; // suppress leading operator padding

  const place = (r: Row, dx: number, dy: number) => {
    for (const g of r.glyphs) glyphs.push({ ...g, x: g.x + dx, y: g.y + dy });
    for (const u of r.rules) rules.push({ ...u, x1: u.x1 + dx, x2: u.x2 + dx, y1: u.y1 + dy });
  };

  for (const tok of toks) {
    switch (tok.t) {
      case 'ch':
      case 'sym': {
        const ch = canon(tok.v);
        if (ch === ' ') {
          x += SPACE * s;
          break;
        }
        const op = OPS.has(ch);
        if (op && !prevOp) x += OP_PAD * s;
        const draw = hasGlyph(ch) ? ch : '?';
        glyphs.push({ ch: draw, x, y: 0, s });
        x += widthOf(draw, s);
        if (op) x += OP_PAD * s;
        prevOp = op;
        break;
      }

      case 'text': {
        const r = layRow(tok.body, s);
        place(r, x, 0);
        x += r.w;
        prevOp = false;
        break;
      }

      case 'sup':
      case 'sub': {
        const r = layRow(tok.body, s * SUB);
        place(r, x, tok.t === 'sup' ? -XH * s * 0.95 : XH * s * 0.42);
        x += r.w;
        prevOp = false;
        break;
      }

      case 'frac': {
        const num = layRow(tok.num, s * SUB);
        const den = layRow(tok.den, s * SUB);
        const w = Math.max(num.w, den.w) + 0.1 * s;
        const barY = -XH * s * 0.55;
        place(num, x + (w - num.w) / 2, barY - 0.2 * s);
        place(den, x + (w - den.w) / 2, barY + 0.46 * s);
        rules.push({ x1: x, y1: barY, x2: x + w, s });
        x += w + OP_PAD * s;
        prevOp = false;
        break;
      }

      case 'sqrt': {
        const body = layRow(tok.body, s);
        glyphs.push({ ch: '√', x, y: 0, s });
        const hookW = widthOf('√', s);
        place(body, x + hookW, 0);
        rules.push({ x1: x + hookW * 0.92, y1: -0.78 * s, x2: x + hookW + body.w + 0.04 * s, s });
        x += hookW + body.w + 0.06 * s;
        prevOp = false;
        break;
      }

      case 'br':
        break;
    }
  }
  return { glyphs, rules, w: x };
}

/** Lays out one LaTeX answer. Lines are stacked, each starting at x = 0. */
export function layoutLatex(latex: string): Laid {
  const toks = tokenize(latex);
  const lines: Tok[][] = [[]];
  for (const t of toks) {
    if (t.t === 'br') lines.push([]);
    else lines[lines.length - 1].push(t);
  }

  const glyphs: LaidGlyph[] = [];
  const rules: LaidRule[] = [];
  let w = 0;
  const step = 1.42;

  // Working written as a chain continues on new lines that start with "=". Those lines are
  // moved right so their "=" sits under the first "=" of the line above, as a teacher writes.
  // Spaces at the start or end of a line ("\\ = ...") would push its first "=" off the left edge.
  const isSpace = (t: Tok) => (t.t === 'ch' || t.t === 'sym') && t.v.trim() === '';
  const rows = lines.map((toksInLine) => {
    let a = 0;
    let b = toksInLine.length;
    while (a < b && isSpace(toksInLine[a])) a++;
    while (b > a && isSpace(toksInLine[b - 1])) b--;
    return layRow(toksInLine.slice(a, b), 1);
  });
  const startsWithEq = (r: Row) => {
    const first = r.glyphs.find((g) => g.s === 1 && g.y === 0);
    return !!first && first.ch === '=' && first.x < 0.2;
  };
  let eqX = 0;
  const shifts = rows.map((r) => {
    if (startsWithEq(r)) return eqX;
    const eq = r.glyphs.find((g) => g.ch === '=' && g.s === 1 && g.y === 0 && g.x > 0.2);
    eqX = eq ? eq.x : 0;
    return 0;
  });

  rows.forEach((row, i) => {
    const dy = i * step;
    const dx = shifts[i];
    for (const g of row.glyphs) glyphs.push({ ...g, x: g.x + dx, y: g.y + dy });
    for (const u of row.rules) {
      rules.push({ ...u, x1: u.x1 + dx, x2: u.x2 + dx, y1: u.y1 + dy, ...(u.y2 !== undefined ? { y2: u.y2 + dy } : null) });
    }
    w = Math.max(w, row.w + dx);
  });

  const last = (lines.length - 1) * step;
  const lastRow = rows[rows.length - 1];
  const lastDx = shifts[shifts.length - 1] ?? 0;
  return { glyphs, rules, w, lines: last, final: { x0: lastDx, x1: lastDx + (lastRow?.w ?? w), y: last } };
}

/** Lays out plain text (answers that are words, not math). */
export function layoutText(text: string): Laid {
  return layoutLatex(text.replace(/[\\{}^_$]/g, ''));
}

const COL_GAP = 1.9; // space between the content of neighbouring columns, in em
const HEAD_SCALE = 0.7;
const HEAD_ROOM = 1.5; // baseline of the first body line when there are headings

/**
 * Lays out working as side-by-side columns: an optional heading over each, a rule under the
 * headings, and a vertical line between neighbouring columns. The final answer is the last
 * line of the last column.
 */
export function layoutColumns(cols: Column[]): Laid {
  const used = cols.filter((c) => c.lines.some((l) => l.trim()));
  if (used.length === 0) return layoutLatex('');
  const heads = used.map((c) => (c.heading.trim() ? layoutText(c.heading.trim()) : null));
  const bodies = used.map((c) => layoutLatex(c.lines.filter((l) => l.trim()).join(' \\\\ ')));
  const hasHead = heads.some(Boolean);
  const bodyTop = hasHead ? HEAD_ROOM : 0;
  const widths = used.map((_, i) => Math.max(bodies[i].w, (heads[i]?.w ?? 0) * HEAD_SCALE, 1.2));

  const xs: number[] = [];
  let x = 0;
  for (const w of widths) {
    xs.push(x);
    x += w + COL_GAP;
  }
  const total = x - COL_GAP;

  const glyphs: LaidGlyph[] = [];
  const rules: LaidRule[] = [];
  let bottom = bodyTop;
  used.forEach((_, i) => {
    const body = bodies[i];
    for (const g of body.glyphs) glyphs.push({ ...g, x: g.x + xs[i], y: g.y + bodyTop });
    for (const r of body.rules) {
      rules.push({
        ...r,
        x1: r.x1 + xs[i], x2: r.x2 + xs[i], y1: r.y1 + bodyTop,
        ...(r.y2 !== undefined ? { y2: r.y2 + bodyTop } : null),
      });
    }
    const head = heads[i];
    if (head) {
      for (const g of head.glyphs) {
        glyphs.push({ ...g, x: g.x * HEAD_SCALE + xs[i], y: g.y * HEAD_SCALE, s: g.s * HEAD_SCALE });
      }
    }
    bottom = Math.max(bottom, bodyTop + body.lines);
  });

  if (hasHead) rules.push({ x1: -0.3, y1: 0.42, x2: total + 0.3, s: 1 });
  for (let i = 1; i < used.length; i++) {
    const dx = xs[i] - COL_GAP / 2;
    rules.push({ x1: dx, y1: -0.85, x2: dx, y2: bottom + 0.5, s: 1 });
  }

  const last = used.length - 1;
  return {
    glyphs, rules, w: total, lines: bottom,
    final: { x0: xs[last], x1: xs[last] + widths[last], y: bodyTop + bodies[last].lines },
  };
}

/**
 * Characters in a LaTeX answer that the hand cannot draw. When there are any, the answer is
 * typeset instead, so a missing letter never shows up as a "?" in someone's working.
 */
export function undrawable(latex: string): string[] {
  const bad = new Set<string>();
  const walk = (toks: Tok[]) => {
    for (const t of toks) {
      if (t.t === 'ch' || t.t === 'sym') {
        const ch = canon(t.v);
        if (ch !== ' ' && !hasGlyph(ch)) bad.add(ch);
      } else if (t.t === 'frac') {
        walk(t.num);
        walk(t.den);
      } else if (t.t === 'sup' || t.t === 'sub' || t.t === 'sqrt' || t.t === 'text') {
        walk(t.body);
      }
    }
  };
  walk(tokenize(latex));
  return [...bad];
}
