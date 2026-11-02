// HTTP contract, auth and abuse protection (new in the Node server; no Python counterpart).
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'slate-samples-'));
process.env.SLATE_SAMPLES_DIR = dir;
process.env.SLATE_SAVE_SAMPLES = '1';
process.env.SLATE_MOCK = '1';
process.env.SLATE_BURST_SOLVE_MIN = '3';
delete process.env.SLATE_AUTH_DISABLED;

const { createApp } = await import('../src/app.ts');
const { calculator } = await import('../src/calc.ts');
const { MemoryQuotaStore, setQuotaStore, userBuckets } = await import('../src/limits.ts');
const { rateSample } = await import('../src/samples.ts');

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let base = '';
let server: ReturnType<ReturnType<typeof createApp>['listen']>;
const store = new MemoryQuotaStore();

before(async () => {
  setQuotaStore(store);
  server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  server.close();
  calculator.close();
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const bypass = (on: boolean) => (on ? (process.env.SLATE_AUTH_DISABLED = '1') : delete process.env.SLATE_AUTH_DISABLED);

test('health needs no token', async () => {
  const r = await fetch(`${base}/api/health`);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, mock: true, provider: 'mock', model: 'mock' });
});

test('a missing or malformed token is 401 {detail}', async () => {
  bypass(false);
  for (const headers of [{}, { Authorization: 'Bearer not-a-jwt' }, { Authorization: 'Basic abc' }]) {
    const r = await fetch(`${base}/api/me/usage`, { headers });
    assert.equal(r.status, 401);
    assert.equal(typeof (await r.json()).detail, 'string');
  }
});

test('mock solve streams NDJSON ending in an answer, with quota headers', async () => {
  bypass(true);
  const r = await post('/api/solve', { image: `data:image/png;base64,${PNG}`, mode: 'answer' });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/x-ndjson');
  assert.ok(r.headers.get('x-quota-limit') && r.headers.get('x-quota-remaining') && r.headers.get('x-quota-reset'));
  const events = (await r.text()).trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(events.map((e) => e.type), ['read', 'think', 'tool', 'tool_result', 'think', 'answer']);
  const answer = events.at(-1);
  assert.equal(answer.answer_latex, 'x = 4');
  assert.match(answer.id, /^[0-9a-f]{12}$/);

  // Only the owner can rate the sample; anyone else sees "not found".
  await assert.rejects(rateSample(answer.id, 'someone-else', true, null), /Sample not found/);
  const fb = await post('/api/feedback', { id: answer.id, correct: true, corrected_latex: null });
  assert.deepEqual(await fb.json(), { ok: true });
  const acc = await (await fetch(`${base}/api/accuracy`)).json();
  assert.deepEqual(acc, { rated: 1, correct: 1, accuracy: 1 });
});

test('input is validated like the pydantic models', async () => {
  bypass(true);
  assert.equal((await post('/api/solve', { image: 'aGVsbG8=' })).status, 400); // not a PNG
  assert.equal((await post('/api/solve', { image: PNG, mode: 'essay' })).status, 422);
  assert.equal((await post('/api/feedback', { id: 'XYZ', correct: true })).status, 422);
  assert.equal((await post('/api/feedback', { id: 'a'.repeat(100_000), correct: true })).status, 413); // small body limit
  assert.equal((await post('/api/diagram', { prompt: '' })).status, 422);
});

test('burst limit gives 429 with Retry-After; usage reports the count', async () => {
  bypass(true);
  userBuckets.clear();
  const codes: number[] = [];
  let retry: string | null = null;
  for (let i = 0; i < 4; i++) {
    const r = await post('/api/recognize', { image: PNG });
    codes.push(r.status);
    if (r.status === 429) retry = r.headers.get('retry-after');
    await r.body?.cancel();
  }
  assert.deepEqual(codes, [200, 200, 200, 429]);
  assert.ok(Number(retry) > 0);
  const u = await (await fetch(`${base}/api/me/usage`)).json();
  // Students get the share of AI energy left, never limits or token counts.
  assert.ok(u.used.solve >= 4 && u.left === 100 && !('limits' in u) && !('tokens' in u) && /^\d{4}-\d{2}-\d{2}$/.test(u.day), JSON.stringify(u));
});

test('a blocked user is 403; a per-user limit override applies', async () => {
  bypass(true);
  userBuckets.clear();
  store.users.set('dev', { blocked: true });
  assert.equal((await fetch(`${base}/api/molecule?name=water`)).status, 403);
  store.users.set('dev', { limits: { molecule: 0 } });
  const r = await fetch(`${base}/api/molecule?name=water`);
  assert.equal(r.status, 429);
  // A per-feature cap: the AI energy itself is untouched.
  assert.equal(r.headers.get('x-quota-remaining'), '100');
  assert.match((await r.json()).detail, /for one day/);
  store.users.delete('dev');
});
