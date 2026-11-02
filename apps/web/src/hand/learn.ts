/**
 * Learns the user's handwriting from the board.
 *
 * When the model reads a region, we know both the ink the user drew and the characters it
 * spells. Splitting that ink into characters and keeping the strokes gives us the user's own
 * letterforms, so answers can be written in their hand rather than an authored alphabet.
 */

import { ASC, CAP, DESC, XH } from './glyphs';
import { layoutLatex } from './layout';
import type { P2 } from './path';
import type { Bounds, StrokeEl } from '../model';

/** One captured character: strokes in em space, baseline at y = 0, up negative. */
export interface Sample {
  /** [x, y, pressure] per point, as the user drew it. */
  strokes: [number, number, number][][];
  /** Advance width in em units. */
  w: number;
}

export interface Bank {
  /** Character -> samples, newest last. */
  glyphs: Record<string, Sample[]>;
  /** Mean pen width of the ink we learned from, in em units. */
  penEm: number;
  learned: number;
}

const KEY = 'slate.hand.v1';
const MAX_PER_CHAR = 4;
const MAX_CHARS = 160;

/**
 * Where each character's ink sits relative to the baseline, as [top, bottom] heights above
 * it. Both are positive for marks that float above the line (an "=" spans 0.4 to 0.2), and
 * the bottom goes negative for descenders. The difference is the ink's true height, which is
 * what a captured cluster must be scaled by.
 */
const METRICS: Record<string, [top: number, bottom: number]> = {};
{
  const set = (chars: string, top: number, bottom = 0) => {
    for (const ch of chars) METRICS[ch] = [top, bottom];
  };
  set('0123456789', CAP);
  set('ABCDEFGHIJKLMNOPQRSTUVWXYZ', CAP);
  set('bdfhklt', ASC);
  set('i', 0.65);
  set('aceimnorsuvwxz', XH);
  set('gpqy', XH, -DESC);
  set('j', 0.65, -DESC);
  // Operators float above the baseline; these are their real ink extents.
  set('=', 0.4, 0.2);
  set('+±', 0.5, 0.1);
  set('×', 0.42, 0.18);
  set('÷', 0.47, 0.13);
  set('≈≠', 0.4, 0.17);
  set('≤≥', 0.52, -0.02);
  set('<>', 0.5, 0);
  set('()[]', 0.78, -0.2);
  set('√', 0.78, -0.08);
  set('πμ', XH);
  set('θ', 0.74);
  set('α', XH);
  set('β', CAP, -DESC);
  set('Δ', CAP);
  set('°', 0.72, 0.49);
  set('?!', CAP);
  set('%', CAP);
}

// Too small, too thin, or too easily mis-split to learn reliably.
const EXCLUDE = new Set([' ', ',', '.', "'", '-', '°']);

// --- splitting ink into characters ------------------------------------------

interface Cluster {
  strokes: StrokeEl[];
  x1: number;
  x2: number;
}

const strokeBounds = (s: StrokeEl): Bounds => {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const [x, y] of s.points) {
    if (x < x1) x1 = x;
    if (y < y1) y1 = y;
    if (x > x2) x2 = x;
    if (y > y2) y2 = y;
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
};

/**
 * Groups strokes into characters by horizontal position. Strokes that overlap or nearly touch
 * belong to one character, which keeps "=", "+", "x" and a dotted "i" together.
 */
function splitIntoCharacters(strokes: StrokeEl[], lineHeight: number): Cluster[] {
  const items = strokes
    .map((s) => ({ s, b: strokeBounds(s) }))
    .sort((a, b) => a.b.x - b.b.x);
  const gap = lineHeight * 0.14;
  const clusters: Cluster[] = [];

  for (const { s, b } of items) {
    const last = clusters[clusters.length - 1];
    if (last && b.x <= last.x2 + gap) {
      last.strokes.push(s);
      last.x1 = Math.min(last.x1, b.x);
      last.x2 = Math.max(last.x2, b.x + b.w);
    } else {
      clusters.push({ strokes: [s], x1: b.x, x2: b.x + b.w });
    }
  }
  return clusters;
}

/** The characters a recognized line spells, or null when it is too complex to learn from. */
function charsOf(latex: string): string[] | null {
  const laid = layoutLatex(latex);
  // Fractions, roots, powers and multiple lines move characters off the baseline, so the
  // ink cannot be split by horizontal position alone.
  if (laid.rules.length > 0 || laid.lines > 0) return null;
  if (laid.glyphs.some((g) => g.s !== 1 || g.y !== 0)) return null;
  const chars = laid.glyphs.map((g) => g.ch).filter((ch) => ch !== ' ');
  return chars.length ? chars : null;
}

// --- capturing --------------------------------------------------------------

function normalize(cluster: Cluster, baseline: number, scale: number): Sample | null {
  const strokes: [number, number, number][][] = [];
  for (const s of cluster.strokes) {
    // Baseline maps to y = 0; ink above the line is negative, matching the glyph convention.
    const pts = s.points.map(
      ([x, y, p]) => [(x - cluster.x1) * scale, (y - baseline) * scale, p] as [number, number, number],
    );
    if (pts.length >= 2) strokes.push(pts);
  }
  if (strokes.length === 0) return null;
  return { strokes, w: (cluster.x2 - cluster.x1) * scale + 0.08 };
}

/**
 * Learns from one recognized region. Returns the characters it captured.
 *
 * Only runs when the ink splits cleanly into as many characters as the model read, so a
 * misread or joined-up writing is skipped rather than learned wrongly.
 */
export function learnFrom(bank: Bank, sources: StrokeEl[], latex: string): string[] {
  const chars = charsOf(latex);
  if (!chars) return [];

  const pen = sources.filter((s) => s.kind === 'pen');
  if (pen.length === 0) return [];

  // Line height from the tallest ink, which is the user's cap height.
  const bounds = pen.map(strokeBounds);
  const lineHeight = Math.max(...bounds.map((b) => b.h));
  if (!(lineHeight > 4)) return [];

  const clusters = splitIntoCharacters(pen, lineHeight);
  if (clusters.length !== chars.length) return [];

  const captured: string[] = [];
  for (let i = 0; i < clusters.length; i++) {
    const ch = chars[i];
    if (EXCLUDE.has(ch) || !(ch in METRICS)) continue;

    const cluster = clusters[i];
    const b = cluster.strokes.map(strokeBounds);
    const top = Math.min(...b.map((r) => r.y));
    const low = Math.max(...b.map((r) => r.y + r.h));
    const h = low - top;
    if (!(h > 2)) continue;

    // Scale the captured ink so its height matches this character's em extent.
    const [emTop, emBottom] = METRICS[ch];
    const extent = emTop - emBottom;
    if (!(extent > 0.12)) continue; // too thin to scale without distorting it
    const scale = extent / h;
    // The baseline sits below the ink by however far this character's bottom is above it.
    const baseline = low + emBottom / scale;

    const sample = normalize(cluster, baseline, scale);
    if (!sample) continue;
    // Ignore anything wildly out of proportion: likely a bad split.
    if (sample.w < 0.08 || sample.w > 2) continue;

    const list = (bank.glyphs[ch] ??= []);
    list.push(sample);
    if (list.length > MAX_PER_CHAR) list.shift();
    captured.push(ch);
  }

  if (captured.length) {
    const widths = pen.map((s) => s.size);
    const penPx = widths.reduce((a, b) => a + b, 0) / widths.length;
    const em = penPx / (lineHeight / CAP);
    // Average the pen width in with what we already know.
    bank.penEm = bank.penEm > 0 ? bank.penEm * 0.7 + em * 0.3 : em;
    bank.learned += captured.length;
    prune(bank);
  }
  return captured;
}

function prune(bank: Bank) {
  const keys = Object.keys(bank.glyphs);
  if (keys.length <= MAX_CHARS) return;
  for (const k of keys.slice(0, keys.length - MAX_CHARS)) delete bank.glyphs[k];
}

// --- storage ----------------------------------------------------------------

export const emptyBank = (): Bank => ({ glyphs: {}, penEm: 0, learned: 0 });

export function loadBank(): Bank {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyBank();
    const data = JSON.parse(raw) as Partial<Bank>;
    const glyphs: Record<string, Sample[]> = {};
    for (const [ch, list] of Object.entries(data.glyphs ?? {})) {
      const valid = (Array.isArray(list) ? list : []).filter(
        (s): s is Sample =>
          !!s && Array.isArray(s.strokes) && s.strokes.length > 0 && typeof s.w === 'number' && Number.isFinite(s.w),
      );
      if (valid.length) glyphs[ch] = valid.slice(-MAX_PER_CHAR);
    }
    return {
      glyphs,
      penEm: typeof data.penEm === 'number' && Number.isFinite(data.penEm) ? data.penEm : 0,
      learned: typeof data.learned === 'number' ? data.learned : 0,
    };
  } catch {
    return emptyBank();
  }
}

export function saveBank(bank: Bank): void {
  try {
    // Round the points; full precision would triple the size for no visible gain.
    const r = (v: number) => Math.round(v * 1000) / 1000;
    const glyphs: Record<string, Sample[]> = {};
    for (const [ch, list] of Object.entries(bank.glyphs)) {
      glyphs[ch] = list.map((s) => ({
        w: r(s.w),
        strokes: s.strokes.map((st) => st.map(([x, y, p]) => [r(x), r(y), Math.round(p * 100) / 100] as [number, number, number])),
      }));
    }
    localStorage.setItem(KEY, JSON.stringify({ glyphs, penEm: r(bank.penEm), learned: bank.learned }));
  } catch {
    // storage full or blocked; the bank still works for this session
  }
}

/** Samples for a character, best first, or an empty list when it has not been seen. */
export const samplesFor = (bank: Bank, ch: string): Sample[] => bank.glyphs[ch] ?? [];

/** How much of what the AI needs to write it can already write in the user's hand. */
export function coverage(bank: Bank, text: string): number {
  const chars = [...new Set([...text].filter((c) => c !== ' '))];
  if (chars.length === 0) return 1;
  return chars.filter((c) => (bank.glyphs[c]?.length ?? 0) > 0).length / chars.length;
}

export type { P2 };
