/**
 * Checks the grapher and geometry simulators' maths against exact answers.
 * Run: node tests/sim-maths.test.ts   (from apps/web)
 */

import { area, integrate, model, roots } from '../src/sim/grapher.ts';
import { angleAt, circleAngles, foot, solveTriangle } from '../src/sim/geometry.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `-> ${detail}`);
}
const near = (name: string, got: number, want: number, tol = 1e-9) =>
  check(name, Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)), `got ${got}, want ${want}`);

// --- integrals ---------------------------------------------------------------------------
near('∫₀² x² dx = 8/3', area({ fn: 'quadratic', a: 1, b: 1, h: 0, k: 0, x1: 0, x2: 2 }).value, 8 / 3);
near('∫₀^π sin x dx = 2', area({ fn: 'sin', a: 1, b: 1, h: 0, k: 0, x1: 0, x2: Math.PI }).value, 2);
near('∫₀¹ eˣ dx = e − 1', area({ fn: 'exp', a: 1, b: 1, h: 0, k: 0, x1: 0, x2: 1 }).value, Math.E - 1);
near('∫₁^e ln x dx = 1', area({ fn: 'log', a: 1, b: 1, h: 0, k: 0, x1: 1, x2: Math.E }).value, 1);
near('∫₁⁴ 2/x dx = 2 ln 4', area({ fn: 'recip', a: 2, b: 1, h: 0, k: 0, x1: 1, x2: 4 }).value, 2 * Math.log(4));
near('∫₋₂³ |x| dx = 6.5 (corner)', area({ fn: 'abs', a: 1, b: 1, h: 0, k: 0, x1: -2, x2: 3 }).value, 6.5);
near('∫ reversed bounds is negative', area({ fn: 'cubic', a: 1, b: 1, h: 0, k: 0, x1: 2, x2: 0 }).value, -4);
near('∫₋₂₀²⁰ e^(4x) (huge, relative)', integrate((x) => Math.exp(4 * x), -20, 20), (Math.exp(80) - Math.exp(-80)) / 4, 1e-9);
// a·sin(b(x−h)) + k: antiderivative −(a/b)cos(b(x−h)) + kx
{
  const [a, b, h, k, lo, hi] = [2.5, -1.7, 0.3, 1.2, -3, 4.4];
  const F = (x: number) => (-a / b) * Math.cos(b * (x - h)) + k * x;
  near('∫ transformed sine', area({ fn: 'sin', a, b, h, k, x1: lo, x2: hi }).value, F(hi) - F(lo));
}
check('ln across its asymptote has no area', Number.isNaN(area({ fn: 'log', a: 1, b: 1, h: 0, k: 0, x1: -1, x2: 2 }).value));
check('1/x across its asymptote has no area', Number.isNaN(area({ fn: 'recip', a: 1, b: 1, h: 0, k: 0, x1: -1, x2: 2 }).value));

// --- derivatives: exact formula against a central difference -----------------------------
for (const fn of ['linear', 'quadratic', 'cubic', 'sin', 'cos', 'exp', 'log', 'recip', 'abs']) {
  const m = model({ fn, a: -1.3, b: 0.8, h: -0.4, k: 2 });
  let worst = 0;
  for (const x of [-2.9, -1.1, 0.7, 1.9, 3.3]) {
    const y1 = m.y(x + 1e-5);
    const y0 = m.y(x - 1e-5);
    if (!Number.isFinite(y1) || !Number.isFinite(y0)) continue;
    worst = Math.max(worst, Math.abs(m.dy(x) - (y1 - y0) / 2e-5) / Math.max(1, Math.abs(m.dy(x))));
  }
  check(`dy/dx for ${fn}`, worst < 1e-6, `worst relative error ${worst}`);
}

// --- roots ---------------------------------------------------------------------------------
{
  const r = roots(model({ fn: 'quadratic', a: 1, b: 1, h: 1, k: -4 }));
  check('(x−1)² − 4 has roots −1, 3', r !== 'all' && r.length === 2 && Math.abs(r[0] + 1) < 1e-12 && Math.abs(r[1] - 3) < 1e-12, JSON.stringify(r));
  const s = roots(model({ fn: 'sin', a: 1, b: 2, h: 0, k: 0 }), -0.1, Math.PI + 0.1);
  check('sin 2x has 3 roots in [0, π]', s !== 'all' && s.length === 3, JSON.stringify(s));
  const e = roots(model({ fn: 'exp', a: 2, b: 1, h: 0, k: -6 }));
  check('2eˣ − 6 has root ln 3', e !== 'all' && e.length === 1 && Math.abs(e[0] - Math.log(3)) < 1e-12, JSON.stringify(e));
}

// --- triangle centres ------------------------------------------------------------------------
for (const [name, A, B, C] of [
  ['acute', { x: 2, y: 1.5 }, { x: 11, y: 1.5 }, { x: 5, y: 8 }],
  ['obtuse', { x: 1, y: 1 }, { x: 12, y: 2 }, { x: 3, y: 3.5 }],
  ['3-4-5', { x: 3, y: 1.5 }, { x: 11, y: 1.5 }, { x: 3, y: 7.5 }],
] as const) {
  const t = solveTriangle(A, B, C);
  near(`${name}: angle sum 180°`, t.angA + t.angB + t.angC, 180, 1e-12);
  near(`${name}: centroid`, t.G.x, (A.x + B.x + C.x) / 3);
  const dO = [A, B, C].map((P) => Math.hypot(P.x - t.O.x, P.y - t.O.y));
  check(`${name}: O equidistant = R`, dO.every((d) => Math.abs(d - t.R) < 1e-9), dO.join(', '));
  const perp = (P: typeof A, Q: typeof A, S: typeof A) => (t.H.x - P.x) * (S.x - Q.x) + (t.H.y - P.y) * (S.y - Q.y);
  check(`${name}: AH ⊥ BC, BH ⊥ CA`, Math.abs(perp(A, B, C)) < 1e-9 && Math.abs(perp(B, C, A)) < 1e-9);
  const dI = [[B, C], [C, A], [A, B]].map(([P, Q]) => {
    const F = foot(t.I, P, Q);
    return Math.hypot(F.x - t.I.x, F.y - t.I.y);
  });
  check(`${name}: I equidistant from sides = r`, dI.every((d) => Math.abs(d - t.r) < 1e-9), dI.join(', '));
  near(`${name}: OH = 3·OG (Euler)`, Math.hypot(t.H.x - t.O.x, t.H.y - t.O.y), 3 * Math.hypot(t.G.x - t.O.x, t.G.y - t.O.y));
  near(`${name}: sine rule a/sin A = 2R`, t.a / Math.sin((t.angA * Math.PI) / 180), 2 * t.R);
}
near('3-4-5: right angle at A', solveTriangle({ x: 3, y: 1.5 }, { x: 11, y: 1.5 }, { x: 3, y: 7.5 }).angA, 90, 1e-12);
check('collinear points are degenerate', solveTriangle({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }).degenerate);
near('angleAt is 45°', angleAt({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }), 45, 1e-12);

// --- circle theorems -------------------------------------------------------------------------
for (const [t1, t2, t3] of [[200, 340, 70], [10, 100, 250], [300, 20, 160], [0, 200, 100]]) {
  const k = circleAngles({ setup: 'centre', t1, t2, t3 });
  near(`centre ${t1}/${t2}/${t3}: ∠AOB = 2∠APB`, k.central, 2 * k.atP, 1e-9);
}
for (const t3 of [5, 60, 170, 250]) near(`semicircle P at ${t3}°: 90°`, circleAngles({ setup: 'semicircle', t1: 180, t3 }).atP, 90, 1e-9);
{
  const k = circleAngles({ setup: 'cyclic', t1: 200, t2: 300, t3: 30, t4: 120 });
  near('cyclic: A + C = 180°', k.quad[0] + k.quad[2], 180, 1e-9);
  near('cyclic: B + D = 180°', k.quad[1] + k.quad[3], 180, 1e-9);
  const s = circleAngles({ setup: 'segment', t1: 200, t2: 340, t3: 70, t4: 130 });
  check('segment: same side', s.qSame);
  near('segment: ∠APB = ∠AQB', s.atP, s.atQ, 1e-9);
  const o = circleAngles({ setup: 'segment', t1: 200, t2: 340, t3: 70, t4: 280 });
  near('segment: opposite sides sum to 180°', o.atP + o.atQ, 180, 1e-9);
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
if (failures) process.exit(1);
