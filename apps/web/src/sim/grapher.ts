/**
 * Function grapher: transformations of the standard graphs, y = a·f(b(x − h)) + k, with a point
 * on the curve and its tangent (the derivative), and the signed area between two bounds.
 *
 * Everything is worked out in graph units. The view is a square-unit window centred on (cx, cy)
 * whose half-width is the zoom setting.
 */

import { bool, fmt, label, line, num, str, text, tf } from './kit.ts';
import type { Formula, Look, Readout, SimDef, SimParams, SimState } from './kit.ts';

interface GraphState extends SimState {
  /** The point on the curve: the slider value, sweeping across the view while playing. */
  x: number;
  dir: number;
}

export type FamKey = 'linear' | 'quadratic' | 'cubic' | 'sin' | 'cos' | 'exp' | 'log' | 'recip' | 'abs';

interface Fam {
  name: string;
  f: (u: number) => number;
  df: (u: number) => number;
  /** The anchor (dragging it changes h and k) sits at u = u0, at height a·f0 + k. */
  u0: number;
  f0?: number;
  /** The shape handle (dragging it changes a and b) sits at u = u1. */
  u1: number;
}

const FAMS: Record<FamKey, Fam> = {
  linear: { name: 'Linear', f: (u) => u, df: () => 1, u0: 0, u1: 1 },
  quadratic: { name: 'Quadratic', f: (u) => u * u, df: (u) => 2 * u, u0: 0, u1: 1 },
  cubic: { name: 'Cubic', f: (u) => u * u * u, df: (u) => 3 * u * u, u0: 0, u1: 1 },
  sin: { name: 'Sine', f: Math.sin, df: Math.cos, u0: 0, u1: Math.PI / 2 },
  cos: { name: 'Cosine', f: Math.cos, df: (u) => -Math.sin(u), u0: 0, u1: Math.PI },
  exp: { name: 'Exponential', f: Math.exp, df: Math.exp, u0: 0, u1: 1 },
  log: { name: 'Logarithmic', f: (u) => (u > 0 ? Math.log(u) : NaN), df: (u) => (u > 0 ? 1 / u : NaN), u0: 1, u1: Math.E },
  recip: { name: 'Reciprocal', f: (u) => (u === 0 ? NaN : 1 / u), df: (u) => (u === 0 ? NaN : -1 / (u * u)), u0: 0, f0: 0, u1: 1 },
  abs: { name: 'Absolute value', f: Math.abs, df: (u) => (u === 0 ? NaN : Math.sign(u)), u0: 0, u1: 1 },
};

/** The curve for these settings: y(x), its exact derivative, and the parts. */
export function model(p: SimParams) {
  const key = (str(p, 'fn', 'quadratic') in FAMS ? str(p, 'fn', 'quadratic') : 'quadratic') as FamKey;
  const F = FAMS[key];
  const a = num(p, 'a', 1);
  let b = num(p, 'b', 1);
  if (Math.abs(b) < 1e-9) b = 0.05; // b = 0 would squash the graph to a single value
  const h = num(p, 'h', 0);
  const k = num(p, 'k', 0);
  const y = (x: number) => a * F.f(b * (x - h)) + k;
  const dy = (x: number) => a * b * F.df(b * (x - h));
  return { key, F, a, b, h, k, y, dy };
}
type Model = ReturnType<typeof model>;

// --- numerics -----------------------------------------------------------------------------

function simpsonStep(f: (x: number) => number, l: number, r: number, fl: number, fm: number, fr: number, whole: number, eps: number, depth: number): number {
  const m = (l + r) / 2;
  const lm = (l + m) / 2;
  const rm = (m + r) / 2;
  const flm = f(lm);
  const frm = f(rm);
  const left = ((m - l) / 6) * (fl + 4 * flm + fm);
  const right = ((r - m) / 6) * (fm + 4 * frm + fr);
  const d = left + right - whole;
  if (depth <= 0 || Math.abs(d) <= 15 * eps) return left + right + d / 15;
  return simpsonStep(f, l, m, fl, flm, fm, left, eps / 2, depth - 1) + simpsonStep(f, m, r, fm, frm, fr, right, eps / 2, depth - 1);
}

/** ∫ f from lo to hi by adaptive Simpson over 64 panels (relative error around 1e-11 for these curves). */
export function integrate(f: (x: number) => number, lo: number, hi: number, eps = 1e-11): number {
  if (lo === hi) return 0;
  if (lo > hi) return -integrate(f, hi, lo, eps);
  const n = 64;
  const w = (hi - lo) / n;
  // A relative tolerance: e^x over a wide range is huge, and an absolute one could never be met.
  let rough = 0;
  for (let i = 0; i <= n; i++) rough += Math.abs(f(lo + i * w)) * w;
  eps *= Math.max(1, rough);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const l = lo + i * w;
    const r = i === n - 1 ? hi : l + w;
    const fl = f(l);
    const fr = f(r);
    const fm = f((l + r) / 2);
    sum += simpsonStep(f, l, r, fl, fm, fr, ((r - l) / 6) * (fl + 4 * fm + fr), eps / n, 18);
  }
  return sum;
}

/** The signed area between the bounds, or why there is none. */
export function area(p: SimParams): { value: number; why?: string } {
  const m = model(p);
  const lo = num(p, 'x1', 0);
  const hi = num(p, 'x2', 2);
  if (m.key === 'log' && (m.b * (lo - m.h) <= 0 || m.b * (hi - m.h) <= 0)) return { value: NaN, why: 'Outside the domain' };
  if (m.key === 'recip' && m.h >= Math.min(lo, hi) && m.h <= Math.max(lo, hi)) return { value: NaN, why: 'Diverges at the asymptote' };
  return { value: integrate(m.y, lo, hi) };
}

/** Exact x-intercepts. Periodic curves list those in [x0, x1]. */
export function roots(m: Model, x0 = -50, x1 = 50): number[] | 'all' {
  const { key, a, b, h, k } = m;
  if (a === 0) return k === 0 ? 'all' : [];
  const c = -k / a; // f(u) = c
  let us: number[] = [];
  switch (key) {
    case 'linear': us = [c]; break;
    case 'quadratic': us = c > 0 ? [-Math.sqrt(c), Math.sqrt(c)] : c === 0 ? [0] : []; break;
    case 'cubic': us = [Math.cbrt(c)]; break;
    case 'abs': us = c > 0 ? [-c, c] : c === 0 ? [0] : []; break;
    case 'exp': us = c > 0 ? [Math.log(c)] : []; break;
    case 'log': us = [Math.exp(c)]; break;
    case 'recip': us = c !== 0 ? [1 / c] : []; break;
    case 'sin':
    case 'cos': {
      if (Math.abs(c) > 1) break;
      const base = key === 'sin' ? [Math.asin(c), Math.PI - Math.asin(c)] : [Math.acos(c), -Math.acos(c)];
      const ua = b * (x0 - h);
      const ub = b * (x1 - h);
      const umin = Math.min(ua, ub);
      const umax = Math.max(ua, ub);
      for (const u0 of base) {
        for (let n = Math.ceil((umin - u0) / (2 * Math.PI)); u0 + 2 * Math.PI * n <= umax; n++) us.push(u0 + 2 * Math.PI * n);
      }
      break;
    }
  }
  const xs = us.map((u) => h + u / b).sort((p, q) => p - q);
  return xs.filter((x, i) => i === 0 || Math.abs(x - xs[i - 1]) > 1e-9);
}

// --- view -----------------------------------------------------------------------------------

const L = 8;
const T = 8;
const R = 552;
const B = 372;
const MX = (L + R) / 2;
const MY = (T + B) / 2;

function view(p: SimParams) {
  const zoom = num(p, 'zoom', 6);
  const s = (R - L) / 2 / zoom;
  const cx = num(p, 'cx', 0);
  const cy = num(p, 'cy', 0);
  return {
    s, cx, cy,
    X: (x: number) => MX + (x - cx) * s,
    Y: (y: number) => MY - (y - cy) * s,
    ix: (px: number) => cx + (px - MX) / s,
    iy: (py: number) => cy - (py - MY) / s,
    x0: cx - (MX - L) / s,
    x1: cx + (R - MX) / s,
    y0: cy - (B - MY) / s,
    y1: cy + (MY - T) / s,
  };
}
type View = ReturnType<typeof view>;

function niceStep(raw: number) {
  const e = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e;
}

/** A tidy value to snap drags to: about 3 px at this zoom, always 1, 2 or 5 × 10ⁿ. */
const snapUnit = (v: View) => niceStep(3 / v.s);
const snap = (x: number, u: number) => Number((Math.round(x / u) * u).toFixed(6));
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

const isTrig = (p: SimParams) => ['sin', 'cos'].includes(str(p, 'fn'));

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : Math.abs(a);
}

/** n/4 of π, written the way a textbook does: π/2, 3π/4, −2π. */
function piLabel(quarters: number) {
  const g = gcd(quarters, 4) || 1;
  const n = quarters / g;
  const d = 4 / g;
  const top = n === 1 ? 'π' : n === -1 ? '−π' : `${fmt(n)}π`;
  return d === 1 ? top : `${top}/${d}`;
}

function drawAxes(ctx: CanvasRenderingContext2D, p: SimParams, v: View, look: Look) {
  const step = niceStep(55 / v.s);
  const pi = isTrig(p) && bool(p, 'pi');
  // x ticks in quarters of π for trig graphs, if asked.
  const qStep = pi ? Math.max(1, Math.round(niceStep((55 / v.s) / (Math.PI / 4)))) : 0;
  const xStep = pi ? (qStep * Math.PI) / 4 : step;
  const mant = Math.round(step / Math.pow(10, Math.floor(Math.log10(step) + 1e-9)));
  const minor = step / (mant === 2 ? 4 : 5);

  ctx.save();
  ctx.beginPath();
  ctx.rect(L, T, R - L, B - T);
  ctx.clip();
  if (bool(p, 'grid')) {
    ctx.lineWidth = 1;
    if (minor * v.s >= 9 && !pi) {
      ctx.strokeStyle = look.cardEdge;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      for (let x = Math.ceil(v.x0 / minor) * minor; x <= v.x1; x += minor) {
        ctx.moveTo(Math.round(v.X(x)) + 0.5, T);
        ctx.lineTo(Math.round(v.X(x)) + 0.5, B);
      }
      for (let y = Math.ceil(v.y0 / minor) * minor; y <= v.y1; y += minor) {
        ctx.moveTo(L, Math.round(v.Y(y)) + 0.5);
        ctx.lineTo(R, Math.round(v.Y(y)) + 0.5);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = look.cardEdge;
    ctx.beginPath();
    for (let x = Math.ceil(v.x0 / xStep) * xStep; x <= v.x1; x += xStep) {
      ctx.moveTo(Math.round(v.X(x)) + 0.5, T);
      ctx.lineTo(Math.round(v.X(x)) + 0.5, B);
    }
    for (let y = Math.ceil(v.y0 / step) * step; y <= v.y1; y += step) {
      ctx.moveTo(L, Math.round(v.Y(y)) + 0.5);
      ctx.lineTo(R, Math.round(v.Y(y)) + 0.5);
    }
    ctx.stroke();
  }
  // Axes, and where their numbers go when the axis itself is off screen.
  const ax = v.Y(0);
  const ay = v.X(0);
  const axOn = ax >= T && ax <= B;
  const ayOn = ay >= L && ay <= R;
  if (axOn) line(ctx, L, ax, R, ax, look.muted, 1.4);
  if (ayOn) line(ctx, ay, T, ay, B, look.muted, 1.4);
  const lx = clamp(ax, T + 6, B - 16);
  const ly = clamp(ay, L + 4, R - 30);
  const below = lx < B - 18;
  const digits = (st: number) => Math.max(0, -Math.floor(Math.log10(st) + 1e-9));
  for (let i = Math.ceil(v.x0 / xStep); i * xStep <= v.x1; i++) {
    if (i === 0) continue;
    const x = i * xStep;
    const px = v.X(x);
    if (px < L + 10 || px > R - 10) continue;
    if (axOn) line(ctx, px, ax - 3, px, ax + 3, look.muted, 1.2);
    const s = pi ? piLabel(i * qStep) : Number(x.toFixed(digits(step))).toString().replace('-', '−');
    text(ctx, s, px, below ? lx + 11 : lx - 9, { size: 10, color: look.muted, align: 'center' });
  }
  for (let i = Math.ceil(v.y0 / step); i * step <= v.y1; i++) {
    if (i === 0) continue;
    const y = i * step;
    const py = v.Y(y);
    if (py < T + 8 || py > B - 8) continue;
    if (ayOn) line(ctx, ay - 3, py, ay + 3, py, look.muted, 1.2);
    const s = Number(y.toFixed(digits(step))).toString().replace('-', '−');
    text(ctx, s, ly - 5 < L + 4 ? ly + 6 : ly - 5, py, { size: 10, color: look.muted, align: ly - 5 < L + 4 ? 'left' : 'right' });
  }
  if (axOn && ayOn) text(ctx, '0', ay - 5, ax + 10, { size: 10, color: look.muted, align: 'right' });
  if (axOn) text(ctx, 'x', R - 6, ax - 10, { size: 12, weight: 600, color: look.muted, align: 'right' });
  if (ayOn) text(ctx, 'y', ay + 9, T + 10, { size: 12, weight: 600, color: look.muted });
  ctx.restore();
}

/** Points along the curve across the view, broken where it is undefined or jumps an asymptote. */
function samples(m: Model, v: View): [number, number][][] {
  const xs: number[] = [];
  const n = Math.round((R - L) * 1.5);
  for (let i = 0; i <= n; i++) xs.push(v.x0 + ((v.x1 - v.x0) * i) / n);
  if (m.key === 'log' || m.key === 'recip') {
    // Crowd samples against the vertical asymptote so the curve really runs off the screen.
    for (let j = 1; j <= 14; j++) for (const sg of [-1, 1]) xs.push(m.h + sg * Math.pow(10, 1 - j) * (v.x1 - v.x0));
  }
  xs.sort((p, q) => p - q);
  const out: [number, number][][] = [];
  let cur: [number, number][] = [];
  let prev = NaN;
  for (const x of xs) {
    if (x < v.x0 || x > v.x1) continue;
    const y = m.y(x);
    const jumped = m.key === 'recip' && Number.isFinite(prev) && Math.sign(prev - m.h) !== Math.sign(x - m.h);
    if (!Number.isFinite(y) || jumped) {
      if (cur.length > 1) out.push(cur);
      cur = [];
    }
    if (Number.isFinite(y)) cur.push([v.X(x), clamp(v.Y(y), -5000, 5000)]);
    prev = x;
  }
  if (cur.length > 1) out.push(cur);
  return out;
}

function dot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke?: string) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

const pt = (x: number, y: number) => `(${fmt(x)}, ${fmt(y)})`;

// --- equations ------------------------------------------------------------------------------

/** The equation as written on the board (tex = false) or for KaTeX. */
export function equation(p: SimParams, tex: boolean): string {
  const { key, a, b, h, k } = model(p);
  const M = tex ? '-' : '−';
  const n = (v: number) => (tex ? tf(v) : fmt(v));
  const same = (u: number, w: number) => Math.abs(u - w) < 1e-12;
  const coef = (c: number) => (same(c, 1) ? '' : same(c, -1) ? M : n(c));
  const par = (s: string) => (tex ? `\\left(${s}\\right)` : `(${s})`);
  const shift = h === 0 ? 'x' : `x ${h > 0 ? M : '+'} ${n(Math.abs(h))}`;
  const sh = h === 0 ? 'x' : par(shift);
  const inner = same(b, 1) ? shift : `${coef(b)}${sh}`;
  const pow = (base: string, e: number) => (tex ? `${base}^{${e}}` : `${base}${e === 2 ? '²' : '³'}`);
  const kk = k === 0 ? '' : ` ${k > 0 ? '+' : M} ${n(Math.abs(k))}`;
  let A = a;
  let body = '';
  switch (key) {
    case 'linear': A = a * b; body = `${coef(A)}${sh}`; break;
    case 'quadratic': A = a * b * b; body = `${coef(A)}${pow(sh, 2)}`; break;
    case 'cubic': A = a * b * b * b; body = `${coef(A)}${pow(sh, 3)}`; break;
    case 'abs': A = a * Math.abs(b); body = `${coef(A)}${tex ? `\\left|${shift}\\right|` : `|${shift}|`}`; break;
    case 'sin': body = `${coef(a)}${tex ? '\\sin' : 'sin'}${par(inner)}`; break;
    case 'cos': body = `${coef(a)}${tex ? '\\cos' : 'cos'}${par(inner)}`; break;
    case 'log': body = `${coef(a)}${tex ? '\\ln' : 'ln'}${par(inner)}`; break;
    case 'exp': body = `${coef(a)}${tex ? `e^{${inner}}` : inner === 'x' ? 'eˣ' : `e^(${inner})`}`; break;
    case 'recip':
      A = a / b;
      body = tex ? `${A < 0 ? '-' : ''}\\dfrac{${tf(Math.abs(A))}}{${shift}}` : `${n(A)}/${sh}`;
      break;
  }
  if (Math.abs(A) < 1e-12) return `y = ${n(k)}`;
  return `y = ${body}${kk}`;
}

/** Ax² + Bx + C for KaTeX. */
function polyTex(cs: number[]) {
  const deg = cs.length - 1;
  let s = '';
  cs.forEach((c, i) => {
    if (Math.abs(c) < 1e-12) return;
    const e = deg - i;
    const mag = Math.abs(c);
    const body = e === 0 ? tf(mag) : `${Math.abs(mag - 1) < 1e-12 ? '' : tf(mag)}x${e > 1 ? `^{${e}}` : ''}`;
    s += s ? ` ${c < 0 ? '-' : '+'} ${body}` : `${c < 0 ? '-' : ''}${body}`;
  });
  return s || '0';
}

/** The quadratic's expanded coefficients: a·b²(x − h)² + k = Ax² + Bx + C. */
function quadCoefs(m: Model) {
  const A = m.a * m.b * m.b;
  return { A, B: -2 * A * m.h, C: A * m.h * m.h + m.k };
}

// --- the simulator -------------------------------------------------------------------------

const FN_OPTIONS: { value: FamKey; label: string }[] = [
  { value: 'linear', label: 'Linear  y = x' },
  { value: 'quadratic', label: 'Quadratic  y = x²' },
  { value: 'cubic', label: 'Cubic  y = x³' },
  { value: 'sin', label: 'Sine  y = sin x' },
  { value: 'cos', label: 'Cosine  y = cos x' },
  { value: 'exp', label: 'Exponential  y = eˣ' },
  { value: 'log', label: 'Logarithm  y = ln x' },
  { value: 'recip', label: 'Reciprocal  y = 1/x' },
  { value: 'abs', label: 'Absolute value  y = |x|' },
];

function anchorPos(m: Model) {
  return { x: m.h + m.F.u0 / m.b, y: m.a * (m.F.f0 ?? m.F.f(m.F.u0)) + m.k };
}
function handlePos(m: Model) {
  return { x: m.h + m.F.u1 / m.b, y: m.a * m.F.f(m.F.u1) + m.k };
}

function slopeText(m: Model, x: number) {
  const d = m.dy(x);
  return Number.isFinite(d) ? fmt(d) : 'undefined';
}

function draw(ctx: CanvasRenderingContext2D, p: SimParams, s: GraphState, look: Look) {
  const v = view(p);
  const m = model(p);
  drawAxes(ctx, p, v, look);

  ctx.save();
  ctx.beginPath();
  ctx.rect(L, T, R - L, B - T);
  ctx.clip();

  // Asymptotes.
  const asym = look.violet;
  if (m.key === 'log' || m.key === 'recip') line(ctx, v.X(m.h), T, v.X(m.h), B, asym, 1.3, [6, 5]);
  if ((m.key === 'exp' || m.key === 'recip') && m.a !== 0) line(ctx, L, v.Y(m.k), R, v.Y(m.k), asym, 1.3, [6, 5]);

  const segs = samples(m, v);

  // Shaded area: above the axis in blue, below in red, so the sign of the integral shows.
  const showArea = bool(p, 'area');
  const x1 = num(p, 'x1', 0);
  const x2 = num(p, 'x2', 2);
  const ar = showArea ? area(p) : null;
  if (ar && Number.isFinite(ar.value)) {
    const lo = Math.min(x1, x2);
    const hi = Math.max(x1, x2);
    const n = Math.max(2, Math.ceil((hi - lo) * v.s));
    const zero = v.Y(0);
    for (const [top, c] of [[true, look.blue], [false, look.red]] as const) {
      ctx.save();
      ctx.beginPath();
      if (top) ctx.rect(L, -6000, R - L, zero + 6000);
      else ctx.rect(L, zero, R - L, 12000);
      ctx.clip();
      ctx.beginPath();
      ctx.moveTo(v.X(lo), zero);
      for (let i = 0; i <= n; i++) {
        const x = lo + ((hi - lo) * i) / n;
        ctx.lineTo(v.X(x), clamp(v.Y(m.y(x)), -5000, 5000));
      }
      ctx.lineTo(v.X(hi), zero);
      ctx.closePath();
      ctx.fillStyle = c;
      ctx.globalAlpha = look.dark ? 0.3 : 0.18;
      ctx.fill();
      ctx.restore();
    }
  }
  if (showArea) {
    for (const [bx, tag] of [[x1, 'x₁'], [x2, 'x₂']] as const) {
      const px = v.X(bx);
      if (px < L || px > R) continue;
      line(ctx, px, T, px, B, look.green, 1.6, [3, 4]);
      label(ctx, `${tag} = ${fmt(bx)}`, clamp(px, L + 34, R - 34), B - 12, look, { color: look.green, size: 10.5 });
    }
  }

  // The curve.
  ctx.strokeStyle = look.blue;
  ctx.lineWidth = 2.6;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const seg of segs) {
    ctx.beginPath();
    seg.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.stroke();
  }

  // Roots.
  const rs = roots(m, v.x0, v.x1);
  if (rs !== 'all') {
    for (const r of rs) {
      const px = v.X(r);
      if (px > L && px < R && v.Y(0) > T && v.Y(0) < B) dot(ctx, px, v.Y(0), 3.6, look.card, look.blue);
    }
  }

  // Tangent at the point.
  const px = s.x;
  const py = m.y(px);
  const slope = m.dy(px);
  const onCurve = Number.isFinite(py);
  if (bool(p, 'tangent') && onCurve && Number.isFinite(slope)) {
    const ya = py + slope * (v.x0 - px);
    const yb = py + slope * (v.x1 - px);
    line(ctx, v.X(v.x0), clamp(v.Y(ya), -5000, 5000), v.X(v.x1), clamp(v.Y(yb), -5000, 5000), look.orange, 1.8);
  }

  // Anchor (h, k) and the shape handle.
  const an = anchorPos(m);
  const hd = handlePos(m);
  if (Number.isFinite(hd.y) && m.a !== 0) {
    const hx = v.X(hd.x);
    const hy = v.Y(hd.y);
    ctx.save();
    ctx.fillStyle = look.card;
    ctx.strokeStyle = look.green;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(hx - 4.5, hy - 4.5, 9, 9);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  const anx = v.X(an.x);
  const any = v.Y(an.y);
  dot(ctx, anx, any, 5.5, look.card, look.violet);
  const anTag = { quadratic: 'vertex', abs: 'vertex', cubic: 'inflection' }[m.key as string];
  // Boxes already used by labels and dots, so the point's labels can keep clear of them.
  type Box = { x0: number; y0: number; x1: number; y1: number };
  const used: Box[] = [];
  const inView = anx > L && anx < R && any > T && any < B;
  if (inView) used.push({ x0: anx - 8, y0: any - 8, x1: anx + 8, y1: any + 8 });
  if (anTag && inView) {
    const up = m.a < 0 ? -1 : 1; // put the label on the open side's opposite
    const tag = `${anTag} ${pt(an.x, an.y)}`;
    const fx = clamp(anx, L + 60, R - 60);
    const fy = clamp(any + up * 18, T + 30, B - 30);
    const fw = tag.length * 5.8;
    used.push({ x0: fx - fw / 2, y0: fy - 8, x1: fx + fw / 2, y1: fy + 8 });
    label(ctx, tag, fx, fy, look, { color: look.violet, size: 10.5 });
  }
  const overlap = (a: Box, b: Box) => Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

  // The point on the curve.
  if (onCurve) {
    const X = v.X(px);
    const Y = v.Y(py);
    if (X > L - 6 && X < R + 6 && Y > T - 6 && Y < B + 6) {
      dot(ctx, X, Y, 6, look.red, look.card);
      const tagS = `${pt(px, py)}`;
      const tagM = bool(p, 'tangent') ? `slope ${slopeText(m, px)}` : '';
      // Above and to the right by preference; another corner if that one is taken.
      const w = Math.max(tagS.length * 6.6, tagM.length * 5.8);
      const h = tagM ? 23 : 8;
      const sides = (X < R - 120 ? [true, false] : [false, true]).filter((r) => (r ? X < R - 60 : X > L + 60));
      let best: { right: boolean; ly: number } | null = null;
      let bestHit = Infinity;
      for (const right of sides.length ? sides : [X < R - 120]) {
        for (const ly of [clamp(Y - 16 - (tagM ? 15 : 0), T + 40, B - 30), clamp(Y + 18, T + 40, B - 30 - (tagM ? 15 : 0))]) {
          const x0 = right ? X + 12 : X - 12 - w;
          const box = { x0, y0: ly - 8, x1: x0 + w, y1: ly + h };
          const hit = used.reduce((t, b) => t + overlap(box, b), 0);
          if (hit < bestHit - 0.5) {
            bestHit = hit;
            best = { right, ly };
          }
        }
      }
      const { right, ly } = best ?? { right: X < R - 120, ly: clamp(Y - 16, T + 40, B - 30) };
      const lx = right ? X + 12 : X - 12;
      label(ctx, tagS, lx, ly, look, { color: look.red, align: right ? 'left' : 'right', size: 11.5 });
      if (tagM) label(ctx, tagM, lx, ly + 15, look, { color: look.orange, align: right ? 'left' : 'right', size: 10.5 });
    }
  }
  ctx.restore();

  // Equation and area in the top corner.
  const eq = equation(p, false);
  ctx.save();
  ctx.font = `650 13px -apple-system, "Segoe UI", system-ui, sans-serif`;
  const lines: [string, string][] = [[eq, look.blue]];
  if (ar) lines.push([Number.isFinite(ar.value) ? `∫ from ${fmt(Math.min(x1, x2))} to ${fmt(Math.max(x1, x2))} = ${fmt(x2 >= x1 ? ar.value : -ar.value, 4)}` : `Area: ${ar.why}`, look.green]);
  const w = Math.max(...lines.map(([t]) => ctx.measureText(t).width)) + 20;
  ctx.fillStyle = look.card;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.roundRect(L + 6, T + 6, w, 12 + lines.length * 18, 8);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = look.cardEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  lines.forEach(([t, c], i) => text(ctx, t, L + 16, T + 21 + i * 18, { size: i ? 12 : 13, weight: 650, color: c }));
}

function readouts(p: SimParams, s: GraphState): Readout[] {
  const m = model(p);
  const y = m.y(s.x);
  const out: Readout[] = [
    { label: 'Point', value: Number.isFinite(y) ? pt(s.x, y) : `x = ${fmt(s.x)}: undefined`, color: 'red' },
    { label: 'Slope dy/dx', value: Number.isFinite(y) ? slopeText(m, s.x) : '—', color: 'orange' },
  ];
  const v = view(p);
  const rs = roots(m, v.x0, v.x1);
  const rootText = rs === 'all' ? 'every x' : rs.length === 0 ? 'none' : rs.length > 3 ? `${rs.slice(0, 3).map((r) => fmt(r)).join(', ')}…` : rs.map((r) => fmt(r)).join(', ');
  switch (m.key) {
    case 'quadratic': {
      const { A, B: Bq, C } = quadCoefs(m);
      out.push({ label: 'Vertex', value: pt(m.h, m.k), color: 'violet' });
      out.push({ label: 'Discriminant', value: fmt(Bq * Bq - 4 * A * C) });
      break;
    }
    case 'sin':
    case 'cos':
      out.push({ label: 'Amplitude', value: fmt(Math.abs(m.a)) });
      out.push({ label: 'Period', value: `${fmt((2 * Math.PI) / Math.abs(m.b))}` });
      break;
    case 'exp':
      out.push({ label: 'Asymptote', value: `y = ${fmt(m.k)}`, color: 'violet' });
      break;
    case 'log':
      out.push({ label: 'Asymptote', value: `x = ${fmt(m.h)}`, color: 'violet' });
      break;
    case 'recip':
      out.push({ label: 'Asymptotes', value: `x = ${fmt(m.h)}, y = ${fmt(m.k)}`, color: 'violet' });
      break;
    case 'linear':
      out.push({ label: 'Gradient', value: fmt(m.a * m.b) });
      break;
    default:
      out.push({ label: m.key === 'cubic' ? 'Inflection' : 'Vertex', value: pt(m.h, m.k), color: 'violet' });
  }
  if (bool(p, 'area')) {
    const ar = area(p);
    const sgn = num(p, 'x2', 2) >= num(p, 'x1', 0) ? 1 : -1;
    out.push({ label: 'Area ∫', value: Number.isFinite(ar.value) ? fmt(sgn * ar.value, 4) : '—', color: 'green' });
  } else out.push({ label: m.key === 'sin' || m.key === 'cos' ? 'Roots in view' : 'Roots', value: rootText, color: 'blue' });
  return out;
}

function formulas(p: SimParams): Formula[] {
  const m = model(p);
  const x0 = num(p, 'px', 1);
  const y0 = m.y(x0);
  const d = m.dy(x0);
  const fx = { linear: 'x', quadratic: 'x^2', cubic: 'x^3', sin: '\\sin x', cos: '\\cos x', exp: 'e^x', log: '\\ln x', recip: '\\dfrac{1}{x}', abs: '|x|' }[m.key];
  const dfx = { linear: '1', quadratic: '2u', cubic: '3u^2', sin: '\\cos u', cos: '-\\sin u', exp: 'e^u', log: '\\dfrac{1}{u}', recip: '-\\dfrac{1}{u^2}', abs: '\\operatorname{sgn} u' }[m.key];
  const out: Formula[] = [
    { label: 'Graph', tex: equation(p, true) },
    {
      label: `From f(x) = ${m.F.name.toLowerCase()}`,
      tex: `y = a\\,f\\big(b(x-h)\\big)+k,\\quad f(x)=${fx},\\ a=${tf(m.a)},\\ b=${tf(m.b)},\\ h=${tf(m.h)},\\ k=${tf(m.k)}`,
    },
  ];
  const rt = roots(m);
  switch (m.key) {
    case 'quadratic': {
      const { A, B: Bq, C } = quadCoefs(m);
      const disc = Bq * Bq - 4 * A * C;
      out.push({ label: 'Expanded', tex: `y = ${polyTex([A, Bq, C])}` });
      out.push({
        label: 'Discriminant',
        tex: `\\Delta = B^2-4AC = ${tf(disc)}${A === 0 ? '' : disc > 1e-12 ? '>0\\ \\text{(two roots)}' : disc < -1e-12 ? '<0\\ \\text{(no real roots)}' : '=0\\ \\text{(one repeated root)}'}`,
      });
      if (rt !== 'all' && rt.length) out.push({ label: 'Roots', tex: `x = \\dfrac{-B\\pm\\sqrt{\\Delta}}{2A} = ${rt.map((r) => tf(r)).join(',\\ ')}` });
      out.push({ label: 'Vertex', tex: `\\left(h,\\,k\\right) = \\left(${tf(m.h)},\\,${tf(m.k)}\\right)` });
      break;
    }
    case 'linear':
      out.push({ label: 'Gradient and intercept', tex: `m = ab = ${tf(m.a * m.b)},\\quad c = k - abh = ${tf(m.k - m.a * m.b * m.h)}` });
      break;
    case 'cubic':
      out.push({ label: 'Inflection and root', tex: `(h,k)=(${tf(m.h)},${tf(m.k)}),\\quad x = h + \\tfrac{1}{b}\\sqrt[3]{-k/a} = ${rt === 'all' ? '\\text{all}' : rt.map((r) => tf(r)).join(',')}` });
      break;
    case 'sin':
    case 'cos':
      out.push({ label: 'Amplitude and period', tex: `|a| = ${tf(Math.abs(m.a))},\\quad T = \\dfrac{2\\pi}{|b|} = ${tf((2 * Math.PI) / Math.abs(m.b))}` });
      out.push({ label: 'Phase shift and range', tex: `h = ${tf(m.h)},\\quad ${tf(m.k - Math.abs(m.a))} \\le y \\le ${tf(m.k + Math.abs(m.a))}` });
      break;
    case 'exp':
      out.push({ label: 'Asymptote and intercept', tex: `y = ${tf(m.k)},\\quad y(0) = ${tf(m.y(0))}` });
      break;
    case 'log':
      out.push({ label: 'Asymptote and domain', tex: `x = ${tf(m.h)},\\quad ${m.b > 0 ? `x > ${tf(m.h)}` : `x < ${tf(m.h)}`}` });
      break;
    case 'recip':
      out.push({ label: 'Asymptotes', tex: `x = ${tf(m.h)},\\quad y = ${tf(m.k)}` });
      break;
    case 'abs':
      out.push({ label: 'Vertex', tex: `(h,k) = (${tf(m.h)},${tf(m.k)})` });
      break;
  }
  if (Number.isFinite(y0)) {
    out.push({
      label: `Derivative at x = ${fmt(x0)}`,
      tex: Number.isFinite(d)
        ? `\\dfrac{dy}{dx} = ab\\,f'(u),\\ f'(u)=${dfx},\\ u=b(x-h)\\ \\Rightarrow\\ ${tf(d)}`
        : `\\dfrac{dy}{dx}\\ \\text{is undefined here (a corner)}`,
    });
    if (Number.isFinite(d)) out.push({ label: 'Tangent', tex: `y = ${tf(d)}\\left(x ${x0 < 0 ? '+' : '-'} ${tf(Math.abs(x0))}\\right) ${y0 < 0 ? '-' : '+'} ${tf(Math.abs(y0))}` });
  }
  if (bool(p, 'area')) {
    const ar = area(p);
    out.push({
      label: 'Signed area',
      tex: Number.isFinite(ar.value)
        ? `\\int_{${tf(num(p, 'x1', 0))}}^{${tf(num(p, 'x2', 2))}} y\\,dx = ${tf(ar.value, 5)}`
        : `\\int y\\,dx\\ \\text{${ar.why}}`,
    });
  }
  return out;
}

export const grapherSim: SimDef<GraphState> = {
  label: 'Function grapher',
  subject: 'Maths',
  display: ['tangent', 'area', 'grid', 'pi'],
  keywords: 'graph plot function curve parabola quadratic vertex roots discriminant sine cosine trig period amplitude exponential logarithm reciprocal asymptote modulus absolute transformation tangent gradient derivative differentiation integral area calculus desmos',
  blurb: 'Transform graphs, tangents and slopes, area under a curve',
  defaults: {
    fn: 'quadratic', a: 1, b: 1, h: 1, k: -4, px: 3, tangent: true, area: false, x1: 1, x2: 3,
    zoom: 6, cx: 1, cy: -1.5, grid: true, pi: true,
  },
  controls: [
    { key: 'fn', label: 'Function', type: 'choice', options: FN_OPTIONS },
    { key: 'a', label: 'a (vertical stretch)', type: 'range', min: -5, max: 5, step: 0.05 },
    { key: 'b', label: 'b (horizontal stretch)', type: 'range', min: -4, max: 4, step: 0.05 },
    { key: 'h', label: 'h (shift right)', type: 'range', min: -10, max: 10, step: 0.1 },
    { key: 'k', label: 'k (shift up)', type: 'range', min: -10, max: 10, step: 0.1 },
    { key: 'px', label: 'Point x', type: 'range', min: -20, max: 20, step: 0.1 },
    { key: 'tangent', label: 'Tangent and slope', type: 'toggle' },
    { key: 'area', label: 'Area under curve', type: 'toggle' },
    { key: 'x1', label: 'From x₁', type: 'range', min: -20, max: 20, step: 0.1, show: (p) => bool(p, 'area') },
    { key: 'x2', label: 'To x₂', type: 'range', min: -20, max: 20, step: 0.1, show: (p) => bool(p, 'area') },
    { key: 'zoom', label: 'Zoom (half-width)', type: 'range', min: 1, max: 20, step: 0.5 },
    { key: 'cx', label: 'View centre x', type: 'range', min: -20, max: 20, step: 0.1 },
    { key: 'cy', label: 'View centre y', type: 'range', min: -20, max: 20, step: 0.1 },
    { key: 'grid', label: 'Grid', type: 'toggle' },
    { key: 'pi', label: 'x in multiples of π', type: 'toggle', show: isTrig },
  ],
  presets: [
    { label: 'Parabola: vertex and roots', params: { fn: 'quadratic', a: 1, b: 1, h: 1, k: -4, px: 3, tangent: true, area: false, zoom: 6, cx: 1, cy: -1.5 } },
    { label: 'Area under y = x² from 0 to 2', params: { fn: 'quadratic', a: 1, b: 1, h: 0, k: 0, px: 1, tangent: false, area: true, x1: 0, x2: 2, zoom: 3, cx: 0.5, cy: 1.5 } },
    { label: 'Sine: amplitude and period', params: { fn: 'sin', a: 2, b: 1, h: 0, k: 0, px: 1.6, tangent: true, area: false, zoom: 8, cx: 0, cy: 0, pi: true } },
    { label: 'Tangent to a cubic', params: { fn: 'cubic', a: 0.5, b: 1, h: 0, k: 0, px: 1.5, tangent: true, area: false, zoom: 4, cx: 0, cy: 0 } },
    { label: 'Reciprocal: asymptotes', params: { fn: 'recip', a: 2, b: 1, h: 1, k: 1, px: 3, tangent: true, area: false, zoom: 6, cx: 0, cy: 0 } },
    { label: 'Exponential growth', params: { fn: 'exp', a: 1, b: 1, h: 0, k: 0, px: 1, tangent: true, area: false, zoom: 4, cx: 0, cy: 2.5 } },
  ],
  title: (p) => equation(p, false),
  init: (p) => ({ t: 0, done: false, x: num(p, 'px', 3), dir: 1 }),
  step: (p, s, dt) => {
    s.t += dt;
    // Play walks the point along the curve, so the tangent can be watched turning.
    const v = view(p);
    const lo = v.x0 + (v.x1 - v.x0) * 0.04;
    const hi = v.x1 - (v.x1 - v.x0) * 0.04;
    s.x += s.dir * ((v.x1 - v.x0) / 10) * dt;
    if (s.x >= hi || s.x <= lo) {
      s.x = clamp(s.x, lo, hi);
      s.dir *= -1;
    }
  },
  draw,
  readouts,
  formulas,
  grab: (p, s, x, y) => {
    if (x < L || x > R || y < T || y > B) return null;
    const v = view(p);
    const m = model(p);
    const u = snapUnit(v);
    const near = (gx: number, gy: number, r = 13) => Number.isFinite(gy) && Math.hypot(x - v.X(gx), y - v.Y(gy)) <= r;
    if (near(s.x, m.y(s.x))) {
      return { hint: 'Drag the point along the curve', drag: (X) => ({ px: clamp(snap(v.ix(X), u), -20, 20) }) };
    }
    const an = anchorPos(m);
    if (near(an.x, an.y)) {
      const what = m.key === 'quadratic' || m.key === 'abs' ? 'the vertex' : m.key === 'recip' ? 'where the asymptotes cross' : 'this point';
      return {
        hint: `Drag ${what} to change h and k`,
        drag: (X, Y) => ({
          h: clamp(snap(v.ix(X) - m.F.u0 / m.b, u), -10, 10),
          k: clamp(snap(v.iy(Y) - m.a * (m.F.f0 ?? m.F.f(m.F.u0)), u), -10, 10),
        }),
      };
    }
    const hd = handlePos(m);
    if (m.a !== 0 && near(hd.x, hd.y, 11)) {
      const f1 = m.F.f(m.F.u1);
      return {
        hint: 'Drag to stretch: up/down changes a, sideways changes b',
        drag: (X, Y) => {
          const out: SimParams = { a: clamp(snap((v.iy(Y) - m.k) / f1, 0.05), -5, 5) };
          const dx = v.ix(X) - m.h;
          if (Math.abs(dx) > 1e-6) {
            const b = clamp(snap(m.F.u1 / dx, 0.05), -4, 4);
            if (Math.abs(b) >= 0.05) out.b = b;
          }
          return out;
        },
      };
    }
    if (bool(p, 'area')) {
      for (const key of ['x1', 'x2']) {
        if (Math.abs(x - v.X(num(p, key, 0))) <= 7) {
          return { cursor: 'ew-resize', hint: 'Drag the bound', drag: (X) => ({ [key]: clamp(snap(v.ix(X), u), -20, 20) }) };
        }
      }
    }
    return null;
  },
};
