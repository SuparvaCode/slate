/**
 * Checks the diagram solvers against hand-worked answers and the existing pulley presets.
 * Run: node tests/diagram.test.ts   (from apps/web; Node 23.6+ runs TypeScript directly)
 */

import { normalize } from '../src/diagram/normalize.ts';
import { fmtN, layout, solveMech } from '../src/diagram/mech.ts';
import { fmt, solveCircuit } from '../src/diagram/circuit.ts';
import { compile } from '../src/diagram/expr.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `-> ${detail}`);
}
const near = (name: string, got: number | undefined | null, want: number, tol = 0.01) =>
  check(name, got !== undefined && got !== null && Math.abs(got - want) <= tol, `got ${got}, want ${want}`);

function mech(raw: unknown) {
  const { diagram, issues } = normalize(raw);
  const res = solveMech(diagram, layout(diagram));
  return { diagram, issues, res, body: (id: string) => res.bodies.find((b) => b.id === id)! };
}

// --- pulleys --------------------------------------------------------------------

{
  // Atwood 2 kg / 3 kg: a = (m2 − m1) g / (m1 + m2) = 1.96, T = 2 m1 m2 g / (m1 + m2) = 23.52.
  const { issues, res, body } = mech({
    kind: 'mechanics', size: [12, 9],
    parts: [
      { id: 'c', type: 'ceiling', at: [4, 0.5], w: 4 },
      { id: 'p1', type: 'pulley', at: [6, 1.6], r: 0.5 },
      { id: 'm1', type: 'mass', at: [5.5, 6], kg: 2 },
      { id: 'm2', type: 'mass', at: [6.5, 5], kg: 3 },
    ],
    ropes: [{ id: 'r1', path: ['m1', 'p1', 'm2'] }],
  });
  check('atwood: no issues', issues.length === 0, issues.join('; '));
  near('atwood: a of m2 (down)', body('m2').a, 1.96);
  near('atwood: a of m1 (up)', body('m1').a, -1.96);
  near('atwood: tension', res.tension.get('r1'), 23.52);
}

{
  // Block on a table, μ = 0.3: a = (m2 g − μ m1 g) / (m1 + m2) = 1.3067, T = m2 (g − a).
  const { res, body } = mech({
    size: [12, 9],
    parts: [
      { id: 't', type: 'table', at: [1, 4], w: 6, h: 2, mu: 0.3 },
      { id: 'm1', type: 'mass', at: [4, 3], kg: 4, on: 't' },
      { id: 'p1', type: 'pulley', at: [7.4, 3.6], r: 0.4 },
      { id: 'm2', type: 'mass', at: [7.8, 6.5], kg: 2 },
    ],
    ropes: [{ id: 'r1', path: ['m1', 'p1', 'm2'] }],
  });
  near('table: a of block (right)', body('m1').a, 1.3067);
  near('table: a of hanging mass', body('m2').a, 1.3067);
  near('table: tension', res.tension.get('r1'), 2 * (9.8 - 1.3067));
  check('table: sliding, not stuck', !body('m1').stuck);
}

{
  // Incline 30°, μ = 0.25, m1 = 5 kg, m2 = 2 kg: friction holds it, so T = m2 g = 19.6.
  const { res, body } = mech({
    size: [12, 9],
    parts: [
      { id: 's', type: 'incline', at: [1, 7.5], w: 6, angle: 30, mu: 0.25 },
      { id: 'm1', type: 'mass', at: [4, 5.5], kg: 5, on: 's' },
      { id: 'p1', type: 'pulley', at: [7.1, 3.6], r: 0.4 },
      { id: 'm2', type: 'mass', at: [7.5, 6], kg: 2 },
    ],
    ropes: [{ id: 'r1', path: ['m1', 'p1', 'm2'] }],
  });
  check('incline: held by friction', body('m1').stuck && body('m1').a === 0, JSON.stringify(body('m1')));
  near('incline: tension', res.tension.get('r1'), 19.6);
  // Static friction = m1 g sin θ − T = 24.5 − 19.6 = 4.9 N, up the slope.
  near('incline: friction needed', Math.abs(body('m1').friction), 4.9);
}

{
  // The AI's own layout: the hanging mass drawn straight under the pulley's axle, and the pulley
  // then realigned with the slope. The strand must still hang vertically: T = m2 g = 29.4 N.
  const { res, body } = mech({
    kind: 'mechanics', size: [14, 9],
    parts: [
      { id: 'inc', type: 'incline', at: [1, 8], w: 9, angle: 30, mu: 0.2 },
      { id: 'm1', type: 'mass', at: [5, 5.5], kg: 5, on: 'inc' },
      { id: 'pul', type: 'pulley', at: [10, 3.1], r: 0.5, fixed: true },
      { id: 'm2', type: 'mass', at: [10, 6], kg: 3 },
    ],
    ropes: [{ id: 'r1', path: ['m1', 'pul', 'm2'] }],
  });
  check('AI slope layout: held by friction', body('m1').stuck);
  near('AI slope layout: tension is m2 g', res.tension.get('r1'), 29.4);
  near('AI slope layout: friction 4.9 N', Math.abs(body('m1').friction), 4.9);
}

{
  // Built by hand in the studio: the second mass was placed 1.5 units to the side of the wheel.
  // A hanging mass settles straight down, so this is still an Atwood machine.
  const { res, body } = mech({
    size: [14, 9],
    parts: [
      { id: 'p1', type: 'pulley', at: [7, 2], r: 0.5, fixed: true },
      { id: 'm1', type: 'mass', at: [7, 4.5], kg: 2 },
      { id: 'm2', type: 'mass', at: [8.5, 4.5], kg: 3 },
    ],
    ropes: [{ id: 'rope1', path: ['m1', 'p1', 'm2'] }],
  });
  near('hand-built Atwood: m1 rises at 1.96', body('m1').a, -1.96);
  near('hand-built Atwood: m2 falls at 1.96', body('m2').a, 1.96);
  near('hand-built Atwood: tension 23.52 N', res.tension.get('rope1'), 23.52);
}

{
  // Same incline with no friction: a = (m1 g sin θ − m2 g) / (m1 + m2) = 0.7, down the slope.
  const { body } = mech({
    size: [12, 9],
    parts: [
      { id: 's', type: 'incline', at: [1, 7.5], w: 6, angle: 30 },
      { id: 'm1', type: 'mass', at: [4, 5.5], kg: 5, on: 's' },
      { id: 'p1', type: 'pulley', at: [7.1, 3.6], r: 0.4 },
      { id: 'm2', type: 'mass', at: [7.5, 6], kg: 2 },
    ],
    ropes: [{ id: 'r1', path: ['m1', 'p1', 'm2'] }],
  });
  near('frictionless incline: block slides down the slope', body('m1').a, -0.7);
}

function tackle(load: number, effort: number) {
  // One movable pulley: 2 supporting strands. a = (2F − mg) / m.
  return mech({
    size: [12, 10],
    parts: [
      { id: 'c', type: 'ceiling', at: [3, 0.5], w: 6 },
      { id: 'top', type: 'pulley', at: [6.5, 1.6], r: 0.5 },
      { id: 'low', type: 'pulley', at: [5.5, 5], r: 0.5, fixed: false },
      { id: 'load', type: 'mass', at: [5.5, 7], kg: load },
      { id: 'F', type: 'effort', at: [7, 5], N: effort },
      { id: 'f', type: 'floor', at: [2, 9.5], w: 8 },
    ],
    ropes: [
      { id: 'main', path: ['c', 'low', 'top', 'F'] },
      { id: 'hook', path: ['low', 'load'] },
    ],
  });
}
{
  const { res, body } = tackle(40, 220);
  near('movable pulley: load rises at 1.2 m/s²', body('load').a, -1.2);
  near('movable pulley: hook tension 440 N', res.tension.get('hook'), 440);
  near('movable pulley: rope tension is the effort', res.tension.get('main'), 220);
  const weak = tackle(40, 150).body('load');
  near('movable pulley: too little effort, load falls', weak.a, (392 - 300) / 40);
}

{
  // Two masses hanging from one movable pulley would be underdetermined if it had no rope.
  const { res } = mech({
    size: [10, 8],
    parts: [{ id: 'm', type: 'mass', at: [5, 3], kg: 1 }],
    ropes: [],
  });
  near('free fall', res.bodies[0].a, 9.8);
}

// --- circuits ---------------------------------------------------------------------

function circuit(parts: unknown[], wires: [string, string][]) {
  const { diagram, issues } = normalize({ kind: 'circuit', size: [14, 9], parts, wires });
  return { issues, res: solveCircuit(diagram) };
}

{
  const { issues, res } = circuit(
    [
      { id: 'B', type: 'battery', at: [2, 4], V: 12, rot: 90 },
      { id: 'R1', type: 'resistor', at: [5, 2], ohm: 4 },
      { id: 'R2', type: 'resistor', at: [5, 6], ohm: 2 },
      { id: 'A', type: 'ammeter', at: [8, 4], rot: 90 },
      { id: 'V', type: 'voltmeter', at: [5, 0.8] },
    ],
    [['B.+', 'R1.a'], ['R1.b', 'A.a'], ['A.b', 'R2.b'], ['R2.a', 'B.-'], ['V.a', 'R1.a'], ['V.b', 'R1.b']],
  );
  check('series: no issues', issues.length === 0, issues.join('; '));
  near('series: ammeter reads 2 A', Math.abs(res.parts.get('A')!.I), 2);
  near('series: voltmeter across R1 reads 8 V', Math.abs(res.parts.get('V')!.V), 8);
  near('series: R2 power 8 W', res.parts.get('R2')!.P, 8);
}

{
  // 4 Ω in series with (6 Ω ∥ 3 Ω) on 12 V: 2 A total, 4 V across the pair.
  const { res } = circuit(
    [
      { id: 'B', type: 'battery', at: [1, 4], V: 12, rot: 90 },
      { id: 'R1', type: 'resistor', at: [4, 1], ohm: 4 },
      { id: 'J1', type: 'junction', at: [7, 1] },
      { id: 'J2', type: 'junction', at: [7, 7] },
      { id: 'R2', type: 'resistor', at: [7, 4], ohm: 6, rot: 90 },
      { id: 'R3', type: 'resistor', at: [10, 4], ohm: 3, rot: 90 },
    ],
    [['B.+', 'R1.a'], ['R1.b', 'J1'], ['J1', 'R2.a'], ['J1', 'R3.a'], ['R2.b', 'J2'], ['R3.b', 'J2'], ['J2', 'B.-']],
  );
  near('parallel: battery current 2 A', Math.abs(res.parts.get('B')!.I), 2);
  near('parallel: 6 Ω carries 0.667 A', Math.abs(res.parts.get('R2')!.I), 2 / 3);
  near('parallel: 3 Ω carries 1.333 A', Math.abs(res.parts.get('R3')!.I), 4 / 3);
}

{
  // An unbalanced bridge, which series/parallel rules cannot reduce: I through R5 = 1.4286 A.
  const { res } = circuit(
    [
      { id: 'B', type: 'battery', at: [1, 4], V: 10, rot: 90 },
      { id: 'a', type: 'junction', at: [3, 4] },
      { id: 'b', type: 'junction', at: [11, 4] },
      { id: 'c', type: 'junction', at: [7, 2] },
      { id: 'd', type: 'junction', at: [7, 6] },
      { id: 'R1', type: 'resistor', at: [5, 3], ohm: 1 },
      { id: 'R2', type: 'resistor', at: [5, 5], ohm: 2 },
      { id: 'R3', type: 'resistor', at: [9, 3], ohm: 2 },
      { id: 'R4', type: 'resistor', at: [9, 5], ohm: 1 },
      { id: 'R5', type: 'resistor', at: [7, 4], ohm: 1, rot: 90 },
    ],
    [
      ['B.+', 'a'], ['B.-', 'b'], ['a', 'R1.a'], ['R1.b', 'c'], ['a', 'R2.a'], ['R2.b', 'd'],
      ['c', 'R3.a'], ['R3.b', 'b'], ['d', 'R4.a'], ['R4.b', 'b'], ['c', 'R5.a'], ['R5.b', 'd'],
    ],
  );
  near('bridge: R5 current', Math.abs(res.parts.get('R5')!.I), 1.4286);
  near('bridge: total current', Math.abs(res.parts.get('B')!.I), 7.1429);
}

{
  const open = circuit(
    [
      { id: 'B', type: 'battery', at: [2, 4], V: 9 },
      { id: 'S', type: 'switch', at: [5, 2], closed: false },
      { id: 'L', type: 'bulb', at: [8, 4], ohm: 3 },
    ],
    [['B.+', 'S.a'], ['S.b', 'L.a'], ['L.b', 'B.-']],
  ).res;
  near('open switch: no current', open.parts.get('L')!.I, 0, 1e-6);
  const short = circuit([{ id: 'B', type: 'battery', at: [2, 4], V: 9 }], [['B.+', 'B.-']]).res;
  check('short circuit is reported', !short.ok && /short/i.test(short.error ?? ''), JSON.stringify(short));
  const internal = circuit(
    [
      { id: 'B', type: 'battery', at: [2, 4], V: 12, ohm: 1 },
      { id: 'R', type: 'resistor', at: [6, 4], ohm: 5 },
    ],
    [['B.+', 'R.a'], ['R.b', 'B.-']],
  ).res;
  near('internal resistance: terminal voltage 10 V', internal.parts.get('B')!.V, 10);
}

{
  // "Slides from the top": along = 1 puts the block at the top end of the slope.
  const { diagram } = normalize({
    size: [14, 9],
    parts: [
      { id: 's', type: 'incline', at: [2, 8.5], w: 4, angle: 63.43 },
      { id: 'm', type: 'mass', at: [0, 0], kg: 5, on: 's', along: 1 },
    ],
  });
  const lay = layout(diagram);
  const c = lay.pos.get('m')!;
  // The top of this slope is at x = 6, y = 8.5 - 4 tan(63.43°) = 0.5.
  check('along = 1: block near the top of the slope', c[1] < 2.2 && c[0] > 4.4, JSON.stringify(c));
  const bottom = layout(normalize({ ...diagram, parts: diagram.parts.map((p) => (p.id === 'm' ? { ...p, along: 0 } : p)) }).diagram).pos.get('m')!;
  check('along = 0: block at the foot of the slope', bottom[1] > 7.2 && bottom[0] < 3.2, JSON.stringify(bottom));
  near('sliding from the top: a = g sin θ', solveMech(diagram, lay).bodies[0].a, -9.8 * Math.sin(63.43 * Math.PI / 180));
}

{
  // The AI's steep triangle, exactly as it came back: 6 units of base at 63.4° rises 12 units,
  // past a 9-unit frame, the block has no position, and the height mark stops at y = 2.
  const { diagram, issues } = normalize({
    size: [14, 9],
    parts: [{ id: 'inc1', type: 'incline', at: [2, 8], w: 6, angle: 63.43 }, { id: 'm1', type: 'mass', kg: 5, on: 'inc1', along: 1 }],
    marks: [
      { type: 'dim', from: [2, 8], to: [8, 8], text: '12 cm' },
      { type: 'dim', from: [8, 8], to: [8, 2], text: '24 cm' },
    ],
  });
  check('steep triangle: no issues left to report', issues.length === 0, issues.join('; '));
  const inc = diagram.parts.find((p) => p.id === 'inc1')!;
  const top = 8 - inc.w! * Math.tan((63.43 * Math.PI) / 180);
  check('steep triangle: shrunk to fit the frame', top >= 0.25 && inc.w! < 6, `w = ${inc.w}, top y = ${top}`);
  check('steep triangle: the block is kept', diagram.parts.some((p) => p.id === 'm1'));
  const [base, height] = diagram.marks;
  near('steep triangle: base mark ends at the new corner', (base.to as number[])[0], 2 + inc.w!);
  near('steep triangle: height mark reaches the new top', (height.to as number[])[1], top);
  near('steep triangle: height mark stays on the right side', (height.to as number[])[0], 2 + inc.w!);
}

// --- validation and expressions -------------------------------------------------------

{
  const { diagram, issues } = normalize({
    parts: [{ id: 'x', type: 'spaceship', at: [1, 1] }, { id: 'm', type: 'mass', at: [2, 2] }],
    ropes: [{ path: ['m', 'ghost'] }],
    wires: [['m.a', 'nowhere']],
  });
  check('unknown part type is reported', issues.some((i) => i.includes('spaceship')), issues.join('; '));
  check('rope to a missing part is reported and dropped', issues.some((i) => i.includes('ghost')) && diagram.ropes.length === 0);
  check('bad wire is reported', issues.some((i) => i.startsWith('Wire 1')));
  check('kind inferred', diagram.kind === 'mechanics', diagram.kind);
}

near('expr: 2x^2 − 3x + 1 at 2', compile('2x^2 - 3x + 1')(2), 3, 1e-9);
near('expr: y = 3sin x at π/2', compile('y = 3sin x')(Math.PI / 2), 3, 1e-9);
near('expr: x(x+1) at 3', compile('x(x+1)')(3), 12, 1e-9);
near('expr: e^-x at 0', compile('e^-x')(0), 1, 1e-9);
near('expr: sqrt(x)/2 at 16', compile('sqrt(x)/2')(16), 2, 1e-9);
near('expr: -x^2 at 3 is -9', compile('-x^2')(3), -9, 1e-9);

for (const [v, want] of [[220, '220'], [100, '100'], [440, '440'], [29.4, '29.4'], [2.5, '2.5'], [1.96, '1.96'], [10, '10'], [-9.8, '−9.8'], [0.7, '0.7']] as [number, string][]) {
  check(`fmtN(${v}) is ${want}`, fmtN(v) === want, fmtN(v));
  check(`fmt(${v}) is ${want}`, fmt(v) === want, fmt(v));
}

console.log(failures ? `\n${failures} failed` : '\nall passed');
process.exit(failures ? 1 : 0);
