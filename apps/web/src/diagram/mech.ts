/**
 * Mechanics diagrams: where parts sit, how ropes run round pulleys, and a general solver.
 *
 * The solver works for any arrangement of ropes, fixed and movable pulleys, hanging masses,
 * blocks on tables and slopes, and applied pulls. Each body moves along one direction (hanging
 * things straight up and down, blocks along their surface). Each rope adds one equation: its
 * length cannot change, so Σ (∂L/∂q) a = 0; its tension T acts on every body it touches with
 * generalized force −T ∂L/∂q. Newton's law for each body plus one constraint per rope gives a
 * square linear system in the accelerations and tensions. A rope ending in a pull has a known
 * tension instead. Friction is static until the force needed to hold a block exceeds μN.
 *
 * Coordinates are grid units with y down; one unit is one metre for the motion.
 */

import type { Diagram, Part, XY } from './types.ts';

const sub = (a: XY, b: XY): XY => [a[0] - b[0], a[1] - b[1]];
const add = (a: XY, b: XY): XY => [a[0] + b[0], a[1] + b[1]];
const mul = (a: XY, k: number): XY => [a[0] * k, a[1] * k];
const dot = (a: XY, b: XY) => a[0] * b[0] + a[1] * b[1];
const len = (a: XY) => Math.hypot(a[0], a[1]);
const unit = (a: XY): XY => {
  const l = len(a);
  return l > 1e-9 ? [a[0] / l, a[1] / l] : [0, 1];
};
const DEG = Math.PI / 180;

/** Default block size from its mass, so heavier blocks look heavier. */
export const blockSize = (p: Part): XY => {
  const side = Math.min(1.6, Math.max(0.55, 0.45 + 0.13 * Math.sqrt(p.kg ?? 1)));
  return [p.w ?? side, p.h ?? side];
};

/** An incline's geometry: base-left corner, unit vector up the slope, outward normal, slope length. */
export function slope(p: Part) {
  const th = (p.angle ?? 30) * DEG;
  const w = p.w ?? 6;
  return { o: p.at, u: [Math.cos(th), -Math.sin(th)] as XY, n: [-Math.sin(th), -Math.cos(th)] as XY, L: w / Math.cos(th), th, w, hgt: w * Math.tan(th) };
}

export interface Body {
  id: string;
  m: number;
  /** Unit direction of the body's coordinate. */
  u: XY;
  surface?: Part;
  mu: number;
  /** Normal force from the surface, for friction. */
  normal: number;
  /** How far it can travel along +u and −u before it hits something. */
  room: [number, number];
}

export interface Seg {
  a: XY;
  b: XY;
}

export interface Wrap {
  c: XY;
  r: number;
  a0: number;
  a1: number;
  ccw: boolean;
}

export interface RopeGeo {
  id: string;
  segs: Seg[];
  wraps: Wrap[];
  /** Pull applied at the free end, newtons, when the rope ends in an effort. */
  effort?: number;
}

export interface Layout {
  /** Centre of every part after snapping (masses onto surfaces, under pulleys...). */
  pos: Map<string, XY>;
  size: Map<string, XY>;
  ropes: RopeGeo[];
  bodies: Body[];
}

const isHanging = (p: Part, d: Diagram) =>
  p.type === 'mass' && !(p.on && d.parts.some((q) => q.id === p.on && (q.type === 'table' || q.type === 'incline')));

/** Where everything sits. `disp` moves bodies along their direction, for animation. */
export function layout(d: Diagram, disp?: Map<string, number>): Layout {
  const byId = new Map(d.parts.map((p) => [p.id, p]));
  const pos = new Map<string, XY>();
  const size = new Map<string, XY>();
  for (const p of d.parts) {
    pos.set(p.id, [...p.at] as XY);
    if (p.type === 'mass') size.set(p.id, blockSize(p));
  }

  // Blocks sit on their table or slope.
  for (const p of d.parts) {
    if (p.type !== 'mass' || !p.on) continue;
    const s = byId.get(p.on)!;
    const [w, h] = size.get(p.id)!;
    if (s.type === 'table') {
      const x0 = s.at[0];
      const W = s.w ?? 6;
      const x = p.along !== undefined
        ? x0 + w / 2 + p.along * Math.max(0, W - w)
        : Math.min(x0 + W - w / 2, Math.max(x0 + w / 2, p.at[0]));
      pos.set(p.id, [x, s.at[1] - h / 2]);
    } else if (s.type === 'incline') {
      const g = slope(s);
      // "along" puts it at the bottom (0) or top (1), leaving room for a pulley at the top.
      const along = p.along !== undefined
        ? w / 2 + p.along * Math.max(0, g.L - w - 0.25)
        : Math.min(g.L - w / 2, Math.max(w / 2, dot(sub(p.at, g.o), g.u)));
      pos.set(p.id, add(add(g.o, mul(g.u, along)), mul(g.n, h / 2)));
    }
  }

  // A pulley next to a block on a surface lines its top up with the rope from the block.
  for (const r of d.ropes) {
    for (let i = 0; i < r.path.length - 1; i++) {
      for (const [ai, bi] of [[i, i + 1], [i + 1, i]]) {
        const blk = byId.get(r.path[ai])!;
        const pul = byId.get(r.path[bi])!;
        if (blk.type !== 'mass' || !blk.on || pul.type !== 'pulley' || !pul.fixed) continue;
        const s = byId.get(blk.on)!;
        const c = pos.get(blk.id)!;
        const pr = pul.r ?? 0.5;
        const pc = pos.get(pul.id)!;
        const u: XY = s.type === 'incline' ? slope(s).u : [1, 0];
        const nrm: XY = s.type === 'incline' ? slope(s).n : [0, -1];
        // Point on the rope's line nearest the pulley, then down by the radius.
        const foot = add(c, mul(u, dot(sub(pc, c), u)));
        if (len(sub(foot, pc)) < pr + 1.2) pos.set(pul.id, sub(foot, mul(nrm, pr)));
      }
    }
  }

  // A mass (or a pull) hanging just below a pulley drops straight from the side of the wheel.
  for (const r of d.ropes) {
    for (let i = 0; i < r.path.length; i++) {
      const m = byId.get(r.path[i])!;
      if (!(isHanging(m, d) || m.type === 'effort') || (i !== 0 && i !== r.path.length - 1)) continue;
      const ni = i === 0 ? 1 : i - 1;
      const nb = byId.get(r.path[ni])!;
      // Only when the rope wraps the wheel; a rope tied to the axle hangs from the centre.
      if (nb.type !== 'pulley' || ni === 0 || ni === r.path.length - 1) continue;
      const pc = pos.get(nb.id)!;
      const mc = pos.get(m.id)!;
      const pr = nb.r ?? 0.5;
      // A hanging mass always settles with its strand straight down, wherever it was drawn. A pull
      // only snaps when it is close, since one placed off to the side may be meant to pull at a slant.
      if (mc[1] > pc[1] && (m.type === 'mass' || Math.abs(mc[0] - pc[0]) <= pr + 0.8)) {
        // The strand drops on the side away from the rope's other strand, whatever side the mass
        // was drawn on: a pulley realigned with a slope can move past a mass placed under its axle.
        const other = r.path[i === 0 ? 2 : i - 2];
        const dx = other ? pos.get(other)![0] - pc[0] : 0;
        let side: number;
        if (Math.abs(dx) > pr * 0.6) side = dx > 0 ? -1 : 1;
        else if (Math.abs(mc[0] - pc[0]) > 1e-6) side = Math.sign(mc[0] - pc[0]);
        else side = i === 0 ? -1 : 1;
        mc[0] = pc[0] + side * pr;
      }
    }
  }

  // Bodies and their directions.
  const bodies: Body[] = [];
  const g = d.g;
  for (const p of d.parts) {
    if (p.type === 'mass') {
      const s = p.on ? byId.get(p.on) : undefined;
      const m = p.kg ?? 1;
      if (s?.type === 'table') bodies.push({ id: p.id, m, u: [1, 0], surface: s, mu: s.mu ?? 0, normal: m * g, room: [0, 0] });
      else if (s?.type === 'incline') {
        const sl = slope(s);
        bodies.push({ id: p.id, m, u: sl.u, surface: s, mu: s.mu ?? 0, normal: m * g * Math.cos(sl.th), room: [0, 0] });
      } else bodies.push({ id: p.id, m, u: [0, 1], mu: 0, normal: 0, room: [0, 0] });
    } else if (p.type === 'pulley' && p.fixed === false) {
      bodies.push({ id: p.id, m: p.kg ?? 0, u: [0, 1], mu: 0, normal: 0, room: [0, 0] });
    }
  }

  if (disp) {
    for (const b of bodies) {
      const q = disp.get(b.id);
      if (q) pos.set(b.id, add(pos.get(b.id)!, mul(b.u, q)));
    }
  }

  const ropes = d.ropes.map((r) => ropeGeo(r.id, r.path, byId, pos, size));
  for (const b of bodies) b.room = room(b, d, byId, pos, size);
  return { pos, size, ropes, bodies };
}

/** Free travel along +u and −u. */
function room(b: Body, d: Diagram, byId: Map<string, Part>, pos: Map<string, XY>, size: Map<string, XY>): [number, number] {
  const c = pos.get(b.id)!;
  const p = byId.get(b.id)!;
  const [w, h] = p.type === 'mass' ? size.get(b.id)! : [2 * (p.r ?? 0.5), 2 * (p.r ?? 0.5)];
  if (b.surface?.type === 'table') {
    const x0 = b.surface.at[0];
    return [Math.max(0, x0 + (b.surface.w ?? 6) - (c[0] + w / 2)), Math.max(0, c[0] - w / 2 - x0)];
  }
  if (b.surface?.type === 'incline') {
    const g = slope(b.surface);
    const along = dot(sub(c, g.o), g.u);
    // Up the slope it stops short of the pulley at the top.
    return [Math.max(0, g.L - along - w / 2 - 0.15), Math.max(0, along - w / 2)];
  }
  // Hanging: down to the floor or the frame, up to the nearest thing above.
  let floorY = d.size[1];
  let ceilY = -Infinity;
  for (const q of d.parts) {
    const qc = pos.get(q.id)!;
    if (q.type === 'floor' && qc[1] > c[1] && c[0] >= qc[0] - 0.2 && c[0] <= qc[0] + (q.w ?? 4) + 0.2) floorY = Math.min(floorY, qc[1]);
    if (q.id === b.id) continue;
    if (q.type === 'pulley' && qc[1] < c[1] && Math.abs(qc[0] - c[0]) < w / 2 + (q.r ?? 0.5) + 0.05) ceilY = Math.max(ceilY, qc[1] + (q.r ?? 0.5));
    if (q.type === 'ceiling' && qc[1] < c[1]) ceilY = Math.max(ceilY, qc[1]);
  }
  if (ceilY === -Infinity) ceilY = 0;
  return [Math.max(0, floorY - (c[1] + h / 2) - 0.02), Math.max(0, c[1] - h / 2 - ceilY - 0.1)];
}

interface Node {
  c: XY;
  rho: number;
  part: Part;
}

/** The rope's straight runs (exact tangents) and the arcs where it wraps round wheels. */
function ropeGeo(
  id: string, path: string[], byId: Map<string, Part>, pos: Map<string, XY>, size: Map<string, XY>,
): RopeGeo {
  const parts = path.map((p) => byId.get(p)!);
  const centre = (i: number) => pos.get(parts[i].id)!;
  const last = parts.length - 1;

  // Which way the rope turns round each pulley, from where its neighbours roughly are. A rope
  // tied to a ceiling or floor meets it straight above or below the next part; a wall, level with it.
  const rough = parts.map((p, i) => {
    const c = centre(i);
    if (i !== 0 && i !== last) return c;
    const nb = centre(i === 0 ? 1 : last - 1);
    if (p.type === 'ceiling' || p.type === 'floor') return [nb[0], c[1]] as XY;
    if (p.type === 'wall') return [c[0], nb[1]] as XY;
    return c;
  });
  const sigma = parts.map((p, i) => {
    if (p.type !== 'pulley' || i === 0 || i === last) return 0;
    const a = rough[i - 1];
    const c = rough[i];
    const b = rough[i + 1];
    const cross = (c[0] - a[0]) * (b[1] - c[1]) - (c[1] - a[1]) * (b[0] - c[0]);
    if (Math.abs(cross) > 1e-6) return Math.sign(cross);
    // Straight through: a rope going down then up (or up then down) wraps the usual way.
    return 1;
  });

  const nodes: Node[] = parts.map((p, i) => ({ c: centre(i), rho: sigma[i] * (p.type === 'pulley' ? (p.r ?? 0.5) : 0), part: p }));

  // Rope ends: where on the part the rope is tied.
  const endPoint = (i: number, j: number): XY => {
    const p = parts[i];
    const c = centre(i);
    const nb = nodes[j];
    // A ceiling or floor rope meets it straight above or below the wheel's edge.
    const vertical = (down: boolean): XY => {
      // Travel from this end towards the neighbour (or from it, at the far end).
      const travelDown = i === 0 ? down : !down;
      const nx = travelDown ? 1 : -1;
      return [nb.c[0] + nb.rho * nx, c[1]];
    };
    switch (p.type) {
      case 'ceiling':
        return vertical(true);
      case 'floor':
        return vertical(false);
      case 'wall': {
        const right = nb.c[0] > c[0];
        const travelRight = i === 0 ? right : !right;
        return [c[0], nb.c[1] + nb.rho * (travelRight ? -1 : 1)];
      }
      case 'mass': {
        const [w, h] = size.get(p.id)!;
        const s = p.on ? byId.get(p.on) : undefined;
        if (s?.type === 'table' || s?.type === 'incline') {
          const u: XY = s.type === 'incline' ? slope(s).u : [1, 0];
          const toward = dot(sub(nb.c, c), u) >= 0 ? 1 : -1;
          return add(c, mul(u, (toward * w) / 2));
        }
        const dv = sub(nb.c, c);
        if (Math.abs(dv[0]) > Math.abs(dv[1]) * 1.5) return [c[0] + (Math.sign(dv[0]) * w) / 2, c[1]];
        return [c[0], c[1] + (dv[1] < 0 ? -h / 2 : h / 2)];
      }
      default:
        return c;
    }
  };
  if (last >= 1) {
    if (parts[0].type !== 'pulley') nodes[0] = { ...nodes[0], c: endPoint(0, 1) };
    if (parts[last].type !== 'pulley') nodes[last] = { ...nodes[last], c: endPoint(last, last - 1) };
  }

  const segs: Seg[] = [];
  for (let i = 0; i < last; i++) {
    const A = nodes[i];
    const B = nodes[i + 1];
    const dv = sub(B.c, A.c);
    const D = len(dv);
    const dh = unit(dv);
    const p: XY = [dh[1], -dh[0]];
    const a = D > 1e-9 ? Math.max(-1, Math.min(1, (A.rho - B.rho) / D)) : 0;
    const n = add(mul(dh, a), mul(p, Math.sqrt(1 - a * a)));
    segs.push({ a: add(A.c, mul(n, A.rho)), b: add(B.c, mul(n, B.rho)) });
  }

  const wraps: Wrap[] = [];
  for (let i = 1; i < last; i++) {
    const nd = nodes[i];
    if (nd.part.type !== 'pulley') continue;
    const tin = segs[i - 1].b;
    const tout = segs[i].a;
    wraps.push({
      c: nd.c, r: Math.abs(nd.rho), ccw: sigma[i] < 0,
      a0: Math.atan2(tin[1] - nd.c[1], tin[0] - nd.c[0]),
      a1: Math.atan2(tout[1] - nd.c[1], tout[0] - nd.c[0]),
    });
  }

  const effortEnd = [parts[0], parts[last]].find((p) => p.type === 'effort');
  return { id, segs, wraps, effort: effortEnd ? (effortEnd.N ?? 100) : undefined };
}

// --- solver ------------------------------------------------------------------------

export interface MechResult {
  ok: boolean;
  error?: string;
  bodies: { id: string; a: number; u: XY; m: number; friction: number; stuck: boolean; room: [number, number] }[];
  /** Tension of each rope; null when the rope is slack or does not fix anything. */
  tension: Map<string, number | null>;
  /** One-line summaries for the panel and the AI check. */
  facts: string[];
}

/** Gaussian elimination with partial pivoting. Null when singular. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-10) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/** ∂L/∂q for each body: how fast the rope lengthens when the body moves along u. */
function jacobian(d: Diagram, lay: Layout): number[][] {
  const index = new Map(lay.bodies.map((b, i) => [b.id, i]));
  return d.ropes.map((r, ri) => {
    const row = new Array(lay.bodies.length).fill(0);
    const geo = lay.ropes[ri];
    geo.segs.forEach((s, k) => {
      const e = unit(sub(s.b, s.a));
      const ia = index.get(r.path[k]);
      const ib = index.get(r.path[k + 1]);
      if (ia !== undefined) row[ia] -= dot(e, lay.bodies[ia].u);
      if (ib !== undefined) row[ib] += dot(e, lay.bodies[ib].u);
    });
    return row.map((v) => (Math.abs(v) < 1e-9 ? 0 : v));
  });
}

export function solveMech(d: Diagram, lay: Layout = layout(d)): MechResult {
  const B = lay.bodies;
  const nb = B.length;
  const J = jacobian(d, lay);
  const tension = new Map<string, number | null>();
  const g = d.g;

  // Ropes that end in a pull have a known tension; ropes that touch no moving body fix nothing.
  const known: (number | null)[] = lay.ropes.map((r) => r.effort ?? null);
  const live = d.ropes.map((_, i) => known[i] === null && J[i].some((v) => v !== 0));

  const gravity = B.map((b) => b.m * g * b.u[1]);
  const pulls = B.map((_, i) => d.ropes.reduce((acc, _r, ri) => acc - (known[ri] !== null ? J[ri][i] * known[ri]! : 0), 0));

  /** Solves with some blocks held by static friction and the rest given a kinetic friction force. */
  const attempt = (stuck: Set<number>, kinetic: number[]) => {
    const ropeIdx = d.ropes.map((_, i) => i).filter((i) => live[i]);
    const stuckIdx = [...stuck];
    const nU = nb + ropeIdx.length + stuckIdx.length;
    const A = Array.from({ length: nU }, () => new Array(nU).fill(0));
    const rhs = new Array(nU).fill(0);
    for (let i = 0; i < nb; i++) {
      A[i][i] = B[i].m;
      ropeIdx.forEach((ri, k) => (A[i][nb + k] = J[ri][i]));
      rhs[i] = gravity[i] + pulls[i] + kinetic[i];
    }
    ropeIdx.forEach((ri, k) => {
      for (let i = 0; i < nb; i++) A[nb + k][i] = J[ri][i];
    });
    stuckIdx.forEach((bi, k) => {
      const col = nb + ropeIdx.length + k;
      A[bi][col] = -1; // the static friction force on this block
      A[col][bi] = 1; // and it does not move
    });
    const x = solveLinear(A, rhs);
    if (!x) return null;
    const fs = new Map(stuckIdx.map((bi, k) => [bi, x[nb + ropeIdx.length + k]]));
    return { a: x.slice(0, nb), T: new Map(ropeIdx.map((ri, k) => [ri, x[nb + k]])), fs };
  };

  const frictional = B.map((b, i) => (b.mu > 0 && b.normal > 0 ? i : -1)).filter((i) => i >= 0);
  let stuck = new Set(frictional);
  const kinetic = new Array(nb).fill(0);
  let sol = attempt(stuck, kinetic);
  for (let iter = 0; sol && iter < 6; iter++) {
    let changed = false;
    for (const [bi, f] of sol.fs) {
      const max = B[bi].mu * B[bi].normal;
      if (Math.abs(f) > max + 1e-9) {
        stuck = new Set([...stuck].filter((s) => s !== bi));
        // It slides the way it was being pushed; kinetic friction keeps the side static friction was on.
        kinetic[bi] = Math.sign(f) * max;
        changed = true;
      }
    }
    if (!changed) break;
    sol = attempt(stuck, kinetic);
  }

  if (!sol) {
    return {
      ok: false,
      error: 'These ropes and pulleys cannot be solved: something is free with no mass, or a rope is tied in a loop.',
      bodies: B.map((b) => ({ id: b.id, a: 0, u: b.u, m: b.m, friction: 0, stuck: false, room: b.room })), tension, facts: [],
    };
  }

  d.ropes.forEach((r, i) => {
    if (known[i] !== null) tension.set(r.id, known[i]);
    else if (live[i]) tension.set(r.id, sol.T.get(i)!);
    else tension.set(r.id, null);
  });

  // A rope can only pull. A negative tension means it would go slack; report it plainly.
  const slack = d.ropes.filter((r) => (tension.get(r.id) ?? 0) < -1e-6).map((r) => r.id);

  const bodies = B.map((b, i) => ({
    id: b.id, a: Math.abs(sol.a[i]) < 1e-9 ? 0 : sol.a[i], u: b.u, m: b.m,
    friction: stuck.has(i) ? sol.fs.get(i)! : kinetic[i], stuck: stuck.has(i), room: b.room,
  }));

  const facts: string[] = [];
  const byId = new Map(d.parts.map((p) => [p.id, p]));
  for (const b of bodies) {
    const p = byId.get(b.id)!;
    const name = p.label || b.id;
    if (b.m === 0 && p.type === 'pulley') continue;
    if (b.stuck) facts.push(`${name}: held still by friction (${fmtN(Math.abs(b.friction))} N of ${fmtN(B[bodies.indexOf(b)].mu * B[bodies.indexOf(b)].normal)} N available)`);
    else facts.push(`${name}: a = ${fmtN(Math.abs(b.a))} m/s²${b.a === 0 ? '' : ` ${direction(b.u, Math.sign(b.a))}`}`);
  }
  for (const r of d.ropes) {
    const t = tension.get(r.id);
    if (t !== null && t !== undefined) facts.push(`${r.id}: T = ${fmtN(t)} N`);
  }
  if (slack.length) facts.push(`Slack: ${slack.join(', ')} would need to push, so it goes slack.`);
  return { ok: true, bodies, tension, facts };
}

/** "down", "up", "to the right", "up the slope"... */
export function direction(u: XY, sign: number): string {
  const v = mul(u, sign);
  if (Math.abs(v[0]) < 1e-6) return v[1] > 0 ? 'down' : 'up';
  if (Math.abs(v[1]) < 1e-6) return v[0] > 0 ? 'to the right' : 'to the left';
  return v[1] < 0 ? 'up the slope' : 'down the slope';
}

export function fmtN(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : v.toFixed(3);
  return (s.includes('.') ? s.replace(/\.?0+$/, '') : s).replace(/^-/, '−');
}

// --- motion ------------------------------------------------------------------------

/** Displacements at time t from rest, and whether the motion has run out of room. */
export function motionAt(res: MechResult, t: number): { disp: Map<string, number>; done: boolean; t: number } {
  let tEnd = 8;
  for (const b of res.bodies) {
    if (b.a === 0) continue;
    const roomAhead = b.a > 0 ? b.room[0] : b.room[1];
    tEnd = Math.min(tEnd, Math.sqrt((2 * roomAhead) / Math.abs(b.a)));
  }
  const tc = Math.min(t, tEnd);
  const disp = new Map(res.bodies.map((b) => [b.id, 0.5 * b.a * tc * tc]));
  return { disp, done: t >= tEnd, t: tc };
}
