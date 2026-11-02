/**
 * Pulley systems: an Atwood machine, a block on a table, a block on an incline (each with a
 * hanging mass over one pulley), and a block and tackle with 1 to 6 supporting strands.
 *
 * The pulley wheel can have mass (a uniform disc, I = ½MR²), so the tensions either side
 * differ, and blocks can have friction. Displacements use 60 px to the metre.
 */

import {
  BW, DEG, FLOOR, SIM_FONT, angleArc, arrow, block, bool, fmt, hatch, label, line, num, str, text, tf, wheel,
} from './kit';
import type { Formula, Look, Readout, SimDef, SimParams, SimState } from './kit';

const PX = 60; // pixels per metre
const R = 22; // pulley radius on screen

interface PulleyState extends SimState {
  /** Rope travel in metres; positive when the hanging mass goes down (or the load goes up). */
  x: number;
  v: number;
  a: number;
  /** Why the motion stopped, shown on the board. */
  stop: string;
}

const side = (m: number) => Math.min(70, 24 + 7 * Math.sqrt(m));

// --- physics ----------------------------------------------------------------

interface Dyn {
  /** Acceleration along the rope, positive towards the hanging mass falling. */
  a: number;
  /** Tension on the first block's side and on the hanging side. */
  t1: number;
  t2: number;
  /** Friction force on block 1 (0 when there is none). */
  f: number;
  /** Normal force on block 1. */
  n: number;
  /** True when friction holds the system still. */
  stuck: boolean;
}

function dynamics(p: SimParams, v: number): Dyn {
  const setup = str(p, 'setup', 'atwood');
  const g = num(p, 'g', 9.8);
  const m1 = num(p, 'm1', 2);
  const m2 = num(p, 'm2', 3);
  const M = bool(p, 'massive') ? num(p, 'M', 1) : 0;
  const mu = setup === 'atwood' ? 0 : num(p, 'mu', 0);
  const th = num(p, 'angle', 30) * DEG;
  const inertia = m1 + m2 + M / 2;

  // Force driving m2 down, before friction.
  let drive: number;
  let n = 0;
  if (setup === 'atwood') drive = (m2 - m1) * g;
  else if (setup === 'table') {
    n = m1 * g;
    drive = m2 * g;
  } else {
    n = m1 * g * Math.cos(th);
    drive = m2 * g - m1 * g * Math.sin(th);
  }
  const fmax = mu * n;
  let f = 0;
  let a: number;
  let stuck = false;
  if (Math.abs(v) < 1e-6) {
    if (Math.abs(drive) <= fmax) {
      stuck = true;
      a = 0;
      f = -drive;
    } else {
      f = -Math.sign(drive) * fmax;
      a = (drive + f) / inertia;
    }
  } else {
    f = -Math.sign(v) * fmax;
    a = (drive + f) / inertia;
  }
  // Hanging side: m2 g - T2 = m2 a. Block side, along its motion: T1 - (weight part) - friction = m1 a.
  const t2 = m2 * (g - a);
  const t1 = t2 - (M / 2) * a;
  return { a, t1, t2, f: Math.abs(f), n, stuck };
}

function tackle(p: SimParams) {
  const g = num(p, 'g', 9.8);
  const m = num(p, 'load', 40);
  const F = num(p, 'effort', 120);
  const n = Math.round(num(p, 'strands', 2));
  const eta = num(p, 'eff', 100) / 100;
  const lift = eta * n * F;
  const w = m * g;
  const a = lift > w ? (lift - w) / m : 0;
  return { g, m, F, n, eta, lift, w, a, hold: w / (eta * n) };
}

// --- layout ---------------------------------------------------------------------

interface Geo {
  /** Rope travel limits in metres. */
  min: number;
  max: number;
}

const CEIL = 22;

function atwoodGeo(p: SimParams) {
  const s1 = side(num(p, 'm1', 2));
  const s2 = side(num(p, 'm2', 3));
  const cx = 280;
  const cy = 74;
  const y0 = 222;
  return { s1, s2, cx, cy, y0 };
}

function tableGeo(p: SimParams) {
  const s1 = side(num(p, 'm1', 2));
  const s2 = side(num(p, 'm2', 3));
  const top = 178;
  const edge = 360;
  const bx0 = 150;
  const by = top - s1 / 2;
  const cx = edge + 14;
  const cy = by + R;
  return { s1, s2, top, edge, bx0, by, cx, cy, hy0: cy + 70 };
}

function inclineGeo(p: SimParams) {
  const s1 = side(num(p, 'm1', 2));
  const s2 = side(num(p, 'm2', 3));
  const th = num(p, 'angle', 30) * DEG;
  const right = 400;
  const L = Math.min(330 / Math.cos(th), 250 / Math.sin(th));
  const apex: [number, number] = [right, FLOOR - L * Math.sin(th)];
  const base: [number, number] = [right - L * Math.cos(th), FLOOR];
  const ux = Math.cos(th);
  const uy = -Math.sin(th);
  const nx = -Math.sin(th);
  const ny = -Math.cos(th);
  // The wheel sits just past the top so the rope leaves the block parallel to the slope.
  const cx = apex[0] + nx * (s1 / 2 - R) + ux * (R + 6);
  const cy = apex[1] + ny * (s1 / 2 - R) + uy * (R + 6);
  return { s1, s2, th, L, apex, base, ux, uy, nx, ny, cx, cy, s0: L * 0.42 };
}

function geo(p: SimParams): Geo {
  const setup = str(p, 'setup', 'atwood');
  if (setup === 'atwood') {
    const g = atwoodGeo(p);
    // m2 falls (x > 0) until it lands or m1 reaches the pulley; the reverse the other way.
    const down2 = (FLOOR - (g.y0 + g.s2 / 2)) / PX;
    const up1 = (g.y0 - g.s1 / 2 - (g.cy + R + 6)) / PX;
    const down1 = (FLOOR - (g.y0 + g.s1 / 2)) / PX;
    const up2 = (g.y0 - g.s2 / 2 - (g.cy + R + 6)) / PX;
    return { min: -Math.min(down1, up2), max: Math.min(down2, up1) };
  }
  if (setup === 'table') {
    const g = tableGeo(p);
    const toEdge = (g.edge - 6 - (g.bx0 + g.s1 / 2)) / PX;
    const land = (FLOOR - (g.hy0 + g.s2 / 2)) / PX;
    const back = (g.bx0 - g.s1 / 2 - 20) / PX;
    const up2 = (g.hy0 - g.s2 / 2 - (g.cy + R + 4)) / PX;
    return { min: -Math.min(back, up2), max: Math.min(toEdge, land) };
  }
  const g = inclineGeo(p);
  const hy0 = g.cy + 60;
  const top = (g.L - 8 - (g.s0 + g.s1 / 2)) / PX;
  const land = (FLOOR - (hy0 + g.s2 / 2)) / PX;
  const bottom = (g.s0 - g.s1 / 2) / PX;
  const up2 = (hy0 - g.s2 / 2 - (g.cy + R + 4)) / PX;
  return { min: -Math.min(bottom, up2), max: Math.min(top, land) };
}

function tackleGeo(p: SimParams) {
  const n = Math.round(num(p, 'strands', 2));
  const sp = 30;
  const left = 250 - (n * sp) / 2;
  const xs = Array.from({ length: n + 1 }, (_, i) => left + i * sp);
  const topY = 74;
  const boxH = side(num(p, 'load', 40) / 6) + 6;
  const hook = 34;
  const bot0 = FLOOR - boxH - hook;
  const eff0 = topY + 56;
  // The load can rise until its pulleys meet the top ones, and the rope end reaches the floor.
  const maxRise = Math.min((bot0 - topY - sp - 10) / PX, (FLOOR - 26 - eff0) / n / PX);
  return { n, sp, xs, topY, boxH, hook, bot0, eff0, maxRise };
}

// --- drawing ------------------------------------------------------------------------

/** Where a rope from (px, py) first touches a wheel, on the side `pick` prefers. */
function tangent(px: number, py: number, cx: number, cy: number, r: number, pick: (a: number, b: number) => boolean) {
  const d = Math.hypot(px - cx, py - cy);
  const base = Math.atan2(py - cy, px - cx);
  const off = Math.acos(Math.min(1, r / d));
  const a1 = base + off;
  const a2 = base - off;
  return pick(a1, a2) ? a1 : a2;
}

function rope(ctx: CanvasRenderingContext2D, look: Look, draw: (c: CanvasRenderingContext2D) => void) {
  ctx.save();
  ctx.strokeStyle = look.line;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  draw(ctx);
  ctx.stroke();
  ctx.restore();
}

/** Force arrows scale with the largest weight in the scene so they stay readable. */
const forceScale = (p: SimParams) => {
  const g = num(p, 'g', 9.8);
  const heaviest = Math.max(num(p, 'm1', 2), num(p, 'm2', 3)) * g;
  return 70 / Math.max(1, heaviest);
};

function drawAtwood(ctx: CanvasRenderingContext2D, p: SimParams, s: PulleyState, look: Look, d: Dyn) {
  const g = atwoodGeo(p);
  const x = s.x * PX;
  const y1 = g.y0 - x;
  const y2 = g.y0 + x;
  const lx = g.cx - R;
  const rx = g.cx + R;
  hatch(ctx, g.cx - 70, CEIL, g.cx + 70, CEIL, look, 0, -1);
  line(ctx, g.cx, CEIL, g.cx, g.cy, look.muted, 3);
  rope(ctx, look, (c) => {
    c.moveTo(lx, y1 - g.s1 / 2);
    c.lineTo(lx, g.cy);
    c.arc(g.cx, g.cy, R, Math.PI, 0);
    c.lineTo(rx, y2 - g.s2 / 2);
  });
  wheel(ctx, g.cx, g.cy, R, s.x * PX / R, look);
  block(ctx, lx, y1, g.s1, 0, `${fmt(num(p, 'm1', 2))} kg`, look, look.blue);
  block(ctx, rx, y2, g.s2, 0, `${fmt(num(p, 'm2', 3))} kg`, look, look.orange);
  hatch(ctx, 120, FLOOR, 440, FLOOR, look);
  if (bool(p, 'forces')) {
    const k = forceScale(p);
    const gv = num(p, 'g', 9.8);
    const w1 = num(p, 'm1', 2) * gv;
    const w2 = num(p, 'm2', 3) * gv;
    arrow(ctx, lx - g.s1 / 2 - 14, y1, lx - g.s1 / 2 - 14, y1 - d.t1 * k, look.green, { tag: 'T₁', look });
    arrow(ctx, lx - g.s1 / 2 - 14, y1, lx - g.s1 / 2 - 14, y1 + w1 * k, look.red, { tag: 'm₁g', look });
    arrow(ctx, rx + g.s2 / 2 + 14, y2, rx + g.s2 / 2 + 14, y2 - d.t2 * k, look.green, { tag: 'T₂', look });
    arrow(ctx, rx + g.s2 / 2 + 14, y2, rx + g.s2 / 2 + 14, y2 + w2 * k, look.red, { tag: 'm₂g', look });
  }
  if (bool(p, 'motion') && Math.abs(d.a) > 1e-3) {
    const dir = Math.sign(d.a);
    arrow(ctx, g.cx + 90, 200, g.cx + 90, 200 + dir * 36, look.violet, { tag: 'a', look, dash: true });
    arrow(ctx, g.cx - 90, 200, g.cx - 90, 200 - dir * 36, look.violet, { tag: 'a', look, dash: true });
  }
}

function drawTable(ctx: CanvasRenderingContext2D, p: SimParams, s: PulleyState, look: Look, d: Dyn) {
  const g = tableGeo(p);
  const x = s.x * PX;
  const bx = g.bx0 + x;
  const hy = g.hy0 + x;
  const hx = g.cx + R;
  // Table top and legs.
  ctx.save();
  ctx.fillStyle = look.cardEdge;
  ctx.fillRect(40, g.top, g.edge - 40, 10);
  ctx.restore();
  line(ctx, 40, g.top, g.edge, g.top, look.muted, 2);
  line(ctx, 60, g.top + 10, 60, FLOOR, look.muted, 3);
  line(ctx, g.edge - 20, g.top + 10, g.edge - 20, FLOOR, look.muted, 3);
  line(ctx, g.edge, g.top, g.cx, g.cy, look.muted, 3);
  rope(ctx, look, (c) => {
    c.moveTo(bx + g.s1 / 2, g.by);
    c.lineTo(g.cx, g.cy - R);
    c.arc(g.cx, g.cy, R, -Math.PI / 2, 0);
    c.lineTo(hx, hy - g.s2 / 2);
  });
  wheel(ctx, g.cx, g.cy, R, x / R, look);
  block(ctx, bx, g.by, g.s1, 0, `${fmt(num(p, 'm1', 2))} kg`, look, look.blue);
  block(ctx, hx, hy, g.s2, 0, `${fmt(num(p, 'm2', 3))} kg`, look, look.orange);
  hatch(ctx, 30, FLOOR, 520, FLOOR, look);
  if (num(p, 'mu', 0) > 0) label(ctx, `μ = ${fmt(num(p, 'mu', 0))}`, 110, g.top + 24, look, { color: look.muted });
  if (bool(p, 'forces')) {
    const k = forceScale(p);
    const gv = num(p, 'g', 9.8);
    arrow(ctx, bx + g.s1 / 2, g.by - 14, bx + g.s1 / 2 + d.t1 * k, g.by - 14, look.green, { tag: 'T', look });
    arrow(ctx, bx, g.by, bx, g.by + num(p, 'm1', 2) * gv * k, look.red, { tag: 'm₁g', look });
    arrow(ctx, bx, g.by - g.s1 / 2, bx, g.by - g.s1 / 2 - d.n * k, look.blue, { tag: 'N', look });
    if (d.f > 1e-3) arrow(ctx, bx - g.s1 / 2, g.by + 8, bx - g.s1 / 2 - d.f * k, g.by + 8, look.orange, { tag: 'f', look });
    arrow(ctx, hx + g.s2 / 2 + 14, hy, hx + g.s2 / 2 + 14, hy - d.t2 * k, look.green, { tag: 'T', look });
    arrow(ctx, hx + g.s2 / 2 + 14, hy, hx + g.s2 / 2 + 14, hy + num(p, 'm2', 3) * gv * k, look.red, { tag: 'm₂g', look });
  }
}

function drawIncline(ctx: CanvasRenderingContext2D, p: SimParams, s: PulleyState, look: Look, d: Dyn) {
  const g = inclineGeo(p);
  const x = s.x * PX;
  const along = g.s0 + x;
  const bx = g.base[0] + g.ux * along + g.nx * (g.s1 / 2);
  const by = g.base[1] + g.uy * along + g.ny * (g.s1 / 2);
  const hx = g.cx + R;
  const hy = g.cy + 60 + x;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(g.base[0], g.base[1]);
  ctx.lineTo(g.apex[0], g.apex[1]);
  ctx.lineTo(g.apex[0], FLOOR);
  ctx.closePath();
  ctx.fillStyle = look.cardEdge;
  ctx.fill();
  ctx.strokeStyle = look.muted;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  angleArc(ctx, g.base[0], g.base[1], 34, -g.th, 0, `${fmt(num(p, 'angle', 30))}°`, look);
  line(ctx, g.apex[0], g.apex[1], g.cx, g.cy, look.muted, 3);
  // The rope leaves the block's leading face, parallel to the slope, and wraps over the wheel.
  const rx0 = bx + g.ux * (g.s1 / 2);
  const ry0 = by + g.uy * (g.s1 / 2);
  const ta = tangent(rx0, ry0, g.cx, g.cy, R, (a, b) => Math.sin(a) < Math.sin(b));
  rope(ctx, look, (c) => {
    c.moveTo(rx0, ry0);
    c.lineTo(g.cx + R * Math.cos(ta), g.cy + R * Math.sin(ta));
    c.arc(g.cx, g.cy, R, ta, 0);
    c.lineTo(hx, hy - g.s2 / 2);
  });
  wheel(ctx, g.cx, g.cy, R, x / R, look);
  block(ctx, bx, by, g.s1, -g.th, `${fmt(num(p, 'm1', 2))} kg`, look, look.blue);
  block(ctx, hx, hy, g.s2, 0, `${fmt(num(p, 'm2', 3))} kg`, look, look.orange);
  hatch(ctx, 20, FLOOR, 540, FLOOR, look);
  if (num(p, 'mu', 0) > 0) label(ctx, `μ = ${fmt(num(p, 'mu', 0))}`, (g.base[0] + g.apex[0]) / 2 + 30, FLOOR - 16, look, { color: look.muted });
  if (bool(p, 'forces')) {
    const k = forceScale(p);
    const gv = num(p, 'g', 9.8);
    arrow(ctx, bx, by, bx + g.ux * d.t1 * k, by + g.uy * d.t1 * k, look.green, { tag: 'T', look });
    arrow(ctx, bx, by, bx, by + num(p, 'm1', 2) * gv * k, look.red, { tag: 'm₁g', look });
    arrow(ctx, bx, by, bx + g.nx * d.n * k, by + g.ny * d.n * k, look.blue, { tag: 'N', look });
    if (d.f > 1e-3) {
      // Friction opposes the motion (or the tendency to move) along the slope.
      const dir = s.v !== 0 ? -Math.sign(s.v) : d.stuck ? -Math.sign(dynamicsDrive(p)) : -Math.sign(d.a);
      arrow(ctx, bx, by, bx + g.ux * dir * d.f * k, by + g.uy * dir * d.f * k, look.orange, { tag: 'f', look });
    }
    arrow(ctx, hx + g.s2 / 2 + 14, hy, hx + g.s2 / 2 + 14, hy - d.t2 * k, look.green, { tag: 'T', look });
    arrow(ctx, hx + g.s2 / 2 + 14, hy, hx + g.s2 / 2 + 14, hy + num(p, 'm2', 3) * gv * k, look.red, { tag: 'm₂g', look });
  }
}

function dynamicsDrive(p: SimParams) {
  const g = num(p, 'g', 9.8);
  return num(p, 'm2', 3) * g - num(p, 'm1', 2) * g * Math.sin(num(p, 'angle', 30) * DEG);
}

function drawTackle(ctx: CanvasRenderingContext2D, p: SimParams, s: PulleyState, look: Look) {
  const g = tackleGeo(p);
  const rise = s.x * PX;
  const bot = g.bot0 - rise;
  const eff = g.eff0 + g.n * rise;
  const r = g.sp / 2;
  const top = g.topY;
  const k = tackle(p);
  hatch(ctx, g.xs[0] - 50, CEIL, g.xs[g.n] + 50, CEIL, look, 0, -1);

  // Pulley blocks: each wheel between strands i and i+1 is on top or at the load.
  const tops: number[] = [];
  const bots: number[] = [];
  for (let i = 0; i < g.n; i++) ((i + g.n) % 2 === 1 ? tops : bots).push(i);
  for (const i of tops) line(ctx, (g.xs[i] + g.xs[i + 1]) / 2, CEIL, (g.xs[i] + g.xs[i + 1]) / 2, top, look.muted, 3);
  // The bar that carries the lower pulleys and the load hook.
  const barL = bots.length ? (g.xs[bots[0]] + g.xs[bots[0] + 1]) / 2 : g.xs[0];
  const barR = bots.length ? (g.xs[bots[bots.length - 1]] + g.xs[bots[bots.length - 1] + 1]) / 2 : g.xs[0];
  const anchoredLow = g.n % 2 === 1;
  const lowL = Math.min(barL, anchoredLow ? g.xs[0] : barL);
  const mid = (lowL + barR) / 2;
  line(ctx, lowL, bot, barR, bot, look.muted, 3);
  line(ctx, mid, bot, mid, bot + g.hook, look.muted, 2.5);

  rope(ctx, look, (c) => {
    // Every supporting strand runs between the upper and lower blocks.
    for (let i = 0; i < g.n; i++) {
      c.moveTo(g.xs[i], bot);
      c.lineTo(g.xs[i], top);
    }
    for (const i of tops) {
      const cx = (g.xs[i] + g.xs[i + 1]) / 2;
      c.moveTo(g.xs[i], top);
      c.arc(cx, top, r, Math.PI, 0);
    }
    for (const i of bots) {
      const cx = (g.xs[i] + g.xs[i + 1]) / 2;
      c.moveTo(g.xs[i + 1], bot);
      c.arc(cx, bot, r, 0, Math.PI);
    }
    c.moveTo(g.xs[g.n], top);
    c.lineTo(g.xs[g.n], eff);
  });
  // The first strand of an even tackle is tied to the ceiling; of an odd one, to the lower block.
  if (!anchoredLow) {
    line(ctx, g.xs[0], top, g.xs[0], CEIL, look.muted, 2);
  } else {
    ctx.beginPath();
    ctx.arc(g.xs[0], bot, 3, 0, Math.PI * 2);
    ctx.fillStyle = look.muted;
    ctx.fill();
  }
  for (const i of tops) wheel(ctx, (g.xs[i] + g.xs[i + 1]) / 2, top, r - 1, -s.x * PX / r, look);
  for (const i of bots) wheel(ctx, (g.xs[i] + g.xs[i + 1]) / 2, bot, r - 1, s.x * PX / r, look);
  // Tight strands supporting the load are numbered.
  for (let i = 0; i < g.n; i++) label(ctx, String(i + 1), g.xs[i], (top + bot) / 2 + (i % 2) * 14, look, { size: 10, color: look.muted });

  const bw = Math.max(60, g.boxH * 1.4);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(mid - bw / 2, bot + g.hook, bw, g.boxH, 5);
  ctx.fillStyle = look.orange;
  ctx.globalAlpha = look.dark ? 0.35 : 0.22;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = look.orange;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  text(ctx, `${fmt(k.m)} kg`, mid, bot + g.hook + g.boxH / 2, { size: 11, weight: 650, color: look.ink, align: 'center' });

  // The pull on the free end.
  const ex = g.xs[g.n];
  ctx.save();
  ctx.beginPath();
  ctx.arc(ex, eff + 7, 7, 0, Math.PI * 2);
  ctx.strokeStyle = look.line;
  ctx.lineWidth = 2.4;
  ctx.stroke();
  ctx.restore();
  arrow(ctx, ex + 16, eff, ex + 16, eff + 30 + Math.min(40, k.F / 8), look.green, { tag: `${fmt(k.F)} N`, look });
  hatch(ctx, g.xs[0] - 90, FLOOR, g.xs[g.n] + 120, FLOOR, look);

  if (bool(p, 'forces')) {
    const kk = 80 / Math.max(1, k.w);
    const lx = mid - bw / 2 - 18;
    const ly = bot + g.hook + g.boxH / 2;
    arrow(ctx, lx, ly, lx, ly + k.w * kk, look.red, { tag: 'W', look });
    arrow(ctx, lx, ly, lx, ly - Math.min(k.lift, k.w * 1.6) * kk, look.blue, { tag: `${g.n}ηF`, look });
  }
  label(ctx, `${g.n} strand${g.n > 1 ? 's' : ''} hold the load`, 470, 96, look, { color: look.muted, size: 11 });
}

// --- definition ---------------------------------------------------------------------

const SETUPS = [
  { value: 'atwood', label: 'Atwood' },
  { value: 'table', label: 'Table' },
  { value: 'incline', label: 'Incline' },
  { value: 'tackle', label: 'Block & tackle' },
];

const notTackle = (p: SimParams) => str(p, 'setup') !== 'tackle';
const isTackle = (p: SimParams) => str(p, 'setup') === 'tackle';

export const pulleySim: SimDef<PulleyState> = {
  label: 'Pulley systems',
  blurb: 'Atwood, table, incline, block & tackle',
  defaults: {
    setup: 'atwood', m1: 2, m2: 3, M: 1, massive: false, mu: 0.2, angle: 30, g: 9.8,
    load: 40, effort: 120, strands: 4, eff: 100, forces: true, motion: true,
  },
  controls: [
    { key: 'setup', label: 'System', type: 'choice', options: SETUPS },
    { key: 'm1', label: 'Mass m₁', type: 'range', min: 0.5, max: 20, step: 0.5, unit: 'kg', show: notTackle },
    { key: 'm2', label: 'Mass m₂', type: 'range', min: 0.5, max: 20, step: 0.5, unit: 'kg', show: notTackle },
    { key: 'angle', label: 'Slope', type: 'range', min: 5, max: 70, step: 1, unit: '°', show: (p) => str(p, 'setup') === 'incline' },
    { key: 'mu', label: 'Friction μ', type: 'range', min: 0, max: 1, step: 0.05, show: (p) => str(p, 'setup') === 'table' || str(p, 'setup') === 'incline' },
    { key: 'massive', label: 'Pulley has mass', type: 'toggle', show: notTackle },
    { key: 'M', label: 'Pulley mass M', type: 'range', min: 0.5, max: 10, step: 0.5, unit: 'kg', show: (p) => notTackle(p) && bool(p, 'massive') },
    { key: 'strands', label: 'Supporting strands', type: 'range', min: 1, max: 6, step: 1, show: isTackle },
    { key: 'load', label: 'Load', type: 'range', min: 5, max: 200, step: 5, unit: 'kg', show: isTackle },
    { key: 'effort', label: 'Effort', type: 'range', min: 10, max: 1000, step: 10, unit: 'N', show: isTackle },
    { key: 'eff', label: 'Efficiency', type: 'range', min: 40, max: 100, step: 5, unit: '%', show: isTackle },
    { key: 'g', label: 'Gravity g', type: 'range', min: 1.6, max: 25, step: 0.1, unit: 'm/s²' },
    { key: 'forces', label: 'Force arrows', type: 'toggle' },
    { key: 'motion', label: 'Acceleration arrows', type: 'toggle', show: (p) => str(p, 'setup') === 'atwood' },
  ],
  presets: [
    { label: 'Atwood 3 kg / 2 kg', params: { setup: 'atwood', m1: 2, m2: 3, massive: false } },
    { label: 'Heavy pulley', params: { setup: 'atwood', m1: 2, m2: 3, massive: true, M: 4 } },
    { label: 'Table, μ = 0.3', params: { setup: 'table', m1: 4, m2: 2, mu: 0.3 } },
    { label: 'Incline 30°, held by friction', params: { setup: 'incline', m1: 5, m2: 2, angle: 30, mu: 0.25 } },
    { label: 'Single movable pulley', params: { setup: 'tackle', strands: 2, load: 40, effort: 220, eff: 100 } },
    { label: '6-strand tackle, 85% efficient', params: { setup: 'tackle', strands: 6, load: 120, effort: 260, eff: 85 } },
    { label: 'Too little effort', params: { setup: 'tackle', strands: 3, load: 60, effort: 150, eff: 100 } },
  ],
  title: (p) => {
    const s = str(p, 'setup');
    if (s === 'tackle') return `Block & tackle · ${Math.round(num(p, 'strands', 2))} strands`;
    if (s === 'table') return 'Block on a table';
    if (s === 'incline') return 'Block on an incline';
    return 'Atwood machine';
  },
  init: () => ({ t: 0, done: false, x: 0, v: 0, a: 0, stop: '' }),
  step: (p, s, dt) => {
    if (s.done) return;
    if (isTackle(p)) {
      const k = tackle(p);
      const max = tackleGeo(p).maxRise;
      s.a = k.a;
      if (k.a <= 0) {
        s.done = true;
        s.stop = `Too little effort: holding needs ${fmt(k.hold)} N`;
        return;
      }
      s.v += k.a * dt;
      s.x += s.v * dt;
      s.t += dt;
      if (s.x >= max) {
        s.x = max;
        s.done = true;
        s.stop = 'The load reached the top';
      }
      return;
    }
    const lim = geo(p);
    const d = dynamics(p, s.v);
    s.a = d.a;
    if (d.stuck) {
      s.done = true;
      s.v = 0;
      s.stop = 'Friction holds it still';
      return;
    }
    const v0 = s.v;
    s.v += d.a * dt;
    // Friction cannot reverse the motion; it stops it.
    if (v0 !== 0 && Math.sign(s.v) !== Math.sign(v0) && dynamics(p, 0).stuck) {
      s.v = 0;
      s.done = true;
      s.stop = 'Friction stopped it';
      return;
    }
    s.x += s.v * dt;
    s.t += dt;
    if (s.x >= lim.max || s.x <= lim.min) {
      s.x = Math.min(lim.max, Math.max(lim.min, s.x));
      s.done = true;
      s.stop = 'End of the rope travel';
    }
  },
  draw: (ctx, p, s, look) => {
    const setup = str(p, 'setup', 'atwood');
    if (setup === 'tackle') drawTackle(ctx, p, s, look);
    else {
      const d = dynamics(p, s.v);
      if (setup === 'table') drawTable(ctx, p, s, look, d);
      else if (setup === 'incline') drawIncline(ctx, p, s, look, d);
      else drawAtwood(ctx, p, s, look, d);
    }
    // Why it stopped, as a chip in the top corner, clear of the force tags along the floor.
    if (s.stop) {
      ctx.save();
      ctx.font = `600 11px ${SIM_FONT}`;
      const w = ctx.measureText(s.stop).width + 18;
      ctx.beginPath();
      ctx.roundRect(BW - 10 - w, 8, w, 22, 11);
      ctx.fillStyle = look.dark ? '#3a3a3c' : '#f2f2f5';
      ctx.fill();
      ctx.restore();
      text(ctx, s.stop, BW - 19, 19, { size: 11, weight: 600, color: look.muted, align: 'right' });
    }
  },
  readouts: (p, s) => {
    if (isTackle(p)) {
      const k = tackle(p);
      return [
        { label: 'Ideal MA', value: String(k.n) },
        { label: 'Actual MA', value: fmt(k.eta * k.n) },
        { label: 'Effort to hold', value: `${fmt(k.hold)} N` },
        { label: 'Load a', value: `${fmt(k.a)} m/s²`, color: 'violet' },
        { label: 'Raised', value: `${fmt(s.x)} m` },
        { label: 'Rope pulled', value: `${fmt(s.x * k.n)} m` },
      ];
    }
    const d = dynamics(p, s.v);
    const out: Readout[] = [
      { label: 'a', value: `${fmt(Math.abs(d.a))} m/s²`, color: 'violet' },
      { label: bool(p, 'massive') ? 'T₁' : 'T', value: `${fmt(d.t1)} N`, color: 'green' },
    ];
    if (bool(p, 'massive')) out.push({ label: 'T₂', value: `${fmt(d.t2)} N`, color: 'green' });
    if (str(p, 'setup') !== 'atwood') out.push({ label: 'Friction', value: `${fmt(d.f)} N`, color: 'orange' });
    out.push({ label: 'v', value: `${fmt(Math.abs(s.v))} m/s` }, { label: 't', value: `${fmt(s.t)} s` });
    return out;
  },
  formulas: (p) => formulas(p),
  readoutAt: 'left',
};

function formulas(p: SimParams): Formula[] {
  const setup = str(p, 'setup', 'atwood');
  const g = num(p, 'g', 9.8);
  if (setup === 'tackle') {
    const k = tackle(p);
    return [
      { label: 'Mechanical advantage', tex: `\\text{MA} = \\eta n = ${tf(k.eta)} \\times ${k.n} = ${tf(k.eta * k.n)}` },
      { label: 'Effort to hold the load', tex: `F = \\dfrac{mg}{\\eta n} = \\dfrac{${tf(k.m)} \\times ${tf(g)}}{${tf(k.eta * k.n)}} = ${tf(k.hold)}\\ \\text{N}` },
      { label: 'Velocity ratio', tex: `\\text{VR} = \\dfrac{\\text{rope pulled}}{\\text{load raised}} = ${k.n}` },
      {
        label: 'Load acceleration',
        tex: k.a > 0
          ? `a = \\dfrac{\\eta n F - mg}{m} = \\dfrac{${tf(k.lift)} - ${tf(k.w)}}{${tf(k.m)}} = ${tf(k.a)}\\ \\text{m/s}^2`
          : `\\eta n F = ${tf(k.lift)} < mg = ${tf(k.w)}\\ \\Rightarrow\\ \\text{no lift}`,
      },
    ];
  }
  const m1 = num(p, 'm1', 2);
  const m2 = num(p, 'm2', 3);
  const M = bool(p, 'massive') ? num(p, 'M', 1) : 0;
  const d = dynamics(p, 0);
  const den = M ? `m_1 + m_2 + \\tfrac{M}{2}` : 'm_1 + m_2';
  const denN = tf(m1 + m2 + M / 2);
  const mu = num(p, 'mu', 0);
  const th = num(p, 'angle', 30);
  let top: string;
  let topN: string;
  if (setup === 'atwood') {
    top = '(m_2 - m_1)\\,g';
    topN = `(${tf(m2)} - ${tf(m1)}) \\times ${tf(g)}`;
  } else if (setup === 'table') {
    top = 'm_2 g - \\mu m_1 g';
    topN = `${tf(m2 * g)} - ${tf(mu * m1 * g)}`;
  } else {
    top = 'm_2 g - m_1 g\\sin\\theta - \\mu m_1 g\\cos\\theta';
    topN = `${tf(m2 * g)} - ${tf(m1 * g * Math.sin(th * DEG))} - ${tf(mu * m1 * g * Math.cos(th * DEG))}`;
  }
  const out: Formula[] = [];
  if (d.stuck) {
    out.push({ label: 'Friction holds', tex: `|\\text{drive}| \\le \\mu N = ${tf(mu * d.n)}\\ \\text{N} \\Rightarrow a = 0` });
  } else {
    out.push({ label: 'Acceleration', tex: `a = \\dfrac{${top}}{${den}} = \\dfrac{${topN}}{${denN}} = ${tf(d.a)}\\ \\text{m/s}^2` });
  }
  out.push({ label: 'Tension (hanging side)', tex: `T${M ? '_2' : ''} = m_2 (g - a) = ${tf(m2)} \\times (${tf(g)} - ${tf(d.a)}) = ${tf(d.t2)}\\ \\text{N}` });
  if (M) out.push({ label: 'Tension (other side)', tex: `T_1 = T_2 - \\tfrac{M}{2} a = ${tf(d.t1)}\\ \\text{N}` });
  if (setup !== 'atwood') out.push({ label: 'Normal force', tex: `N = ${setup === 'table' ? 'm_1 g' : 'm_1 g\\cos\\theta'} = ${tf(d.n)}\\ \\text{N}` });
  return out;
}
