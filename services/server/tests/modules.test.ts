// Ports of test_keys.py, test_molecule.py and test_recognize.py, plus the jsonfix cases.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repairLatexJson } from '../src/jsonfix.ts';
import { KeyPool, POOL, afterLimit, afterReject } from '../src/keys.ts';
import { compoundName, toDiagram } from '../src/molecule.ts';
import { fixLineBreaks, normalize, parseJson } from '../src/recognize.ts';

const R = String.raw;

// --- test_keys.py ---
test('key pool', () => {
  process.env.GROQ_API_KEY = 'k1';
  process.env.GROQ_API_KEYS = 'k2, k3,k1,,k4';
  const p = new KeyPool();
  assert.deepEqual(p.keys(), ['k2', 'k3', 'k1', 'k4'], 'keys: listed once, extra keys first');
  assert.deepEqual([1, 2, 3, 4, 5].map(() => p.take()), ['k2', 'k3', 'k1', 'k4', 'k2'], 'take: each key in turn');
  p.rest('k3', 30);
  assert.deepEqual([1, 2, 3].map(() => p.take()), ['k1', 'k4', 'k2'], 'rest: a resting key is skipped');
  p.rest('k1', 10);
  p.rest('k4', 20);
  p.rest('k2', 40);
  assert.equal(p.take(), 'k1', 'all resting: the one free soonest');
  const w = p.waitFor('k1');
  assert.ok(w > 9 && w <= 10, `wait_for: seconds left ${w}`);
  const [nxt, wait] = afterLimit('k2', 60);
  assert.ok(nxt !== 'k2' && wait === 0, 'after_limit: moves to a free key with no wait');
  const other = afterReject('k3');
  assert.ok(other !== null && other !== 'k3', 'after_reject: another key to try');
  assert.equal(POOL.usable(), 3, 'usable: rejected key not counted');
  process.env.GROQ_API_KEYS = '';
  process.env.GROQ_API_KEY = '';
  assert.equal(new KeyPool().take(), null, 'no keys: take gives None');
});

// --- test_molecule.py ---
const WATER = {
  id: { id: { cid: 962 } },
  atoms: { aid: [1, 2, 3], element: [8, 1, 1] },
  bonds: { aid1: [1, 1], aid2: [2, 3], order: [1, 1] },
  coords: [{ aid: [1, 2, 3], conformers: [{ x: [2.5369, 3.0739, 2.0], y: [-0.155, 0.155, 0.155] }] }],
};
test('compound names', () => {
  assert.equal(compoundName('structure of benzene'), 'benzene');
  assert.equal(compoundName('draw caffeine'), 'caffeine');
  assert.equal(compoundName('aspirin'), 'aspirin');
  assert.equal(compoundName('an atwood machine with a pulley'), null, 'physics is not looked up');
  assert.equal(compoundName('a ball thrown upward at 20 m/s'), null, 'long sentence is not looked up');
});
test('water as a diagram', () => {
  const d = toDiagram('water', WATER) as any;
  const atoms = d.parts.filter((p: any) => p.type === 'atom');
  const bonds = d.parts.filter((p: any) => p.type === 'bond');
  assert.deepEqual(atoms.map((a: any) => a.el), ['O', 'H', 'H']);
  assert.ok(bonds.length === 2 && bonds.every((b: any) => b.from === 'a1'), 'bonds from oxygen');
  assert.equal(d.title, 'Water (H₂O)', 'Hill formula in title');
  assert.ok(d.kind === 'chemistry' && d.show.forces === false, 'plain figure');
  const [o, h] = [atoms[0].at, atoms[1].at];
  assert.ok(o[1] > h[1], 'y flipped: O below H');
  assert.ok(Math.abs(Math.hypot(o[0] - h[0], o[1] - h[1]) - 1.3) < 0.05, 'bond about 1.3 units');
});

// --- test_recognize.py ---
const LINE_BREAK_CASES: [string, string][] = [
  [R`2x + 5 = 13 \nx =`, R`2x + 5 = 13 \\ x =`],
  ['2x + 5 = 13\nx =', R`2x + 5 = 13 \\ x =`],
  ['a = 1\r\nb = 2', R`a = 1 \\ b = 2`],
  [R`a \neq b`, R`a \neq b`],
  [R`\nabla f, \nu, \ne, \notin A, \neg p, \nleq`, R`\nabla f, \nu, \ne, \notin A, \neg p, \nleq`],
  [R`x \neq 1 \ny = 2`, R`x \neq 1 \\ y = 2`],
  [R`a \\ n = 3`, R`a \\ n = 3`],
  [R`a\\n=3`, R`a\\n=3`],
  [R`\nused`, R`\\ used`],
  [R`\int \tan^4 x \, dx = \ `.trimEnd(), R`\int \tan^4 x \, dx =`],
  [R`x = 4 \\`, 'x = 4'],
  [R`a \, b`, R`a \, b`],
];
const squash = (s: string) => s.split(/\s+/).filter(Boolean).join(' ');
for (const [src, want] of LINE_BREAK_CASES) test(`line breaks: ${src}`, () => assert.equal(squash(fixLineBreaks(src)), squash(want)));
test('normalize and parse', () => {
  const r = normalize({ kind: 'weird', latex: 'x^2', confidence: 7, uncertain: 'x', intent: 'solve' });
  assert.equal(r.kind, 'math', 'bad kind falls back to math');
  assert.equal(r.confidence, 1.0, 'confidence clamped to 1');
  assert.deepEqual(r.uncertain, [], 'non-list uncertain becomes []');
  assert.equal(r.text, '', "missing text becomes ''");
  assert.equal(r.intent, 'solve', 'valid intent kept');
  assert.equal(normalize({ intent: 'dance' }).intent, 'unknown', 'bad intent becomes unknown');
  assert.equal(parseJson('```json\n{"latex": "1+1"}\n```').latex, '1+1', 'code fences stripped');
});

// --- jsonfix (coordinator's cases): each is the inside of a JSON string, decoded after repair ---
const JSONFIX: [string, string][] = [
  [R`\frac{3}{4}`, R`\frac{3}{4}`],
  [R`\\frac{3}{4}`, R`\frac{3}{4}`],
  [R`\beta + \times \theta \right)`, R`\beta + \times \theta \right)`],
  [R`\sqrt{2} \pi \, \{x\}`, R`\sqrt{2} \pi \, \{x\}`],
  [R`x \neq 2`, R`x \neq 2`],
  [R`line1\nline2`, 'line1\nline2'],
  [R`é`, 'é'],
  [R`say \"hi\"`, 'say "hi"'],
  [R`\\\\ break`, R`\\ break`],
];
for (const [inside, want] of JSONFIX) {
  test(`jsonfix: ${inside}`, () => assert.equal(JSON.parse(repairLatexJson(`{"a": "${inside}"}`)).a, want));
}
test('jsonfix: \\r\\n stays a line break', () => assert.equal(JSON.parse(repairLatexJson('{"a": "x\\r\\ny"}')).a, 'x\r\ny'));
