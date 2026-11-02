/**
 * DC circuits: series, parallel and mixed loads on a battery with internal resistance, plus a
 * resistor-capacitor circuit that charges or discharges over time.
 *
 * Moving dots show conventional current; their speed follows each wire's current, so a branch
 * carrying half the current visibly moves half as fast. Bulbs glow with the power they take.
 */

import { BW, FLOOR, bool, fmt, label, line, num, plot, str, text, tf } from './kit';
import type { Formula, Look, Readout, SimDef, SimParams, SimState } from './kit';

type P2 = [number, number];

interface Seg {
  pts: P2[];
  /** Current along the polyline, amperes. Negative runs it backwards. */
  i: number;
}

interface Part {
  kind: 'load' | 'cap' | 'battery' | 'switch' | 'ammeter';
  at: P2;
  vertical: boolean;
  name: string;
  /** For loads: index into the solution's loads. */
  idx?: number;
}

interface Load {
  name: string;
  r: number;
  broken: boolean;
  i: number;
  v: number;
  p: number;
}

interface CircuitState extends SimState {
  /** Distance travelled by the dots on each wire, px. */
  phase: number[];
  /** Capacitor voltage, for the RC circuit. */
  vc: number;
  hist: [number, number][];
  ihist: [number, number][];
}

const SUB = ['₁', '₂', '₃'];

// --- solving -------------------------------------------------------------------

function loadsOf(p: SimParams): Load[] {
  const setup = str(p, 'setup', 'series');
  const n = setup === 'mixed' ? 3 : Math.round(num(p, 'count', 2));
  const broken = str(p, 'broken', 'none');
  return Array.from({ length: n }, (_, k) => ({
    name: `${str(p, 'load') === 'bulb' ? 'L' : 'R'}${SUB[k]}`,
    r: num(p, `r${k + 1}`, 10),
    broken: broken === String(k + 1),
    i: 0,
    v: 0,
    p: 0,
  }));
}

const par = (a: number, b: number) => (!Number.isFinite(a) ? b : !Number.isFinite(b) ? a : (a * b) / (a + b));

function solve(p: SimParams) {
  const setup = str(p, 'setup', 'series');
  const E = num(p, 'emf', 6);
  const r = num(p, 'rin', 0.5);
  const closed = bool(p, 'closed');
  const loads = loadsOf(p);
  const eff = loads.map((l) => (l.broken ? Infinity : l.r));
  let req: number;
  if (setup === 'series') req = eff.reduce((a, b) => a + b, 0);
  else if (setup === 'parallel') req = eff.reduce((a, b) => par(a, b), Infinity);
  else req = eff[0] + par(eff[1], eff[2]);
  const I = closed && Number.isFinite(req) ? E / (req + r) : 0;
  if (setup === 'series') {
    for (const l of loads) {
      l.i = I;
      // The whole EMF appears across the gap in a broken series load.
      l.v = l.broken ? (closed ? E : 0) : I * l.r;
    }
  } else if (setup === 'parallel') {
    const v = I * (Number.isFinite(req) ? req : 0);
    for (const l of loads) {
      l.v = closed ? (Number.isFinite(req) ? v : E) : 0;
      l.i = l.broken ? 0 : l.v / l.r;
    }
  } else {
    const rp = par(eff[1], eff[2]);
    const vp = Number.isFinite(rp) ? I * rp : 0;
    loads[0].i = I;
    loads[0].v = I * loads[0].r;
    for (const l of loads.slice(1)) {
      l.v = vp;
      l.i = l.broken ? 0 : vp / l.r;
    }
  }
  for (const l of loads) l.p = l.i * l.i * l.r;
  return { setup, E, r, closed, loads, req, I, vt: E - I * r };
}

function rc(p: SimParams) {
  const R = num(p, 'R', 1000);
  const C = num(p, 'C', 1000) * 1e-6;
  const E = num(p, 'emf', 6);
  const r = num(p, 'rin', 0.5);
  const tau = (R + r) * C;
  return { R, C, E, r, tau, charge: str(p, 'mode', 'charge') === 'charge' };
}

// --- layout ---------------------------------------------------------------------------

interface Layout {
  segs: Seg[];
  parts: Part[];
  /** Current that makes dots move at the reference speed. */
  iref: number;
}

function layout(p: SimParams, s: CircuitState): Layout {
  const setup = str(p, 'setup', 'series');
  const meters = bool(p, 'meters');
  if (setup === 'rc') {
    const L = 50, R = 270, T = 80, B = 290, M = (T + B) / 2;
    const k = rc(p);
    const i = (k.charge ? k.E - s.vc : -s.vc) / (k.R + k.r);
    const running = s.t > 0;
    const parts: Part[] = [
      { kind: 'battery', at: [L, M], vertical: true, name: k.charge ? 'battery' : 'wire' },
      { kind: 'load', at: [(L + R) / 2, T], vertical: false, name: 'R', idx: 0 },
      { kind: 'cap', at: [R, M], vertical: true, name: 'C' },
      { kind: 'switch', at: [(L + R) / 2, B], vertical: false, name: running ? 'closed' : 'open' },
    ];
    if (meters) parts.push({ kind: 'ammeter', at: [L, T + 40], vertical: true, name: 'A' });
    return { segs: [{ pts: [[L, M], [L, T], [R, T], [R, B], [L, B], [L, M]], i: running ? i : 0 }], parts, iref: k.E / (k.R + k.r) };
  }

  const L = 80, R = 480, T = 70, B = 290, M = (T + B) / 2;
  const sol = solve(p);
  const parts: Part[] = [
    { kind: 'battery', at: [L, M], vertical: true, name: 'battery' },
    { kind: 'switch', at: [150, B], vertical: false, name: sol.closed ? 'closed' : 'open' },
  ];
  const segs: Seg[] = [];
  const iref = Math.max(1e-6, sol.E / (sol.req + sol.r || 1));
  if (setup === 'series') {
    const n = sol.loads.length;
    sol.loads.forEach((_, k) => parts.push({ kind: 'load', at: [L + ((R - L) * (k + 1)) / (n + 1), T], vertical: false, name: '', idx: k }));
    if (meters) parts.push({ kind: 'ammeter', at: [R, M], vertical: true, name: 'A' });
    segs.push({ pts: [[L, M], [L, T], [R, T], [R, B], [L, B], [L, M]], i: sol.I });
    return { segs, parts, iref: Math.max(iref, sol.I) };
  }

  const branchLoads = setup === 'mixed' ? sol.loads.slice(1) : sol.loads;
  const n = branchLoads.length;
  const xs = setup === 'mixed' ? [340, R] : n === 1 ? [R] : n === 2 ? [300, R] : [260, 370, R];
  if (setup === 'mixed') parts.push({ kind: 'load', at: [215, T], vertical: false, name: '', idx: 0 });
  branchLoads.forEach((_, k) => parts.push({ kind: 'load', at: [xs[k], M], vertical: true, name: '', idx: setup === 'mixed' ? k + 1 : k }));
  if (meters) parts.push({ kind: 'ammeter', at: [setup === 'mixed' ? 130 : (L + xs[0]) / 2, T], vertical: false, name: 'A' });

  const rest = (k: number) => branchLoads.slice(k).reduce((a, l) => a + l.i, 0);
  segs.push({ pts: [[L, B], [L, T]], i: sol.I });
  segs.push({ pts: [[L, T], [xs[0], T]], i: sol.I });
  for (let k = 1; k < n; k++) segs.push({ pts: [[xs[k - 1], T], [xs[k], T]], i: rest(k) });
  branchLoads.forEach((l, k) => segs.push({ pts: [[xs[k], T], [xs[k], B]], i: l.i }));
  for (let k = n - 1; k >= 1; k--) segs.push({ pts: [[xs[k], B], [xs[k - 1], B]], i: rest(k) });
  segs.push({ pts: [[xs[0], B], [L, B]], i: sol.I });
  return { segs, parts, iref: Math.max(iref, sol.I) };
}

// --- drawing -------------------------------------------------------------------------------

function lengthOf(pts: P2[]) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
}

function pointAt(pts: P2[], d: number): P2 {
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (d <= l) {
      const t = l ? d / l : 0;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
    }
    d -= l;
  }
  return pts[pts.length - 1];
}

const HALF = 28; // half the length a symbol takes on its wire

/** Clears the wire under a symbol. */
function gap(ctx: CanvasRenderingContext2D, part: Part, look: Look, extra = 0) {
  const [x, y] = part.at;
  ctx.fillStyle = look.card;
  if (part.vertical) ctx.fillRect(x - 18 - extra, y - HALF, 36 + extra * 2, HALF * 2);
  else ctx.fillRect(x - HALF, y - 18 - extra, HALF * 2, 36 + extra * 2);
}

/** Draws in a frame where the symbol's wire runs along x. */
function along(ctx: CanvasRenderingContext2D, part: Part, fn: () => void) {
  ctx.save();
  ctx.translate(part.at[0], part.at[1]);
  if (part.vertical) ctx.rotate(Math.PI / 2);
  fn();
  ctx.restore();
}

function drawResistor(ctx: CanvasRenderingContext2D, part: Part, look: Look, broken: boolean) {
  along(ctx, part, () => {
    ctx.strokeStyle = look.line;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-HALF, 0);
    ctx.lineTo(-20, 0);
    const n = 6;
    for (let i = 0; i < n; i++) ctx.lineTo(-20 + (40 * (i + 0.5)) / n, i % 2 ? 7 : -7);
    ctx.lineTo(20, 0);
    if (!broken) ctx.lineTo(HALF, 0);
    ctx.stroke();
  });
}

function drawBulb(ctx: CanvasRenderingContext2D, part: Part, look: Look, glow: number, broken: boolean) {
  const [x, y] = part.at;
  if (glow > 0.01) {
    const r = 16 + 26 * Math.min(1.4, glow);
    const g = ctx.createRadialGradient(x, y, 4, x, y, r);
    g.addColorStop(0, `rgba(255, 204, 0, ${Math.min(0.85, 0.25 + glow * 0.6)})`);
    g.addColorStop(1, 'rgba(255, 204, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  along(ctx, part, () => {
    ctx.strokeStyle = look.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-HALF, 0);
    ctx.lineTo(-13, 0);
    ctx.moveTo(13, 0);
    ctx.lineTo(HALF, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fillStyle = glow > 0.01 ? `rgba(255, 214, 10, ${Math.min(0.9, 0.2 + glow * 0.7)})` : look.card;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    const c = 9.2;
    if (broken) {
      ctx.moveTo(-c, -c * 0.3);
      ctx.lineTo(-2, 2);
      ctx.moveTo(c, -c * 0.3);
      ctx.lineTo(2, 4);
    } else {
      ctx.moveTo(-c * 0.7, -c * 0.7);
      ctx.lineTo(c * 0.7, c * 0.7);
      ctx.moveTo(c * 0.7, -c * 0.7);
      ctx.lineTo(-c * 0.7, c * 0.7);
    }
    ctx.stroke();
  });
}

function drawBattery(ctx: CanvasRenderingContext2D, part: Part, look: Look, emf: number) {
  if (part.name === 'wire') {
    line(ctx, part.at[0], part.at[1] - HALF, part.at[0], part.at[1] + HALF, look.line, 2);
    label(ctx, 'shorted', part.at[0] - 30, part.at[1], look, { color: look.faint, size: 10 });
    return;
  }
  const [x, y] = part.at;
  ctx.save();
  ctx.strokeStyle = look.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - HALF);
  ctx.lineTo(x, y - 6);
  ctx.moveTo(x, y + 6);
  ctx.lineTo(x, y + HALF);
  ctx.stroke();
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(x - 16, y - 6);
  ctx.lineTo(x + 16, y - 6);
  ctx.stroke();
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.moveTo(x - 8, y + 6);
  ctx.lineTo(x + 8, y + 6);
  ctx.stroke();
  ctx.restore();
  text(ctx, '+', x + 22, y - 10, { size: 13, weight: 700, color: look.red, align: 'center' });
  text(ctx, '−', x + 22, y + 10, { size: 13, weight: 700, color: look.blue, align: 'center' });
  label(ctx, `${fmt(emf)} V`, x - 34, y, look, { size: 11 });
}

function drawSwitch(ctx: CanvasRenderingContext2D, part: Part, look: Look) {
  const closed = part.name === 'closed';
  along(ctx, part, () => {
    ctx.strokeStyle = look.line;
    ctx.fillStyle = look.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-HALF, 0);
    ctx.lineTo(-14, 0);
    ctx.moveTo(14, 0);
    ctx.lineTo(HALF, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-14, 0, 3, 0, Math.PI * 2);
    ctx.arc(14, 0, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    const a = closed ? 0 : -0.55;
    ctx.lineTo(-14 + 30 * Math.cos(a), 30 * Math.sin(a));
    ctx.stroke();
  });
  label(ctx, closed ? 'switch closed' : 'switch open', part.at[0], part.at[1] + 22, look, { color: look.muted, size: 10 });
}

function drawCap(ctx: CanvasRenderingContext2D, part: Part, look: Look) {
  along(ctx, part, () => {
    ctx.strokeStyle = look.line;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-HALF, 0);
    ctx.lineTo(-5, 0);
    ctx.moveTo(5, 0);
    ctx.lineTo(HALF, 0);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-5, -15);
    ctx.lineTo(-5, 15);
    ctx.moveTo(5, -15);
    ctx.lineTo(5, 15);
    ctx.stroke();
  });
}

function drawMeter(ctx: CanvasRenderingContext2D, part: Part, look: Look, reading: string) {
  const [x, y] = part.at;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, 13, 0, Math.PI * 2);
  ctx.fillStyle = look.card;
  ctx.fill();
  ctx.strokeStyle = look.line;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  text(ctx, part.name, x, y + 0.5, { size: 12, weight: 700, color: look.ink, align: 'center' });
  label(ctx, reading, x + (part.vertical ? 46 : 0), y + (part.vertical ? 0 : -22), look, { color: look.green, size: 11 });
}

function drawDots(ctx: CanvasRenderingContext2D, segs: Seg[], phase: number[], look: Look) {
  const SPACING = 22;
  ctx.fillStyle = look.yellow;
  ctx.strokeStyle = look.dark ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.25)';
  ctx.lineWidth = 0.8;
  segs.forEach((seg, k) => {
    if (Math.abs(seg.i) < 1e-9) return;
    const len = lengthOf(seg.pts);
    const off = ((phase[k] ?? 0) % SPACING + SPACING) % SPACING;
    for (let d = off; d < len; d += SPACING) {
      const [x, y] = pointAt(seg.pts, d);
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  });
}

// --- definition ---------------------------------------------------------------------------------

const isRC = (p: SimParams) => str(p, 'setup') === 'rc';
const notRC = (p: SimParams) => !isRC(p);
const hasLoad = (k: number) => (p: SimParams) =>
  notRC(p) && (str(p, 'setup') === 'mixed' ? k <= 3 : k <= Math.round(num(p, 'count', 2)));

const SPEED = 70; // px/s for the reference current

export const circuitSim: SimDef<CircuitState> = {
  autoplay: true,
  label: 'Electric circuit',
  blurb: 'Series, parallel, bulbs, RC charging',
  defaults: {
    setup: 'series', load: 'bulb', count: 2, emf: 6, rin: 0.5, r1: 10, r2: 10, r3: 20, closed: true,
    broken: 'none', meters: true, values: true, R: 1000, C: 1000, mode: 'charge',
  },
  controls: [
    {
      key: 'setup', label: 'Circuit', type: 'choice', options: [
        { value: 'series', label: 'Series' }, { value: 'parallel', label: 'Parallel' },
        { value: 'mixed', label: 'Mixed' }, { value: 'rc', label: 'RC' },
      ],
    },
    { key: 'load', label: 'Loads', type: 'choice', options: [{ value: 'bulb', label: 'Bulbs' }, { value: 'resistor', label: 'Resistors' }], show: notRC },
    { key: 'count', label: 'How many', type: 'range', min: 1, max: 3, step: 1, show: (p) => str(p, 'setup') === 'series' || str(p, 'setup') === 'parallel' },
    { key: 'emf', label: 'Battery EMF', type: 'range', min: 1.5, max: 24, step: 0.5, unit: 'V' },
    { key: 'rin', label: 'Internal resistance', type: 'range', min: 0, max: 5, step: 0.1, unit: 'Ω' },
    { key: 'r1', label: 'Load 1', type: 'range', min: 1, max: 100, step: 1, unit: 'Ω', show: hasLoad(1) },
    { key: 'r2', label: 'Load 2', type: 'range', min: 1, max: 100, step: 1, unit: 'Ω', show: hasLoad(2) },
    { key: 'r3', label: 'Load 3', type: 'range', min: 1, max: 100, step: 1, unit: 'Ω', show: hasLoad(3) },
    {
      key: 'broken', label: 'Break a load', type: 'choice', show: notRC, options: [
        { value: 'none', label: 'None' }, { value: '1', label: '1' }, { value: '2', label: '2' }, { value: '3', label: '3' },
      ],
    },
    { key: 'closed', label: 'Switch closed', type: 'toggle', show: notRC },
    { key: 'mode', label: 'Capacitor', type: 'choice', options: [{ value: 'charge', label: 'Charge' }, { value: 'discharge', label: 'Discharge' }], show: isRC },
    { key: 'R', label: 'Resistance R', type: 'range', min: 100, max: 10000, step: 100, unit: 'Ω', show: isRC },
    { key: 'C', label: 'Capacitance C', type: 'range', min: 100, max: 5000, step: 100, unit: 'µF', show: isRC },
    { key: 'meters', label: 'Ammeter', type: 'toggle' },
    { key: 'values', label: 'Values on parts', type: 'toggle', show: notRC },
  ],
  presets: [
    { label: 'Two bulbs in series', params: { setup: 'series', load: 'bulb', count: 2, r1: 10, r2: 10, broken: 'none', closed: true } },
    { label: 'Two bulbs in parallel', params: { setup: 'parallel', load: 'bulb', count: 2, r1: 10, r2: 10, broken: 'none', closed: true } },
    { label: 'Series: one bulb blows', params: { setup: 'series', load: 'bulb', count: 3, broken: '2', closed: true } },
    { label: 'Parallel: one bulb blows', params: { setup: 'parallel', load: 'bulb', count: 3, broken: '2', closed: true } },
    { label: 'Mixed resistors', params: { setup: 'mixed', load: 'resistor', r1: 4, r2: 6, r3: 12, broken: 'none', closed: true } },
    { label: 'RC charging, τ = 1 s', params: { setup: 'rc', R: 1000, C: 1000, mode: 'charge' } },
  ],
  title: (p) => {
    const s = str(p, 'setup', 'series');
    if (s === 'rc') return `RC circuit · ${str(p, 'mode') === 'discharge' ? 'discharging' : 'charging'}`;
    const what = str(p, 'load') === 'bulb' ? 'bulbs' : 'resistors';
    return s === 'mixed' ? `Mixed ${what}` : `${s === 'series' ? 'Series' : 'Parallel'} ${what}`;
  },
  init: (p) => {
    const k = rc(p);
    const vc = isRC(p) && !k.charge ? k.E : 0;
    return { t: 0, done: false, phase: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], vc, hist: [[0, vc]], ihist: [] };
  },
  step: (p, s, dt) => {
    if (isRC(p)) {
      const k = rc(p);
      const target = k.charge ? k.E : 0;
      // Exact solution over the step, so large steps stay stable.
      s.vc = target + (s.vc - target) * Math.exp(-dt / k.tau);
      s.t += dt;
      s.hist.push([s.t, s.vc]);
      if (s.hist.length > 400) s.hist.shift();
      if (s.t > k.tau * 6) s.done = true;
    } else {
      s.t += dt;
    }
    const lay = layout(p, s);
    lay.segs.forEach((seg, k) => {
      s.phase[k] = (s.phase[k] ?? 0) + (SPEED * seg.i * dt) / lay.iref;
    });
  },
  draw: (ctx, p, s, look) => {
    const lay = layout(p, s);
    ctx.save();
    ctx.strokeStyle = look.line;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    for (const seg of lay.segs) {
      ctx.beginPath();
      seg.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.stroke();
    }
    ctx.restore();
    // Junction dots where parallel branches meet.
    if (!isRC(p) && str(p, 'setup') !== 'series') {
      ctx.fillStyle = look.line;
      for (const seg of lay.segs) {
        if (seg.pts.length === 2 && seg.pts[0][0] === seg.pts[1][0] && seg.pts[0][0] !== 80 && seg.pts[0][0] !== 480) {
          for (const pt of seg.pts) {
            ctx.beginPath();
            ctx.arc(pt[0], pt[1], 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }
    drawDots(ctx, lay.segs, s.phase, look);

    if (isRC(p)) {
      const k = rc(p);
      const i = s.t > 0 ? (k.charge ? k.E - s.vc : -s.vc) / (k.R + k.r) : 0;
      for (const part of lay.parts) {
        gap(ctx, part, look);
        if (part.kind === 'battery') drawBattery(ctx, part, look, k.E);
        else if (part.kind === 'load') {
          drawResistor(ctx, part, look, false);
          label(ctx, `R = ${fmt(k.R)} Ω`, part.at[0], part.at[1] - 22, look, { color: look.muted, size: 10.5 });
        } else if (part.kind === 'cap') {
          drawCap(ctx, part, look);
          label(ctx, `${fmt(k.C * 1e6)} µF`, part.at[0] + 44, part.at[1] - 10, look, { color: look.muted, size: 10.5 });
          label(ctx, `${fmt(s.vc)} V`, part.at[0] + 44, part.at[1] + 8, look, { color: look.blue, size: 11 });
        } else if (part.kind === 'switch') drawSwitch(ctx, part, look);
        else if (part.kind === 'ammeter') drawMeter(ctx, part, look, `${fmt(Math.abs(i) * 1000)} mA`);
      }
      plot(ctx, 362, 40, 172, 120, s.hist, {
        tMax: k.tau * 6, vMax: k.E * 1.05, color: look.blue, look, title: 'V꜀ – t', unit: 'V', positive: true,
      });
      text(ctx, `τ = RC = ${fmt(k.tau)} s`, 362, 190, { size: 11, weight: 600, color: look.ink });
      text(ctx, k.charge ? `after τ: 63% of ${fmt(k.E)} V` : 'after τ: 37% left', 362, 208, { size: 10.5, color: look.muted });
      if (s.t === 0) label(ctx, 'Press play to close the switch', 160, FLOOR + 14, look, { color: look.muted });
      return;
    }

    const sol = solve(p);
    const bulbs = str(p, 'load') === 'bulb';
    for (const part of lay.parts) {
      if (part.kind === 'load') {
        const l = sol.loads[part.idx ?? 0];
        gap(ctx, part, look, 4);
        if (bulbs) {
          const pref = (sol.E * sol.E) / l.r;
          drawBulb(ctx, part, look, pref > 0 ? l.p / pref : 0, l.broken);
        } else drawResistor(ctx, part, look, l.broken);
        const [x, y] = part.at;
        const tx = part.vertical ? x + 22 : x;
        const ty = part.vertical ? y : y - 26;
        const align: CanvasTextAlign = part.vertical ? 'left' : 'center';
        label(ctx, `${l.name} ${fmt(l.r)} Ω${l.broken ? ' · broken' : ''}`, tx, ty - (part.vertical ? 8 : 0), look, { size: 10.5, align });
        if (bool(p, 'values')) {
          label(ctx, `${fmt(l.i)} A · ${fmt(l.v)} V`, tx, ty + (part.vertical ? 8 : 13), look, { size: 10, align, color: look.green });
        }
      } else if (part.kind === 'battery') {
        gap(ctx, part, look);
        drawBattery(ctx, part, look, sol.E);
      } else if (part.kind === 'switch') {
        gap(ctx, part, look);
        drawSwitch(ctx, part, look);
      } else if (part.kind === 'ammeter') {
        gap(ctx, { ...part, at: [part.at[0], part.at[1]] }, look, -6);
        line(ctx, part.vertical ? part.at[0] : part.at[0] - HALF, part.vertical ? part.at[1] - HALF : part.at[1],
          part.vertical ? part.at[0] : part.at[0] + HALF, part.vertical ? part.at[1] + HALF : part.at[1], look.line, 2);
        drawMeter(ctx, part, look, `${fmt(sol.I)} A`);
      }
    }
    if (!sol.closed) label(ctx, 'Open switch: no current flows', BW / 2, FLOOR + 14, look, { color: look.muted });
    else if (sol.I === 0) label(ctx, 'The circuit is broken: no current flows', BW / 2, FLOOR + 14, look, { color: look.red });
  },
  readouts: (p, s) => {
    if (isRC(p)) {
      const k = rc(p);
      const i = s.t > 0 ? (k.charge ? k.E - s.vc : -s.vc) / (k.R + k.r) : 0;
      return [
        { label: 'V꜀', value: `${fmt(s.vc)} V`, color: 'blue' },
        { label: 'Current', value: `${fmt(Math.abs(i) * 1000)} mA`, color: 'green' },
        { label: 'Charge', value: `${fmt(s.vc * k.C * 1000)} mC` },
        { label: 'τ', value: `${fmt(k.tau)} s` },
        { label: 't', value: `${fmt(s.t)} s` },
      ];
    }
    const sol = solve(p);
    const out: Readout[] = [
      { label: 'Total R', value: Number.isFinite(sol.req) ? `${fmt(sol.req)} Ω` : '∞' },
      { label: 'Current', value: `${fmt(sol.I)} A`, color: 'green' },
      { label: 'Terminal V', value: `${fmt(sol.vt)} V` },
      { label: 'Power', value: `${fmt(sol.I * sol.vt)} W`, color: 'orange' },
    ];
    for (const l of sol.loads.slice(0, 2)) out.push({ label: `P ${l.name}`, value: `${fmt(l.p)} W` });
    return out;
  },
  formulas: (p) => {
    if (isRC(p)) {
      const k = rc(p);
      return [
        { label: 'Time constant', tex: `\\tau = RC = ${tf(k.R + k.r)} \\times ${tf(k.C)} = ${tf(k.tau)}\\ \\text{s}` },
        k.charge
          ? { label: 'Charging', tex: `V_C = \\varepsilon\\left(1 - e^{-t/\\tau}\\right),\\quad V_C(\\tau) = ${tf(k.E * (1 - Math.exp(-1)))}\\ \\text{V}` }
          : { label: 'Discharging', tex: `V_C = V_0\\, e^{-t/\\tau},\\quad V_C(\\tau) = ${tf(k.E * Math.exp(-1))}\\ \\text{V}` },
        { label: 'Starting current', tex: `I_0 = \\dfrac{\\varepsilon}{R + r} = ${tf((k.E / (k.R + k.r)) * 1000)}\\ \\text{mA}` },
        { label: 'Energy stored (full)', tex: `U = \\tfrac12 C\\varepsilon^2 = ${tf(0.5 * k.C * k.E * k.E * 1000)}\\ \\text{mJ}` },
      ];
    }
    const sol = solve(p);
    const names = sol.loads.map((l) => `R_${sol.loads.indexOf(l) + 1}`);
    let reqTex: string;
    if (sol.setup === 'series') reqTex = `R = ${names.join(' + ')}`;
    else if (sol.setup === 'parallel') reqTex = `\\dfrac{1}{R} = ${names.map((n) => `\\dfrac{1}{${n}}`).join(' + ')}`;
    else reqTex = `R = R_1 + \\dfrac{R_2 R_3}{R_2 + R_3}`;
    const out: Formula[] = [
      { label: 'Equivalent resistance', tex: `${reqTex} \\Rightarrow R = ${Number.isFinite(sol.req) ? tf(sol.req) : '\\infty'}\\ \\Omega` },
      { label: "Current (Ohm's law)", tex: `I = \\dfrac{\\varepsilon}{R + r} = \\dfrac{${tf(sol.E)}}{${Number.isFinite(sol.req) ? tf(sol.req) : '\\infty'} + ${tf(sol.r)}} = ${tf(sol.I)}\\ \\text{A}` },
      { label: 'Terminal voltage', tex: `V = \\varepsilon - Ir = ${tf(sol.vt)}\\ \\text{V}` },
    ];
    for (const [k, l] of sol.loads.entries()) {
      out.push({ label: `Load ${k + 1}`, tex: `V_${k + 1} = I_${k + 1} R_${k + 1} = ${tf(l.i)} \\times ${tf(l.r)} = ${tf(l.v)}\\ \\text{V},\\ P = ${tf(l.p)}\\ \\text{W}` });
    }
    return out;
  },
};
