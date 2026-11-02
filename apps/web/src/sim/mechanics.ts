/**
 * Mechanics simulators: a block on an incline, a mass on a spring, a pendulum and a projectile.
 * All use 60 px to the metre unless they rescale to fit (the projectile does).
 */

import {
  BH, BW, DEG, FLOOR, angleArc, arrow, block, bool, energyBars, fmt, hatch, label, line, num, plot, rk4, spring,
  str, text, tf, wheel,
} from './kit';
import type { Formula, Readout, SimDef, SimParams, SimState } from './kit';

const PX = 60;
const HISTORY = 400;

// ============================================================ incline

interface InclineState extends SimState {
  s: number; // distance down the slope, m
  v: number;
  stop: string;
}

function inclineForces(p: SimParams, v: number) {
  const g = num(p, 'g', 9.8);
  const m = num(p, 'm', 2);
  const th = num(p, 'angle', 30) * DEG;
  const mu = num(p, 'mu', 0.2);
  const push = num(p, 'push', 0); // up the slope, N
  const W = m * g;
  const along = W * Math.sin(th) - push; // down-slope drive before friction
  const N = W * Math.cos(th);
  const fmax = mu * N;
  let f: number;
  let stuck = false;
  if (Math.abs(v) < 1e-6) {
    if (Math.abs(along) <= fmax) {
      stuck = true;
      f = -along;
    } else f = -Math.sign(along) * fmax;
  } else f = -Math.sign(v) * fmax;
  const a = stuck ? 0 : (along + f) / m;
  return { g, m, th, mu, push, W, along, N, fmax, f, a, stuck };
}

function inclineGeo(p: SimParams) {
  const th = num(p, 'angle', 30) * DEG;
  const left = 70;
  const L = Math.min(420 / Math.cos(th), 280 / Math.sin(th));
  const top: [number, number] = [left, FLOOR - L * Math.sin(th)];
  const bottom: [number, number] = [left + L * Math.cos(th), FLOOR];
  const side = Math.min(64, 26 + 7 * Math.sqrt(num(p, 'm', 2)));
  return { th, L, top, bottom, side, ux: Math.cos(th), uy: Math.sin(th), nx: Math.sin(th), ny: -Math.cos(th) };
}

export const inclineSim: SimDef<InclineState> = {
  label: 'Inclined plane',
  blurb: 'Friction, normal force, free-body diagram',
  defaults: { m: 2, angle: 30, mu: 0.2, push: 0, g: 9.8, components: true, forces: true },
  controls: [
    { key: 'm', label: 'Mass', type: 'range', min: 0.5, max: 20, step: 0.5, unit: 'kg' },
    { key: 'angle', label: 'Slope', type: 'range', min: 0, max: 75, step: 1, unit: '°' },
    { key: 'mu', label: 'Friction μ', type: 'range', min: 0, max: 1.2, step: 0.05 },
    { key: 'push', label: 'Push up the slope', type: 'range', min: 0, max: 200, step: 2, unit: 'N' },
    { key: 'g', label: 'Gravity g', type: 'range', min: 1.6, max: 25, step: 0.1, unit: 'm/s²' },
    { key: 'forces', label: 'Force arrows', type: 'toggle' },
    { key: 'components', label: 'Weight components', type: 'toggle' },
  ],
  presets: [
    { label: 'Frictionless 30°', params: { angle: 30, mu: 0, push: 0 } },
    { label: 'Held by friction', params: { angle: 20, mu: 0.5, push: 0 } },
    { label: 'Angle of repose (tan θ = μ)', params: { angle: 31, mu: 0.6, push: 0 } },
    { label: 'Pushed up the slope', params: { m: 4, angle: 25, mu: 0.1, push: 60 } },
  ],
  title: (p) => `Inclined plane · ${fmt(num(p, 'angle', 30))}°`,
  init: (p) => ({ t: 0, done: false, s: inclineGeo(p).L * 0.18 / PX, v: 0, stop: '' }),
  step: (p, s, dt) => {
    if (s.done) return;
    const g = inclineGeo(p);
    const f = inclineForces(p, s.v);
    if (f.stuck) {
      s.done = true;
      s.stop = 'Friction holds the block still';
      return;
    }
    const v0 = s.v;
    s.v += f.a * dt;
    if (v0 !== 0 && Math.sign(s.v) !== Math.sign(v0) && inclineForces(p, 0).stuck) {
      s.v = 0;
      s.done = true;
      s.stop = 'Friction stopped the block';
      return;
    }
    s.s += s.v * dt;
    s.t += dt;
    const max = (g.L - g.side * 0.75) / PX;
    const min = (g.side * 0.6) / PX;
    if (s.s >= max || s.s <= min) {
      s.s = Math.min(max, Math.max(min, s.s));
      s.done = true;
      s.stop = s.s >= max ? 'Reached the bottom' : 'Reached the top';
    }
  },
  draw: (ctx, p, s, look) => {
    const g = inclineGeo(p);
    const f = inclineForces(p, s.v);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(g.top[0], g.top[1]);
    ctx.lineTo(g.bottom[0], g.bottom[1]);
    ctx.lineTo(g.top[0], FLOOR);
    ctx.closePath();
    ctx.fillStyle = look.cardEdge;
    ctx.fill();
    ctx.strokeStyle = look.muted;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    hatch(ctx, 30, FLOOR, 540, FLOOR, look);
    angleArc(ctx, g.bottom[0], g.bottom[1], 38, Math.PI, Math.PI + g.th, `${fmt(num(p, 'angle', 30))}°`, look);
    // Centre of the block: along the slope, lifted by half its side along the outward normal
    // (up and to the right).
    const d = s.s * PX;
    const ox = g.nx;
    const oy = g.ny;
    const ccx = g.top[0] + g.ux * d + ox * (g.side / 2);
    const ccy = g.top[1] + g.uy * d + oy * (g.side / 2);
    block(ctx, ccx, ccy, g.side, g.th, `${fmt(num(p, 'm', 2))} kg`, look, look.blue);
    if (num(p, 'mu', 0) > 0) label(ctx, `μ = ${fmt(num(p, 'mu', 0))}`, g.top[0] + 40, FLOOR - 20, look, { color: look.muted });

    if (bool(p, 'forces')) {
      const k = 90 / Math.max(1, f.W, f.push);
      arrow(ctx, ccx, ccy, ccx, ccy + f.W * k, look.red, { tag: 'mg', look });
      arrow(ctx, ccx, ccy, ccx + ox * f.N * k, ccy + oy * f.N * k, look.blue, { tag: 'N', look });
      if (Math.abs(f.f) > 1e-3) {
        // Positive f points down the slope.
        arrow(ctx, ccx, ccy, ccx + g.ux * f.f * k, ccy + g.uy * f.f * k, look.orange, { tag: 'f', look });
      }
      if (f.push > 0) arrow(ctx, ccx - g.ux * 6, ccy - g.uy * 6, ccx - g.ux * (6 + f.push * k), ccy - g.uy * (6 + f.push * k), look.green, { tag: 'P', look });
      if (bool(p, 'components')) {
        const a = f.W * Math.sin(g.th) * k;
        const b = f.W * Math.cos(g.th) * k;
        arrow(ctx, ccx, ccy, ccx + g.ux * a, ccy + g.uy * a, look.red, { tag: 'mg sinθ', look, dash: true, w: 1.6 });
        arrow(ctx, ccx, ccy, ccx - ox * b, ccy - oy * b, look.red, { tag: 'mg cosθ', look, dash: true, w: 1.6 });
      }
    }
    if (s.stop) label(ctx, s.stop, BW / 2, FLOOR + 16, look, { color: look.muted });
  },
  readouts: (p, s) => {
    const f = inclineForces(p, s.v);
    return [
      { label: 'a', value: `${fmt(f.a)} m/s²`, color: 'violet' },
      { label: 'N', value: `${fmt(f.N)} N`, color: 'blue' },
      { label: 'Friction', value: `${fmt(Math.abs(f.f))} N`, color: 'orange' },
      { label: 'v', value: `${fmt(s.v)} m/s` },
      { label: 't', value: `${fmt(s.t)} s` },
    ];
  },
  formulas: (p) => {
    const f = inclineForces(p, 0);
    const deg = num(p, 'angle', 30);
    const out: Formula[] = [
      { label: 'Normal force', tex: `N = mg\\cos\\theta = ${tf(f.m)} \\times ${tf(f.g)} \\times \\cos ${tf(deg)}^\\circ = ${tf(f.N)}\\ \\text{N}` },
      { label: 'Down-slope pull', tex: `mg\\sin\\theta${f.push ? ' - P' : ''} = ${tf(f.along)}\\ \\text{N}` },
      { label: 'Most friction can give', tex: `f_{\\max} = \\mu N = ${tf(f.mu)} \\times ${tf(f.N)} = ${tf(f.fmax)}\\ \\text{N}` },
    ];
    out.push(
      f.stuck
        ? { label: 'Result', tex: `|${tf(f.along)}| \\le ${tf(f.fmax)} \\Rightarrow \\text{stays still}, a = 0` }
        : { label: 'Acceleration', tex: `a = \\dfrac{${tf(f.along)} ${f.f < 0 ? '-' : '+'} ${tf(Math.abs(f.f))}}{${tf(f.m)}} = ${tf(f.a)}\\ \\text{m/s}^2` },
    );
    if (f.mu > 0) out.push({ label: 'Slides on its own above', tex: `\\theta = \\tan^{-1}\\mu = ${tf(Math.atan(f.mu) / DEG)}^\\circ` });
    return out;
  },
  readoutAt: 'right',
};

// ============================================================ spring

interface SpringState extends SimState {
  x: number; // displacement from equilibrium, m (down or right is positive)
  v: number;
  hist: [number, number][];
}

function springSys(p: SimParams) {
  const m = num(p, 'm', 1);
  const k = num(p, 'k', 40);
  const b = num(p, 'damping', 0);
  const g = num(p, 'g', 9.8);
  const w0 = Math.sqrt(k / m);
  const zeta = b / (2 * Math.sqrt(k * m));
  return { m, k, b, g, w0, zeta, T: (2 * Math.PI) / w0, A: num(p, 'amp', 0.6) };
}

export const springSim: SimDef<SpringState> = {
  label: 'Spring & mass',
  blurb: 'Simple harmonic motion, damping, energy',
  defaults: { orient: 'vertical', m: 1, k: 40, amp: 0.6, damping: 0, g: 9.8, graph: true, energy: true },
  controls: [
    { key: 'orient', label: 'Spring', type: 'choice', options: [{ value: 'vertical', label: 'Hanging' }, { value: 'horizontal', label: 'On a table' }] },
    { key: 'm', label: 'Mass', type: 'range', min: 0.1, max: 10, step: 0.1, unit: 'kg' },
    { key: 'k', label: 'Spring constant k', type: 'range', min: 5, max: 400, step: 5, unit: 'N/m' },
    { key: 'amp', label: 'Pulled by', type: 'range', min: 0.05, max: 1, step: 0.05, unit: 'm' },
    { key: 'damping', label: 'Damping b', type: 'range', min: 0, max: 20, step: 0.1, unit: 'kg/s' },
    { key: 'g', label: 'Gravity g', type: 'range', min: 1.6, max: 25, step: 0.1, unit: 'm/s²', show: (p) => str(p, 'orient') === 'vertical' },
    { key: 'graph', label: 'Displacement graph', type: 'toggle' },
    { key: 'energy', label: 'Energy bars', type: 'toggle' },
  ],
  presets: [
    { label: 'Undamped', params: { damping: 0 } },
    { label: 'Light damping', params: { damping: 1.2 } },
    { label: 'Critically damped', params: { m: 1, k: 40, damping: 12.65 } },
    { label: 'Stiff spring', params: { k: 300, m: 1, damping: 0 } },
  ],
  title: (p) => (str(p, 'orient') === 'horizontal' ? 'Spring on a table' : 'Hanging spring'),
  init: (p) => ({ t: 0, done: false, x: springSys(p).A, v: 0, hist: [[0, springSys(p).A]] }),
  step: (p, s, dt) => {
    const sys = springSys(p);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const [x, v] = rk4(([x, v]) => [v, (-sys.k * x - sys.b * v) / sys.m], [s.x, s.v], dt / n);
      s.x = x;
      s.v = v;
    }
    s.t += dt;
    s.hist.push([s.t, s.x]);
    if (s.hist.length > HISTORY) s.hist.shift();
    if (sys.b > 0 && Math.abs(s.x) < 1e-3 && Math.abs(s.v) < 1e-3) s.done = true;
  },
  draw: (ctx, p, s, look) => {
    const sys = springSys(p);
    const vertical = str(p, 'orient') !== 'horizontal';
    const side = Math.min(60, 26 + 9 * Math.sqrt(sys.m));
    const ampPx = 90 / Math.max(0.3, sys.A); // keeps the full swing on the board
    const scale = Math.min(PX * 1.6, ampPx);
    if (vertical) {
      const ax = 150;
      const top = 24;
      const eq = 190;
      const y = eq + s.x * scale;
      hatch(ctx, ax - 60, top, ax + 60, top, look, 0, -1);
      spring(ctx, ax, top, ax, y - side / 2, 12, 12, look.line);
      block(ctx, ax, y, side, 0, `${fmt(sys.m)} kg`, look, look.blue);
      line(ctx, ax - 70, eq, ax + 70, eq, look.faint, 1, [4, 4]);
      label(ctx, 'equilibrium', ax + 74, eq, look, { align: 'left', color: look.faint, size: 10 });
      if (Math.abs(s.v) > 0.02) arrow(ctx, ax + side / 2 + 16, y, ax + side / 2 + 16, y + Math.sign(s.v) * Math.min(50, Math.abs(s.v) * 25), look.violet, { tag: 'v', look });
    } else {
      const wall = 40;
      const eq = 200;
      const y = 300;
      const x = eq + s.x * scale;
      hatch(ctx, wall, y - 60, wall, y + side / 2, look, -1, 0);
      line(ctx, wall, y + side / 2, 330, y + side / 2, look.muted, 2);
      // Fewer coils when the spring is short, so it never turns into a solid block.
      spring(ctx, wall, y, x - side / 2, y, Math.max(5, Math.min(12, Math.round((x - side / 2 - wall) / 14))), 10, look.line);
      block(ctx, x, y, side, 0, `${fmt(sys.m)} kg`, look, look.blue);
      line(ctx, eq, y - 50, eq, y + side / 2 + 8, look.faint, 1, [4, 4]);
      if (Math.abs(s.v) > 0.02) arrow(ctx, x, y - side / 2 - 12, x + Math.sign(s.v) * Math.min(50, Math.abs(s.v) * 25), y - side / 2 - 12, look.violet, { tag: 'v', look });
    }
    if (bool(p, 'graph')) {
      plot(ctx, 300, 30, 230, 120, s.hist, { tMax: Math.max(3, sys.T * 3), vMax: sys.A * 1.1, color: look.blue, look, title: 'x – t', unit: 'x' });
    }
    if (bool(p, 'energy')) {
      const ke = 0.5 * sys.m * s.v * s.v;
      const pe = 0.5 * sys.k * s.x * s.x;
      const e0 = 0.5 * sys.k * sys.A * sys.A;
      energyBars(ctx, 300, 186, 230, 54, [
        { label: 'KE', value: ke, color: look.orange },
        { label: 'PE', value: pe, color: look.blue },
        { label: 'E', value: ke + pe, color: look.green },
      ], e0, look);
    }
  },
  readouts: (p, s) => {
    const sys = springSys(p);
    const out: Readout[] = [
      { label: 'x', value: `${fmt(s.x)} m`, color: 'blue' },
      { label: 'v', value: `${fmt(s.v)} m/s`, color: 'violet' },
      { label: 'Period', value: `${fmt(sys.T)} s` },
      { label: 'Frequency', value: `${fmt(1 / sys.T)} Hz` },
    ];
    if (sys.b > 0) out.push({ label: 'Damping ratio ζ', value: fmt(sys.zeta) });
    out.push({ label: 't', value: `${fmt(s.t)} s` });
    return out;
  },
  formulas: (p) => {
    const sys = springSys(p);
    const out: Formula[] = [
      { label: 'Period', tex: `T = 2\\pi\\sqrt{\\dfrac{m}{k}} = 2\\pi\\sqrt{\\dfrac{${tf(sys.m)}}{${tf(sys.k)}}} = ${tf(sys.T)}\\ \\text{s}` },
      { label: 'Angular frequency', tex: `\\omega = \\sqrt{k/m} = ${tf(sys.w0)}\\ \\text{rad/s}` },
      { label: 'Top speed', tex: `v_{\\max} = A\\omega = ${tf(sys.A)} \\times ${tf(sys.w0)} = ${tf(sys.A * sys.w0)}\\ \\text{m/s}` },
      { label: 'Energy', tex: `E = \\tfrac12 kA^2 = ${tf(0.5 * sys.k * sys.A * sys.A)}\\ \\text{J}` },
    ];
    if (str(p, 'orient') === 'vertical') {
      out.push({ label: 'Stretch at rest', tex: `\\Delta L = \\dfrac{mg}{k} = ${tf((sys.m * sys.g) / sys.k)}\\ \\text{m}` });
    }
    if (sys.b > 0) {
      const kind = sys.zeta < 0.999 ? 'under-damped' : sys.zeta > 1.001 ? 'over-damped' : 'critically damped';
      out.push({ label: 'Damping', tex: `\\zeta = \\dfrac{b}{2\\sqrt{km}} = ${tf(sys.zeta)}\\ (\\text{${kind}})` });
    }
    return out;
  },
};

// ============================================================ pendulum

interface PendulumState extends SimState {
  th: number;
  w: number;
  hist: [number, number][];
  trail: [number, number][];
}

function pend(p: SimParams) {
  const L = num(p, 'L', 1.5);
  const g = num(p, 'g', 9.8);
  const m = num(p, 'm', 1);
  const b = num(p, 'damping', 0);
  const a0 = num(p, 'angle', 30) * DEG;
  const T0 = 2 * Math.PI * Math.sqrt(L / g);
  // Large-angle period from the arithmetic-geometric mean: T = T0 / agm(1, cos(a0/2)).
  let x = 1;
  let y = Math.cos(a0 / 2);
  for (let i = 0; i < 12; i++) [x, y] = [(x + y) / 2, Math.sqrt(x * y)];
  return { L, g, m, b, a0, T0, T: T0 / x };
}

export const pendulumSim: SimDef<PendulumState> = {
  label: 'Pendulum',
  blurb: 'Period, large angles, energy',
  defaults: { L: 1.5, angle: 30, m: 1, g: 9.8, damping: 0, energy: true, graph: true, trail: true, forces: false },
  controls: [
    { key: 'L', label: 'Length', type: 'range', min: 0.2, max: 3, step: 0.05, unit: 'm' },
    { key: 'angle', label: 'Released at', type: 'range', min: 2, max: 170, step: 1, unit: '°' },
    { key: 'm', label: 'Bob mass', type: 'range', min: 0.1, max: 10, step: 0.1, unit: 'kg' },
    { key: 'g', label: 'Gravity g', type: 'range', min: 1.6, max: 25, step: 0.1, unit: 'm/s²' },
    { key: 'damping', label: 'Air drag', type: 'range', min: 0, max: 2, step: 0.05, unit: '1/s' },
    { key: 'forces', label: 'Force arrows', type: 'toggle' },
    { key: 'trail', label: 'Trail', type: 'toggle' },
    { key: 'graph', label: 'Angle graph', type: 'toggle' },
    { key: 'energy', label: 'Energy bars', type: 'toggle' },
  ],
  presets: [
    { label: 'Small swing (10°)', params: { angle: 10, damping: 0 } },
    { label: 'Big swing (120°)', params: { angle: 120, damping: 0 } },
    { label: 'On the Moon', params: { g: 1.6 } },
    { label: 'Seconds pendulum', params: { L: 0.994, g: 9.8, angle: 8 } },
  ],
  title: (p) => `Pendulum · ${fmt(num(p, 'L', 1.5))} m`,
  init: (p) => ({ t: 0, done: false, th: num(p, 'angle', 30) * DEG, w: 0, hist: [[0, num(p, 'angle', 30)]], trail: [] }),
  step: (p, s, dt) => {
    const k = pend(p);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const [th, w] = rk4(([th, w]) => [w, -(k.g / k.L) * Math.sin(th) - k.b * w], [s.th, s.w], dt / n);
      s.th = th;
      s.w = w;
    }
    s.t += dt;
    s.hist.push([s.t, s.th / DEG]);
    if (s.hist.length > HISTORY) s.hist.shift();
  },
  draw: (ctx, p, s, look) => {
    const k = pend(p);
    const graph = bool(p, 'graph') || bool(p, 'energy');
    const px = graph ? 170 : BW / 2;
    const py = 40;
    const len = Math.min(k.L * 90, 280) * (k.a0 > 90 * DEG ? 0.55 : 1);
    const bx = px + Math.sin(s.th) * len;
    const by = py + Math.cos(s.th) * len;
    hatch(ctx, px - 60, py, px + 60, py, look, 0, -1);
    line(ctx, px, py, px, py + len + 14, look.faint, 1, [4, 4]);
    const a0 = k.a0;
    angleArc(ctx, px, py, 42, Math.PI / 2 - a0, Math.PI / 2, `${fmt(a0 / DEG)}°`, look);
    if (bool(p, 'trail')) {
      s.trail.push([bx, by]);
      if (s.trail.length > 60) s.trail.shift();
      ctx.save();
      for (let i = 1; i < s.trail.length; i++) {
        ctx.globalAlpha = (i / s.trail.length) * 0.5;
        line(ctx, s.trail[i - 1][0], s.trail[i - 1][1], s.trail[i][0], s.trail[i][1], look.violet, 2);
      }
      ctx.restore();
    }
    line(ctx, px, py, bx, by, look.line, 2);
    const r = 10 + 4 * Math.sqrt(k.m);
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = look.blue;
    ctx.globalAlpha = look.dark ? 0.45 : 0.3;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = look.blue;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(px, py, 3, 0, Math.PI * 2);
    ctx.fillStyle = look.muted;
    ctx.fill();
    if (bool(p, 'forces')) {
      const W = k.m * k.g;
      const T = k.m * (k.g * Math.cos(s.th) + k.L * s.w * s.w);
      const sc = 50 / Math.max(1, W);
      arrow(ctx, bx, by, bx, by + W * sc, look.red, { tag: 'mg', look });
      arrow(ctx, bx, by, bx - Math.sin(s.th) * T * sc, by - Math.cos(s.th) * T * sc, look.green, { tag: 'T', look });
    }
    if (bool(p, 'graph')) {
      plot(ctx, 330, 30, 200, 110, s.hist, { tMax: Math.max(3, k.T * 2.5), vMax: (k.a0 / DEG) * 1.1, color: look.violet, look, title: 'θ – t', unit: 'θ' });
    }
    if (bool(p, 'energy')) {
      const h = k.L * (1 - Math.cos(s.th));
      const ke = 0.5 * k.m * (k.L * s.w) ** 2;
      const pe = k.m * k.g * h;
      const e0 = k.m * k.g * k.L * (1 - Math.cos(k.a0));
      energyBars(ctx, 330, 186, 200, 54, [
        { label: 'KE', value: ke, color: look.orange },
        { label: 'PE', value: pe, color: look.blue },
        { label: 'E', value: ke + pe, color: look.green },
      ], e0, look);
    }
  },
  readouts: (p, s) => {
    const k = pend(p);
    return [
      { label: 'θ', value: `${fmt(s.th / DEG)}°`, color: 'violet' },
      { label: 'Speed', value: `${fmt(Math.abs(s.w * k.L))} m/s` },
      { label: 'Period', value: `${fmt(k.T)} s` },
      { label: 'Small-angle T', value: `${fmt(k.T0)} s` },
      { label: 't', value: `${fmt(s.t)} s` },
    ];
  },
  formulas: (p) => {
    const k = pend(p);
    return [
      { label: 'Small swings', tex: `T_0 = 2\\pi\\sqrt{\\dfrac{L}{g}} = 2\\pi\\sqrt{\\dfrac{${tf(k.L)}}{${tf(k.g)}}} = ${tf(k.T0)}\\ \\text{s}` },
      { label: `At ${fmt(k.a0 / DEG)}° (exact)`, tex: `T = \\dfrac{T_0}{\\operatorname{agm}(1, \\cos\\frac{\\theta_0}{2})} = ${tf(k.T)}\\ \\text{s}` },
      { label: 'Speed at the bottom', tex: `v = \\sqrt{2gL(1-\\cos\\theta_0)} = ${tf(Math.sqrt(2 * k.g * k.L * (1 - Math.cos(k.a0))))}\\ \\text{m/s}` },
      { label: 'Mass does not change the period', tex: `T \\text{ has no } m` },
    ];
  },
  readoutAt: 'left',
};

// ============================================================ projectile

interface ProjState extends SimState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  path: [number, number][];
  top: number;
}

function proj(p: SimParams) {
  const v0 = num(p, 'v0', 20);
  const a = num(p, 'angle', 45) * DEG;
  const h0 = num(p, 'h0', 0);
  const g = num(p, 'g', 9.8);
  const vx = v0 * Math.cos(a);
  const vy = v0 * Math.sin(a);
  const T = (vy + Math.sqrt(vy * vy + 2 * g * h0)) / g;
  const R = vx * T;
  const H = h0 + (vy * vy) / (2 * g);
  return { v0, a, h0, g, vx, vy, T, R, H, drag: bool(p, 'drag') ? num(p, 'k', 0.05) : 0 };
}

/** World metres to the drawing: everything the ideal flight reaches fits the board. */
function projView(p: SimParams) {
  const k = proj(p);
  const left = 60;
  const ground = FLOOR - 10;
  const sx = (BW - left - 50) / Math.max(5, k.R * 1.05);
  const sy = (ground - 50) / Math.max(5, k.H * 1.1);
  const s = Math.min(sx, sy);
  return { left, ground, s, X: (x: number) => left + x * s, Y: (y: number) => ground - y * s };
}

export const projectileSim: SimDef<ProjState> = {
  label: 'Projectile',
  blurb: 'Range, height, flight time, air drag',
  defaults: { v0: 20, angle: 45, h0: 0, g: 9.8, drag: false, k: 0.05, vectors: true, ideal: true },
  controls: [
    { key: 'v0', label: 'Launch speed', type: 'range', min: 1, max: 60, step: 0.5, unit: 'm/s' },
    { key: 'angle', label: 'Angle', type: 'range', min: 0, max: 90, step: 1, unit: '°' },
    { key: 'h0', label: 'Launch height', type: 'range', min: 0, max: 50, step: 0.5, unit: 'm' },
    { key: 'g', label: 'Gravity g', type: 'range', min: 1.6, max: 25, step: 0.1, unit: 'm/s²' },
    { key: 'drag', label: 'Air drag', type: 'toggle' },
    { key: 'k', label: 'Drag per mass', type: 'range', min: 0.005, max: 0.3, step: 0.005, unit: '1/m', show: (p) => bool(p, 'drag') },
    { key: 'vectors', label: 'Velocity arrows', type: 'toggle' },
    { key: 'ideal', label: 'Ideal path', type: 'toggle', show: (p) => bool(p, 'drag') },
  ],
  presets: [
    { label: '45° gives the longest range', params: { angle: 45, h0: 0, drag: false } },
    { label: 'Thrown off a cliff', params: { angle: 20, h0: 30, v0: 15 } },
    { label: 'Horizontal throw', params: { angle: 0, h0: 20, v0: 12 } },
    { label: 'With air drag', params: { angle: 45, drag: true, k: 0.06, v0: 30 } },
  ],
  title: (p) => `Projectile · ${fmt(num(p, 'v0', 20))} m/s at ${fmt(num(p, 'angle', 45))}°`,
  init: (p) => {
    const k = proj(p);
    return { t: 0, done: false, x: 0, y: k.h0, vx: k.vx, vy: k.vy, path: [[0, k.h0]], top: k.h0 };
  },
  step: (p, s, dt) => {
    if (s.done) return;
    const k = proj(p);
    const n = 4;
    for (let i = 0; i < n; i++) {
      const [x, y, vx, vy] = rk4(([, , vx, vy]) => {
        const sp = Math.hypot(vx, vy);
        return [vx, vy, -k.drag * sp * vx, -k.g - k.drag * sp * vy];
      }, [s.x, s.y, s.vx, s.vy], dt / n);
      if (y < 0 && s.t > 0) {
        // Land exactly on the ground.
        const f = s.y / (s.y - y);
        s.x += (x - s.x) * f;
        s.y = 0;
        s.t += (dt / n) * f;
        s.done = true;
        s.path.push([s.x, 0]);
        return;
      }
      s.x = x;
      s.y = y;
      s.vx = vx;
      s.vy = vy;
      s.t += dt / n;
      s.top = Math.max(s.top, y);
    }
    s.path.push([s.x, s.y]);
  },
  draw: (ctx, p, s, look) => {
    const k = proj(p);
    const v = projView(p);
    hatch(ctx, 20, v.ground, BW - 20, v.ground, look);
    // Distance ticks along the ground, spaced for the width shown (at least 5 m, whatever the range).
    const step = niceStep((BW - 30 - v.left) / v.s);
    for (let d = step, n = 0; v.X(d) < BW - 30 && n < 40; d += step, n++) {
      line(ctx, v.X(d), v.ground, v.X(d), v.ground + 5, look.faint, 1);
      text(ctx, `${fmt(d)}`, v.X(d), v.ground + 14, { size: 9.5, color: look.faint, align: 'center' });
    }
    text(ctx, 'm', BW - 22, v.ground + 14, { size: 9.5, color: look.faint });
    if (k.h0 > 0) {
      ctx.save();
      ctx.fillStyle = look.cardEdge;
      ctx.fillRect(v.left - 24, v.Y(k.h0), 24, v.ground - v.Y(k.h0));
      ctx.restore();
      line(ctx, v.left - 24, v.Y(k.h0), v.left, v.Y(k.h0), look.muted, 2);
      line(ctx, v.left, v.Y(k.h0), v.left, v.ground, look.muted, 2);
    }
    if (!k.drag || bool(p, 'ideal')) {
      ctx.save();
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = look.faint;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let i = 0; i <= 60; i++) {
        const t = (k.T * i) / 60;
        const xx = v.X(k.vx * t);
        const yy = v.Y(k.h0 + k.vy * t - 0.5 * k.g * t * t);
        i ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.save();
    ctx.strokeStyle = look.violet;
    ctx.lineWidth = 2.4;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    s.path.forEach(([x, y], i) => (i ? ctx.lineTo(v.X(x), v.Y(y)) : ctx.moveTo(v.X(x), v.Y(y))));
    ctx.stroke();
    ctx.restore();
    // The launcher.
    ctx.save();
    ctx.translate(v.left, v.Y(k.h0));
    ctx.rotate(-k.a);
    ctx.fillStyle = look.muted;
    ctx.beginPath();
    ctx.roundRect(-4, -5, 30, 10, 4);
    ctx.fill();
    ctx.restore();
    // The launch angle, unless the ball is still beside it (its velocity tags would land on it).
    const near = Math.hypot(v.X(s.x) - v.left, v.Y(s.y) - v.Y(k.h0)) < 70;
    if (k.a > 0.5 * DEG && !near) angleArc(ctx, v.left, v.Y(k.h0), 30, -k.a, 0, `${fmt(k.a / DEG)}°`, look);
    // Peak marker.
    if (!k.drag) {
      const tp = k.vy / k.g;
      if (tp > 0) {
        const xp = v.X(k.vx * tp);
        line(ctx, xp, v.Y(k.H), xp, v.ground, look.faint, 1, [3, 3]);
        label(ctx, `H = ${fmt(k.H)} m`, xp, v.Y(k.H) - 12, look, { color: look.muted, size: 10.5 });
      }
    }
    const bx = v.X(s.x);
    const by = v.Y(s.y);
    ctx.beginPath();
    ctx.arc(bx, by, 7, 0, Math.PI * 2);
    ctx.fillStyle = look.orange;
    ctx.fill();
    if (bool(p, 'vectors') && !s.done) {
      const sc = 2.2;
      arrow(ctx, bx, by, bx + s.vx * sc, by, look.blue, { tag: 'vₓ', look, w: 2 });
      arrow(ctx, bx, by, bx, by - s.vy * sc, look.green, { tag: 'v_y'.replace('_y', 'ᵧ'), look, w: 2 });
      arrow(ctx, bx, by, bx + s.vx * sc, by - s.vy * sc, look.violet, { look, w: 2 });
    }
    if (s.done) label(ctx, `Landed at ${fmt(s.x)} m after ${fmt(s.t)} s`, BW / 2, 24, look, { color: look.muted });
  },
  readouts: (_p, s) => [
    { label: 'x', value: `${fmt(s.x)} m` },
    { label: 'y', value: `${fmt(s.y)} m` },
    { label: 'Speed', value: `${fmt(Math.hypot(s.vx, s.vy))} m/s`, color: 'violet' },
    { label: 'Highest', value: `${fmt(s.top)} m` },
    { label: 't', value: `${fmt(s.t)} s` },
  ],
  formulas: (p) => {
    const k = proj(p);
    const out: Formula[] = [
      { label: 'Components', tex: `v_x = ${tf(k.v0)}\\cos ${tf(k.a / DEG)}^\\circ = ${tf(k.vx)},\\quad v_y = ${tf(k.vy)}\\ \\text{m/s}` },
      { label: 'Greatest height', tex: `H = h_0 + \\dfrac{v_y^2}{2g} = ${tf(k.h0)} + \\dfrac{${tf(k.vy)}^2}{2 \\times ${tf(k.g)}} = ${tf(k.H)}\\ \\text{m}` },
      { label: 'Flight time', tex: `t = \\dfrac{v_y + \\sqrt{v_y^2 + 2gh_0}}{g} = ${tf(k.T)}\\ \\text{s}` },
      { label: 'Range', tex: `R = v_x t = ${tf(k.vx)} \\times ${tf(k.T)} = ${tf(k.R)}\\ \\text{m}` },
    ];
    if (k.drag) out.push({ label: 'With drag', tex: `\\text{no closed form; solved step by step (RK4)}` });
    return out;
  },
  readoutAt: 'right',
};

function niceStep(span: number) {
  const raw = span / 6;
  const p = 10 ** Math.floor(Math.log10(raw || 1));
  const f = raw / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

void BH;
void wheel;
