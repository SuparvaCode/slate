/**
 * Draws a diagram as a board card: parts, ropes and wires, markings, and (for mechanics) the
 * forces the solver found. `progress` from 0 to 1 builds it up piece by piece, for the AI's
 * "constructing" animation. Mechanics diagrams can also play their motion.
 */

import { isFigureKind, placePaths } from '../figures';
import { SIM_FONT, arrow, hatch, label, line, text, wheel } from '../sim/kit';
import type { Look } from '../sim/kit';
import { HALF, solveCircuit, terminalAt, terminals } from './circuit';
import type { CircuitResult } from './circuit';
import { tryCompile } from './expr';
import { fmtN, layout, motionAt, slope, solveMech } from './mech';
import type { Layout, MechResult } from './mech';
import { TWO_TERMINAL, U } from './types';
import type { Diagram, Part, Ref, Tint, XY } from './types';

export const PAD = 22;
export const HEAD = 40;
const DEG = Math.PI / 180;

/** Card size in base pixels; the board scales it to the element's box. */
export const cardBase = (d: Diagram): XY => [d.size[0] * U + PAD * 2, d.size[1] * U + PAD + HEAD];

export function tintColor(look: Look, t: Tint | undefined, fallback: string): string {
  if (!t) return fallback;
  if (t === 'ink') return look.ink;
  if (t === 'gray') return look.muted;
  return look[t];
}

// --- solving, cached per diagram ------------------------------------------------------

interface Solved {
  lay?: Layout;
  mech?: MechResult;
  circ?: CircuitResult;
}

const cache = new WeakMap<Diagram, Solved>();

const isMech = (d: Diagram) => d.ropes.length > 0 || d.parts.some((p) => p.type === 'mass' || p.type === 'pulley');
const isCircuit = (d: Diagram) => d.parts.some((p) => TWO_TERMINAL.has(p.type));

export function solved(d: Diagram): Solved {
  let s = cache.get(d);
  if (!s) {
    s = {};
    if (isMech(d)) {
      s.lay = layout(d);
      s.mech = solveMech(d, s.lay);
    }
    if (isCircuit(d)) s.circ = solveCircuit(d);
    cache.set(d, s);
  }
  return s;
}

/** What the solvers worked out, in words, for the studio and the AI check. */
export function diagramFacts(d: Diagram): { ok: boolean; error?: string; facts: string[] } {
  const s = solved(d);
  const facts = [...(s.mech?.facts ?? []), ...(s.circ?.facts ?? [])];
  const error = (s.mech && !s.mech.ok ? s.mech.error : undefined) ?? (s.circ && !s.circ.ok ? s.circ.error : undefined);
  return { ok: !error, error, facts };
}

// --- motion ------------------------------------------------------------------------------

interface Motion {
  d: Diagram;
  t: number;
  playing: boolean;
  done: boolean;
}

const motions = new Map<string, Motion>();

export function motionOf(id: string, d: Diagram): Motion {
  let m = motions.get(id);
  if (!m || m.d !== d) {
    m = { d, t: 0, playing: false, done: false };
    motions.set(id, m);
  }
  return m;
}

/** True when the diagram has something that moves. */
export function canMove(d: Diagram): boolean {
  if (!d.show.motion) return false;
  const m = solved(d).mech;
  return !!m?.ok && m.bodies.some((b) => b.a !== 0);
}

export function togglePlay(id: string, d: Diagram) {
  const m = motionOf(id, d);
  if (!canMove(d)) return;
  if (m.done) {
    m.t = 0;
    m.done = false;
  }
  m.playing = !m.playing;
}

export function resetMotion(id: string, d: Diagram) {
  const m = motionOf(id, d);
  m.t = 0;
  m.playing = false;
  m.done = false;
}

/** Advances a playing diagram; false once it has stopped. */
export function stepMotion(id: string, d: Diagram, dt: number): boolean {
  const m = motionOf(id, d);
  if (!m.playing) return false;
  m.t += Math.min(dt, 0.1);
  const r = motionAt(solved(d).mech!, m.t);
  if (r.done) {
    m.t = r.t;
    m.playing = false;
    m.done = true;
  }
  return m.playing;
}

export function pruneMotions(ids: Set<string>) {
  for (const id of motions.keys()) if (!ids.has(id)) motions.delete(id);
}

// --- the card ------------------------------------------------------------------------------

export interface CardLike {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  diagram: Diagram;
}

// --- fitting the drawing into its card --------------------------------------------------------

/** Maps the drawing's own pixels into the card: card = t + k * drawing. */
interface Fit {
  k: number;
  tx: number;
  ty: number;
}

const fits = new WeakMap<Diagram, Fit>();
let measureCanvas: HTMLCanvasElement | null = null;
const INK = '#000000';
const MEASURE_LOOK: Look = {
  line: INK, ink: INK, muted: INK, faint: INK, card: INK, cardEdge: INK, red: INK, blue: INK, green: INK,
  orange: INK, violet: INK, yellow: INK, dark: false,
};

/**
 * What the drawing really covers, in its own pixels: force arrows, labels and parts the AI put
 * near the edge all reach past the grid frame. Found by drawing it once off screen.
 */
function contentBox(d: Diagram): [number, number, number, number] | null {
  if (typeof document === 'undefined') return null;
  const M = 320;
  const S = 0.5;
  measureCanvas ??= document.createElement('canvas');
  const c = measureCanvas;
  c.width = Math.ceil((d.size[0] * U + 2 * M) * S);
  c.height = Math.ceil((d.size[1] * U + 2 * M) * S);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.setTransform(S, 0, 0, S, M * S, M * S);
  drawDiagram(ctx, d, MEASURE_LOOK);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
  for (let y = 0; y < c.height; y++) {
    const row = y * c.width * 4;
    for (let x = 0; x < c.width; x++) {
      if (px[row + x * 4 + 3] > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  return [x0 / S - M - 2, y0 / S - M - 2, (x1 + 1) / S - M + 2, (y1 + 1) / S - M + 2];
}

function fitOf(d: Diagram, bw: number, bh: number): Fit {
  let f = fits.get(d);
  if (f) return f;
  const b = contentBox(d);
  // Where the drawing may go: below the title, clear of the rounded edge and any warning line.
  const warn = !diagramFacts(d).ok && !isPlain(d);
  const ax0 = 12;
  const ay0 = HEAD - 4;
  const ax1 = bw - 12;
  const ay1 = bh - (warn ? 26 : 10);
  if (!b || (PAD + b[0] >= ax0 && PAD + b[2] <= ax1 && HEAD + b[1] >= ay0 && HEAD + b[3] <= ay1)) {
    // Already inside: leave it where it was drawn, so nothing jumps while parts are dragged.
    f = { k: 1, tx: PAD, ty: HEAD };
  } else {
    const cw = Math.max(1, b[2] - b[0]);
    const ch = Math.max(1, b[3] - b[1]);
    const k = Math.min(1, (ax1 - ax0) / cw, (ay1 - ay0) / ch);
    f = { k, tx: ax0 + (ax1 - ax0 - cw * k) / 2 - b[0] * k, ty: ay0 + (ay1 - ay0 - ch * k) / 2 - b[1] * k };
  }
  fits.set(d, f);
  return f;
}

function frame(el: CardLike) {
  const [bw, bh] = cardBase(el.diagram);
  const s = Math.min(el.w / bw, el.h / bh);
  return { s, ox: el.x + (el.w - bw * s) / 2, oy: el.y + (el.h - bh * s) / 2, bw, bh, fit: fitOf(el.diagram, bw, bh) };
}

/** A grid point of the diagram, in the card's own coordinates (board or preview). */
export function gridToWorld(el: CardLike, q: XY): XY {
  const f = frame(el);
  return [f.ox + (f.fit.tx + q[0] * U * f.fit.k) * f.s, f.oy + (f.fit.ty + q[1] * U * f.fit.k) * f.s];
}

export function worldToGrid(el: CardLike, wx: number, wy: number): XY {
  const f = frame(el);
  return [((wx - f.ox) / f.s - f.fit.tx) / (U * f.fit.k), ((wy - f.oy) / f.s - f.fit.ty) / (U * f.fit.k)];
}

/** Pixels per grid unit at the card's current size. */
export const gridScale = (el: CardLike) => {
  const f = frame(el);
  return f.s * U * f.fit.k;
};

/** No forces, numbers or motion: drawn as a plain textbook figure. */
export const isPlain = (d: Diagram) => !d.show.forces && !d.show.values && !d.show.motion;

/** The play pill at the card's top right, in base pixels. */
const pill = (bw: number) => ({ x: bw - PAD - 74, y: 11, w: 74, h: 22 });

/** "play" when (wx, wy) is on the card's play button. */
export function diagramButtonAt(el: CardLike, wx: number, wy: number): 'play' | null {
  if (!canMove(el.diagram)) return null;
  const f = frame(el);
  const bx = (wx - f.ox) / f.s;
  const by = (wy - f.oy) / f.s;
  const p = pill(f.bw);
  return bx >= p.x - 4 && bx <= p.x + p.w + 4 && by >= p.y - 4 && by <= p.y + p.h + 4 ? 'play' : null;
}

const KIND_LABEL: Record<Diagram['kind'], string> = {
  mechanics: 'Mechanics', circuit: 'Circuit', graph: 'Graph', geometry: 'Geometry', chemistry: 'Chemistry', sketch: 'Sketch',
};

export function drawDiagramCard(
  ctx: CanvasRenderingContext2D, el: CardLike, look: Look, o: { progress?: number; chrome?: boolean } = {},
) {
  const d = el.diagram;
  const f = frame(el);
  const m = motionOf(el.id, d);
  ctx.save();
  ctx.translate(f.ox, f.oy);
  ctx.scale(f.s, f.s);
  if (o.chrome !== false) {
    ctx.save();
    ctx.shadowColor = look.dark ? 'rgba(0,0,0,0.45)' : 'rgba(15,23,42,0.08)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 4;
    ctx.beginPath();
    ctx.roundRect(0, 0, f.bw, f.bh, 18);
    ctx.fillStyle = look.card;
    ctx.fill();
    ctx.restore();
    ctx.strokeStyle = look.cardEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
    const facts = diagramFacts(d);
    const plain = isPlain(d);
    const tag = `${KIND_LABEL[d.kind]}${!plain && (solved(d).mech || solved(d).circ) ? (facts.ok ? ' · solved' : ' · check') : ''}`;
    // The title gives way to the tag and Play button rather than running under them.
    ctx.save();
    ctx.font = `550 11.5px ${SIM_FONT}`;
    const right = (canMove(d) ? pill(f.bw).x - 12 : f.bw - PAD) - ctx.measureText(tag).width - 14;
    ctx.restore();
    text(ctx, ellipsize(ctx, d.title, right - PAD, `650 14px ${SIM_FONT}`), PAD, 22, { size: 14, weight: 650, color: look.ink });
    if (canMove(d)) {
      const p = pill(f.bw);
      ctx.beginPath();
      ctx.roundRect(p.x, p.y, p.w, p.h, 11);
      ctx.fillStyle = look.dark ? 'rgba(10,132,255,0.22)' : 'rgba(0,122,255,0.1)';
      ctx.fill();
      text(ctx, m.playing ? '❚❚  Pause' : m.done ? '↺  Replay' : '▶  Play', p.x + p.w / 2, p.y + p.h / 2 + 0.5, {
        size: 11.5, weight: 650, color: look.blue, align: 'center',
      });
      text(ctx, tag, p.x - 12, 22, { size: 11.5, weight: 550, color: look.muted, align: 'right' });
    } else {
      text(ctx, tag, f.bw - PAD, 22, { size: 11.5, weight: 550, color: facts.ok ? look.muted : look.orange, align: 'right' });
    }
    if (!facts.ok && facts.error && !plain) {
      text(ctx, ellipsize(ctx, facts.error, f.bw - PAD * 2, `550 11px ${SIM_FONT}`), PAD, f.bh - 13, { size: 11, weight: 550, color: look.orange });
    }
    // Nothing is ever drawn outside the card.
    ctx.beginPath();
    ctx.roundRect(1, HEAD - 6, f.bw - 2, f.bh - HEAD + 5, [0, 0, 17, 17]);
    ctx.clip();
  }
  ctx.translate(f.fit.tx, f.fit.ty);
  ctx.scale(f.fit.k, f.fit.k);
  drawDiagram(ctx, d, look, { progress: o.progress, t: m.t, id: el.id });
  ctx.restore();
}

function ellipsize(ctx: CanvasRenderingContext2D, s: string, max: number, font: string): string {
  ctx.save();
  ctx.font = font;
  let out = s;
  if (ctx.measureText(out).width > max) {
    while (out.length > 1 && ctx.measureText(`${out}…`).width > max) out = out.slice(0, -1);
    out = `${out.trimEnd()}…`;
  }
  ctx.restore();
  return out;
}

// --- the drawing -----------------------------------------------------------------------------

type Op = [layer: number, fn: () => void];

const v = {
  sub: (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]],
  add: (a: XY, b: XY): XY => [a[0] + b[0], a[1] + b[1]],
  mul: (a: XY, k: number): XY => [a[0] * k, a[1] * k],
  len: (a: XY) => Math.hypot(a[0], a[1]),
  unit: (a: XY): XY => {
    const l = Math.hypot(a[0], a[1]);
    return l > 1e-9 ? [a[0] / l, a[1] / l] : [0, 1];
  },
};

function niceStep(range: number, target = 8) {
  const raw = range / target;
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

const tickText = (x: number) => {
  const r = Math.round(x * 1000) / 1000;
  return String(r).replace('-', '−');
};

const ATOM_COLORS: Record<string, keyof Look> = { O: 'red', N: 'blue', Cl: 'green', F: 'green', Br: 'orange', S: 'orange', P: 'orange' };

export function drawDiagram(
  ctx: CanvasRenderingContext2D, d: Diagram, look: Look, o: { progress?: number; t?: number; id?: string } = {},
) {
  const ops: Op[] = [];
  const add = (layer: number, fn: () => void) => ops.push([layer, fn]);
  const col = (t: Tint | undefined, fb: string = look.line) => tintColor(look, t, fb);
  const byId = new Map(d.parts.map((p) => [p.id, p]));
  const sol = solved(d);

  let lay = sol.lay;
  const turn = new Map<string, number>();
  if (lay && sol.mech?.ok && o.t) {
    const mo = motionAt(sol.mech, o.t);
    lay = layout(d, mo.disp);
    for (const r of d.ropes) {
      const end = [r.path[0], r.path[r.path.length - 1]].find((id) => mo.disp.has(id));
      const q = end ? mo.disp.get(end)! : 0;
      for (const id of r.path.slice(1, -1)) {
        const p = byId.get(id)!;
        turn.set(id, (turn.get(id) ?? 0) + q / (p.r ?? 0.5));
      }
    }
  }
  const P = (q: XY): XY => [q[0] * U, q[1] * U];
  const posOf = (id: string): XY => P(lay?.pos.get(id) ?? byId.get(id)?.at ?? [0, 0]);
  const refAt = (r: Ref): XY => (typeof r === 'string' ? posOf(r) : P(r));

  const poly = (pts: XY[], closed = false) => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    if (closed) ctx.closePath();
  };
  const tinted = (c: string, a: number) => {
    ctx.save();
    ctx.globalAlpha *= a;
    ctx.fillStyle = c;
    ctx.fill();
    ctx.restore();
  };

  // --- parts ---------------------------------------------------------------------------
  for (const p of d.parts) {
    const c = posOf(p.id);
    switch (p.type) {
      case 'ceiling':
        add(0, () => hatch(ctx, c[0], c[1], c[0] + (p.w ?? 4) * U, c[1], look, 0, -1));
        break;
      case 'floor':
        add(0, () => hatch(ctx, c[0], c[1], c[0] + (p.w ?? 4) * U, c[1], look, 0, 1));
        break;
      case 'wall': {
        const right = d.parts.filter((q) => q !== p).reduce((s, q) => s + Math.sign(q.at[0] - p.at[0]), 0) >= 0;
        add(0, () => hatch(ctx, c[0], c[1], c[0], c[1] + (p.h ?? 4) * U, look, right ? -1 : 1, 0));
        break;
      }
      case 'anchor':
        add(2, () => {
          ctx.beginPath();
          ctx.arc(c[0], c[1], 4, 0, Math.PI * 2);
          ctx.fillStyle = look.muted;
          ctx.fill();
        });
        break;
      case 'table': {
        const w = (p.w ?? 6) * U;
        const h = (p.h ?? 2) * U;
        add(0, () => {
          ctx.beginPath();
          ctx.roundRect(c[0], c[1], w, 9, 3);
          tinted(look.muted, 0.18);
          ctx.strokeStyle = look.muted;
          ctx.lineWidth = 2;
          ctx.stroke();
          for (const lx of [c[0] + 12, c[0] + w - 12]) line(ctx, lx, c[1] + 9, lx, c[1] + h, look.muted, 3);
          if (p.mu) text(ctx, `μ = ${fmtN(p.mu)}`, c[0] + w / 2, c[1] + 24, { size: 11, color: look.muted, align: 'center' });
        });
        break;
      }
      case 'incline': {
        const g = slope(p);
        const o0 = P(g.o);
        const pts: XY[] = [o0, [o0[0] + g.w * U, o0[1]], [o0[0] + g.w * U, o0[1] - g.hgt * U]];
        add(0, () => {
          poly(pts, true);
          tinted(look.muted, 0.1);
          ctx.strokeStyle = look.muted;
          ctx.lineWidth = 2;
          ctx.lineJoin = 'round';
          ctx.stroke();
          hatch(ctx, o0[0] - 6, o0[1], o0[0] + g.w * U + 6, o0[1], look, 0, 1);
          ctx.save();
          ctx.strokeStyle = look.muted;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(o0[0], o0[1], 38, -g.th, 0);
          ctx.stroke();
          ctx.restore();
          label(ctx, `${fmtN(p.angle ?? 30)}°`, o0[0] + 54 * Math.cos(g.th / 2), o0[1] - 54 * Math.sin(g.th / 2), look, { size: 11, color: look.muted });
          if (p.mu) text(ctx, `μ = ${fmtN(p.mu)}`, o0[0] + g.w * U * 0.72, o0[1] - 12, { size: 11, color: look.muted, align: 'center' });
        });
        break;
      }
      case 'pulley': {
        const r = (p.r ?? 0.5) * U;
        add(1, () => {
          // What holds a fixed pulley up: a strut to the ceiling above, or to the nearby table or slope.
          if (p.fixed === false) return;
          const ceiling = d.parts.find(
            (q) => q.type === 'ceiling' && q.at[1] * U < c[1] && c[0] >= q.at[0] * U - 4 && c[0] <= (q.at[0] + (q.w ?? 4)) * U + 4,
          );
          if (ceiling) {
            line(ctx, c[0], c[1], c[0], ceiling.at[1] * U, look.muted, 3);
            return;
          }
          let best: XY | null = null;
          for (const q of d.parts) {
            const corner: XY | null =
              q.type === 'table' ? P([q.at[0] + (q.w ?? 6), q.at[1]]) :
              q.type === 'incline' ? P(v.add(slope(q).o, [slope(q).w, -slope(q).hgt])) : null;
            if (corner && v.len(v.sub(corner, c)) < 1.8 * U && (!best || v.len(v.sub(corner, c)) < v.len(v.sub(best, c)))) best = corner;
          }
          if (best) line(ctx, c[0], c[1], best[0], best[1], look.muted, 3.5);
          else {
            line(ctx, c[0], c[1], c[0], c[1] - r - 14, look.muted, 3);
            hatch(ctx, c[0] - 16, c[1] - r - 14, c[0] + 16, c[1] - r - 14, look, 0, -1);
          }
        });
        add(2, () => {
          wheel(ctx, c[0], c[1], r, turn.get(p.id) ?? 0, look);
          if (p.fixed === false && p.kg) text(ctx, `${fmtN(p.kg)} kg`, c[0] + r + 8, c[1], { size: 10.5, color: look.muted });
          if (p.label) label(ctx, p.label, c[0] - r - 12, c[1] - r, look, { size: 11, color: look.muted });
        });
        break;
      }
      case 'mass': {
        const [wu, hu] = lay?.size.get(p.id) ?? [1, 1];
        const w = wu * U;
        const h = hu * U;
        const s = p.on ? byId.get(p.on) : undefined;
        const ang = s?.type === 'incline' ? -(s.angle ?? 30) * DEG : 0;
        const tint = col(p.color, look.blue);
        add(2, () => {
          ctx.save();
          ctx.translate(c[0], c[1]);
          ctx.rotate(ang);
          ctx.beginPath();
          ctx.roundRect(-w / 2, -h / 2, w, h, 6);
          ctx.fillStyle = look.card;
          ctx.fill();
          tinted(tint, look.dark ? 0.34 : 0.2);
          ctx.strokeStyle = tint;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
        });
        add(6, () => {
          const kg = `${fmtN(p.kg ?? 1)} kg`;
          // A label that only repeats the mass ("5 kg", "5kg") is shown once.
          const same = !!p.label && p.label.replace(/\s+/g, '').toLowerCase() === kg.replace(/\s+/g, '').toLowerCase();
          if (p.label && !same) {
            label(ctx, p.label, c[0], c[1] - 7, look, { size: 12.5, weight: 700 });
            label(ctx, kg, c[0], c[1] + 8, look, { size: 10.5, weight: 550, color: look.muted });
          } else label(ctx, kg, c[0], c[1], look, { size: 12, weight: 650 });
        });
        break;
      }
      case 'effort': {
        const u: XY = [Math.cos((p.dir ?? 90) * DEG), Math.sin((p.dir ?? 90) * DEG)];
        add(5, () => {
          const tip = v.add(c, v.mul(u, 46));
          arrow(ctx, c[0], c[1], tip[0], tip[1], col(p.color, look.red), { w: 2.6 });
          const tag = d.show.values ? `${p.label ?? 'F'} = ${fmtN(p.N ?? 100)} N` : (p.label ?? 'F');
          label(ctx, tag, tip[0] + u[0] * 14 + (Math.abs(u[0]) < 0.5 ? 0 : 0), tip[1] + u[1] * 12, look, { size: 11.5, color: col(p.color, look.red) });
        });
        break;
      }
      case 'junction':
        add(2, () => {
          ctx.beginPath();
          ctx.arc(c[0], c[1], 3.6, 0, Math.PI * 2);
          ctx.fillStyle = look.line;
          ctx.fill();
          if (p.label) label(ctx, p.label, c[0] + 9, c[1] - 10, look, { size: 11, color: look.muted });
        });
        break;
      case 'battery':
      case 'resistor':
      case 'bulb':
      case 'switch':
      case 'ammeter':
      case 'voltmeter':
      case 'capacitor':
        add(2, () => symbol(ctx, p, look, sol.circ, d.show.values));
        break;
      case 'graph':
        add(0, () => graph(ctx, p, look));
        break;
      case 'point':
        add(3, () => {
          ctx.beginPath();
          ctx.arc(c[0], c[1], 3.8, 0, Math.PI * 2);
          ctx.fillStyle = col(p.color, look.ink);
          ctx.fill();
          if (p.label) label(ctx, p.label, c[0] + 10, c[1] - 11, look, { size: 13, weight: 650, color: col(p.color, look.ink) });
        });
        break;
      case 'segment':
        add(1, () => {
          const a = refAt(p.from!);
          const b = refAt(p.to!);
          if (p.arrow) arrow(ctx, a[0], a[1], b[0], b[1], col(p.color), { w: 2, dash: p.dash });
          else line(ctx, a[0], a[1], b[0], b[1], col(p.color), 2, p.dash ? [6, 5] : undefined);
          if (p.label) {
            const m = v.mul(v.add(a, b), 0.5);
            const n = v.unit([b[1] - a[1], a[0] - b[0]]);
            label(ctx, p.label, m[0] + n[0] * 13, m[1] + n[1] * 13, look, { size: 12, color: col(p.color, look.ink) });
          }
        });
        break;
      case 'polygon':
        add(0, () => {
          const pts = (p.points ?? []).map(refAt);
          poly(pts, true);
          if (p.fill) tinted(col(p.color, look.blue), 0.12);
          ctx.strokeStyle = col(p.color);
          ctx.lineWidth = 2;
          ctx.lineJoin = 'round';
          if (p.dash) ctx.setLineDash([6, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
        });
        break;
      case 'circle':
        add(0, () => {
          ctx.beginPath();
          ctx.arc(c[0], c[1], (p.r ?? 1) * U, 0, Math.PI * 2);
          if (p.fill) tinted(col(p.color, look.blue), 0.12);
          ctx.strokeStyle = col(p.color);
          ctx.lineWidth = 2;
          if (p.dash) ctx.setLineDash([6, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
          if (p.label) label(ctx, p.label, c[0], c[1] - (p.r ?? 1) * U - 12, look, { size: 12 });
        });
        break;
      case 'path':
        add(1, () => {
          const pts = (p.points ?? []).map(refAt);
          ctx.beginPath();
          if (p.smooth && pts.length > 2) {
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length - 1; i++) {
              const m = v.mul(v.add(pts[i], pts[i + 1]), 0.5);
              ctx.quadraticCurveTo(pts[i][0], pts[i][1], m[0], m[1]);
            }
            const l = pts[pts.length - 1];
            ctx.lineTo(l[0], l[1]);
          } else pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
          if (p.closed) ctx.closePath();
          if (p.fill && p.closed) tinted(col(p.color, look.blue), 0.12);
          ctx.strokeStyle = col(p.color);
          ctx.lineWidth = 2;
          ctx.lineJoin = 'round';
          if (p.dash) ctx.setLineDash([6, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
          if (p.arrow && pts.length >= 2) {
            const a = pts[pts.length - 2];
            const b = pts[pts.length - 1];
            const u = v.unit(v.sub(b, a));
            arrow(ctx, b[0] - u[0] * 14, b[1] - u[1] * 14, b[0], b[1], col(p.color), { w: 2 });
          }
          if (p.label) label(ctx, p.label, pts[0][0], pts[0][1] - 12, look, { size: 12 });
        });
        break;
      case 'atom':
        add(3, () => {
          const tint = ATOM_COLORS[p.el ?? 'C'] ? (look[ATOM_COLORS[p.el ?? 'C']] as string) : look.ink;
          ctx.beginPath();
          ctx.arc(c[0], c[1], 11, 0, Math.PI * 2);
          ctx.fillStyle = look.card;
          ctx.fill();
          text(ctx, p.el ?? 'C', c[0], c[1] + 0.5, { size: 17, weight: 650, color: p.color ? col(p.color) : tint, align: 'center' });
          if (p.charge) text(ctx, p.charge.replace('-', '−'), c[0] + 11, c[1] - 10, { size: 11, weight: 700, color: p.color ? col(p.color) : tint, align: 'center' });
          if (p.label) label(ctx, p.label, c[0], c[1] + 22, look, { size: 10.5, color: look.muted });
        });
        break;
      case 'bond':
        add(1, () => {
          const a = refAt(p.from!);
          const b = refAt(p.to!);
          const u = v.unit(v.sub(b, a));
          const n: XY = [-u[1], u[0]];
          const a1 = v.add(a, v.mul(u, 12));
          const b1 = v.sub(b, v.mul(u, 12));
          const offs = p.order === 3 ? [-4.5, 0, 4.5] : p.order === 2 ? [-2.6, 2.6] : [0];
          for (const k of offs) {
            line(ctx, a1[0] + n[0] * k, a1[1] + n[1] * k, b1[0] + n[0] * k, b1[1] + n[1] * k, col(p.color, look.ink), 1.8, p.dash ? [4, 4] : undefined);
          }
        });
        break;
      case 'shape': {
        const w = (p.w ?? 2) * U;
        const h = (p.h ?? 1) * U;
        add(0, () => {
          ctx.beginPath();
          if (p.shape === 'ellipse') ctx.ellipse(c[0], c[1], w / 2, h / 2, 0, 0, Math.PI * 2);
          else ctx.roundRect(c[0] - w / 2, c[1] - h / 2, w, h, 6);
          if (p.fill) tinted(col(p.color, look.blue), 0.14);
          ctx.strokeStyle = col(p.color);
          ctx.lineWidth = 2;
          if (p.dash) ctx.setLineDash([6, 5]);
          ctx.stroke();
          ctx.setLineDash([]);
          if (p.label) label(ctx, p.label, c[0], c[1], look, { size: 12.5, weight: 600 });
        });
        break;
      }
      case 'text':
        add(6, () => {
          const size = (p.size ?? 0.45) * U;
          (p.text ?? '').split('\n').forEach((ln, i) =>
            label(ctx, ln, c[0], c[1] + i * size * 1.25, look, { size, weight: 550, color: col(p.color, look.ink) }));
        });
        break;
      case 'figure':
        add(0, () => {
          if (!p.kind || !isFigureKind(p.kind)) return;
          const w = (p.w ?? 3) * U;
          const h = (p.h ?? 3) * U;
          ctx.strokeStyle = col(p.color);
          ctx.fillStyle = col(p.color);
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (const fp of placePaths(p.kind, c[0] - w / 2, c[1] - h / 2, w, h)) {
            if (fp.dot > 0) {
              ctx.beginPath();
              ctx.arc(fp.pts[0][0], fp.pts[0][1], 2 * fp.dot, 0, Math.PI * 2);
              ctx.fill();
              continue;
            }
            poly(fp.pts as XY[], fp.closed);
            ctx.lineWidth = fp.thin ? 1 : 2;
            ctx.setLineDash(fp.dash ? [5, 5] : []);
            ctx.stroke();
            ctx.setLineDash([]);
          }
          if (p.label) label(ctx, p.label, c[0], c[1] + h / 2 + 12, look, { size: 12 });
        });
        break;
    }
  }

  // --- ropes ---------------------------------------------------------------------------
  if (lay) {
    d.ropes.forEach((r, ri) => {
      const geo = lay!.ropes[ri];
      const c = col(r.color);
      add(1, () => geo.segs.forEach((s) => line(ctx, s.a[0] * U, s.a[1] * U, s.b[0] * U, s.b[1] * U, c, 2)));
      add(3, () => {
        for (const w of geo.wraps) {
          ctx.save();
          ctx.strokeStyle = c;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(w.c[0] * U, w.c[1] * U, w.r * U, w.a0, w.a1, w.ccw);
          ctx.stroke();
          ctx.restore();
        }
      });
    });
  }

  // --- wires ---------------------------------------------------------------------------
  const horiz = (t: string): boolean | null => {
    const p = byId.get(t.split('.')[0]);
    if (!p || p.type === 'junction') return null;
    return Math.round(((p.rot ?? 0) % 180) / 90) === 0;
  };
  for (const w of d.wires) {
    const a0 = terminalAt(d, w.from);
    const b0 = terminalAt(d, w.to);
    if (!a0 || !b0) continue;
    const a = P(a0);
    const b = P(b0);
    let pts: XY[] = [a, b];
    if (Math.abs(a[0] - b[0]) > 2 && Math.abs(a[1] - b[1]) > 2) {
      const hf = horiz(w.from);
      const ht = horiz(w.to);
      const elbow: XY = hf === true ? [b[0], a[1]] : hf === false ? [a[0], b[1]] : ht === true ? [a[0], b[1]] : [b[0], a[1]];
      pts = [a, elbow, b];
    }
    add(1, () => {
      ctx.save();
      poly(pts);
      ctx.strokeStyle = look.line;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();
    });
  }

  // --- markings ------------------------------------------------------------------------
  for (const m of d.marks) {
    const c = col(m.color, look.muted);
    switch (m.type) {
      case 'label':
        add(4, () => {
          const q = refAt(m.at!);
          label(ctx, m.text!, q[0], q[1], look, { size: 12.5, weight: 600, color: m.color ? c : look.ink });
        });
        break;
      case 'arrow':
        add(4, () => {
          const a = refAt(m.from!);
          const b = refAt(m.to!);
          arrow(ctx, a[0], a[1], b[0], b[1], m.color ? c : look.ink, { w: 2 });
          if (m.text) {
            const mid = v.mul(v.add(a, b), 0.5);
            const n = v.unit([b[1] - a[1], a[0] - b[0]]);
            label(ctx, m.text, mid[0] + n[0] * 13, mid[1] + n[1] * 13, look, { size: 12, color: m.color ? c : look.ink });
          }
        });
        break;
      case 'dim':
        add(4, () => {
          const a = refAt(m.from!);
          const b = refAt(m.to!);
          const u = v.unit(v.sub(b, a));
          const n: XY = [-u[1], u[0]];
          line(ctx, a[0], a[1], b[0], b[1], c, 1.2);
          for (const [e, s] of [[a, 1], [b, -1]] as [XY, number][]) {
            line(ctx, e[0] - n[0] * 6, e[1] - n[1] * 6, e[0] + n[0] * 6, e[1] + n[1] * 6, c, 1.2);
            const t = v.add(e, v.mul(u, 8 * s));
            poly([v.add(t, v.mul(n, 3.5)), e, v.sub(t, v.mul(n, 3.5))], true);
            ctx.fillStyle = c;
            ctx.fill();
          }
          if (m.text) {
            const mid = v.mul(v.add(a, b), 0.5);
            label(ctx, m.text, mid[0], mid[1], look, { size: 11.5, weight: 600, color: look.ink });
          }
        });
        break;
      case 'angle':
        add(4, () => {
          const o0 = refAt(m.at!);
          const a = refAt(m.from!);
          const b = refAt(m.to!);
          const a0 = Math.atan2(a[1] - o0[1], a[0] - o0[0]);
          let diff = Math.atan2(b[1] - o0[1], b[0] - o0[0]) - a0;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          while (diff <= -Math.PI) diff += 2 * Math.PI;
          const r = 26;
          ctx.save();
          ctx.strokeStyle = m.color ? c : look.orange;
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.arc(o0[0], o0[1], r, a0, a0 + diff, diff < 0);
          ctx.stroke();
          ctx.restore();
          if (m.text) {
            const am = a0 + diff / 2;
            label(ctx, m.text, o0[0] + Math.cos(am) * (r + 14), o0[1] + Math.sin(am) * (r + 14), look, { size: 12, color: m.color ? c : look.orange });
          }
        });
        break;
      case 'right':
        add(4, () => {
          const o0 = refAt(m.at!);
          const ua = v.unit(v.sub(refAt(m.from!), o0));
          const ub = v.unit(v.sub(refAt(m.to!), o0));
          const s = 11;
          poly([v.add(o0, v.mul(ua, s)), v.add(o0, v.add(v.mul(ua, s), v.mul(ub, s))), v.add(o0, v.mul(ub, s))]);
          ctx.strokeStyle = c;
          ctx.lineWidth = 1.4;
          ctx.stroke();
        });
        break;
      case 'ticks':
        add(4, () => {
          const seg = byId.get(m.on!);
          if (!seg?.from || !seg.to) return;
          const a = refAt(seg.from);
          const b = refAt(seg.to);
          const u = v.unit(v.sub(b, a));
          const n: XY = [-u[1], u[0]];
          const mid = v.mul(v.add(a, b), 0.5);
          const k = m.n ?? 1;
          for (let i = 0; i < k; i++) {
            const q = v.add(mid, v.mul(u, (i - (k - 1) / 2) * 5));
            line(ctx, q[0] - n[0] * 6, q[1] - n[1] * 6, q[0] + n[0] * 6, q[1] + n[1] * 6, m.color ? c : look.ink, 1.6);
          }
        });
        break;
      case 'force':
        add(5, () => {
          const q = posOf(m.on!);
          const u: XY = [Math.cos((m.dir ?? 90) * DEG), Math.sin((m.dir ?? 90) * DEG)];
          const tip = v.add(q, v.mul(u, 50));
          arrow(ctx, q[0], q[1], tip[0], tip[1], m.color ? c : look.red, { w: 2.4 });
          if (m.text) label(ctx, m.text, tip[0] + u[0] * 14, tip[1] + u[1] * 12, look, { size: 11.5, color: m.color ? c : look.red });
        });
        break;
    }
  }

  // --- forces the solver found ------------------------------------------------------------
  if (lay && sol.mech?.ok && d.show.forces) {
    const res = sol.mech;
    const L = lay;
    const flen = (F: number) => Math.min(66, 18 + 5.2 * Math.sqrt(Math.max(0, F)));
    const val = (sym: string, F: number) => (d.show.values ? `${sym} = ${fmtN(F)} N` : sym);

    // Labels are placed in the first free spot, clear of blocks, wheels, ropes, arrows and each
    // other, so two masses side by side never have their numbers drawn on top of one another.
    type Box = [number, number, number, number];
    interface FArrow { a: XY; b: XY; color: string; dash?: boolean; w: number; text?: string; size: number }
    const boxes: Box[] = [];
    const lines: [XY, XY][] = [];
    const blockOf = (id: string) => {
      const p = byId.get(id)!;
      const c = P(L.pos.get(id)!);
      const [wu, hu] = L.size.get(id)!;
      const s = p.on ? byId.get(p.on) : undefined;
      const th = s?.type === 'incline' ? (s.angle ?? 30) * DEG : 0;
      const hx = ((Math.abs(Math.cos(th)) * wu + Math.abs(Math.sin(th)) * hu) * U) / 2;
      const hy = ((Math.abs(Math.sin(th)) * wu + Math.abs(Math.cos(th)) * hu) * U) / 2;
      return { c, w: wu * U, h: hu * U, box: [c[0] - hx, c[1] - hy, c[0] + hx, c[1] + hy] as Box };
    };
    for (const p of d.parts) {
      if (p.type === 'mass') boxes.push(blockOf(p.id).box);
      else if (p.type === 'pulley') {
        const c = P(L.pos.get(p.id)!);
        const r = (p.r ?? 0.5) * U + 2;
        boxes.push([c[0] - r, c[1] - r, c[0] + r, c[1] + r]);
      }
    }
    L.ropes.forEach((g) => g.segs.forEach((sg) => lines.push([P(sg.a), P(sg.b)])));

    const overlaps = (a: Box, b: Box) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
    const crosses = (bx: Box, p: XY, q: XY) => {
      const n = Math.max(2, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / 5));
      for (let i = 0; i <= n; i++) {
        const x = p[0] + ((q[0] - p[0]) * i) / n;
        const y = p[1] + ((q[1] - p[1]) * i) / n;
        if (x > bx[0] && x < bx[2] && y > bx[1] && y < bx[3]) return true;
      }
      return false;
    };
    const W = d.size[0] * U;
    const H = d.size[1] * U;
    const cost = (bx: Box) =>
      boxes.filter((o) => overlaps(bx, o)).length +
      lines.filter(([p, q]) => crosses(bx, p, q)).length +
      (bx[0] < -PAD + 2 || bx[2] > W + PAD - 2 || bx[1] < -6 || bx[3] > H + PAD - 4 ? 2 : 0);
    const segBox = (a: XY, b: XY, pad = 4): Box =>
      [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad];

    const forces: FArrow[] = [];
    const accels: FArrow[] = [];
    for (const b of res.bodies) {
      const p = byId.get(b.id)!;
      if (p.type !== 'mass') continue;
      const { c, h } = blockOf(b.id);
      const s = p.on ? byId.get(p.on) : undefined;
      const n: XY | null = s?.type === 'incline' ? slope(s).n : s?.type === 'table' ? [0, -1] : null;
      const mg = b.m * d.g;
      const w0: XY = n ? c : [c[0], c[1] + h / 2];
      forces.push({ a: w0, b: [w0[0], w0[1] + flen(mg)], color: look.red, w: 2.4, text: val('mg', mg), size: 11 });
      d.ropes.forEach((r, ri) => {
        const T = res.tension.get(r.id);
        if (!T || T < 1e-6) return;
        const geo = L.ropes[ri];
        const first = r.path[0] === b.id;
        if (!first && r.path[r.path.length - 1] !== b.id) return;
        const seg = first ? geo.segs[0] : geo.segs[geo.segs.length - 1];
        const at: XY = P(first ? seg.a : seg.b);
        const u = v.unit(v.sub(P(first ? seg.b : seg.a), at));
        forces.push({ a: at, b: v.add(at, v.mul(u, flen(T))), color: look.blue, w: 2.4, text: val('T', T), size: 11 });
      });
      if (n) {
        const normal = b.m * d.g * (s!.type === 'incline' ? Math.cos(slope(s!).th) : 1);
        const top = v.add(c, v.mul(n, h / 2));
        forces.push({ a: top, b: v.add(top, v.mul(n, flen(normal))), color: look.green, w: 2.4, text: val('N', normal), size: 11 });
        if (Math.abs(b.friction) > 1e-6) {
          const base = v.sub(c, v.mul(n, h / 2));
          const u = v.mul(b.u, Math.sign(b.friction));
          const F = Math.abs(b.friction);
          forces.push({ a: base, b: v.add(base, v.mul(u, flen(F))), color: look.orange, w: 2.4, text: val('f', F), size: 11 });
        }
      }
    }
    for (const f of forces) lines.push([f.a, f.b]);

    // Acceleration arrows go beside the block, on whichever side is clear.
    for (const b of res.bodies) {
      const p = byId.get(b.id)!;
      if (p.type !== 'mass' || b.a === 0 || !d.show.values) continue;
      const { c, w, h } = blockOf(b.id);
      const s = p.on ? byId.get(p.on) : undefined;
      const n: XY | null = s?.type === 'incline' ? slope(s).n : s?.type === 'table' ? [0, -1] : null;
      const uu = v.mul(b.u, Math.sign(b.a));
      let centres: XY[];
      if (n) {
        const up = v.mul(n, h / 2 + 18);
        centres = [v.add(c, v.add(up, v.mul(uu, w / 2 + 16))), v.add(c, v.sub(up, v.mul(uu, w / 2 + 16))), v.add(c, up)];
      } else {
        // Away from the nearest other hanging thing first.
        const others = res.bodies.filter((o) => o.id !== b.id).map((o) => P(L.pos.get(o.id)!));
        const near = others.sort((a1, a2) => Math.abs(a1[1] - c[1]) - Math.abs(a2[1] - c[1]) || Math.abs(a1[0] - c[0]) - Math.abs(a2[0] - c[0]))[0];
        const away = near && near[0] > c[0] ? -1 : 1;
        centres = [away, -away].map((sgn) => [c[0] + sgn * (w / 2 + 14), c[1]] as XY);
      }
      let best: FArrow | null = null;
      let bestCost = Infinity;
      for (const m of centres) {
        const ar: FArrow = { a: v.sub(m, v.mul(uu, 15)), b: v.add(m, v.mul(uu, 15)), color: look.violet, dash: true, w: 2, text: `a = ${fmtN(Math.abs(b.a))} m/s²`, size: 10.5 };
        const k = cost(segBox(ar.a, ar.b));
        if (k < bestCost) {
          best = ar;
          bestCost = k;
        }
        if (k === 0) break;
      }
      accels.push(best!);
      lines.push([best!.a, best!.b]);
    }

    const all = [...forces, ...accels];
    const tags: { text: string; at: XY; color: string; size: number }[] = [];
    for (const ar of all) {
      if (!ar.text) continue;
      ctx.save();
      ctx.font = `600 ${ar.size}px ${SIM_FONT}`;
      const tw = ctx.measureText(ar.text).width + 6;
      ctx.restore();
      const th = ar.size + 6;
      const u = v.unit(v.sub(ar.b, ar.a));
      const n: XY = [-u[1], u[0]];
      const along = (Math.abs(u[0]) * tw) / 2 + (Math.abs(u[1]) * th) / 2 + 5;
      const across = (Math.abs(n[0]) * tw) / 2 + (Math.abs(n[1]) * th) / 2 + 6;
      const mid = v.mul(v.add(ar.a, ar.b), 0.5);
      const past = v.add(ar.b, v.mul(u, along));
      const spots: XY[] = [past];
      for (const sgn of [1, -1]) spots.push(v.add(mid, v.mul(n, across * sgn)));
      for (const sgn of [1, -1]) spots.push(v.add(ar.b, v.mul(n, across * sgn)));
      for (const sgn of [1, -1]) spots.push(v.add(past, v.mul(n, across * sgn)));
      spots.push(v.add(past, v.mul(u, th + 4)));
      for (const sgn of [1, -1]) spots.push(v.add(mid, v.mul(n, (across + 20) * sgn)));
      let at = spots[0];
      let bestCost = Infinity;
      for (const sp of spots) {
        const k = cost([sp[0] - tw / 2, sp[1] - th / 2, sp[0] + tw / 2, sp[1] + th / 2]);
        if (k < bestCost) {
          at = sp;
          bestCost = k;
        }
        if (k === 0) break;
      }
      boxes.push([at[0] - tw / 2, at[1] - th / 2, at[0] + tw / 2, at[1] + th / 2]);
      tags.push({ text: ar.text, at, color: ar.color, size: ar.size });
    }

    for (const ar of all) add(5, () => arrow(ctx, ar.a[0], ar.a[1], ar.b[0], ar.b[1], ar.color, { w: ar.w, dash: ar.dash }));
    for (const t of tags) add(6, () => label(ctx, t.text, t.at[0], t.at[1], look, { size: t.size, color: t.color }));
  }

  // --- paint, building up when progress < 1 ------------------------------------------------
  ops.sort((a, b) => a[0] - b[0]);
  const prog = o.progress ?? 1;
  const n = ops.length;
  const base = ctx.globalAlpha;
  ctx.lineCap = 'round';
  ops.forEach(([, fn], i) => {
    const a = prog >= 1 ? 1 : Math.min(1, Math.max(0, prog * (n + 1.5) - i));
    if (a <= 0) return;
    ctx.save();
    ctx.globalAlpha = base * a;
    fn();
    ctx.restore();
  });
}

// --- circuit symbols --------------------------------------------------------------------------

function symbol(ctx: CanvasRenderingContext2D, p: Part, look: Look, circ: CircuitResult | undefined, values: boolean) {
  const { a, b } = terminals(p);
  const A: XY = [a[0] * U, a[1] * U];
  const B: XY = [b[0] * U, b[1] * U];
  const c: XY = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const rot = Math.atan2(B[1] - A[1], B[0] - A[0]);
  const L = HALF * U;
  const ink = look.line;
  const reading = circ?.parts.get(p.id);
  ctx.save();
  ctx.translate(c[0], c[1]);
  ctx.rotate(rot);
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const lead = (x0: number) => {
    ctx.beginPath();
    ctx.moveTo(-L, 0);
    ctx.lineTo(-x0, 0);
    ctx.moveTo(x0, 0);
    ctx.lineTo(L, 0);
    ctx.stroke();
  };
  switch (p.type) {
    case 'resistor': {
      lead(17);
      ctx.beginPath();
      ctx.moveTo(-17, 0);
      for (let i = 0; i < 6; i++) ctx.lineTo(-17 + (i + 0.5) * (34 / 6), i % 2 ? 7 : -7);
      ctx.lineTo(17, 0);
      ctx.stroke();
      break;
    }
    case 'bulb': {
      lead(12);
      const glow = reading ? Math.min(1, Math.sqrt(reading.P) / 4) : 0;
      if (glow > 0.02) {
        ctx.save();
        ctx.shadowColor = look.yellow;
        ctx.shadowBlur = 22 * glow;
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI * 2);
        ctx.globalAlpha = 0.25 + 0.6 * glow;
        ctx.fillStyle = look.yellow;
        ctx.fill();
        ctx.restore();
      }
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-8.5, -8.5);
      ctx.lineTo(8.5, 8.5);
      ctx.moveTo(8.5, -8.5);
      ctx.lineTo(-8.5, 8.5);
      ctx.stroke();
      break;
    }
    case 'battery': {
      lead(5);
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-5, -14);
      ctx.lineTo(-5, 14);
      ctx.stroke();
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(5, -7);
      ctx.lineTo(5, 7);
      ctx.stroke();
      break;
    }
    case 'capacitor': {
      lead(5);
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(-5, -12);
      ctx.lineTo(-5, 12);
      ctx.moveTo(5, -12);
      ctx.lineTo(5, 12);
      ctx.stroke();
      break;
    }
    case 'switch': {
      lead(14);
      for (const x of [-14, 14]) {
        ctx.beginPath();
        ctx.arc(x, 0, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.beginPath();
      ctx.moveTo(-14, 0);
      if (p.closed === false) ctx.lineTo(10, -13);
      else ctx.lineTo(14, -2);
      ctx.stroke();
      break;
    }
    case 'ammeter':
    case 'voltmeter': {
      lead(13);
      ctx.beginPath();
      ctx.arc(0, 0, 13, 0, Math.PI * 2);
      ctx.fillStyle = look.card;
      ctx.fill();
      ctx.stroke();
      ctx.rotate(-rot);
      text(ctx, p.type === 'ammeter' ? 'A' : 'V', 0, 0.5, { size: 13, weight: 700, color: look.ink, align: 'center' });
      break;
    }
  }
  ctx.restore();

  // Name and value beside the part, and the reading on the other side.
  const vertical = Math.abs(Math.sin(rot)) > 0.7;
  const name = p.label ?? p.id;
  const value =
    p.type === 'battery' ? `${fmtN(p.V ?? 12)} V${p.ohm ? `, r = ${fmtN(p.ohm)} Ω` : ''}` :
    p.type === 'resistor' || p.type === 'bulb' ? `${fmtN(p.ohm ?? 10)} Ω` :
    p.type === 'capacitor' ? `${fmtN(p.uF ?? 100)} μF` : '';
  const tag = value ? `${name} = ${value}` : name;
  if (vertical) label(ctx, tag, c[0] - 22, c[1], look, { size: 11.5, align: 'right' });
  else label(ctx, tag, c[0], c[1] - 24, look, { size: 11.5 });
  if (p.type === 'battery') {
    const plus = vertical ? [c[0] + 14, A[1] < B[1] ? c[1] - 14 : c[1] + 14] : [A[0] < B[0] ? c[0] - 13 : c[0] + 13, c[1] - 14];
    text(ctx, '+', plus[0], plus[1], { size: 12, weight: 700, color: look.red, align: 'center' });
  }
  if (!values || !reading) return;
  let read = '';
  if (p.type === 'ammeter') read = `${fmtN(Math.abs(reading.I))} A`;
  else if (p.type === 'voltmeter') read = `${fmtN(Math.abs(reading.V))} V`;
  else if (p.type === 'resistor' || p.type === 'bulb' || p.type === 'battery') read = `${fmtN(Math.abs(reading.I))} A`;
  else if (p.type === 'capacitor') read = `${fmtN(Math.abs(reading.V) * (p.uF ?? 100))} μC`;
  if (!read) return;
  const meter = p.type === 'ammeter' || p.type === 'voltmeter';
  const at: XY = vertical ? [c[0] + 24, c[1]] : [c[0], c[1] + 24];
  ctx.save();
  ctx.font = `650 11px ${SIM_FONT}`;
  const tw = ctx.measureText(read).width + 14;
  ctx.beginPath();
  ctx.roundRect(vertical ? at[0] : at[0] - tw / 2, at[1] - 9, tw, 18, 9);
  ctx.fillStyle = meter ? look.green : look.blue;
  ctx.globalAlpha = look.dark ? 0.28 : 0.14;
  ctx.fill();
  ctx.restore();
  text(ctx, read, vertical ? at[0] + tw / 2 : at[0], at[1] + 0.5, { size: 11, weight: 650, color: meter ? look.green : look.blue, align: 'center' });
}

// --- graphs ---------------------------------------------------------------------------------

const FN_COLORS: (keyof Look)[] = ['blue', 'red', 'green', 'violet', 'orange'];

function graph(ctx: CanvasRenderingContext2D, p: Part, look: Look) {
  const gx = p.at[0] * U;
  const gy = p.at[1] * U;
  const W = (p.w ?? 8) * U;
  const H = (p.h ?? 6) * U;
  const [x0, x1] = p.xr ?? [-5, 5];
  const [y0, y1] = p.yr ?? [-5, 5];
  const X = (x: number) => gx + ((x - x0) / (x1 - x0)) * W;
  const Y = (y: number) => gy + ((y1 - y) / (y1 - y0)) * H;
  const sx = niceStep(x1 - x0);
  const sy = niceStep(y1 - y0);
  const axX = y0 <= 0 && y1 >= 0 ? Y(0) : gy + H;
  const axY = x0 <= 0 && x1 >= 0 ? X(0) : gx;

  ctx.save();
  if (p.grid !== false) {
    ctx.strokeStyle = look.cardEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(x0 / sx) * sx; x <= x1 + 1e-9; x += sx) {
      ctx.moveTo(X(x), gy);
      ctx.lineTo(X(x), gy + H);
    }
    for (let y = Math.ceil(y0 / sy) * sy; y <= y1 + 1e-9; y += sy) {
      ctx.moveTo(gx, Y(y));
      ctx.lineTo(gx + W, Y(y));
    }
    ctx.stroke();
  }
  arrow(ctx, gx - 4, axX, gx + W + 10, axX, look.muted, { w: 1.6 });
  arrow(ctx, axY, gy + H + 4, axY, gy - 10, look.muted, { w: 1.6 });
  text(ctx, 'x', gx + W + 14, axX + 12, { size: 12, weight: 600, color: look.muted, align: 'center' });
  text(ctx, 'y', axY - 12, gy - 10, { size: 12, weight: 600, color: look.muted, align: 'center' });
  for (let x = Math.ceil(x0 / sx) * sx; x <= x1 + 1e-9; x += sx) {
    if (Math.abs(x) < sx / 2) continue;
    line(ctx, X(x), axX - 3, X(x), axX + 3, look.muted, 1.2);
    text(ctx, tickText(x), X(x), axX + 12, { size: 10, color: look.muted, align: 'center' });
  }
  for (let y = Math.ceil(y0 / sy) * sy; y <= y1 + 1e-9; y += sy) {
    if (Math.abs(y) < sy / 2) continue;
    line(ctx, axY - 3, Y(y), axY + 3, Y(y), look.muted, 1.2);
    text(ctx, tickText(y), axY - 7, Y(y), { size: 10, color: look.muted, align: 'right' });
  }
  if (axY !== gx || axX !== gy + H) text(ctx, 'O', axY - 8, axX + 11, { size: 10, color: look.muted, align: 'center' });

  ctx.beginPath();
  ctx.rect(gx, gy, W, H);
  ctx.clip();
  const labels: XY[] = [];
  (p.fns ?? []).forEach((fn, k) => {
    const f = tryCompile(fn.expr);
    if (!f) return;
    const color = look[FN_COLORS[k % FN_COLORS.length]] as string;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    let pen = false;
    let prev = 0;
    let last: XY | null = null;
    const N = 480;
    for (let i = 0; i <= N; i++) {
      const x = x0 + ((x1 - x0) * i) / N;
      const y = f(x);
      const py = Y(y);
      if (!Number.isFinite(y) || Math.abs(py - gy) > H * 6) {
        pen = false;
        continue;
      }
      if (pen && Math.abs(py - prev) > H * 1.2) pen = false;
      if (pen) ctx.lineTo(X(x), py);
      else ctx.moveTo(X(x), py);
      pen = true;
      prev = py;
      if (py >= gy && py <= gy + H) last = [X(x), py];
    }
    ctx.stroke();
    if (last) {
      let at: XY = [Math.min(last[0], gx + W - 6), Math.max(gy + 12, Math.min(gy + H - 12, last[1] - 12))];
      while (labels.some((q) => Math.abs(q[1] - at[1]) < 15 && Math.abs(q[0] - at[0]) < 120)) at = [at[0], at[1] + 16];
      labels.push(at);
      label(ctx, fn.label ?? `y = ${fn.expr.replace(/^\s*y\s*=\s*/, '')}`, at[0], at[1], look, { size: 11.5, weight: 650, color, align: 'right' });
    }
  });
  for (const dt of p.dots ?? []) {
    const q: XY = [X(dt.x), Y(dt.y)];
    ctx.beginPath();
    ctx.arc(q[0], q[1], 4, 0, Math.PI * 2);
    ctx.fillStyle = look.ink;
    ctx.fill();
    if (dt.label) label(ctx, dt.label, q[0] + 8, q[1] - 12, look, { size: 11, align: 'left' });
  }
  ctx.restore();
}
