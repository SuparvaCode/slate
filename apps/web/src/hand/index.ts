import type { AiEl, StrokeEl } from '../model';
import { CAP } from './glyphs';
import { emptyBank, learnFrom, loadBank, saveBank } from './learn';
import type { Bank } from './learn';
import type { Column } from '../types';
import { undrawable } from './layout';
import { answerSource } from './place';
import { DEFAULT_STYLE, writeAnswer } from './writer';
import type { HandStroke, Written } from './writer';

export { CAP, XH } from './glyphs';
export type { HandStroke, Written } from './writer';
export { seedFrom } from './writer';
export { coverage } from './learn';
export { findSpot, readHand } from './place';
export type { Bank } from './learn';

/**
 * The user's learned letterforms. Kept here as one value rather than passed through every
 * draw call, since there is exactly one writing hand per user.
 */
let bank: Bank = emptyBank();
let loaded = false;

export function handBank(): Bank {
  if (!loaded) {
    bank = loadBank();
    loaded = true;
  }
  return bank;
}

/**
 * Learns the user's letterforms from a region the model has read. Returns the characters
 * captured, so the UI can say when the hand has improved.
 */
export function learnHand(sources: StrokeEl[], latex: string): string[] {
  const captured = learnFrom(handBank(), sources, latex);
  if (captured.length) saveBank(bank);
  return captured;
}

/** What the AI should write, or null when there is nothing to write yet. */
export function answerOf(el: AiEl): { source: string; kind: 'latex' | 'text' | 'columns' } | null {
  const r = el.response?.result;
  if (!r || r.placement === 'none') return null;
  // Columns may be at most about 1,400 world pixels wide at the user's letter size, so they
  // stay readable without zooming out; wider working is stacked instead.
  const maxEm = Math.max(18, 1400 / Math.max(1, el.fontSize));
  return answerSource(r.answer_latex, r.answer_text, r.steps ?? [], r.columns, maxEm);
}

/**
 * The handwriting for an AI answer. `fontSize` on the element is the line height the answer
 * was placed at; cap height is what the glyphs are sized from.
 */
export function writtenFor(el: AiEl): Written | null {
  const answer = answerOf(el);
  if (!answer) return null;
  return writeAnswer(answer.source, answer.kind, {
    ...DEFAULT_STYLE,
    slant: el.slant ?? DEFAULT_STYLE.slant,
    box: !!el.boxed,
    fontSize: el.fontSize,
    penWidth: el.penWidth,
    seed: el.seed,
    bank: handBank(),
  });
}

/** Characters in this answer that the hand cannot draw; empty when it can be written by hand. */
export function undrawableIn(el: AiEl): string[] {
  const a = answerOf(el);
  if (!a) return [];
  if (a.kind === 'columns') {
    try {
      const cols = JSON.parse(a.source) as Column[];
      return [...new Set(cols.flatMap((c) => [...undrawable(c.heading), ...c.lines.flatMap(undrawable)]))];
    } catch {
      return [];
    }
  }
  return undrawable(a.kind === 'text' ? a.source.replace(/[\\{}^_$]/g, '') : a.source);
}

/** How long the answer should take to write, matched to how much there is to write. */
export function writeDuration(written: Written, fontSize: number): number {
  const ems = written.total / Math.max(1, fontSize);
  return Math.min(5200, Math.max(420, (ems / 11) * 1000));
}

/**
 * The strokes to draw at `progress` (0 to 1): finished strokes in full, plus the prefix of
 * the one being written.
 */
export function strokesAt(written: Written, progress: number): { stroke: HandStroke; done: boolean }[] {
  if (progress >= 1) return written.strokes.map((stroke) => ({ stroke, done: true }));
  if (progress <= 0) return [];
  const target = written.total * progress;
  const out: { stroke: HandStroke; done: boolean }[] = [];
  let run = 0;
  for (let i = 0; i < written.strokes.length; i++) {
    const len = written.lengths[i];
    if (run + len <= target) {
      out.push({ stroke: written.strokes[i], done: true });
      run += len;
      continue;
    }
    // Partially written stroke: keep points up to the pen's position.
    const want = target - run;
    const stroke = written.strokes[i];
    const partial: HandStroke = [stroke[0]];
    let acc = 0;
    for (let p = 1; p < stroke.length && acc < want; p++) {
      acc += Math.hypot(stroke[p][0] - stroke[p - 1][0], stroke[p][1] - stroke[p - 1][1]);
      partial.push(stroke[p]);
    }
    if (partial.length > 1) out.push({ stroke: partial, done: false });
    break;
  }
  return out;
}

/** Size of the box an answer occupies, and where its first baseline sits inside it. */
export function measure(written: Written): { w: number; h: number; ascent: number } {
  return { w: written.w, h: written.h, ascent: written.ascent };
}

/** Cap height for a given line height, so answers match the user's letter size. */
export const capFor = (fontSize: number) => fontSize * CAP;
