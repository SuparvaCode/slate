/**
 * Turns laid-out glyphs into pen strokes that look written by hand.
 *
 * Variation is driven by a seeded generator, so the same answer always produces the same
 * strokes. That matters: the strokes are generated once and cached, otherwise the ink would
 * shimmer on every repaint.
 */

import { GLYPHS } from './glyphs';
import type { Column } from '../types';
import { layoutColumns, layoutLatex, layoutText } from './layout';
import type { Laid } from './layout';
import { samplesFor } from './learn';
import type { Bank } from './learn';
import { sampledPath } from './path';
import type { P2 } from './path';

export interface HandStyle {
  /** Height of a capital letter, in world units. */
  fontSize: number;
  /** Pen width in world units. */
  penWidth: number;
  /** Forward lean, in degrees. Positive leans right. */
  slant: number;
  /** How uneven the writing is, 0 to 1. */
  wobble: number;
  /** Changes every random choice while keeping them repeatable. */
  seed: number;
  /** The user's learned letterforms. Characters found here are written in their own hand. */
  bank?: Bank;
  /** Draw a hand-drawn box around the last line, which is the final answer. */
  box?: boolean;
}

export const DEFAULT_STYLE: Omit<HandStyle, 'fontSize' | 'penWidth' | 'seed'> = {
  slant: 7,
  wobble: 1,
};

/** One pen stroke: points as [x, y, pressure]. */
export type HandStroke = [number, number, number][];

export interface Written {
  strokes: HandStroke[];
  /** Length of each stroke, for the writing animation. */
  lengths: number[];
  total: number;
  w: number;
  h: number;
  /** Distance from the top of the writing to the first baseline. */
  ascent: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Small, fast, repeatable pseudo-random generator (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth 1-D noise, for drift that wanders instead of jumping. */
function makeNoise(rand: () => number) {
  const table = Array.from({ length: 64 }, () => rand() * 2 - 1);
  return (t: number) => {
    const x = ((t % 64) + 64) % 64;
    const i = Math.floor(x);
    const f = x - i;
    const a = table[i];
    const b = table[(i + 1) % 64];
    const k = f * f * (3 - 2 * f); // smoothstep
    return a + (b - a) * k;
  };
}

/**
 * Pressure along a stroke: bites in, varies through the middle, lifts off at the end.
 * The swell is what makes ink read as a pen rather than a drawn outline.
 */
function pressureAt(t: number, grip: number, swell: number): number {
  const inRamp = Math.min(1, t / 0.1);
  const outRamp = Math.min(1, (1 - t) / 0.14);
  const ends = Math.min(inRamp, outRamp) ** 0.55;
  // Heaviest a little past the middle, as the hand pulls through the stroke.
  const middle = 0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, t * 1.15));
  return 0.14 + 0.86 * grip * ends * middle * swell;
}

/**
 * The outline of a rounded box, sampled every `step`, starting and ending on the top edge and
 * running a little past the start the way a hand closes a box.
 */
function boxPath(x0: number, y0: number, x1: number, y1: number, r: number, step: number): P2[] {
  const pts: P2[] = [];
  const line = (ax: number, ay: number, bx: number, by: number) => {
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let i = 1; i <= n; i++) pts.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]);
  };
  const corner = (ax: number, ay: number, cx: number, cy: number, bx: number, by: number) => {
    for (let i = 1; i <= 6; i++) {
      const t = i / 6;
      const u = 1 - t;
      pts.push([u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by]);
    }
  };
  pts.push([x0 + r, y0]);
  line(x0 + r, y0, x1 - r, y0);
  corner(x1 - r, y0, x1, y0, x1, y0 + r);
  line(x1, y0 + r, x1, y1 - r);
  corner(x1, y1 - r, x1, y1, x1 - r, y1);
  line(x1 - r, y1, x0 + r, y1);
  corner(x0 + r, y1, x0, y1, x0, y1 - r);
  line(x0, y1 - r, x0, y0 + r);
  corner(x0, y0 + r, x0, y0, x0 + r, y0);
  line(x0 + r, y0, x0 + r * 3.2, y0 + r * 0.18);
  return pts;
}

function writeLaid(laid: Laid, style: HandStyle): Written {
  const { fontSize: fs } = style;
  const rand = rng(style.seed || 1);
  const noise = makeNoise(rand);
  const shear = Math.tan((-style.slant * Math.PI) / 180);
  const wob = style.wobble;

  const strokes: HandStroke[] = [];
  const lengths: number[] = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const emit = (pts: P2[], grip: number, swell = 1) => {
    if (pts.length < 2) return;
    // Total length, used for the pressure ramp and the writing animation.
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (len <= 0) return;

    const stroke: HandStroke = [];
    let run = 0;
    for (let i = 0; i < pts.length; i++) {
      if (i > 0) run += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const [x, y] = pts[i];
      stroke.push([x, y, pressureAt(run / len, grip, swell)]);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    strokes.push(stroke);
    lengths.push(len);
  };

  /** Replays a learned stroke, keeping the pressure the user drew it with. */
  const emitWithPressure = (pts: P2[], press: number[]) => {
    if (pts.length < 2) return;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (len <= 0) return;
    const stroke: HandStroke = [];
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      stroke.push([x, y, press[i] ?? 0.5]);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    strokes.push(stroke);
    lengths.push(len);
  };

  for (const g of laid.glyphs) {
    const base = GLYPHS[g.ch] ?? GLYPHS['?'];
    // Pick one of the ways this character can be formed. Jitter alone still reads as a
    // font; different skeletons are what make repeated characters look rewritten.
    const forms = base.alt ? [base, ...base.alt] : [base];
    const form = forms[Math.floor(rand() * forms.length)] ?? base;
    const glyph = { w: form.w ?? base.w, d: form.d };
    const size = g.s * fs;

    // Per-glyph variation: a nudge, a slight turn, a touch of size, and drift along the line.
    // Baseline wanders slowly along the line, the way a hand drifts.
    const drift = noise(g.x * 1.1 + g.y * 9) * 0.055 * wob;
    const jx = (rand() - 0.5) * 0.05 * wob;
    const jy = (rand() - 0.5) * 0.042 * wob + drift;
    const rot = (rand() - 0.5) * 0.17 * wob;
    const sx = 1 + (rand() - 0.5) * 0.14 * wob;
    const sy = 1 + (rand() - 0.5) * 0.13 * wob;
    const grip = 0.74 + (rand() - 0.5) * 0.44;
    const swell = 0.88 + rand() * 0.24;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const baseX = (g.x + jx) * fs;
    const baseY = (g.y + jy) * fs;
    // Turn each glyph about its own middle so letters stay on the line.
    const px = glyph.w / 2;
    const py = -0.25;

    // The user's own strokes for this character, when we have learned any.
    const learned = style.bank ? samplesFor(style.bank, g.ch) : [];
    if (learned.length) {
      const sample = learned[Math.floor(rand() * learned.length)];
      // Fit the sample to the advance width the layout reserved, so spacing stays right.
      const fit = clamp(glyph.w / Math.max(0.05, sample.w), 0.72, 1.38);
      for (const st of sample.strokes) {
        const out: P2[] = [];
        const press: number[] = [];
        for (const [ux0, uy, p] of st) {
          const ux = ux0 * fit;
          const rx = (ux - px) * cos - (uy - py) * sin;
          const ry = (ux - px) * sin + (uy - py) * cos;
          const gx = (rx + px) * sx;
          const gy = (ry + py) * sy;
          out.push([baseX + (gx + gy * shear) * size, baseY + gy * size]);
          press.push(p);
        }
        emitWithPressure(out, press);
      }
      continue;
    }

    for (const d of glyph.d) {
      const src = sampledPath(d);
      const out: P2[] = [];
      const n = src.length;
      for (let i = 0; i < n; i++) {
        let [ux, uy] = src[i];
        // Unsteady hand: a slow waver along the stroke, biggest in the middle.
        const t = i / Math.max(1, n - 1);
        const amp = 0.019 * wob * Math.sin(Math.PI * t);
        ux += noise(i * 0.22 + g.x * 5) * amp;
        uy += noise(i * 0.19 + g.y * 7 + 13) * amp;
        // Turn, scale, then lean.
        const rx = (ux - px) * cos - (uy - py) * sin;
        const ry = (ux - px) * sin + (uy - py) * cos;
        const gx = (rx + px) * sx;
        const gy = (ry + py) * sy;
        out.push([baseX + (gx + gy * shear) * size, baseY + gy * size]);
      }
      emit(out, grip, swell);
    }
  }

  // Fraction bars and the bar over a root: drawn, not from a glyph.
  for (const r of laid.rules) {
    if (r.y2 !== undefined) {
      // A vertical line between columns: starts a touch high, runs a touch long, bows slightly.
      const vx = (r.x1 + (rand() - 0.5) * 0.03 * wob) * fs;
      const vy1 = (r.y1 - (0.01 + rand() * 0.03) * wob) * fs;
      const vy2 = (r.y2 + (0.01 + rand() * 0.04) * wob) * fs;
      const vbow = (rand() - 0.5) * 0.06 * wob * fs;
      const vsteps = Math.max(6, Math.ceil(Math.abs(vy2 - vy1) / (fs * 0.05)));
      const vpts: P2[] = [];
      for (let i = 0; i <= vsteps; i++) {
        const t = i / vsteps;
        const yy = vy1 + (vy2 - vy1) * t;
        vpts.push([vx + Math.sin(Math.PI * t) * vbow + yy * shear, yy]);
      }
      emit(vpts, 0.85, 0.95 + rand() * 0.2);
      continue;
    }
    const y = (r.y1 + (rand() - 0.5) * 0.026 * wob) * fs;
    const x1 = (r.x1 - (0.004 + rand() * 0.016) * wob) * fs;
    const x2 = (r.x2 + (0.004 + rand() * 0.02) * wob) * fs;
    const bow = (rand() - 0.5) * 0.05 * wob * fs;
    const steps = Math.max(6, Math.ceil(Math.abs(x2 - x1) / (fs * 0.05)));
    const pts: P2[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = x1 + (x2 - x1) * t;
      const yy = y + Math.sin(Math.PI * t) * bow;
      pts.push([x + yy * shear, yy]);
    }
    emit(pts, 0.82, 0.95 + rand() * 0.2);
  }

  // A box round the last line, which is the final answer, drawn last so it is written last.
  if (style.box && strokes.length > 0) {
    const fin = laid.final ?? { x0: 0, x1: laid.w, y: laid.lines };
    const yLo = fin.y * fs - fs * 0.95;
    const yHi = fin.y * fs + fs * 0.55;
    const xLo = fin.x0 * fs - fs * 0.35;
    const xHi = fin.x1 * fs + fs * 0.35;
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const st of strokes) {
      let sx0 = Infinity, sx1 = -Infinity, sy0 = Infinity, sy1 = -Infinity;
      for (const p of st) {
        if (p[0] < sx0) sx0 = p[0];
        if (p[0] > sx1) sx1 = p[0];
        if (p[1] < sy0) sy0 = p[1];
        if (p[1] > sy1) sy1 = p[1];
      }
      // Only strokes of the final answer; earlier working and other columns stay outside the box.
      const cx = (sx0 + sx1) / 2;
      const cy = (sy0 + sy1) / 2;
      if (cy < yLo || cy > yHi || cx < xLo || cx > xHi) continue;
      for (const p of st) {
        if (p[0] < bx0) bx0 = p[0];
        if (p[0] > bx1) bx1 = p[0];
        if (p[1] < by0) by0 = p[1];
        if (p[1] > by1) by1 = p[1];
      }
    }
    if (bx1 > bx0 && by1 > by0) {
      const pad = fs * 0.22;
      const x0 = bx0 - pad * 1.15;
      const x1 = bx1 + pad * 1.15;
      const y0 = by0 - pad * 0.85;
      const y1 = by1 + pad * 0.85;
      const r = Math.min(fs * 0.17, (y1 - y0) / 3);
      const cx = (x0 + x1) / 2;
      const cy = (y0 + y1) / 2;
      const turn = (rand() - 0.5) * 0.035 * wob;
      const cs = Math.cos(turn);
      const sn = Math.sin(turn);
      const amp = fs * 0.011 * wob;
      const box = boxPath(x0, y0, x1, y1, r, fs * 0.05).map(([x, y], i): P2 => {
        const dx = x - cx;
        const dy = y - cy;
        return [
          cx + dx * cs - dy * sn + noise(i * 0.07 + 41) * amp,
          cy + dx * sn + dy * cs + noise(i * 0.06 + 57) * amp,
        ];
      });
      emit(box, 0.9, 1);
    }
  }

  if (strokes.length === 0) {
    return { strokes: [], lengths: [], total: 0, w: 0, h: 0, ascent: 0 };
  }

  // Shift so the writing starts at (0, 0), and report where the first baseline sits.
  const dx = -minX;
  const dy = -minY;
  for (const s of strokes) {
    for (const p of s) {
      p[0] += dx;
      p[1] += dy;
    }
  }

  return {
    strokes,
    lengths,
    total: lengths.reduce((a, b) => a + b, 0),
    w: maxX - minX,
    h: maxY - minY,
    ascent: dy,
  };
}

const cache = new Map<string, Written>();

/** Writes a LaTeX answer (or plain text) as pen strokes. Cached, so repaints are cheap. */
/** Columns arrive as JSON; anything malformed becomes a single plain column. */
function parseColumns(source: string): Column[] {
  try {
    const raw = JSON.parse(source) as unknown;
    if (Array.isArray(raw)) {
      const cols = raw
        .filter((c): c is Column => !!c && typeof c === 'object' && Array.isArray((c as Column).lines))
        .map((c) => ({ heading: String(c.heading ?? ''), lines: c.lines.map(String) }));
      if (cols.length) return cols;
    }
  } catch {
    // fall through to the plain column
  }
  return [{ heading: '', lines: [source] }];
}

export function writeAnswer(
  source: string, kind: 'latex' | 'text' | 'columns', style: HandStyle,
): Written {
  const key = `${kind}|${source}|${style.fontSize.toFixed(2)}|${style.penWidth.toFixed(2)}|${style.slant}|${style.wobble}|${style.seed}|${style.bank?.learned ?? 0}|${style.box ? 1 : 0}`;
  let out = cache.get(key);
  if (!out) {
    const laid =
      kind === 'columns' ? layoutColumns(parseColumns(source))
      : kind === 'latex' ? layoutLatex(source)
      : layoutText(source);
    out = writeLaid(laid, style);
    if (cache.size > 300) cache.clear();
    cache.set(key, out);
  }
  return out;
}

/** A number from a string, so each answer gets its own repeatable variation. */
export function seedFrom(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
