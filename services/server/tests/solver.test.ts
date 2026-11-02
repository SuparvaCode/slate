// Ports of services/api/tests/test_solver.py, test_fallback.py and test_live_strings.py.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { exprFromLatex, questionUnknown, trimChain } from '../src/answers.ts';
import { calculator } from '../src/calc.ts';
after(() => calculator.close());
import { SolveError } from '../src/errors.ts';
import { continuation, dropRestated, hooks, solve, verifyAnswer } from '../src/solver.ts';
import type { Turn } from '../src/solver-stream.ts';

const R = String.raw;

// --- test_solver.py ---
const STEP_CASES: [string, string[], string[]][] = [
  ['x^2 - 5x + 6 = 0', ['x^2 - 5x + 6 = 0', '(x-2)(x-3) = 0', R`x = 2 \text{ or } x = 3`], ['(x-2)(x-3) = 0', R`x = 2 \text{ or } x = 3`]],
  ['x^2 - 5x + 6 = 0', ['x^{2} - 5x + 6 = 0', 'x = 2, 3'], ['x = 2, 3']],
  ['7 + 8 =', ['7 + 8 = 15'], ['7 + 8 = 15']],
  ['2x + 5 = 13', ['2x = 13 - 5', 'x = 4'], ['2x = 13 - 5', 'x = 4']],
  ['x =', [], []],
];
const CASES: [string, string, string][] = [
  [R`\tan^x =`, R`\tan^{x} = (e^{\ln\tan x})^{x} = e^{\,x\ln\tan x}`, R`e^{\,x\ln\tan x}`],
  ['7 + 8 =', '7 + 8 = 15', '15'],
  ['7 + 8 =', 'x = 15', '15'],
  ['7 + 8 =', '15', '15'],
  [R`\int \sin^4 x \, dx =`, R`\frac{3x}{8} - \frac{\sin 2x}{4} + \frac{\sin 4x}{32} + C`, R`\frac{3x}{8} - \frac{\sin 2x}{4} + \frac{\sin 4x}{32} + C`],
  ['x^2 - 5x + 6 = 0', 'x = 2, 3', 'x = 2, 3'],
  ['F = ?', R`6 \, \text{N}`, R`6 \, \text{N}`],
  ['x^2 = 4, x =', 'x = 2, x = -2', 'x = 2, x = -2'],
  ['x =', R`2 \quad \text{or} \quad x = -2`, R`2 \quad \text{or} \quad x = -2`],
  ['f(x) =', R`\begin{cases} 1 & x = 0 \end{cases}`, R`\begin{cases} 1 & x = 0 \end{cases}`],
  ['2 + 2 =', '2 + 2 =', '2 + 2 ='],
];
for (const [written, answer, want] of CASES) test(`continuation ${written} + ${answer}`, () => assert.equal(continuation(written, answer), want));
for (const [written, steps, want] of STEP_CASES) test(`steps for ${written}`, () => assert.deepEqual(dropRestated(written, steps), want));

// --- test_fallback.py: the model is replaced by scripted turns ---
const READ = { kind: 'math', latex: R`\int \tan^4 x \, dx =`, intent: 'solve', uncertain: [] };
const CALC: Turn = { type: 'turn', content: '', finish: 'tool_calls', calls: [{ id: 'c1', name: 'calc', args: '{"op": "integrate", "expr": "tan(x)**4", "var": "x"}' }] };

async function runScripted(turns: (Turn | Error)[]) {
  process.env.GROQ_API_KEY ||= 'test';
  let i = 0;
  hooks.turn = async function* () {
    const item = turns[i++];
    if (item instanceof Error) throw item;
    yield item;
  };
  const out = [];
  for await (const ev of solve(READ, 'answer')) if (ev.type === 'answer') out.push(ev);
  return out;
}

test('rate limit after calc gives the calculator answer', async () => {
  const out = await runScripted([CALC, new SolveError("Groq's free-tier limit was reached.")]);
  assert.equal(out.length, 1);
  const a = String(out[0].answer_latex);
  assert.ok(a.includes('tan') && a.includes('+ C') && !a.includes('frac{1}{4}'), `it is the calculator's integral: ${a}`);
  assert.equal(out[0].verification, 'computed');
});
test('model stopping after calc gives an answer', async () => {
  const out = await runScripted([CALC, { type: 'turn', content: '', finish: 'stop', calls: [] }]);
  assert.ok(out.length === 1 && String(out[0].answer_latex).includes('+ C'), JSON.stringify(out));
});
test('failure before calc raises', async () => {
  await assert.rejects(runScripted([new SolveError("Groq's free-tier limit was reached.")]), SolveError);
});

// --- test_live_strings.py ---
test('projectile: typed question and the model answer', () => {
  const written = R`v_0 = 20 \text{ m/s}, \theta = 30^\circ, g = 9.8 \\ t_{flight} = ?`;
  const answer = R`t_{flight} = \frac{2 v_0 \sin\theta}{g} = \frac{40 \cdot \frac12}{9.8} = \frac{20}{9.8} \approx 2.04\ \text{s}`;
  assert.equal(questionUnknown(written), 't_{flight}');
  const trimmed = trimChain(written, answer);
  assert.equal(trimmed, R`t_{flight} = 2.04\ \text{s}`);
  assert.equal(exprFromLatex(trimmed), '2.04');
});
test('system: a bare 3 for "x = ?" against the named result', async () => {
  const out = await calculator.run('solve', { expr: 'x + y = 5, x - y = 1' });
  const target = { op: 'solve', args: { expr: 'x + y = 5, x - y = 1' }, out };
  const unk = questionUnknown(R`x + y = 5 \\ x - y = 1 \\ x = ?`);
  assert.equal(unk, 'x');
  assert.equal((await verifyAnswer(target, exprFromLatex('x = 3'), unk))[0], true);
});
