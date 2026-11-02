// Port of services/api/tests/test_verify.py.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { calculator } from '../src/calc.ts';
after(() => calculator.close());
import { calcAnswer, numericMatches, verifyAnswer, withConstant, type Target } from '../src/solver-verify.ts';

const target = async (op: string, args: Record<string, unknown>): Promise<Target> => ({ op, args, out: await calculator.run(op, args) });
const v = async (t: Target | null, expr: string, unknown: string | null = null) => (await verifyAnswer(t, expr, unknown))[0];

test('the calculator form, and verdicts on integrals', async (t) => {
  const tan4 = await target('integrate', { expr: 'tan(x)**4', var: 'x' });
  await t.test('tan^4 integral is the short form', () => assert.equal(tan4.out.result, 'x + tan(x)**3/3 - tan(x)'));
  const sin4 = await target('integrate', { expr: 'sin(x)**4', var: 'x' });
  await t.test('sin^4 integral stays correct and short', () => {
    assert.ok(String(sin4.out.result).includes('3*x/8') && String(sin4.out.result).includes('sin(4*x)/32'));
  });
  await t.test('wrong tan^4 answer is rejected', async () => assert.equal(await v(tan4, '3*x/4 + tan(x) - tan(x)**3/3'), false));
  await t.test('right tan^4 answer is accepted', async () => assert.equal(await v(tan4, 'x - tan(x) + tan(x)**3/3'), true));
  await t.test('an added constant is accepted for an indefinite integral', async () => assert.equal(await v(tan4, 'x - tan(x) + tan(x)**3/3 + 5'), true));
  await t.test('no answer_expr cannot be decided', async () => assert.equal(await v(tan4, ''), null));
  await t.test('no calculator result cannot be decided', async () => assert.equal(await v(null, 'x'), null));
  await t.test('integral replacement adds the constant', () => assert.ok((calcAnswer(tan4) ?? '').endsWith('+ C')));

  const d = await target('integrate', { expr: 'x', var: 'x', lower: '0', upper: '2' });
  await t.test('definite integral value accepted', async () => assert.equal(await v(d, '2'), true));
  await t.test('definite integral rejects a different value', async () => assert.equal(await v(d, '3'), false));
});

test('sets of results and plain values', async (t) => {
  const s = await target('solve', { expr: 'x**2 - 5*x + 6 = 0', var: 'x' });
  await t.test("solve accepts '2, 3'", async () => assert.equal(await v(s, '2, 3'), true));
  await t.test("solve accepts 'x = 2, x = 3'", async () => assert.equal(await v(s, 'x = 2, x = 3'), true));
  await t.test('solve accepts them in another order', async () => assert.equal(await v(s, '3, 2'), true));
  await t.test('solve rejects a wrong root', async () => assert.equal(await v(s, '2, 4'), false));
  await t.test('solve rejects a missing root', async () => assert.equal(await v(s, '2'), false));
  await t.test('solve rejects an extra root', async () => assert.equal(await v(s, '2, 3, 4'), false));
  await t.test('solve replacement names the variable', () => assert.ok((calcAnswer(s) ?? '').startsWith('x =')));

  const lin = await target('solve', { expr: '2*x + 5 = 13', var: 'x' });
  await t.test('linear solve accepts 4', async () => assert.equal(await v(lin, '4'), true));
  await t.test('linear solve rejects 5', async () => assert.equal(await v(lin, '5'), false));

  const a = await target('evaluate', { expr: '348*27' });
  await t.test('arithmetic accepted', async () => assert.equal(await v(a, '9396'), true));
  await t.test('arithmetic wrong rejected', async () => assert.equal(await v(a, '9397'), false));
  const sm = await target('simplify', { expr: 'tan(x)' });
  await t.test('simplify accepts an equal form', async () => assert.equal(await v(sm, 'sin(x)/cos(x)'), true));
  await t.test('no closed form is undecided', async () => {
    assert.equal(await v({ op: 'integrate', args: {}, out: { result: 'no closed form' } }, '1'), null);
  });
});

test('the constant of integration', () => {
  assert.equal(withConstant('x + 1'), 'x + 1 + C', 'adds + C when missing');
  assert.equal(withConstant('x + 1 + C'), 'x + 1 + C', 'keeps an existing + C');
  assert.equal(withConstant('x+C'), 'x+C', 'keeps + C written without spaces');
  assert.equal(withConstant(String.raw`\cos x`), String.raw`\cos x + C`, 'does not treat a C inside a command as a constant');
  assert.equal(withConstant(''), '', 'leaves an empty answer alone');
});

test('systems of equations: results are named', async (t) => {
  const sys = await target('solve', { expr: 'x + y = 5, x - y = 1', var: 'x, y' });
  await t.test('system: x = 3 accepted', async () => assert.equal(await v(sys, 'x = 3'), true));
  await t.test('system: both values accepted', async () => assert.equal(await v(sys, 'x = 3, y = 2'), true));
  await t.test('system: a wrong value rejected', async () => assert.equal(await v(sys, 'x = 4'), false));
  await t.test('system: one wrong of two rejected', async () => assert.equal(await v(sys, 'x = 3, y = 9'), false));
  await t.test('system: an unnamed value is undecided, not wrong', async () => assert.equal(await v(sys, '3'), null));
  await t.test('system: an unknown name is undecided', async () => assert.equal(await v(sys, 'w = 3'), null));
  await t.test('bare value bound to the asked unknown', async () => assert.equal(await v(sys, '3', 'x'), true));
  await t.test('wrong bare value rejected', async () => assert.equal(await v(sys, '4', 'x'), false));
  await t.test('bare value with no unknown is undecided', async () => assert.equal(await v(sys, '3', null), null));
  await t.test("asked for y, given y's value", async () => assert.equal(await v(sys, '2', 'y'), true));
});

test('numeric results confirm, to the digits written', () => {
  assert.ok(numericMatches('2.04081632653061', '2.04'), '2.04 matches 2.0408');
  assert.ok(!numericMatches('2.04081632653061', '2.05'), '2.05 does not match 2.0408');
  assert.ok(numericMatches('2.04081632653061', '2.0408'), '2.0408 matches');
  assert.ok(numericMatches('3400.0', '3400') && numericMatches('3400.4', '3400'), 'integer rounding');
  assert.ok(!numericMatches('3400.0', '3500'), 'integer far off');
  assert.ok(numericMatches('2.0408', 't = 2.04'), 'named value');
  assert.ok(numericMatches('-1.5', '-1.5') && !numericMatches('-1.5', '1.5'), 'negative');
  assert.ok(!numericMatches('2.04', 'x + 1') && !numericMatches('abc', '2'), 'not a number is no match');
});
