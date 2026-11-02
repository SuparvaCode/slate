// The multi-model retry: each model takes over only when the one before it failed, and nothing
// already shown to the student is ever rewritten by another model. The network is scripted.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { calculator } from '../src/calc.ts';
import { SolveError } from '../src/errors.ts';
import { explabsReady } from '../src/explabs.ts';
import { KeyPool } from '../src/keys.ts';
import { MOCK_RESULT } from '../src/mock.ts';
import { writeSection } from '../src/notes.ts';
import { recognize } from '../src/recognize.ts';
import { hooks, solve } from '../src/solver.ts';
import { Limited, type Turn } from '../src/solver-stream.ts';

after(() => calculator.close());

process.env.EXPLABS_API_KEY ||= 'test';
process.env.GROQ_API_KEY ||= 'test';
process.env.SLATE_PROVIDER = 'groq';
process.env.SLATE_NOTES_GUARD = '0';
delete process.env.SLATE_MOCK;
delete process.env.SLATE_NOTES_THINKERS;
delete process.env.SLATE_SOLVE_BACKUP;
delete process.env.SLATE_RECOGNIZE_BACKUP;

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

interface Call { host: string; model: string; body: Record<string, unknown> }

/** Replaces the network: `answer` decides each reply; every request is recorded. */
function script(answer: (c: Call) => Response | Error): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const c = { host: new URL(String(url)).hostname, model: String(body.model ?? ''), body };
    calls.push(c);
    const r = answer(c);
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  return calls;
}

const chat = (content: string, finish = 'stop') =>
  new Response(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: finish }] }), { status: 200 });
const SECTION = JSON.stringify({ think: 'plan', blocks: [{ t: 'p', text: 'Kinetic energy is the energy of motion.' }], side: [] });

const section = () => writeSection({
  plan: {
    kind: 'notes', title: 'Work and energy', subject: 'Physics', topic: 'Kinetic energy', digest: '',
    profile: { board: 'CBSE', grade: '9', subjects: [] }, sections: [{ heading: 'Kinetic energy', goal: 'Define it.' }],
  },
  index: 0, lineChars: 40, written: '', extra: '', custom: null,
});

test('a key limited on one model stays free for another', () => {
  const saved = [process.env.GROQ_API_KEYS, process.env.GROQ_API_KEY];
  process.env.GROQ_API_KEYS = 'k1';
  process.env.GROQ_API_KEY = '';
  try {
    const p = new KeyPool();
    p.rest('k1', 30, 'qwen');
    assert.ok(p.waitFor('k1', 'qwen') > 29, 'resting for the model that hit the limit');
    assert.equal(p.waitFor('k1', 'other'), 0, 'free for another model');
    p.reject('k1');
    assert.ok(p.waitFor('k1', 'other') > 3600, 'a rejected key is out for every model');
    assert.equal(p.usable(), 0);
  } finally {
    [process.env.GROQ_API_KEYS, process.env.GROQ_API_KEY] = saved;
  }
});

// --- the solver ---------------------------------------------------------------------------------

const READ = { kind: 'math', latex: String.raw`\int \tan^4 x \, dx =`, intent: 'solve', uncertain: [] };
const CALC: Turn = { type: 'turn', content: '', finish: 'tool_calls', calls: [{ id: 'c1', name: 'calc', args: '{"op": "integrate", "expr": "tan(x)**4", "var": "x"}' }] };

test('solver: Groq limited before anything is shown, Claude Haiku takes over', async () => {
  const calls: { model: unknown; opts: Record<string, unknown> }[] = [];
  const steps: (() => AsyncGenerator<any>)[] = [
    async function* () { throw new Limited(20); },
    async function* () { yield CALC; },
    async function* () { throw new SolveError('dropped'); },
  ];
  hooks.turn = async function* (_key, body, _waited, _signal, opts = {}) {
    calls.push({ model: (body as { model?: unknown }).model, opts });
    yield* steps[calls.length - 1]();
  };
  const out = [];
  for await (const ev of solve(READ, 'answer')) if (ev.type === 'answer') out.push(ev);
  assert.equal(calls[0].opts.noWait, true, 'Groq is asked not to wait out its limit');
  assert.equal(calls[1].opts.explabs, true, 'the same turn goes to the backup');
  assert.equal(calls[1].model, 'claude-haiku-5.5');
  assert.equal(calls[2].opts.explabs, true, 'the rest of the solve stays on the backup');
  assert.equal(out.length, 1);
  assert.ok(String(out[0].answer_latex).includes('+ C'), 'the answer is still the calculator-checked one');
});

test('solver: no switch once the student has seen the thinking', async () => {
  let n = 0;
  hooks.turn = async function* () {
    n++;
    yield { type: 'think', delta: 'Let me integrate' };
    throw new Limited(20);
  };
  await assert.rejects(async () => {
    for await (const _ of solve(READ, 'answer')) { /* drain */ }
  }, Limited);
  assert.equal(n, 1, 'not sent to a second model');
});

// --- notes and the handwriting reader --------------------------------------------------------------

test('notes: an empty DeepSeek answer goes to Claude Haiku, not Groq', async () => {
  const calls = script((c) => (c.model === 'deepseek-v4.1-flash' ? chat('', 'length') : chat(SECTION)));
  const out = await section();
  assert.deepEqual(calls.map((c) => c.model), ['deepseek-v4.1-flash', 'claude-haiku-5.5']);
  assert.equal(out.blocks.length, 1);
});

test('reader: Groq limited, Claude Haiku reads the image', async () => {
  const calls = script((c) => (c.host === 'api.groq.com'
    ? new Response('{"error":{"message":"limit"}}', { status: 429, headers: { 'retry-after': '0' } })
    : chat(JSON.stringify(MOCK_RESULT))));
  const [reading, model] = await recognize('iVBORw0KGgo=');
  assert.equal(model, 'claude-haiku-5.5');
  assert.ok(calls.some((c) => c.host === 'api.groq.com'), 'Groq was asked first');
  const backup = calls.find((c) => c.host !== 'api.groq.com');
  assert.ok(backup && !('reasoning_effort' in backup.body), 'no Groq-only settings sent to the backup');
  assert.equal(reading.latex, MOCK_RESULT.latex);
});

// Last: it leaves Experiential Labs cooling off for this process.
test('notes: a network failure skips Experiential Labs for the next requests', async () => {
  const calls = script((c) => (c.host === 'api.groq.com' ? chat(SECTION) : new TypeError('fetch failed')));
  await section();
  assert.deepEqual(calls.map((c) => c.model), ['deepseek-v4.1-flash', 'qwen/qwen3.8-27b'], 'Haiku skipped at once, no second request there');
  assert.equal(explabsReady(), false);
  calls.length = 0;
  await section();
  assert.deepEqual(calls.map((c) => c.host), ['api.groq.com'], 'the next section goes straight to Groq');
});
