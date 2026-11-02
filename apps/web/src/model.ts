import { placePaths } from './figures';
import type { FigureKind } from './figures';
import type { SimKind, SimParams } from './sim';
import type { Diagram } from './diagram/types';
import type { RecognizeResponse, Work } from './types';
import type { Block } from './notes/types';

/** [x, y, pressure] in world coordinates. */
export type Pt = [number, number, number];

export type ColorKey = 'ink' | 'gray' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'violet';
export const COLOR_KEYS: ColorKey[] = ['ink', 'gray', 'red', 'orange', 'yellow', 'green', 'blue', 'violet'];

/** Stroke widths for S / M / L / XL. */
export const SIZES = [3, 5, 8, 13];
/** Text sizes for S / M / L / XL. */
export const TEXT_SIZES = [18, 26, 38, 56];
export const highlightSize = (i: number) => SIZES[i] * 2.6 + 8;

export const FONT = '-apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif';
export const LINE_HEIGHT = 1.3;

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Base {
  id: string;
  color: ColorKey;
}

export interface StrokeEl extends Base {
  type: 'stroke';
  kind: 'pen' | 'highlight';
  points: Pt[];
  size: number;
  /** True for mouse/touch input, which has no real pressure. */
  simulate: boolean;
}

/** How a shape or figure is turned about its centre: rotation in radians, then mirroring. */
interface Turned {
  rot?: number;
  fx?: boolean;
  fy?: boolean;
}

export interface ShapeEl extends Base, Turned {
  type: 'rect' | 'ellipse' | 'diamond';
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  fill: boolean;
}

export interface LineEl extends Base {
  type: 'line' | 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  size: number;
}

export interface TextEl extends Base {
  type: 'text';
  x: number;
  y: number;
  text: string;
  fontSize: number;
  w: number;
  h: number;
}

/** A classroom figure (solid, graph paper, apparatus, circuit symbol...) stretched to a box. */
export interface FigureEl extends Base, Turned {
  type: 'figure';
  kind: FigureKind;
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  fill: boolean;
}

/** An answer the AI wrote, drawn as real pen strokes in a handwriting style. */
export interface AiEl extends Base {
  type: 'ai';
  x: number;
  /** Baseline of the first written line, so the answer sits on the user's line. */
  y: number;
  w: number;
  h: number;
  /** Height of a capital letter, in world units. */
  fontSize: number;
  /** How far the writing reaches above the baseline. */
  ascent: number;
  /** Pen width, taken from the user's own ink. */
  penWidth: number;
  /** How far the user's writing leans, in degrees, so the answer leans the same way. */
  slant: number;
  /** A box round the final answer. */
  boxed: boolean;
  /** Draw the answer as typeset maths instead of handwriting. */
  typeset: boolean;
  /** The user's own correction of what was written. Kept so "solve again" reuses it. */
  readOverride?: string;
  /** Fixes the handwriting variation, so the ink never shimmers between repaints. */
  seed: number;
  status: 'loading' | 'done' | 'error';
  error?: string;
  /** The request was cut off (reload, closed tab, another board opened) and can be continued. */
  interrupted?: boolean;
  sourceIds: string[];
  sourceBox: Bounds;
  response?: RecognizeResponse;
  feedback?: 'correct' | 'wrong';
  createdAt: number;
  /** When the answer arrived; the writing animation plays once from this moment. */
  doneAt?: number;
  /** How the answer was worked out, shown in the Work window. */
  work?: Work;
}

/** A live simulator card (pulleys, circuits, optics...). Its settings are saved; its motion is not. */
export interface SimEl extends Base {
  type: 'sim';
  kind: SimKind;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Unused by the drawing; kept so style changes treat every shape alike. */
  size: number;
  params: SimParams;
}

/** A diagram built from the parts library, by the user or the AI. Solved and drawn from its data. */
export interface DiagramEl extends Base {
  type: 'diagram';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Unused by the drawing; kept so style changes treat every shape alike. */
  size: number;
  diagram: Diagram;
  /** What the user asked for, so "build again" and feedback can start from it. */
  prompt?: string;
  /** Where it came from. */
  source?: 'ai' | 'builder' | 'library';
}

/** A picture on the board: found by image search, or the user's own. Kept as a small JPEG data URL. */
export interface ImageEl extends Base {
  type: 'image';
  x: number;
  y: number;
  w: number;
  h: number;
  /** Unused by the drawing; kept so style changes treat every shape alike. */
  size: number;
  src: string;
  title?: string;
  /** The page the picture came from, for search results. */
  source?: string;
}

/**
 * One block of study notes the AI wrote by hand: a heading, a few lines, a formula, a table, a
 * checklist or a sketch. The strokes are made again from the block whenever it is drawn, so the
 * board saves only the words.
 */
export interface NoteEl extends Base {
  type: 'note';
  /** Top-left of the writing. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Unused by the drawing; kept so style changes treat every shape alike. */
  size: number;
  /** Letter size (em) the block was written at, in world units. */
  fontSize: number;
  penWidth: number;
  /** Width the lines were wrapped to, in world units. */
  wrap: number;
  seed: number;
  block: Block;
  /** The study session that wrote it, and where in its plan it belongs. */
  session: string;
  section: number;
  index: number;
  /** Written in the margin column beside the main notes. */
  side?: boolean;
  /** An answer to a question the student asked part-way (always in the margin). */
  answer?: boolean;
  /** Left edge of the column it was written in, so writing can continue in that column. */
  col: number;
}

export type El = StrokeEl | ShapeEl | LineEl | TextEl | AiEl | FigureEl | SimEl | DiagramEl | ImageEl | NoteEl;

export const uid = () => Math.random().toString(36).slice(2, 10);
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// --- text measuring ---------------------------------------------------------

let measureCtx: CanvasRenderingContext2D | null = null;

export function textSize(text: string, fontSize: number): { w: number; h: number } {
  measureCtx ??= document.createElement('canvas').getContext('2d')!;
  measureCtx.font = `${fontSize}px ${FONT}`;
  const lines = text.split('\n');
  const w = Math.max(fontSize * 0.5, ...lines.map((l) => measureCtx!.measureText(l).width));
  return { w, h: lines.length * fontSize * LINE_HEIGHT };
}

export function makeText(
  id: string, x: number, y: number, text: string, fontSize: number, color: ColorKey,
): TextEl {
  return { id, type: 'text', x, y, text, fontSize, color, ...textSize(text, fontSize) };
}

// --- bounds -----------------------------------------------------------------

const boundsCache = new WeakMap<El, Bounds>();

/** Geometric bounds, without stroke width. Elements are immutable, so this is cached. */
export function boundsOf(el: El): Bounds {
  let b = boundsCache.get(el);
  if (!b) {
    b = computeBounds(el);
    boundsCache.set(el, b);
  }
  return b;
}

function computeBounds(el: El): Bounds {
  switch (el.type) {
    case 'stroke': {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of el.points) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case 'rect':
    case 'ellipse':
    case 'diamond':
    case 'figure': {
      // A turned shape's bounds are the box round its turned corners.
      const b = boxOf(el);
      if (!el.rot) return b;
      const c = Math.abs(Math.cos(el.rot));
      const s = Math.abs(Math.sin(el.rot));
      const w = b.w * c + b.h * s;
      const h = b.w * s + b.h * c;
      return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w, h };
    }
    case 'sim':
    case 'diagram':
    case 'image':
      return boxOf(el);
    case 'note':
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    case 'line':
    case 'arrow':
      return {
        x: Math.min(el.x1, el.x2),
        y: Math.min(el.y1, el.y2),
        w: Math.abs(el.x2 - el.x1),
        h: Math.abs(el.y2 - el.y1),
      };
    case 'text':
      return { x: el.x, y: el.y, w: el.w, h: el.h };
    case 'ai':
      // y is the baseline, so the box starts where the writing's tallest letter reaches.
      return { x: el.x, y: el.y - el.ascent, w: el.w, h: el.h };
  }
}

/** Bounds including stroke width, which is what is actually visible on screen. */
export function visualBounds(el: El): Bounds {
  const b = boundsOf(el);
  let pad = 0;
  switch (el.type) {
    case 'stroke':
    case 'rect':
    case 'ellipse':
    case 'diamond':
    case 'figure':
      pad = el.size / 2;
      break;
    case 'line':
      pad = el.size / 2;
      break;
    case 'arrow':
      pad = Math.max(12, el.size * 3.4) * 0.6 + el.size / 2;
      break;
    default:
      break;
  }
  return { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
}

export function unionBounds(list: Bounds[]): Bounds | null {
  if (list.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const b of list) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function boundsIntersect(a: Bounds, b: Bounds): boolean {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

// --- hit testing ------------------------------------------------------------

export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

const inside = (b: Bounds, x: number, y: number, pad = 0) =>
  x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

/** True when (x, y) touches the element. `tol` is extra reach in world units. */
export function hitEl(el: El, x: number, y: number, tol: number): boolean {
  // A turned shape is tested in its own frame, where it is upright.
  if (turnable(el) && isTurned(el)) {
    const [lx, ly] = toLocal(el, x, y);
    return hitEl({ ...el, rot: 0, fx: false, fy: false }, lx, ly, tol);
  }
  const b = boundsOf(el);
  switch (el.type) {
    case 'stroke': {
      const r = el.size / 2 + tol;
      if (!inside(b, x, y, r)) return false;
      const p = el.points;
      if (p.length === 1) return Math.hypot(x - p[0][0], y - p[0][1]) <= r;
      for (let i = 1; i < p.length; i++) {
        if (distToSegment(x, y, p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]) <= r) return true;
      }
      return false;
    }
    case 'rect': {
      const r = el.size / 2 + tol;
      if (!inside(b, x, y, r)) return false;
      if (el.fill) return true;
      return !(x > b.x + r && x < b.x + b.w - r && y > b.y + r && y < b.y + b.h - r);
    }
    case 'ellipse': {
      const r = el.size / 2 + tol;
      const rx = b.w / 2 || 0.5;
      const ry = b.h / 2 || 0.5;
      const d = Math.hypot((x - (b.x + rx)) / rx, (y - (b.y + ry)) / ry);
      if (el.fill && d <= 1) return true;
      return Math.abs(d - 1) * Math.min(rx, ry) <= r;
    }
    case 'diamond': {
      const r = el.size / 2 + tol;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      const pts: [number, number][] = [[cx, b.y], [b.x + b.w, cy], [cx, b.y + b.h], [b.x, cy]];
      if (el.fill && pointInPolygon(x, y, pts)) return true;
      for (let i = 0; i < 4; i++) {
        const [ax, ay] = pts[i];
        const [bx, by] = pts[(i + 1) % 4];
        if (distToSegment(x, y, ax, ay, bx, by) <= r) return true;
      }
      return false;
    }
    case 'line':
    case 'arrow':
      return distToSegment(x, y, el.x1, el.y1, el.x2, el.y2) <= el.size / 2 + tol + 2;
    case 'figure': {
      const r = el.size / 2 + tol + 1;
      if (!inside(b, x, y, r)) return false;
      for (const p of placePaths(el.kind, b.x, b.y, b.w, b.h)) {
        if (p.dot > 0) {
          if (Math.hypot(x - p.pts[0][0], y - p.pts[0][1]) <= r + el.size * p.dot) return true;
          continue;
        }
        const n = p.pts.length;
        for (let i = 1; i < n + (p.closed ? 1 : 0); i++) {
          const a = p.pts[i - 1];
          const c = p.pts[i % n];
          if (distToSegment(x, y, a[0], a[1], c[0], c[1]) <= r) return true;
        }
        if (el.fill && p.fill && p.closed && pointInPolygon(x, y, p.pts)) return true;
      }
      return false;
    }
    case 'text':
    case 'ai':
    case 'sim':
    case 'diagram':
    case 'image':
    case 'note':
      return inside(b, x, y, tol);
  }
}

export function pointInPolygon(x: number, y: number, poly: [number, number][]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

/** Elements the lasso encloses: ink with at least half its points inside, others by their center. */
export function lassoPick(elements: El[], lasso: [number, number][]): El[] {
  if (lasso.length < 3) return [];
  return elements.filter((el) => {
    // Answers and simulators are never sent to be solved.
    if (el.type === 'ai' || el.type === 'sim' || el.type === 'diagram' || el.type === 'image' || el.type === 'note') return false;
    if (el.type === 'stroke') {
      const n = el.points.filter(([x, y]) => pointInPolygon(x, y, lasso)).length;
      return n / el.points.length >= 0.5;
    }
    const b = boundsOf(el);
    return pointInPolygon(b.x + b.w / 2, b.y + b.h / 2, lasso);
  });
}

// --- transforms -------------------------------------------------------------

export function translateEl(el: El, dx: number, dy: number): El {
  switch (el.type) {
    case 'stroke':
      return { ...el, points: el.points.map(([x, y, p]) => [x + dx, y + dy, p] as Pt) };
    case 'rect':
    case 'ellipse':
    case 'diamond':
    case 'figure':
    case 'sim':
    case 'diagram':
    case 'image':
    case 'note':
    case 'text':
    case 'ai':
      return { ...el, x: el.x + dx, y: el.y + dy };
    case 'line':
    case 'arrow':
      return { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy };
  }
}

/** Scales the element about (ox, oy). Negative factors flip it. */
export function scaleEl(el: El, sx: number, sy: number, ox: number, oy: number): El {
  const mx = (x: number) => ox + (x - ox) * sx;
  const my = (y: number) => oy + (y - oy) * sy;
  switch (el.type) {
    case 'stroke':
      return { ...el, points: el.points.map(([x, y, p]) => [mx(x), my(y), p] as Pt) };
    case 'rect':
    case 'ellipse':
    case 'diamond':
    case 'figure':
    case 'sim':
    case 'diagram':
    case 'image': {
      const x1 = mx(el.x), x2 = mx(el.x + el.w), y1 = my(el.y), y2 = my(el.y + el.h);
      return { ...el, x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
    }
    case 'line':
    case 'arrow':
      return { ...el, x1: mx(el.x1), y1: my(el.y1), x2: mx(el.x2), y2: my(el.y2) };
    case 'text': {
      const s = (Math.abs(sx) + Math.abs(sy)) / 2;
      const fontSize = Math.max(8, el.fontSize * s);
      return {
        ...el,
        x: Math.min(mx(el.x), mx(el.x + el.w)),
        y: Math.min(my(el.y), my(el.y + el.h)),
        fontSize,
        ...textSize(el.text, fontSize),
      };
    }
    case 'note': {
      // Like an answer: the block is written again at the new size, wrapped to the new width.
      const s = (Math.abs(sx) + Math.abs(sy)) / 2;
      return {
        ...el,
        x: Math.min(mx(el.x), mx(el.x + el.w)),
        y: Math.min(my(el.y), my(el.y + el.h)),
        w: el.w * s,
        h: el.h * s,
        wrap: el.wrap * s,
        col: mx(el.col),
        fontSize: Math.max(6, el.fontSize * s),
        penWidth: Math.max(0.8, el.penWidth * s),
      };
    }
    case 'ai': {
      // Handwriting scales as a whole: the strokes are regenerated at the new size.
      const s = (Math.abs(sx) + Math.abs(sy)) / 2;
      return {
        ...el,
        x: mx(el.x),
        y: my(el.y),
        w: el.w * s,
        h: el.h * s,
        ascent: el.ascent * s,
        fontSize: Math.max(8, el.fontSize * s),
        penWidth: Math.max(1, el.penWidth * s),
      };
    }
  }
}


export function quantizeStroke(el: StrokeEl): StrokeEl {
  const r = (v: number) => Math.round(v * 10) / 10;
  return { ...el, points: el.points.map(([x, y, p]) => [r(x), r(y), Math.round(p * 100) / 100] as Pt) };
}


// --- turning and mirroring ----------------------------------------------------------------

/** The upright box of a shape or figure; boundsOf gives the box round it once it is turned. */
export function boxOf(el: { x: number; y: number; w: number; h: number }): Bounds {
  return { x: Math.min(el.x, el.x + el.w), y: Math.min(el.y, el.y + el.h), w: Math.abs(el.w), h: Math.abs(el.h) };
}

type Turnable = ShapeEl | FigureEl;

const turnable = (el: El): el is Turnable =>
  el.type === 'rect' || el.type === 'ellipse' || el.type === 'diamond' || el.type === 'figure';

/** A plain boolean, not a type guard: an upright rectangle is still a rectangle. */
export const isTurned = (el: El): boolean => turnable(el) && (!!el.rot || !!el.fx || !!el.fy);

/** Ink, lines and shapes turn; text, answers, simulators and diagrams stay upright so they stay readable. */
export const canRotate = (el: El) => el.type === 'stroke' || el.type === 'line' || el.type === 'arrow' || turnable(el);

/** A board point in the shape's own upright frame. */
function toLocal(el: Turnable, x: number, y: number): [number, number] {
  const b = boxOf(el);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const a = el.rot ?? 0;
  const dx = x - cx;
  const dy = y - cy;
  let lx = dx * Math.cos(a) + dy * Math.sin(a);
  let ly = -dx * Math.sin(a) + dy * Math.cos(a);
  if (el.fx) lx = -lx;
  if (el.fy) ly = -ly;
  return [cx + lx, cy + ly];
}

const turnPoint = (x: number, y: number, a: number, ox: number, oy: number): [number, number] => {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [ox + (x - ox) * c - (y - oy) * s, oy + (x - ox) * s + (y - oy) * c];
};

/** An angle in (−π, π], with tiny leftovers from rounding dropped. */
function normAngle(a: number): number | undefined {
  let r = a % (2 * Math.PI);
  if (r > Math.PI) r -= 2 * Math.PI;
  if (r <= -Math.PI) r += 2 * Math.PI;
  return Math.abs(r) < 1e-6 ? undefined : r;
}

/** Turns the element by `a` radians about (ox, oy). Things that stay upright move round the point instead. */
export function rotateEl(el: El, a: number, ox: number, oy: number): El {
  switch (el.type) {
    case 'stroke':
      return { ...el, points: el.points.map(([x, y, p]) => [...turnPoint(x, y, a, ox, oy), p] as Pt) };
    case 'line':
    case 'arrow': {
      const [x1, y1] = turnPoint(el.x1, el.y1, a, ox, oy);
      const [x2, y2] = turnPoint(el.x2, el.y2, a, ox, oy);
      return { ...el, x1, y1, x2, y2 };
    }
    case 'rect':
    case 'ellipse':
    case 'diamond':
    case 'figure': {
      const b = boxOf(el);
      const [cx, cy] = turnPoint(b.x + b.w / 2, b.y + b.h / 2, a, ox, oy);
      return { ...el, x: cx - b.w / 2, y: cy - b.h / 2, w: b.w, h: b.h, rot: normAngle((el.rot ?? 0) + a) };
    }
    default: {
      const b = boundsOf(el);
      const [cx, cy] = turnPoint(b.x + b.w / 2, b.y + b.h / 2, a, ox, oy);
      return translateEl(el, cx - (b.x + b.w / 2), cy - (b.y + b.h / 2));
    }
  }
}

/** Mirrors the element across the line x = ox ("x") or y = oy ("y"). */
export function flipEl(el: El, axis: 'x' | 'y', ox: number, oy: number): El {
  const m = (x: number, y: number): [number, number] => (axis === 'x' ? [2 * ox - x, y] : [x, 2 * oy - y]);
  switch (el.type) {
    case 'stroke':
      return { ...el, points: el.points.map(([x, y, p]) => [...m(x, y), p] as Pt) };
    case 'line':
    case 'arrow': {
      const [x1, y1] = m(el.x1, el.y1);
      const [x2, y2] = m(el.x2, el.y2);
      return { ...el, x1, y1, x2, y2 };
    }
    case 'rect':
    case 'ellipse':
    case 'diamond':
    case 'figure': {
      // Mirroring a turned shape turns it the other way and mirrors it in its own frame.
      const b = boxOf(el);
      const [cx, cy] = m(b.x + b.w / 2, b.y + b.h / 2);
      return {
        ...el, x: cx - b.w / 2, y: cy - b.h / 2, w: b.w, h: b.h,
        rot: el.rot ? normAngle(-el.rot) : undefined,
        fx: axis === 'x' ? !el.fx || undefined : el.fx,
        fy: axis === 'y' ? !el.fy || undefined : el.fy,
      };
    }
    default: {
      const b = boundsOf(el);
      const [cx, cy] = m(b.x + b.w / 2, b.y + b.h / 2);
      return translateEl(el, cx - (b.x + b.w / 2), cy - (b.y + b.h / 2));
    }
  }
}
