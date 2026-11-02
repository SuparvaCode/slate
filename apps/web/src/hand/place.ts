/**
 * Decides where an answer goes on the board.
 *
 * The model says whether the answer continues the user's line or starts a new one; this
 * works out the actual coordinates. Two rules matter: measure the writing before placing it,
 * and never write over something that is already there.
 */

import { CAP } from './glyphs';
import { boundsOf, clamp, unionBounds, visualBounds } from '../model';
import type { Bounds, El, StrokeEl } from '../model';
import type { Column } from '../types';
import { layoutColumns } from './layout';

export type Placement = 'inline' | 'below' | 'none';

/** How the answer should be written: its size, its pen, and where it starts. */
export interface Spot {
  /** Left edge of the writing. */
  x: number;
  /** Baseline of its first line. */
  y: number;
  fontSize: number;
  penWidth: number;
  /** What the placement ended up being, which may differ from what was asked for. */
  placement: 'inline' | 'below';
}

/** The ink style the user wrote in: letter height and pen width. */
export interface Hand {
  fontSize: number;
  penWidth: number;
  /** Bounds of the writing's last line, which an inline answer continues. */
  lastLine: Bounds;
  /** Bounds of all the writing. */
  all: Bounds;
  /** How far the user's letters lean, in degrees; positive leans right. */
  slant: number;
}

/**
 * The height of the user's tall letters. Marks far shorter than most (dots, the bars of "=")
 * and marks far taller than the middle one (an integral sign, a large bracket) are ignored, so
 * one oversized symbol cannot make every answer oversized. The size is read from where most of
 * the letters are, not from the tallest mark.
 */
export function typicalCap(heights: number[]): number {
  const hs = heights.filter((h) => h > 0).sort((a, b) => a - b);
  if (hs.length === 0) return 0;
  const q3 = hs[Math.floor((hs.length - 1) * 0.75)];
  const sized = hs.filter((h) => h >= q3 * 0.3);
  const median = sized[Math.floor(sized.length / 2)];
  const letters = sized.filter((h) => h >= median * 0.5 && h <= median * 2.2);
  return letters[Math.min(letters.length - 1, Math.floor(letters.length * 0.8))] ?? median;
}

/**
 * The lean of the user's writing, from their tall narrow strokes (1, 7, l, t and the like),
 * or null when there are too few to tell.
 */
export function measureSlant(strokes: StrokeEl[], cap: number): number | null {
  const angles: number[] = [];
  for (const s of strokes) {
    if (s.points.length < 6) continue;
    const xs = s.points.map((p) => p[0]);
    const ys = s.points.map((p) => p[1]);
    const h = Math.max(...ys) - Math.min(...ys);
    const w = Math.max(...xs) - Math.min(...xs);
    if (h < cap * 0.55 || h > cap * 1.6 || h < w * 1.4) continue;
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sxy = 0;
    let syy = 0;
    for (let i = 0; i < xs.length; i++) {
      sxy += (xs[i] - mx) * (ys[i] - my);
      syy += (ys[i] - my) ** 2;
    }
    if (syy <= 0) continue;
    // Leaning right means x grows as y shrinks (up the page), so the slope is negative.
    angles.push((Math.atan(-sxy / syy) * 180) / Math.PI);
  }
  if (angles.length < 2) return null;
  angles.sort((a, b) => a - b);
  return clamp(angles[Math.floor(angles.length / 2)], -10, 22);
}

const GAP_EM = 0.34; // space before an inline answer
const BELOW_EM = 0.62; // space above an answer on its own line
const PAD = 3; // slack when testing for overlap, in world units
const OVERSIZE = 2.6; // a mark this many times taller than the letters is a symbol, not a letter

/** A mark too small to be a letter: a stray dot, a pen touch, a lone speck. */
export function isSpeck(b: Bounds, ref: number): boolean {
  return Math.max(b.w, b.h) < ref * 0.2;
}

/** Reads the user's writing style and line structure out of the ink they selected. */
export function readHand(sources: El[]): Hand {
  const all = unionBounds(sources.map(visualBounds))!;
  const boxes = sources.map((s) => ({ s, b: visualBounds(s) }));

  // The size of the user's letters, ignoring oversized marks (an integral sign) and specks.
  const globalCap = typicalCap(boxes.map((i) => i.b.h)) || all.h;
  // Oversized marks belong to the question, but they must not decide where its line is: an
  // integral sign running far below the text would otherwise drag the answer down with it.
  const sized = boxes.filter((i) => i.b.h <= globalCap * OVERSIZE);
  const pool = sized.length ? sized : boxes;
  const specks = pool.filter((i) => isSpeck(i.b, globalCap));
  const body = pool.filter((i) => !isSpeck(i.b, globalCap));

  // Group the ink into lines by vertical position, so an inline answer continues the last one
  // rather than the whole block. Specks take no part: one stray dot below the writing must not
  // become "the last line".
  const items = (body.length ? body : pool).sort(
    (a, b) => a.b.y + a.b.h / 2 - (b.b.y + b.b.h / 2),
  );
  const lineGap = Math.max(globalCap * 0.75, 12);

  const lines: { items: typeof items; b: Bounds }[] = [];
  for (const it of items) {
    const mid = it.b.y + it.b.h / 2;
    const last = lines[lines.length - 1];
    if (last && mid - (last.b.y + last.b.h / 2) < lineGap) {
      last.items.push(it);
      last.b = unionBounds([last.b, it.b])!;
    } else {
      lines.push({ items: [it], b: it.b });
    }
  }

  const lastGroup = lines[lines.length - 1];
  let lastLine = lastGroup?.b ?? all;
  // A full stop or an i-dot on the last line belongs to it, so an inline answer starts after
  // it. It only widens the line; a dot further away is left out.
  if (lastGroup && body.length) {
    const near = specks.filter(({ b }) => {
      const mid = b.y + b.h / 2;
      return mid >= lastLine.y - lastLine.h * 0.25 && mid <= lastLine.y + lastLine.h * 1.2;
    });
    if (near.length) {
      const x0 = Math.min(lastLine.x, ...near.map((n) => n.b.x));
      const x1 = Math.max(lastLine.x + lastLine.w, ...near.map((n) => n.b.x + n.b.w));
      lastLine = { ...lastLine, x: x0, w: x1 - x0 };
    }
  }

  // Letter height comes from the last line, unless that line is only small marks ("=", "-"),
  // which say little about how big the user writes.
  const lastItems = lastGroup?.items ?? items;
  const lineCap = typicalCap(lastItems.map((i) => i.b.h));
  const capHeight = clamp(lineCap >= globalCap * 0.5 ? lineCap : globalCap, 12, 220);

  // An inline answer sits on the line's baseline: where its last few letters end, not where its
  // lowest stroke does (a tail on "y", a stray mark). Written like this, the answer after an
  // "=" lines up with the "=" instead of hanging off the bottom edge of the question.
  const tail = lastItems
    .filter((i) => i.b.h >= capHeight * 0.45)
    .sort((a, b) => a.b.x + a.b.w - (b.b.x + b.b.w))
    .slice(-4)
    .map((i) => i.b.y + i.b.h)
    .sort((a, b) => a - b);
  if (tail.length) lastLine = { ...lastLine, y: tail[Math.floor(tail.length / 2)] - capHeight, h: capHeight };

  const ink = sources.filter((s): s is StrokeEl => s.type === 'stroke' && s.kind === 'pen');
  const slant = measureSlant(ink, capHeight) ?? 7;

  const pens = ink.map((s) => s.size);
  const penWidth = pens.length
    ? pens.reduce((a, b) => a + b, 0) / pens.length
    : clamp(capHeight * 0.1, 2.5, 14);

  return { fontSize: capHeight / CAP, penWidth, lastLine, all, slant };
}

const overlaps = (a: Bounds, b: Bounds) =>
  a.x < b.x + b.w + PAD && a.x + a.w + PAD > b.x && a.y < b.y + b.h + PAD && a.y + a.h + PAD > b.y;

/**
 * Finds a free place for writing of a known size, as close as possible to where it belongs.
 *
 * The first choices are the obvious ones: right after the last line for an inline answer, or
 * on a new line under the writing. When those are taken, free spots all around the question
 * are ranked by how far they are from the obvious one, with a penalty for ending up above or
 * left of the question, where nobody looks for an answer. A spot on the same row as the
 * question is only allowed when nothing sits between it and the question.
 *
 * `size` is the measured writing, so the real footprint is tested. Anything in `ignore` is
 * skipped as an obstacle, except that the question's own ink is never written over.
 */
export function findSpot(
  elements: El[],
  ignore: Set<string>,
  hand: Hand,
  size: { w: number; h: number; ascent: number },
  want: Placement,
): Spot {
  const { fontSize, penWidth, lastLine, all } = hand;
  const reach = Math.max(fontSize * 16, 500);
  const near: Bounds = { x: all.x - reach, y: all.y - reach, w: all.w + reach * 2, h: all.h + reach * 2 };
  const boundsFor = (e: El) => (e.type === 'ai' ? boundsOf(e) : visualBounds(e));

  // Other writing keeps a gap of about half a letter, so an answer never touches a
  // neighbouring problem and reads as belonging to its own question. The question's own ink
  // keeps only the small slack, so an inline answer can still sit right after it.
  const gap = Math.max(PAD, fontSize * 0.5);
  const grow = (o: Bounds): Bounds => ({ x: o.x - gap, y: o.y - gap, w: o.w + gap * 2, h: o.h + gap * 2 });
  const everyOther = elements.filter((e) => !ignore.has(e.id)).map((e) => grow(boundsFor(e)));
  // The search only looks near the question, so it only needs the obstacles that are near.
  const others = everyOther.filter((o) => overlaps(o, near));
  const own = elements.filter((e) => ignore.has(e.id) && e.type !== 'ai').map(boundsFor);

  const boxAt = (x: number, baseline: number): Bounds => ({
    x, y: baseline - size.ascent, w: size.w, h: size.h,
  });
  const clear = (b: Bounds, list: Bounds[]) => !list.some((o) => overlaps(b, o));
  const spot = (x: number, y: number, placement: 'inline' | 'below'): Spot => ({
    x, y, fontSize, penWidth, placement,
  });

  const lastRight = lastLine.x + lastLine.w;
  const inlineX = lastRight + fontSize * GAP_EM;
  const inlineY = lastLine.y + lastLine.h;
  const belowX = all.x;
  const belowY = all.y + all.h + fontSize * BELOW_EM + size.ascent;

  if (want === 'inline' && clear(boxAt(inlineX, inlineY), [...others, ...own])) {
    return spot(inlineX, inlineY, 'inline');
  }
  if (want !== 'inline' && clear(boxAt(belowX, belowY), others)) return spot(belowX, belowY, 'below');

  const blockers = [...others, ...own];
  const ref = want === 'inline' ? { x: inlineX, y: inlineY } : { x: belowX, y: belowY };
  const stepX = Math.max(fontSize * 0.5, reach / 40);
  const stepY = Math.max(fontSize * 0.45, reach / 40);
  let best: { x: number; y: number; cost: number; placement: 'inline' | 'below' } | null = null;

  for (let baseline = all.y - reach / 2; baseline <= all.y + all.h + reach; baseline += stepY) {
    for (
      let x = all.x - Math.min(reach / 2, size.w + fontSize);
      x <= all.x + all.w + reach;
      x += stepX
    ) {
      const box = boxAt(x, baseline);
      const sameRow = Math.abs(baseline - inlineY) <= fontSize * 0.6 && x >= lastRight;
      let cost = Math.hypot((x - ref.x) / fontSize, (baseline - ref.y) / (fontSize * 1.4));
      if (box.y + box.h <= all.y) cost += 4; // entirely above the question
      if (box.x + box.w <= all.x) cost += 3; // entirely to its left
      // Below the question with another problem in between, the answer reads as that
      // problem's answer. Beside the question is better, even when it is further away.
      if (box.y >= all.y + all.h) {
        const left = Math.max(box.x, all.x);
        const right = Math.min(box.x + box.w, all.x + all.w);
        const gapBelow: Bounds = { x: left, y: all.y + all.h, w: right - left, h: box.y - (all.y + all.h) };
        if (right > left && gapBelow.h > 0 && !clear(gapBelow, others)) cost += 12;
      }
      if (best && cost >= best.cost) continue;
      if (!clear(box, blockers)) continue;
      // On the question's row, the answer must be reachable: nothing in between.
      if (sameRow && !clear({ x: lastRight, y: box.y, w: x - lastRight, h: box.h }, blockers)) continue;
      best = { x, y: baseline, cost, placement: sameRow ? 'inline' : 'below' };
    }
  }
  if (best) return spot(best.x, best.y, best.placement);

  // Nothing free within reach: go down a line at a time. This goes beyond the search window,
  // so it must test every obstacle on the board, not just the nearby ones.
  const everything = [...everyOther, ...own];
  let y = belowY;
  for (let i = 0; i < 400; i++) {
    if (clear(boxAt(belowX, y), everything)) return spot(belowX, y, 'below');
    y += fontSize * 1.35;
  }
  return spot(inlineX, inlineY, 'inline');
}

/** What to write: side-by-side columns, else the working, else the bare answer. */
export function answerSource(
  answerLatex: string, answerText: string, steps: string[], columns?: Column[],
  /** The widest columns may be, in em. Wider ones are written as stacked steps instead. */
  maxColumnsEm = Infinity,
): { source: string; kind: 'latex' | 'text' | 'columns' } | null {
  const cols = (columns ?? []).filter((c) => c.lines.length > 0);
  if (cols.length >= 2) {
    if (layoutColumns(cols).w <= maxColumnsEm) return { source: JSON.stringify(cols), kind: 'columns' };
    // Too wide to read side by side without zooming far out: write the same lines stacked.
    return { source: cols.flatMap((c) => c.lines).join(' \\\\ '), kind: 'latex' };
  }
  if (steps.length > 0) {
    // Each step on its own line; the layout already understands \\ as a line break.
    return { source: steps.join(' \\\\ '), kind: 'latex' };
  }
  if (answerLatex.trim()) return { source: answerLatex, kind: 'latex' };
  if (answerText.trim()) return { source: answerText, kind: 'text' };
  return null;
}
