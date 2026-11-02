// Port of services/api/tests/test_calc.py.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { Calculator, validate } from '../src/calc.ts';

const calc = new Calculator(2);
const run = (op: string, args: Record<string, unknown>) => calc.run(op, args);
const str = (r: Record<string, unknown>, k = 'result') => String(r[k] ?? '');
after(() => calc.close());

test('integral of sin^4 x', async () => {
  const r = await run('integrate', { expr: 'sin(x)**4', var: 'x' });
  assert.ok(str(r).includes('3*x/8') && str(r).includes('sin(4*x)/32'), JSON.stringify(r));
});
test("check catches the model's wrong sin^4 answer", async () => {
  const r = await run('check', { expr: '3*x/8 - sin(2*x)/4 + sin(4*x)/32', other: 'x*(3/8 - sin(x)**2/2)' });
  assert.equal(r.equal, false, JSON.stringify(r));
});
test('solve 2^(x+1) = 3^x', async () => {
  const r = await run('solve', { expr: '2**(x+1) = 3**x', var: 'x' });
  assert.ok(str(r).includes('log'), JSON.stringify(r));
  assert.ok(str(r, 'approx').startsWith('{1.709'), 'solve gives an approximation: ' + JSON.stringify(r));
});
test('quadratic roots', async () => assert.equal((await run('solve', { expr: 'x**2 - 5*x + 6', var: 'x' })).result, '{2, 3}'));
test('arithmetic', async () => assert.equal((await run('evaluate', { expr: '348*27' })).result, '9396'));
test('derivative of tan(x)^x', async () => {
  const r = await run('diff', { expr: 'tan(x)**x', var: 'x' });
  assert.ok(str(r).includes('log(tan(x))'), JSON.stringify(r));
});
test('limit sin(x)/x at 0', async () => assert.equal((await run('limit', { expr: 'sin(x)/x', var: 'x', point: '0' })).result, '1'));
test('one-sided limit', async () => assert.equal((await run('limit', { expr: '1/x', var: 'x', point: '0+' })).result, 'oo'));
test('Gaussian integral', async () => {
  assert.equal((await run('integrate', { expr: 'exp(-x**2)', var: 'x', lower: '-oo', upper: 'oo' })).result, 'sqrt(pi)');
});
test('simultaneous equations', async () => {
  const r = await run('solve', { expr: 'x + y = 5, x - y = 1', var: 'x, y' });
  assert.ok(str(r).includes('x: 3') && str(r).includes('y: 2'), JSON.stringify(r));
});
test('Taylor series', async () => assert.ok(str(await run('series', { expr: 'exp(x)', var: 'x', order: 4 })).includes('x**3/6')));
// pi = 3.14159265358979323846..., so 20 significant digits round up to ...32385.
test('numeric precision', async () => assert.equal((await run('numeric', { expr: 'pi', order: 20 })).result, '3.1415926535897932385'));
test('caret means power', async () => assert.equal((await run('evaluate', { expr: '2^10' })).result, '1024'));
test('integration note', async () => assert.ok(str(await run('integrate', { expr: '1/x', var: 'x' }), 'note').includes('constant')));

// --- input the model might send that must be refused before parsing ---
for (const bad of [
  "__import__('os').system('echo hi')", 'x.__class__', "open('secret')", 'lambda: 1', 'eval(1)', 'x; import os',
  "getattr(x, 'y')", '[1, 2]', 'x'.repeat(500),
]) {
  test(`refuses ${bad.slice(0, 28)}`, () => assert.notEqual(validate(bad), null));
  test(`run refuses ${bad.slice(0, 22)}`, async () => assert.ok('error' in (await run('evaluate', { expr: bad }))));
}
test('asks for explicit products', async () => assert.ok(str(await run('evaluate', { expr: 'xy' }), 'error').includes('x*y')));
test('nothing to solve is an error, not a crash', async () => assert.ok('error' in (await run('solve', { expr: '1 = 1' }))));
test('unknown op is an error', async () => assert.ok('error' in (await run('bogus', { expr: '1' }))));

// --- a calculation that never finishes must not hang the server ---
test('hung integral times out', async () => {
  const t = performance.now();
  const r = await calc.run('integrate', { expr: 'exp(sin(x)**7 * x**x) * tan(x**3)**x', var: 'x' }, 2.0);
  const took = (performance.now() - t) / 1000;
  assert.ok('error' in r && took < 5, `${took.toFixed(1)}s ${JSON.stringify(r)}`);
});
test('pool still works after a timeout', async () => assert.equal((await run('evaluate', { expr: '2 + 2' })).result, '4'));
