/**
 * Dynamic geometry: a triangle with draggable vertices and its classic constructions, the circle
 * theorems with points that slide round the circle, and Pythagoras with squares on the sides.
 *
 * Triangle coordinates are in grid units (40 px each, origin bottom-left, y up). Circle points
 * are angles in degrees, measured anticlockwise from the right.
 */

import { BH, BW, bool, fmt, label, line, num, str, tf } from './kit.ts';
import type { Formula, Look, Readout, SimDef, SimParams, SimState } from './kit.ts';

interface GeoState extends SimState {
  /** The moving circle point (t3): the setting, sliding along its arc while playing. */
  p: number;
  dir: number;
}

export interface P2 {
  x: number;
  y: number;
}

const U = 40;
const RAD = Math.PI / 180;
const sub = (p: P2, q: P2): P2 => ({ x: p.x - q.x, y: p.y - q.y });
const add = (p: P2, q: P2): P2 => ({ x: p.x + q.x, y: p.y + q.y });
const mul = (p: P2, k: number): P2 => ({ x: p.x * k, y: p.y * k });
const dot = (p: P2, q: P2) => p.x * q.x + p.y * q.y;
const cross = (p: P2, q: P2) => p.x * q.y - p.y * q.x;
const dist = (p: P2, q: P2) => Math.hypot(p.x - q.x, p.y - q.y);
const mid = (p: P2, q: P2): P2 => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const mod = (x: number, m: number) => ((x % m) + m) % m;
const snapTo = (x: number, u: number) => Number((Math.round(x / u) * u).toFixed(6));

/** The angle at V between rays to P and Q, in degrees (0 to 180). */
export function angleAt(V: P2, P: P2, Q: P2) {
  const u = sub(P, V);
  const w = sub(Q, V);
  return Math.atan2(Math.abs(cross(u, w)), dot(u, w)) / RAD;
}

/** Foot of the perpendicular from P to the line through A and B. */
export function foot(P: P2, A: P2, B: P2): P2 {
  const d = sub(B, A);
  return add(A, mul(d, dot(sub(P, A), d) / dot(d, d)));
}

/** Everything about triangle ABC; side a is opposite A. */
export function solveTriangle(A: P2, B: P2, C: P2) {
  const a = dist(B, C);
  const b = dist(C, A);
  const c = dist(A, B);
  const area = Math.abs(cross(sub(B, A), sub(C, A))) / 2;
  const degenerate = area < 1e-9 * Math.max(1, a * a + b * b + c * c);
  const angA = angleAt(A, B, C);
  const angB = angleAt(B, C, A);
  const angC = angleAt(C, A, B);
  const G = { x: (A.x + B.x + C.x) / 3, y: (A.y + B.y + C.y) / 3 };
  let O: P2 = { x: NaN, y: NaN };
  let H: P2 = { x: NaN, y: NaN };
  let I: P2 = { x: NaN, y: NaN };
  let R = NaN;
  let r = NaN;
  if (!degenerate) {
    const D = 2 * (A.x * (B.y - C.y) + B.x * (C.y - A.y) + C.x * (A.y - B.y));
    const a2 = A.x * A.x + A.y * A.y;
    const b2 = B.x * B.x + B.y * B.y;
    const c2 = C.x * C.x + C.y * C.y;
    O = {
      x: (a2 * (B.y - C.y) + b2 * (C.y - A.y) + c2 * (A.y - B.y)) / D,
      y: (a2 * (C.x - B.x) + b2 * (A.x - C.x) + c2 * (B.x - A.x)) / D,
    };
    // Euler: H = A + B + C − 2O, since OH = 3·OG.
    H = { x: A.x + B.x + C.x - 2 * O.x, y: A.y + B.y + C.y - 2 * O.y };
    const per = a + b + c;
    I = { x: (a * A.x + b * B.x + c * C.x) / per, y: (a * A.y + b * B.y + c * C.y) / per };
    R = (a * b * c) / (4 * area);
    r = area / (per / 2);
  }
  return { a, b, c, area, degenerate, angA, angB, angC, G, O, H, I, R, r };
}

/** The circle theorem angles for these settings (t3 may be the animated value). */
export function circleAngles(p: SimParams, t3 = num(p, 't3', 70)) {
  const setup = str(p, 'setup', 'triangle');
  const t1 = num(p, 't1', 200);
  const t2 = setup === 'semicircle' ? t1 + 180 : num(p, 't2', 340);
  const t4 = num(p, 't4', 130);
  const on = (t: number): P2 => ({ x: Math.cos(t * RAD), y: Math.sin(t * RAD) });
  const A = on(t1);
  const B = on(t2);
  const P = on(t3);
  const Q = on(t4);
  const O = { x: 0, y: 0 };
  // Arc from A anticlockwise to B; the central angle is the arc that does not contain P.
  const s = mod(t2 - t1, 360);
  const pInside = mod(t3 - t1, 360) < s;
  const central = pInside ? 360 - s : s;
  const qSame = (mod(t4 - t1, 360) < s) === pInside;
  return {
    t1, t2, t3, t4, A, B, P, Q, O, central, centralCCW: !pInside,
    atP: angleAt(P, A, B),
    atQ: angleAt(Q, A, B),
    qSame,
    // Cyclic quadrilateral ABCD = t1, t2, t3, t4 in anticlockwise order.
    quad: [angleAt(A, Q, B), angleAt(B, A, P), angleAt(P, B, Q), angleAt(Q, P, A)] as const,
  };
}

// --- drawing helpers -----------------------------------------------------------------------

const px = (q: P2): P2 => ({ x: q.x * U, y: BH - q.y * U });

function dotAt(ctx: CanvasRenderingContext2D, q: P2, r: number, fill: string, stroke: string) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/** The whole line through P with direction d, cut to the box (the caller clips). */
function fullLine(ctx: CanvasRenderingContext2D, P: P2, d: P2, color: string, w: number, dash?: number[]) {
  const len = Math.hypot(d.x, d.y) || 1;
  const k = 2000 / len;
  line(ctx, P.x - d.x * k, P.y - d.y * k, P.x + d.x * k, P.y + d.y * k, color, w, dash);
}

/**
 * An angle mark at V (canvas coordinates): an arc from the ray at `start` through `sweep`
 * radians, a faint sector, and a tag. A right angle gets the square mark.
 */
function angleMark(
  ctx: CanvasRenderingContext2D, V: P2, start: number, sweep: number, r: number, color: string,
  tag: string, look: Look, right = false,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 1.6;
  if (right) {
    const s = Math.min(r * 0.55, 13);
    const u = { x: Math.cos(start), y: Math.sin(start) };
    const w = { x: Math.cos(start + sweep), y: Math.sin(start + sweep) };
    ctx.beginPath();
    ctx.moveTo(V.x + u.x * s, V.y + u.y * s);
    ctx.lineTo(V.x + (u.x + w.x) * s, V.y + (u.y + w.y) * s);
    ctx.lineTo(V.x + w.x * s, V.y + w.y * s);
    ctx.stroke();
    ctx.globalAlpha = look.dark ? 0.3 : 0.16;
    ctx.lineTo(V.x, V.y);
    ctx.lineTo(V.x + u.x * s, V.y + u.y * s);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(V.x, V.y, r, start, start + sweep, sweep < 0);
    ctx.stroke();
    ctx.globalAlpha = look.dark ? 0.3 : 0.16;
    ctx.lineTo(V.x, V.y);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  const am = start + sweep / 2;
  const d = right ? Math.min(r * 0.55, 13) * 1.41 + 14 : r + 15;
  label(ctx, tag, V.x + Math.cos(am) * d, V.y + Math.sin(am) * d, look, { color, size: 11 });
}

/** The interior angle mark at V between P and Q (canvas points). */
function interiorMark(ctx: CanvasRenderingContext2D, V: P2, P: P2, Q: P2, r: number, color: string, tag: string, look: Look, right = false) {
  const u = Math.atan2(P.y - V.y, P.x - V.x);
  const w = Math.atan2(Q.y - V.y, Q.x - V.x);
  let d = mod(w - u + Math.PI, 2 * Math.PI) - Math.PI;
  if (d === -Math.PI) d = Math.PI;
  angleMark(ctx, V, u, d, r, color, tag, look, right);
}

const deg = (v: number) => `${fmt(v, 4)}°`;
const isRight = (v: number) => Math.abs(v - 90) < 1e-7;

// --- triangle ---------------------------------------------------------------------------------

const verts = (p: SimParams): [P2, P2, P2] => [
  { x: num(p, 'ax', 2), y: num(p, 'ay', 1.5) },
  { x: num(p, 'bx', 11), y: num(p, 'by', 1.5) },
  { x: num(p, 'cx', 5), y: num(p, 'cy', 8) },
];

function grid(ctx: CanvasRenderingContext2D, look: Look) {
  ctx.save();
  ctx.strokeStyle = look.cardEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = U; x < BW; x += U) {
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, BH);
  }
  for (let y = BH - U; y > 0; y -= U) {
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(BW, y + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

function drawTriangle(ctx: CanvasRenderingContext2D, p: SimParams, look: Look) {
  if (bool(p, 'grid')) grid(ctx, look);
  const V = verts(p);
  const [A, B, C] = V.map(px);
  const t = solveTriangle(...V);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, BW, BH);
  ctx.clip();

  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  ctx.lineTo(B.x, B.y);
  ctx.lineTo(C.x, C.y);
  ctx.closePath();
  ctx.fillStyle = look.blue;
  ctx.globalAlpha = look.dark ? 0.14 : 0.07;
  ctx.fill();
  ctx.globalAlpha = 1;

  const P = [A, B, C];
  const centres: { q: P2; tag: string; color: string }[] = [];
  if (!t.degenerate) {
    if (bool(p, 'perp')) {
      const O = px(t.O);
      for (let i = 0; i < 3; i++) {
        const S = P[(i + 1) % 3];
        const E = P[(i + 2) % 3];
        const M = mid(S, E);
        fullLine(ctx, M, { x: -(E.y - S.y), y: E.x - S.x }, look.violet, 1.2, [5, 4]);
        // Equal halves.
        for (const h of [mid(S, M), mid(M, E)]) {
          const n = mul({ x: -(E.y - S.y), y: E.x - S.x }, 5 / (dist(S, E) || 1));
          line(ctx, h.x - n.x, h.y - n.y, h.x + n.x, h.y + n.y, look.violet, 1.6);
        }
      }
      ctx.beginPath();
      ctx.arc(O.x, O.y, t.R * U, 0, Math.PI * 2);
      ctx.strokeStyle = look.violet;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      centres.push({ q: O, tag: 'O', color: look.violet });
    }
    if (bool(p, 'bisect')) {
      const I = px(t.I);
      const s = [t.a, t.b, t.c];
      for (let i = 0; i < 3; i++) {
        const S = P[(i + 1) % 3];
        const E = P[(i + 2) % 3];
        // The bisector from vertex i meets the opposite side in the ratio of the other two sides.
        const sS = s[(i + 2) % 3];
        const sE = s[(i + 1) % 3];
        const D = add(mul(S, sE / (sS + sE)), mul(E, sS / (sS + sE)));
        line(ctx, P[i].x, P[i].y, D.x, D.y, look.orange, 1.5);
      }
      ctx.beginPath();
      ctx.arc(I.x, I.y, t.r * U, 0, Math.PI * 2);
      ctx.strokeStyle = look.orange;
      ctx.lineWidth = 1.8;
      ctx.stroke();
      centres.push({ q: I, tag: 'I', color: look.orange });
    }
    if (bool(p, 'altitudes')) {
      const H = px(t.H);
      for (let i = 0; i < 3; i++) {
        const S = P[(i + 1) % 3];
        const E = P[(i + 2) % 3];
        const F = foot(P[i], S, E);
        line(ctx, P[i].x, P[i].y, F.x, F.y, look.red, 1.5);
        // The side extended, when the foot falls outside it (obtuse triangles).
        const u = dot(sub(F, S), sub(E, S)) / dot(sub(E, S), sub(E, S));
        if (u < 0) line(ctx, S.x, S.y, F.x, F.y, look.red, 1, [3, 3]);
        if (u > 1) line(ctx, E.x, E.y, F.x, F.y, look.red, 1, [3, 3]);
        const v = dist(F, P[i]) > 1e-6 ? dot(sub(H, P[i]), sub(F, P[i])) / dot(sub(F, P[i]), sub(F, P[i])) : 0;
        if (v > 1) line(ctx, F.x, F.y, H.x, H.y, look.red, 1, [3, 3]);
        if (v < 0) line(ctx, P[i].x, P[i].y, H.x, H.y, look.red, 1, [3, 3]);
        if (dist(F, P[i]) > 12) {
          const toV = Math.atan2(P[i].y - F.y, P[i].x - F.x);
          const along = u <= 0.5 ? Math.atan2(E.y - S.y, E.x - S.x) : Math.atan2(S.y - E.y, S.x - E.x);
          const sw = mod(toV - along + Math.PI, 2 * Math.PI) - Math.PI;
          const w = 7;
          const a1 = { x: Math.cos(along) * w, y: Math.sin(along) * w };
          const a2 = { x: Math.cos(along + sw) * w, y: Math.sin(along + sw) * w };
          ctx.save();
          ctx.strokeStyle = look.red;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(F.x + a1.x, F.y + a1.y);
          ctx.lineTo(F.x + a1.x + a2.x, F.y + a1.y + a2.y);
          ctx.lineTo(F.x + a2.x, F.y + a2.y);
          ctx.stroke();
          ctx.restore();
        }
      }
      centres.push({ q: H, tag: 'H', color: look.red });
    }
    if (bool(p, 'medians')) {
      const G = px(t.G);
      for (let i = 0; i < 3; i++) {
        const M = mid(P[(i + 1) % 3], P[(i + 2) % 3]);
        line(ctx, P[i].x, P[i].y, M.x, M.y, look.green, 1.5);
        dotAt(ctx, M, 2.6, look.green, look.green);
      }
      centres.push({ q: G, tag: 'G', color: look.green });
    }
    if (bool(p, 'euler') && dist(t.O, t.H) > 1e-6) {
      const O = px(t.O);
      const H = px(t.H);
      fullLine(ctx, O, sub(H, O), look.muted, 1.4, [8, 4, 2, 4]);
      for (const [q, tag, c] of [[O, 'O', look.violet], [H, 'H', look.red], [px(t.G), 'G', look.green]] as const) {
        if (!centres.some((k) => k.tag === tag)) centres.push({ q, tag, color: c });
      }
    }
  }

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(A.x, A.y);
  ctx.lineTo(B.x, B.y);
  ctx.lineTo(C.x, C.y);
  ctx.closePath();
  ctx.strokeStyle = look.blue;
  ctx.lineWidth = 2.6;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();

  // Where each side label goes: outward from the side's midpoint, away from the opposite vertex,
  // and further out when a centre sits on that midpoint (the circumcentre of a right triangle).
  const sideTag = (i: number): P2 => {
    const S = P[(i + 1) % 3];
    const E = P[(i + 2) % 3];
    const M = mid(S, E);
    let n = { x: -(E.y - S.y), y: E.x - S.x };
    if (dot(n, sub(P[i], M)) > 0) n = mul(n, -1);
    n = mul(n, 1 / (Math.hypot(n.x, n.y) || 1));
    const crowded = centres.some((k) => Number.isFinite(k.q.x) && dist(k.q, M) < 10);
    return { x: M.x + n.x * (crowded ? 30 : 14), y: M.y + n.y * (crowded ? 30 : 14) };
  };
  const taken: P2[] = [...P];
  if (!t.degenerate && bool(p, 'sides')) for (let i = 0; i < 3; i++) taken.push(sideTag(i));
  for (const k of centres) {
    if (!Number.isFinite(k.q.x)) continue;
    dotAt(ctx, k.q, 4, look.card, k.color);
    // Up and to the right unless something is there: then the clearest of eight places round it.
    let best = { x: k.q.x + 11, y: k.q.y - 10 };
    let room = Math.min(...taken.map((q) => dist(q, best)));
    if (room < 26) {
      for (let j = 0; j < 8; j++) {
        const a = -Math.PI / 4 + (j * Math.PI) / 4;
        const c = { x: k.q.x + Math.cos(a) * 16, y: k.q.y + Math.sin(a) * 16 };
        const r = Math.min(...taken.map((q) => dist(q, c)));
        if (r > room + 0.5) {
          room = r;
          best = c;
        }
      }
    }
    taken.push(best);
    label(ctx, k.tag, best.x, best.y, look, { color: k.color, size: 11.5 });
  }

  const Gp = px(t.G);
  const angs = [t.angA, t.angB, t.angC];
  const sides = [t.a, t.b, t.c];
  if (!t.degenerate) {
    if (bool(p, 'angles')) {
      for (let i = 0; i < 3; i++) {
        const S = P[(i + 1) % 3];
        const E = P[(i + 2) % 3];
        const r = clamp(Math.min(dist(P[i], S), dist(P[i], E)) * 0.28, 12, 30);
        interiorMark(ctx, P[i], S, E, r, look.muted, deg(angs[i]), look, isRight(angs[i]));
      }
    }
    if (bool(p, 'sides')) {
      for (let i = 0; i < 3; i++) {
        const at = sideTag(i);
        label(ctx, `${'abc'[i]} = ${fmt(sides[i], 4)}`, at.x, at.y, look, { color: look.blue, size: 11.5 });
      }
    }
  } else {
    label(ctx, 'The points are in a line: no triangle', BW / 2, 22, look, { color: look.red, size: 12 });
  }

  const names = ['A', 'B', 'C'];
  for (let i = 0; i < 3; i++) {
    const q = P[i];
    let d = sub(q, Gp);
    const len = Math.hypot(d.x, d.y);
    d = len > 1e-6 ? mul(d, 1 / len) : { x: 0, y: -1 };
    dotAt(ctx, q, 6, look.card, look.blue);
    const tag = bool(p, 'coords') ? `${names[i]}(${fmt(V[i].x)}, ${fmt(V[i].y)})` : names[i];
    const lx = clamp(q.x + d.x * 20, 14, BW - 14);
    const ly = clamp(q.y + d.y * 18, 10, BH - 10);
    const align: CanvasTextAlign = tag.length > 1 ? (lx < 70 ? 'left' : lx > BW - 70 ? 'right' : 'center') : 'center';
    label(ctx, tag, lx, ly, look, { color: look.ink, size: 13, weight: 700, align });
  }
  ctx.restore();
}

// --- circle theorems ----------------------------------------------------------------------------

const OC = { x: BW / 2, y: 194 };
const RC = 140;
const onC = (t: number): P2 => ({ x: OC.x + RC * Math.cos(t * RAD), y: OC.y - RC * Math.sin(t * RAD) });
const isCircle = (p: SimParams) => ['centre', 'semicircle', 'cyclic', 'segment'].includes(str(p, 'setup'));

function pointTag(ctx: CanvasRenderingContext2D, t: number, tag: string, color: string, look: Look) {
  const q = onC(t);
  dotAt(ctx, q, 6, look.card, color);
  label(ctx, tag, OC.x + (RC + 20) * Math.cos(t * RAD), OC.y - (RC + 18) * Math.sin(t * RAD), look, { color: look.ink, size: 13, weight: 700 });
}

function drawCircle(ctx: CanvasRenderingContext2D, p: SimParams, s: GeoState, look: Look) {
  const setup = str(p, 'setup');
  const k = circleAngles(p, s.p);
  ctx.save();
  ctx.beginPath();
  ctx.arc(OC.x, OC.y, RC, 0, Math.PI * 2);
  ctx.strokeStyle = look.muted;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
  const A = onC(k.t1);
  const B = onC(k.t2);
  const P = onC(k.t3);
  const Q = onC(k.t4);
  const seg = (u: P2, w: P2, c: string, wd = 2) => line(ctx, u.x, u.y, w.x, w.y, c, wd);

  if (setup === 'centre') {
    seg(OC, A, look.violet);
    seg(OC, B, look.violet);
    seg(P, A, look.blue);
    seg(P, B, look.blue);
    // Canvas angles run clockwise, so an anticlockwise arc from A to B is a negative sweep.
    const sweep = (k.centralCCW ? -1 : 1) * k.central * RAD;
    angleMark(ctx, OC, -k.t1 * RAD, sweep, 26, look.violet, deg(k.central), look);
    interiorMark(ctx, P, A, B, 30, look.blue, deg(k.atP), look);
    dotAt(ctx, OC, 4, look.violet, look.violet);
    label(ctx, 'O', OC.x + 12 * Math.cos((k.t1 + (k.centralCCW ? 1 : -1) * k.central / 2) * RAD + Math.PI), OC.y - 12 * Math.sin((k.t1 + (k.centralCCW ? 1 : -1) * k.central / 2) * RAD + Math.PI), look, { color: look.ink, size: 12, weight: 700 });
    pointTag(ctx, k.t1, 'A', look.violet, look);
    pointTag(ctx, k.t2, 'B', look.violet, look);
    pointTag(ctx, k.t3, 'P', look.blue, look);
    label(ctx, `∠AOB = ${deg(k.central)} = 2 × ${deg(k.atP)}`, BW / 2, 18, look, { color: look.ink, size: 12.5 });
  } else if (setup === 'semicircle') {
    seg(A, B, look.violet);
    seg(P, A, look.blue);
    seg(P, B, look.blue);
    interiorMark(ctx, P, A, B, 22, look.blue, deg(k.atP), look, Math.abs(k.atP - 90) < 1e-6);
    dotAt(ctx, OC, 4, look.violet, look.violet);
    label(ctx, 'O', OC.x + 12 * Math.cos((k.t3 + 180) * RAD), OC.y - 12 * Math.sin((k.t3 + 180) * RAD) , look, { color: look.ink, size: 12, weight: 700 });
    pointTag(ctx, k.t1, 'A', look.violet, look);
    pointTag(ctx, k.t2, 'B', look.violet, look);
    pointTag(ctx, k.t3, 'P', look.blue, look);
    label(ctx, 'AB is a diameter, so ∠APB = 90°', BW / 2, 18, look, { color: look.ink, size: 12.5 });
  } else if (setup === 'cyclic') {
    const V = [A, B, P, Q];
    ctx.save();
    ctx.beginPath();
    V.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fillStyle = look.blue;
    ctx.globalAlpha = look.dark ? 0.14 : 0.07;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = look.ink;
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
    const cols = [look.red, look.blue, look.red, look.blue];
    V.forEach((q, i) => interiorMark(ctx, q, V[(i + 3) % 4], V[(i + 1) % 4], 24, cols[i], deg(k.quad[i]), look));
    const ts = [k.t1, k.t2, k.t3, k.t4];
    ['A', 'B', 'C', 'D'].forEach((n, i) => pointTag(ctx, ts[i], n, cols[i], look));
    label(ctx, `∠A + ∠C = ${deg(k.quad[0] + k.quad[2])}    ∠B + ∠D = ${deg(k.quad[1] + k.quad[3])}`, BW / 2, 18, look, { color: look.ink, size: 12.5 });
  } else {
    seg(A, B, look.violet);
    seg(P, A, look.blue);
    seg(P, B, look.blue);
    seg(Q, A, look.green);
    seg(Q, B, look.green);
    interiorMark(ctx, P, A, B, 28, look.blue, deg(k.atP), look);
    interiorMark(ctx, Q, A, B, 28, look.green, deg(k.atQ), look);
    pointTag(ctx, k.t1, 'A', look.violet, look);
    pointTag(ctx, k.t2, 'B', look.violet, look);
    pointTag(ctx, k.t3, 'P', look.blue, look);
    pointTag(ctx, k.t4, 'Q', look.green, look);
    label(
      ctx,
      k.qSame ? `Same segment: ∠APB = ∠AQB = ${deg(k.atP)}` : `Opposite segments: ∠APB + ∠AQB = ${deg(k.atP + k.atQ)}`,
      BW / 2, 18, look, { color: look.ink, size: 12.5 },
    );
  }
}

// --- Pythagoras --------------------------------------------------------------------------------

function pythLayout(p: SimParams) {
  const a = num(p, 'la', 3);
  const b = num(p, 'lb', 4);
  // C at the origin, A along x, B along y (units, y up). Squares outward on every side.
  const W = a + 2 * b;
  const H = 2 * a + b;
  const s = Math.min((BW - 40) / W, (BH - 30) / H, 70);
  const ox = (BW - W * s) / 2 + b * s;
  const oy = (BH - H * s) / 2 + (a + b) * s;
  const P = (x: number, y: number): P2 => ({ x: ox + x * s, y: oy - y * s });
  return { a, b, c: Math.hypot(a, b), s, ox, oy, P };
}

function drawPyth(ctx: CanvasRenderingContext2D, p: SimParams, look: Look) {
  const { a, b, c, s, P } = pythLayout(p);
  const C = P(0, 0);
  const A = P(a, 0);
  const B = P(0, b);
  const squares: { pts: P2[]; color: string; tag: string; o: P2; u: P2; v: P2; n: number }[] = [
    { pts: [C, A, P(a, -a), P(0, -a)], color: look.red, tag: `a² = ${fmt(a * a, 4)}`, o: C, u: { x: 1, y: 0 }, v: { x: 0, y: -1 }, n: a },
    { pts: [C, B, P(-b, b), P(-b, 0)], color: look.blue, tag: `b² = ${fmt(b * b, 4)}`, o: C, u: { x: 0, y: 1 }, v: { x: -1, y: 0 }, n: b },
    { pts: [A, B, P(b, a + b), P(a + b, a)], color: look.green, tag: `c² = ${fmt(c * c, 4)}`, o: { x: 0, y: 0 }, u: { x: -a / c, y: b / c }, v: { x: b / c, y: a / c }, n: c },
  ];
  for (const sq of squares) {
    ctx.save();
    ctx.beginPath();
    sq.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.fillStyle = sq.color;
    ctx.globalAlpha = look.dark ? 0.24 : 0.13;
    ctx.fill();
    ctx.globalAlpha = 1;
    if (bool(p, 'units') && s >= 9) {
      // Unit squares, lined up with the square's own sides.
      ctx.save();
      ctx.clip();
      const o = sq.n === c ? A : C;
      const u = sq.n === c ? sq.u : sq.u;
      const v = sq.v;
      ctx.strokeStyle = sq.color;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < sq.n - 1e-9; i++) {
        // Lines across the square at i units along each of its two directions (canvas: y down).
        const pu = { x: o.x + u.x * i * s, y: o.y - u.y * i * s };
        const pv = { x: o.x + v.x * i * s, y: o.y - v.y * i * s };
        ctx.moveTo(pu.x, pu.y);
        ctx.lineTo(pu.x + v.x * sq.n * s, pu.y - v.y * sq.n * s);
        ctx.moveTo(pv.x, pv.y);
        ctx.lineTo(pv.x + u.x * sq.n * s, pv.y - u.y * sq.n * s);
      }
      ctx.stroke();
      ctx.restore();
    }
    ctx.strokeStyle = sq.color;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
    const cx = sq.pts.reduce((m, q) => m + q.x, 0) / 4;
    const cy = sq.pts.reduce((m, q) => m + q.y, 0) / 4;
    label(ctx, sq.tag, cx, cy, look, { color: sq.color, size: 13, weight: 700 });
  }
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(C.x, C.y);
  ctx.lineTo(A.x, A.y);
  ctx.lineTo(B.x, B.y);
  ctx.closePath();
  ctx.fillStyle = look.card;
  ctx.fill();
  ctx.strokeStyle = look.ink;
  ctx.lineWidth = 2.6;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
  angleMark(ctx, C, 0, -Math.PI / 2, 12, look.muted, '', look, true);
  label(ctx, `a = ${fmt(a, 4)}`, (C.x + A.x) / 2, C.y - 11, look, { color: look.red, size: 11.5 });
  label(ctx, `b = ${fmt(b, 4)}`, C.x + 8, (C.y + B.y) / 2, look, { color: look.blue, size: 11.5, align: 'left' });
  const M = mid(A, B);
  label(ctx, `c = ${fmt(c, 4)}`, M.x - 22, M.y - 10, look, { color: look.green, size: 11.5, align: 'right' });
  for (const q of [A, B]) dotAt(ctx, q, 6, look.card, look.ink);
  label(ctx, `${fmt(a * a, 4)} + ${fmt(b * b, 4)} = ${fmt(c * c, 4)}`, BW - 14, BH - 16, look, { color: look.ink, size: 13, weight: 700, align: 'right' });
}

// --- the simulator ---------------------------------------------------------------------------

const isTri = (p: SimParams) => str(p, 'setup', 'triangle') === 'triangle';
const isPyth = (p: SimParams) => str(p, 'setup') === 'pythagoras';

/** The arc P slides along while playing: between its neighbours. */
function pRange(p: SimParams): [number, number] {
  const setup = str(p, 'setup');
  const t1 = num(p, 't1', 200);
  const t2 = setup === 'semicircle' ? t1 + 180 : num(p, 't2', 340);
  const t3 = num(p, 't3', 70);
  const [lo, hi] = setup === 'cyclic' ? [t2, num(p, 't4', 130)] : mod(t3 - t1, 360) < mod(t2 - t1, 360) ? [t1, t2] : [t2, t1];
  const span = mod(hi - lo, 360);
  return [lo + 6, lo + span - 6];
}

function readouts(p: SimParams, s: GeoState): Readout[] {
  if (isPyth(p)) {
    const { a, b, c } = pythLayout(p);
    return [
      { label: 'a', value: fmt(a, 4), color: 'red' },
      { label: 'b', value: fmt(b, 4), color: 'blue' },
      { label: 'c', value: fmt(c, 4), color: 'green' },
      { label: 'a² + b²', value: fmt(a * a + b * b, 5) },
      { label: 'c²', value: fmt(c * c, 5), color: 'green' },
    ];
  }
  if (isCircle(p)) {
    const k = circleAngles(p, s.p);
    switch (str(p, 'setup')) {
      case 'centre':
        return [
          { label: '∠APB', value: deg(k.atP), color: 'blue' },
          { label: '∠AOB', value: deg(k.central), color: 'violet' },
          { label: '∠AOB ÷ ∠APB', value: fmt(k.central / k.atP, 4) },
        ];
      case 'semicircle':
        return [
          { label: '∠APB', value: deg(k.atP), color: 'blue' },
          { label: '∠PAB', value: deg(angleAt(k.A, k.P, k.B)) },
          { label: '∠PBA', value: deg(angleAt(k.B, k.P, k.A)) },
        ];
      case 'cyclic':
        return [
          { label: '∠A', value: deg(k.quad[0]), color: 'red' },
          { label: '∠C', value: deg(k.quad[2]), color: 'red' },
          { label: '∠A + ∠C', value: deg(k.quad[0] + k.quad[2]) },
          { label: '∠B', value: deg(k.quad[1]), color: 'blue' },
          { label: '∠D', value: deg(k.quad[3]), color: 'blue' },
          { label: '∠B + ∠D', value: deg(k.quad[1] + k.quad[3]) },
        ];
      default:
        return [
          { label: '∠APB', value: deg(k.atP), color: 'blue' },
          { label: '∠AQB', value: deg(k.atQ), color: 'green' },
          { label: '∠AOB', value: deg(Math.min(k.central, 360 - k.central)), color: 'violet' },
        ];
    }
  }
  const t = solveTriangle(...verts(p));
  if (t.degenerate) return [{ label: 'Triangle', value: 'the points are in a line', color: 'red' }];
  const max = Math.max(t.angA, t.angB, t.angC);
  const eq = (u: number, w: number) => Math.abs(u - w) < 1e-9;
  const kind = `${eq(t.a, t.b) && eq(t.b, t.c) ? 'equilateral' : eq(t.a, t.b) || eq(t.b, t.c) || eq(t.a, t.c) ? 'isosceles' : 'scalene'}, ${isRight(max) ? 'right' : max > 90 ? 'obtuse' : 'acute'}`;
  return [
    { label: 'Sides a, b, c', value: [t.a, t.b, t.c].map((v) => fmt(v, 4)).join(', '), color: 'blue' },
    { label: 'Angles A, B, C', value: [t.angA, t.angB, t.angC].map(deg).join(', ') },
    { label: 'Sum', value: deg(t.angA + t.angB + t.angC) },
    { label: 'Area', value: fmt(t.area, 4) },
    { label: 'Type', value: kind },
  ];
}

function formulas(p: SimParams): Formula[] {
  if (isPyth(p)) {
    const { a, b, c } = pythLayout(p);
    return [
      { label: "Pythagoras' theorem", tex: `a^2 + b^2 = c^2` },
      { label: 'Squares', tex: `${tf(a, 4)}^2 + ${tf(b, 4)}^2 = ${tf(a * a, 5)} + ${tf(b * b, 5)} = ${tf(c * c, 5)}` },
      { label: 'Hypotenuse', tex: `c = \\sqrt{${tf(c * c, 5)}} = ${tf(c, 5)}` },
      { label: 'Angles', tex: `\\tan A' = \\tfrac{b}{a} \\Rightarrow ${tf(Math.atan2(b, a) / RAD, 4)}^\\circ,\\quad ${tf(Math.atan2(a, b) / RAD, 4)}^\\circ,\\quad 90^\\circ` },
    ];
  }
  if (isCircle(p)) {
    const k = circleAngles(p);
    switch (str(p, 'setup')) {
      case 'centre':
        return [
          { label: 'Angle at the centre', tex: `\\angle AOB = 2\\,\\angle APB` },
          { label: 'Here', tex: `${tf(k.central, 4)}^\\circ = 2 \\times ${tf(k.atP, 4)}^\\circ` },
          { label: 'Why', tex: `\\triangle OAP,\\ \\triangle OBP \\text{ are isosceles } (OA = OB = OP = r)` },
        ];
      case 'semicircle':
        return [
          { label: 'Angle in a semicircle', tex: `\\angle APB = \\tfrac12 \\angle AOB = \\tfrac12 \\times 180^\\circ = 90^\\circ` },
          { label: 'Here', tex: `\\angle PAB + \\angle PBA = ${tf(angleAt(k.A, k.P, k.B), 4)}^\\circ + ${tf(angleAt(k.B, k.P, k.A), 4)}^\\circ = 90^\\circ` },
        ];
      case 'cyclic':
        return [
          { label: 'Cyclic quadrilateral', tex: `\\angle A + \\angle C = \\angle B + \\angle D = 180^\\circ` },
          { label: 'Here', tex: `${tf(k.quad[0], 4)}^\\circ + ${tf(k.quad[2], 4)}^\\circ = ${tf(k.quad[0] + k.quad[2], 4)}^\\circ,\\quad ${tf(k.quad[1], 4)}^\\circ + ${tf(k.quad[3], 4)}^\\circ = ${tf(k.quad[1] + k.quad[3], 4)}^\\circ` },
          { label: 'Why', tex: `\\angle A = \\tfrac12\\,\\text{arc } BCD,\\ \\angle C = \\tfrac12\\,\\text{arc } DAB,\\ \\text{arcs total } 360^\\circ` },
        ];
      default:
        return [
          { label: 'Angles in the same segment', tex: `\\angle APB = \\angle AQB = \\tfrac12 \\angle AOB` },
          {
            label: 'Here',
            tex: k.qSame
              ? `${tf(k.atP, 4)}^\\circ = ${tf(k.atQ, 4)}^\\circ`
              : `\\text{opposite segments: } ${tf(k.atP, 4)}^\\circ + ${tf(k.atQ, 4)}^\\circ = 180^\\circ`,
          },
        ];
    }
  }
  const V = verts(p);
  const t = solveTriangle(...V);
  if (t.degenerate) return [{ label: 'Degenerate', tex: `\\text{A, B and C are collinear: area } = 0` }];
  const pt = (q: P2) => `\\left(${tf(q.x, 4)},\\ ${tf(q.y, 4)}\\right)`;
  const out: Formula[] = [
    { label: 'Angle sum', tex: `${tf(t.angA, 4)}^\\circ + ${tf(t.angB, 4)}^\\circ + ${tf(t.angC, 4)}^\\circ = ${tf(t.angA + t.angB + t.angC, 4)}^\\circ` },
    {
      label: 'Cosine rule',
      tex: `\\cos A = \\dfrac{b^2 + c^2 - a^2}{2bc} = \\dfrac{${tf(t.b * t.b, 4)} + ${tf(t.c * t.c, 4)} - ${tf(t.a * t.a, 4)}}{2 \\times ${tf(t.b, 4)} \\times ${tf(t.c, 4)}} = ${tf(Math.cos(t.angA * RAD), 4)}`,
    },
    { label: 'Sine rule', tex: `\\dfrac{a}{\\sin A} = \\dfrac{b}{\\sin B} = \\dfrac{c}{\\sin C} = 2R = ${tf(2 * t.R, 4)}` },
    { label: 'Area', tex: `\\tfrac12\\,bc\\sin A = \\tfrac12 \\times ${tf(t.b, 4)} \\times ${tf(t.c, 4)} \\times \\sin ${tf(t.angA, 4)}^\\circ = ${tf(t.area, 4)}` },
  ];
  if (bool(p, 'medians')) out.push({ label: 'Centroid', tex: `G = \\left(\\tfrac{x_A+x_B+x_C}{3},\\ \\tfrac{y_A+y_B+y_C}{3}\\right) = ${pt(t.G)},\\quad AG : GM = 2 : 1` });
  if (bool(p, 'altitudes')) out.push({ label: 'Orthocentre', tex: `H = ${pt(t.H)}` });
  if (bool(p, 'perp')) out.push({ label: 'Circumcentre', tex: `O = ${pt(t.O)},\\quad R = \\dfrac{abc}{4\\,\\text{Area}} = ${tf(t.R, 4)}` });
  if (bool(p, 'bisect')) out.push({ label: 'Incentre', tex: `I = \\dfrac{aA + bB + cC}{a + b + c} = ${pt(t.I)},\\quad r = \\dfrac{\\text{Area}}{s} = ${tf(t.r, 4)}` });
  if (bool(p, 'euler')) out.push({ label: 'Euler line', tex: `O,\\ G,\\ H \\text{ collinear},\\quad OH = 3\\,OG = ${tf(3 * dist(t.O, t.G), 4)}` });
  return out;
}

function grab(p: SimParams, s: GeoState, x: number, y: number) {
  const fine = bool(p, 'snap') ? 0.5 : 0.05;
  if (isPyth(p)) {
    const L = pythLayout(p);
    const A = L.P(L.a, 0);
    const B = L.P(0, L.b);
    const step = bool(p, 'snap') ? 0.5 : 0.1;
    if (Math.hypot(x - A.x, y - A.y) <= 14) {
      return { cursor: 'ew-resize', hint: 'Drag to change a', drag: (X: number) => ({ la: clamp(snapTo((X - L.ox) / L.s, step), 0.5, 10) }) };
    }
    if (Math.hypot(x - B.x, y - B.y) <= 14) {
      return { cursor: 'ns-resize', hint: 'Drag to change b', drag: (_X: number, Y: number) => ({ lb: clamp(snapTo((L.oy - Y) / L.s, step), 0.5, 10) }) };
    }
    return null;
  }
  if (isCircle(p)) {
    const setup = str(p, 'setup');
    const k = circleAngles(p, s.p);
    const pts: { key: string; t: number; off: number }[] =
      setup === 'semicircle'
        ? [{ key: 't3', t: k.t3, off: 0 }, { key: 't1', t: k.t1, off: 0 }, { key: 't1', t: k.t2, off: 180 }]
        : [{ key: 't3', t: k.t3, off: 0 }, { key: 't1', t: k.t1, off: 0 }, { key: 't2', t: k.t2, off: 0 }, ...(setup === 'centre' ? [] : [{ key: 't4', t: k.t4, off: 0 }])];
    const hit = pts.find((q) => {
      const c = onC(q.t);
      return Math.hypot(x - c.x, y - c.y) <= 15;
    });
    if (!hit) return null;
    const unit = bool(p, 'snap') ? 1 : 0.1;
    const others = pts.filter((q) => q.key !== hit.key).map((q) => q.t);
    return {
      hint: 'Drag the point round the circle',
      drag: (X: number, Y: number): SimParams => {
        let th = mod(snapTo(Math.atan2(OC.y - Y, X - OC.x) / RAD, unit) - hit.off, 360);
        const own = th + hit.off;
        if (setup === 'cyclic') {
          // Keep ABCD in order round the circle.
          const ts = [k.t1, k.t2, k.t3, k.t4];
          const i = ['t1', 't2', 't3', 't4'].indexOf(hit.key);
          const prev = ts[(i + 3) % 4];
          const span = mod(ts[(i + 1) % 4] - prev, 360);
          const gap = 4;
          let rel = mod(th - prev, 360);
          if (rel < gap || rel > span - gap) {
            const cd = (u: number, w: number) => Math.min(mod(u - w, 360), mod(w - u, 360));
            rel = cd(rel, gap) <= cd(rel, span - gap) ? gap : span - gap;
          }
          th = Number(mod(prev + rel, 360).toFixed(6));
        } else if (others.some((o) => Math.min(mod(own - o, 360), mod(o - own, 360)) < 3)) {
          return {};
        }
        return { [hit.key]: th };
      },
    };
  }
  const V = verts(p);
  const P = V.map(px);
  const keys = [['ax', 'ay'], ['bx', 'by'], ['cx', 'cy']];
  for (let i = 0; i < 3; i++) {
    if (Math.hypot(x - P[i].x, y - P[i].y) <= 14) {
      return {
        hint: `Drag ${'ABC'[i]}`,
        drag: (X: number, Y: number) => ({
          [keys[i][0]]: clamp(snapTo(X / U, fine), 0.25, BW / U - 0.25),
          [keys[i][1]]: clamp(snapTo((BH - Y) / U, fine), 0.25, BH / U - 0.25),
        }),
      };
    }
  }
  // Inside the triangle: move the whole thing.
  const q = { x: x / U, y: (BH - y) / U };
  const s1 = cross(sub(V[1], V[0]), sub(q, V[0]));
  const s2 = cross(sub(V[2], V[1]), sub(q, V[1]));
  const s3 = cross(sub(V[0], V[2]), sub(q, V[2]));
  if ((s1 > 0 && s2 > 0 && s3 > 0) || (s1 < 0 && s2 < 0 && s3 < 0)) {
    const xs = V.map((v) => v.x);
    const ys = V.map((v) => v.y);
    return {
      cursor: 'move',
      hint: 'Drag to move the triangle',
      drag: (X: number, Y: number) => {
        const dx = clamp(snapTo((X - x) / U, fine), 0.25 - Math.min(...xs), BW / U - 0.25 - Math.max(...xs));
        const dy = clamp(snapTo((y - Y) / U, fine), 0.25 - Math.min(...ys), BH / U - 0.25 - Math.max(...ys));
        const out: SimParams = {};
        V.forEach((v, i) => {
          out[keys[i][0]] = Number((v.x + dx).toFixed(6));
          out[keys[i][1]] = Number((v.y + dy).toFixed(6));
        });
        return out;
      },
    };
  }
  return null;
}

export const geometrySim: SimDef<GeoState> = {
  label: 'Dynamic geometry',
  subject: 'Maths',
  display: ['sides', 'angles', 'coords', 'grid', 'medians', 'altitudes', 'perp', 'bisect', 'euler', 'units'],
  keywords: 'geometry triangle angle sum sides centroid median orthocentre altitude circumcentre circumcircle perpendicular bisector incentre incircle angle bisector euler line circle theorem inscribed angle centre semicircle cyclic quadrilateral segment pythagoras hypotenuse squares geogebra',
  blurb: 'Triangle centres, circle theorems and Pythagoras, by hand',
  defaults: {
    setup: 'triangle',
    ax: 2, ay: 1.5, bx: 11, by: 1.5, cx: 5, cy: 8,
    sides: true, angles: true, coords: false, grid: true, snap: true,
    medians: false, altitudes: false, perp: false, bisect: false, euler: false,
    t1: 200, t2: 340, t3: 70, t4: 130,
    la: 3, lb: 4, units: true,
  },
  controls: [
    {
      key: 'setup', label: 'Setup', type: 'choice', options: [
        { value: 'triangle', label: 'Triangle' },
        { value: 'centre', label: 'Angle at the centre' },
        { value: 'semicircle', label: 'Angle in a semicircle' },
        { value: 'cyclic', label: 'Cyclic quadrilateral' },
        { value: 'segment', label: 'Angles in the same segment' },
        { value: 'pythagoras', label: "Pythagoras' theorem" },
      ],
    },
    { key: 'sides', label: 'Side lengths', type: 'toggle', show: isTri },
    { key: 'angles', label: 'Angles', type: 'toggle', show: isTri },
    { key: 'coords', label: 'Coordinates', type: 'toggle', show: isTri },
    { key: 'grid', label: 'Grid', type: 'toggle', show: isTri },
    { key: 'medians', label: 'Medians and centroid', type: 'toggle', show: isTri },
    { key: 'altitudes', label: 'Altitudes and orthocentre', type: 'toggle', show: isTri },
    { key: 'perp', label: 'Perpendicular bisectors and circumcircle', type: 'toggle', show: isTri },
    { key: 'bisect', label: 'Angle bisectors and incircle', type: 'toggle', show: isTri },
    { key: 'euler', label: 'Euler line', type: 'toggle', show: isTri },
    { key: 'snap', label: 'Snap to grid / whole degrees', type: 'toggle' },
    { key: 't1', label: 'A position', type: 'range', min: 0, max: 359, step: 1, unit: '°', show: isCircle },
    { key: 't2', label: 'B position', type: 'range', min: 0, max: 359, step: 1, unit: '°', show: (p) => isCircle(p) && str(p, 'setup') !== 'semicircle' },
    { key: 't3', label: 'P position', type: 'range', min: 0, max: 359, step: 1, unit: '°', show: (p) => isCircle(p) && str(p, 'setup') !== 'cyclic' },
    { key: 'la', label: 'Side a', type: 'range', min: 0.5, max: 10, step: 0.1, show: isPyth },
    { key: 'lb', label: 'Side b', type: 'range', min: 0.5, max: 10, step: 0.1, show: isPyth },
    { key: 'units', label: 'Unit squares', type: 'toggle', show: isPyth },
  ],
  presets: [
    { label: '3-4-5 right triangle', params: { setup: 'triangle', ax: 3, ay: 1.5, bx: 11, by: 1.5, cx: 3, cy: 7.5, medians: false, altitudes: false, perp: true, bisect: false, euler: false } },
    { label: 'All four centres and the Euler line', params: { setup: 'triangle', ax: 2, ay: 1.5, bx: 12, by: 1.5, cx: 4.5, cy: 8.5, medians: true, altitudes: true, perp: true, bisect: true, euler: true } },
    { label: 'Angle at the centre', params: { setup: 'centre', t1: 200, t2: 340, t3: 70 } },
    { label: 'Angle in a semicircle', params: { setup: 'semicircle', t1: 180, t3: 60 } },
    { label: 'Cyclic quadrilateral', params: { setup: 'cyclic', t1: 200, t2: 300, t3: 30, t4: 120 } },
    { label: 'Pythagoras 5-12-13', params: { setup: 'pythagoras', la: 5, lb: 12, units: true } },
  ],
  title: (p) => ({
    triangle: 'Triangle', centre: 'Angle at the centre', semicircle: 'Angle in a semicircle',
    cyclic: 'Cyclic quadrilateral', segment: 'Angles in the same segment', pythagoras: "Pythagoras' theorem",
  })[str(p, 'setup', 'triangle')] ?? 'Dynamic geometry',
  init: (p) => ({ t: 0, done: false, p: num(p, 't3', 70), dir: 1 }),
  step: (p, s, dt) => {
    s.t += dt;
    if (!isCircle(p)) return;
    // Play slides P (or C) along its arc, so the angle can be seen to stay the same.
    const [lo, hi] = pRange(p);
    let rel = mod(s.p - lo, 360);
    if (rel > hi - lo + 1e-9) rel = 0;
    rel += s.dir * 25 * dt;
    if (rel <= 0 || rel >= hi - lo) {
      rel = clamp(rel, 0, hi - lo);
      s.dir *= -1;
    }
    s.p = mod(lo + rel, 360);
  },
  draw: (ctx, p, s, look) => {
    if (isPyth(p)) drawPyth(ctx, p, look);
    else if (isCircle(p)) drawCircle(ctx, p, s, look);
    else drawTriangle(ctx, p, look);
  },
  readouts,
  formulas,
  grab,
};

