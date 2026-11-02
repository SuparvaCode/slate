/**
 * Shared pieces for the simulators: parameter types, controls, and drawing helpers.
 *
 * Every simulator draws in a fixed 560 x 380 "base" box; the board scales that box to the size
 * the user gives the simulator, keeping its proportions, so text and arrows scale with it.
 */

export const BW = 560;
export const BH = 380;
/** Ground line used by the mechanics layouts. */
export const FLOOR = 352;

export type SimParams = Record<string, number | string | boolean>;

export interface Look {
  /** The simulator's own colour (the element colour): ropes, rods, wires. */
  line: string;
  ink: string;
  muted: string;
  faint: string;
  card: string;
  cardEdge: string;
  red: string;
  blue: string;
  green: string;
  orange: string;
  violet: string;
  yellow: string;
  dark: boolean;
}

export interface Readout {
  label: string;
  value: string;
  color?: string;
}

export interface Formula {
  label: string;
  tex: string;
}

interface ControlBase {
  key: string;
  label: string;
  /** Hidden unless this returns true, for controls that only apply to some setups. */
  show?: (p: SimParams) => boolean;
}

export type Control =
  | (ControlBase & { type: 'range'; min: number; max: number; step: number; unit?: string })
  | (ControlBase & { type: 'choice'; options: { value: string; label: string }[] })
  | (ControlBase & { type: 'toggle' });

export interface SimState {
  /** Simulated seconds since the start. */
  t: number;
  /** The motion has reached a stop (a block hit the pulley, the ball landed...). */
  done: boolean;
}

export type SimSubject = 'Physics' | 'Chemistry' | 'Biology' | 'Maths' | 'Computer';

export interface SimDef<S extends SimState = SimState> {
  label: string;
  /** Where the picker files it. Defaults to Physics. */
  subject?: SimSubject;
  /** Extra words the picker search matches, e.g. "vernier micrometer". */
  keywords?: string;
  /** Settings that only change what is drawn (labels, grids), so changing them never restarts the motion. */
  display?: string[];
  /**
   * Settings that carry the run's progress, written back when it pauses, steps or finishes, so the
   * settings panel shows where the run got to (titrant added so far). Return null when unchanged.
   */
  commit?: (p: SimParams, s: S) => SimParams | null;
  /** Settings "Back to the start" restores, for runs whose progress is kept in the settings. */
  resetParams?: SimParams;
  /** One line for the picker. */
  blurb: string;
  defaults: SimParams;
  controls: Control[];
  /** Ready-made setups a teacher can jump to. */
  presets?: { label: string; params: SimParams }[];
  title: (p: SimParams) => string;
  init: (p: SimParams) => S;
  /** Advances the state by dt simulated seconds. Sets s.done when the motion is over. */
  step: (p: SimParams, s: S, dt: number) => void;
  draw: (ctx: CanvasRenderingContext2D, p: SimParams, s: S, look: Look) => void;
  readouts: (p: SimParams, s: S) => Readout[];
  /** The working, with this setup's numbers in it, for the settings panel. */
  formulas: (p: SimParams) => Formula[];
  /** Where the live readouts go, clear of the drawing. */
  readoutAt?: 'left' | 'right';
  /** Starts running as soon as it is on the board (circuits: current always flows). */
  autoplay?: boolean;
  /** Nothing moves in this setup (a molecule, a cell diagram): the card shows no play, reset or clock. */
  still?: (p: SimParams) => boolean;
  /**
   * Direct editing on the board: the part of the drawing at base-box point (x, y), if it can be
   * tapped or dragged. Coordinates are in the 560 x 380 drawing box. Works with the select tool;
   * the pen still draws over the card.
   */
  grab?: (p: SimParams, s: S, x: number, y: number) => SimGrab | null;
}

/** Something on a simulator that the user can operate by hand. */
export interface SimGrab {
  /** CSS cursor on hover. Defaults to 'grab' for drags and 'pointer' for taps. */
  cursor?: string;
  /** Settings a tap changes: a switch, a gate input, an element of the periodic table. */
  tap?: SimParams;
  /** Settings while dragging to base-box point (x, y): moving a lens, a magnet, a jaw. */
  drag?: (x: number, y: number) => SimParams;
  /**
   * Settings when the pointer is let go at base-box point (x, y), or null to keep what the drag
   * left. Lets one grab tell a tap from a drag: tapping an atom changes it, dragging bonds it.
   */
  drop?: (x: number, y: number) => SimParams | null;
  /** Short hint shown while hovering, e.g. "Drag the object". */
  hint?: string;
}

// --- parameters -------------------------------------------------------------

export const num = (p: SimParams, k: string, fallback = 0): number => {
  const v = p[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};
export const str = (p: SimParams, k: string, fallback = ''): string => {
  const v = p[k];
  return typeof v === 'string' ? v : fallback;
};
export const bool = (p: SimParams, k: string): boolean => p[k] === true;

/** A number for people: no trailing zeros, sensible precision, a real minus sign. */
export function fmt(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞';
  if (Math.abs(v) < 1e-9) return '0';
  const a = Math.abs(v);
  const d = a >= 100 ? Math.max(0, digits - 3) : a >= 10 ? Math.max(0, digits - 2) : a >= 1 ? digits - 1 : digits;
  const s = v.toFixed(Math.min(4, d)).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return s.replace('-', '−');
}

/** The same, for KaTeX. */
export const tf = (v: number, digits = 3) => fmt(v, digits).replace('−', '-');

export const DEG = Math.PI / 180;

// --- integration -------------------------------------------------------------

/** One classic Runge-Kutta step for y' = f(y). */
export function rk4(f: (y: number[]) => number[], y: number[], h: number): number[] {
  const k1 = f(y);
  const k2 = f(y.map((v, i) => v + (h / 2) * k1[i]));
  const k3 = f(y.map((v, i) => v + (h / 2) * k2[i]));
  const k4 = f(y.map((v, i) => v + h * k3[i]));
  return y.map((v, i) => v + (h / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
}

// --- drawing ------------------------------------------------------------------

export const SIM_FONT = '-apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif';

interface TextOpts {
  size?: number;
  color?: string;
  align?: CanvasTextAlign;
  weight?: number;
  baseline?: CanvasTextBaseline;
}

export function text(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, o: TextOpts = {}) {
  ctx.font = `${o.weight ?? 500} ${o.size ?? 12}px ${SIM_FONT}`;
  ctx.fillStyle = o.color ?? '#000';
  ctx.textAlign = o.align ?? 'left';
  ctx.textBaseline = o.baseline ?? 'middle';
  ctx.fillText(s, x, y);
}

/**
 * The box labels are kept inside while a simulator draws (its 560 x 380 drawing box), or null.
 * Diagrams share label() and have their own size, so they leave it off.
 */
let labelBox: [number, number] | null = null;
export function withLabelBox<T>(w: number, h: number, draw: () => T): T {
  labelBox = [w, h];
  try {
    return draw();
  } finally {
    labelBox = null;
  }
}

/** Text with a halo in the card colour, so it reads over lines. */
export function label(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, look: Look, o: TextOpts = {}) {
  ctx.save();
  ctx.font = `${o.weight ?? 600} ${o.size ?? 11}px ${SIM_FONT}`;
  ctx.textAlign = o.align ?? 'center';
  ctx.textBaseline = o.baseline ?? 'middle';
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = look.card;
  ctx.lineJoin = 'round';
  // Keep it inside the drawing box: a tag at the tip of an arrow near the edge would be cut off.
  // Only when nothing is rotated, since then x and y are box coordinates.
  const t = ctx.getTransform();
  if (labelBox && Math.abs(t.b) < 1e-9 && Math.abs(t.c) < 1e-9) {
    const [BW, BH] = labelBox;
    const w = ctx.measureText(s).width;
    const h = (o.size ?? 11) * 0.6;
    const align = ctx.textAlign;
    const left = align === 'center' ? x - w / 2 : align === 'right' || align === 'end' ? x - w : x;
    const shiftX = Math.max(0, 3 - left) - Math.max(0, left + w - (BW - 3));
    x += shiftX;
    const mid = ctx.textBaseline === 'middle' ? y : y - h;
    y += Math.max(0, h + 2 - mid) - Math.max(0, mid + h - (BH - 2));
  }
  ctx.strokeText(s, x, y);
  ctx.fillStyle = o.color ?? look.ink;
  ctx.fillText(s, x, y);
  ctx.restore();
}

export function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, w = 2, dash?: number[]) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/** A force or velocity arrow. Nothing is drawn for a near-zero length. */
export function arrow(
  ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string,
  o: { w?: number; tag?: string; look?: Look; dash?: boolean } = {},
) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 2) return;
  const w = o.w ?? 2.4;
  const a = Math.atan2(y2 - y1, x2 - x1);
  const head = Math.min(9, len * 0.45);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  if (o.dash) ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2 - Math.cos(a) * head * 0.6, y2 - Math.sin(a) * head * 0.6);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - head * Math.cos(a - 0.42), y2 - head * Math.sin(a - 0.42));
  ctx.lineTo(x2 - head * Math.cos(a + 0.42), y2 - head * Math.sin(a + 0.42));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  if (o.tag && o.look) {
    label(ctx, o.tag, x2 + Math.cos(a) * 11, y2 + Math.sin(a) * 11, o.look, { color });
  }
}

/** A hatched surface: ground, ceiling or wall. The hatching goes on the side given by (nx, ny). */
export function hatch(
  ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, look: Look, nx = 0, ny = 1,
) {
  line(ctx, x1, y1, x2, y2, look.muted, 2);
  const len = Math.hypot(x2 - x1, y2 - y1);
  const n = Math.floor(len / 10);
  ctx.save();
  ctx.strokeStyle = look.faint;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= n; i++) {
    const t = i / Math.max(1, n);
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    ctx.moveTo(x, y);
    ctx.lineTo(x + nx * 7 - ny * 6, y + ny * 7 + nx * 6);
  }
  ctx.stroke();
  ctx.restore();
}

/** A labelled block, optionally turned to sit on a slope. */
export function block(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, side: number, angle: number, tag: string, look: Look, tint: string,
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.roundRect(-side / 2, -side / 2, side, side, 5);
  ctx.fillStyle = tint;
  ctx.globalAlpha = look.dark ? 0.35 : 0.22;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = tint;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  text(ctx, tag, cx, cy, { size: 11, weight: 650, color: look.ink, align: 'center' });
}

/** A pulley wheel with spokes, turned by `turn` radians so it visibly rolls with the rope. */
export function wheel(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, turn: number, look: Look) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = look.card;
  ctx.fill();
  ctx.strokeStyle = look.muted;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(2, r - 4), 0, Math.PI * 2);
  ctx.strokeStyle = look.faint;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  for (let i = 0; i < 3; i++) {
    const a = turn + (i * Math.PI * 2) / 3;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * (r - 4), cy + Math.sin(a) * (r - 4));
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 2.6, 0, Math.PI * 2);
  ctx.fillStyle = look.muted;
  ctx.fill();
  ctx.restore();
}

/** A coil spring between two points. */
export function spring(
  ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, coils: number, width: number, color: string,
) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ux = (x2 - x1) / (len || 1);
  const uy = (y2 - y1) / (len || 1);
  const lead = Math.min(14, len * 0.12);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 + ux * lead, y1 + uy * lead);
  const body = len - lead * 2;
  const n = coils * 2;
  for (let i = 1; i <= n; i++) {
    const t = lead + (body * (i - 0.5)) / n;
    const side = i % 2 ? 1 : -1;
    ctx.lineTo(x1 + ux * t - uy * width * side, y1 + uy * t + ux * width * side);
  }
  ctx.lineTo(x2 - ux * lead, y2 - uy * lead);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/** Small horizontal bars for kinetic, potential and total energy. */
export function energyBars(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
  parts: { label: string; value: number; color: string }[], max: number, look: Look,
) {
  text(ctx, 'ENERGY', x, y - 10, { size: 10, weight: 650, color: look.faint });
  const rowH = h / parts.length;
  parts.forEach((p, i) => {
    const yy = y + i * rowH;
    text(ctx, p.label, x, yy + rowH / 2, { size: 10.5, color: look.muted });
    const bx = x + 26;
    const bw = w - 26;
    ctx.fillStyle = look.cardEdge;
    ctx.beginPath();
    ctx.roundRect(bx, yy + rowH / 2 - 4, bw, 8, 4);
    ctx.fill();
    const f = max > 0 ? Math.max(0, Math.min(1, p.value / max)) : 0;
    if (f > 0) {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.roundRect(bx, yy + rowH / 2 - 4, Math.max(8, bw * f), 8, 4);
      ctx.fill();
    }
  });
}

/** Little plot with axes; points are [t, value]. */
export function plot(
  ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, pts: [number, number][],
  o: {
    tMax: number; vMax: number; color: string; look: Look; title: string; unit: string;
    /** Values are never negative: zero sits at the bottom instead of the middle. */
    positive?: boolean;
  },
) {
  const { look } = o;
  const zero = o.positive ? y + h - 4 : y + h / 2;
  const span = o.positive ? h - 8 : h / 2 - 4;
  ctx.save();
  ctx.strokeStyle = look.cardEdge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  line(ctx, x, zero, x + w, zero, look.faint, 1, [3, 3]);
  text(ctx, o.title, x + 6, y + 10, { size: 10, weight: 650, color: look.faint });
  text(ctx, `${o.unit}`, x - 4, y + 8, { size: 9.5, color: look.faint, align: 'right' });
  // Beside the end of the axis, or under it when the plot runs to the edge of the box.
  if (x + w + 14 <= BW) text(ctx, 't', x + w + 6, zero, { size: 10, color: look.faint });
  else text(ctx, 't', x + w - 2, zero + 9, { size: 10, color: look.faint, align: 'right' });
  if (pts.length > 1) {
    const t0 = Math.max(0, pts[pts.length - 1][0] - o.tMax);
    ctx.beginPath();
    let started = false;
    for (const [t, v] of pts) {
      if (t < t0) continue;
      const px = x + ((t - t0) / o.tMax) * w;
      const py = zero - (v / (o.vMax || 1)) * span;
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else ctx.lineTo(px, py);
    }
    ctx.strokeStyle = o.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.restore();
}

/** Arc showing an angle at (cx, cy), from a0 to a1 (radians, canvas convention). */
export function angleArc(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, a0: number, a1: number, tag: string, look: Look,
) {
  ctx.save();
  ctx.strokeStyle = look.muted;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.min(a0, a1), Math.max(a0, a1));
  ctx.stroke();
  ctx.restore();
  const am = (a0 + a1) / 2;
  label(ctx, tag, cx + Math.cos(am) * (r + 13), cy + Math.sin(am) * (r + 13), look, { size: 10.5, color: look.muted });
}
