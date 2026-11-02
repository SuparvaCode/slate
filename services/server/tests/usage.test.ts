// AI token counting: provider usage formats, and that a request keeps its scope through Express.
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import express from 'express';

const { aiScope, attribute, countTokens, onTokens } = await import('../src/usage.ts');

test('reads usage from each provider format', () => {
  // OpenAI-style and Experiential Labs: one JSON body.
  assert.equal(countTokens(JSON.stringify({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 300, total_tokens: 1200 } }), 'application/json'), 1200);
  assert.equal(countTokens(JSON.stringify({ usage: { prompt_tokens: 50, completion_tokens: 20 } }), 'application/json'), 70);
  // Anthropic: input + output.
  assert.equal(countTokens(JSON.stringify({ usage: { input_tokens: 400, output_tokens: 100 } }), 'application/json'), 500);
  // Groq stream: usage on the last chunk, under x_groq.
  const groq = ['data: {"choices":[{"delta":{"content":"a"}}]}', 'data: {"choices":[],"x_groq":{"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}}', 'data: [DONE]', ''].join('\n');
  assert.equal(countTokens(groq, 'text/event-stream'), 15);
  // Anthropic stream: input in message_start, running output totals later. Largest wins.
  const claude = [
    'data: {"type":"message_start","message":{"usage":{"input_tokens":200,"output_tokens":1}}}',
    'data: {"type":"message_delta","usage":{"output_tokens":40}}',
    'data: {"type":"message_delta","usage":{"output_tokens":90}}',
  ].join('\n');
  assert.equal(countTokens(claude, 'text/event-stream'), 290);
  // Search results, pages and junk carry no usage.
  assert.equal(countTokens(JSON.stringify({ results: [{ title: 'x' }] }), 'application/json'), 0);
  assert.equal(countTokens('not json with _tokens', 'application/json'), 0);
});

let provider: Server;
let app: Server;
let providerUrl = '';
let appUrl = '';
const counted: [string, string, number][] = [];

before(async () => {
  onTokens((uid, day, n) => counted.push([uid, day, n]));
  // A stand-in AI provider that reports 123 tokens.
  provider = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'hi' } }], usage: { total_tokens: 123 } }));
  }).listen(0, '127.0.0.1');
  await new Promise((r) => provider.once('listening', r));
  providerUrl = `http://127.0.0.1:${(provider.address() as AddressInfo).port}`;

  const a = express();
  a.use(aiScope);
  // The body parser runs between the scope and the handler, as on the real routes.
  a.post('/ask', express.json(), async (req, res) => {
    if (req.body?.who) attribute(req.body.who, '2026-11-02');
    const r = await fetch(providerUrl);
    res.json(await r.json());
  });
  app = a.listen(0, '127.0.0.1');
  await new Promise((r) => app.once('listening', r));
  appUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});
after(() => {
  provider.close();
  app.close();
});

const ask = (who?: string) =>
  fetch(`${appUrl}/ask`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ who }) });
const settle = () => new Promise((r) => setTimeout(r, 50));

test('an AI call is charged to the student whose request made it', async () => {
  counted.length = 0;
  const r = await ask('student-a');
  assert.equal((await r.json()).choices[0].message.content, 'hi', 'the caller still reads the whole response');
  await settle();
  assert.deepEqual(counted, [['student-a', '2026-11-02', 123]]);
});

test('requests at the same time are charged to the right students', async () => {
  counted.length = 0;
  await Promise.all([ask('student-a'), ask('student-b'), ask('student-a')].map((p) => p.then((r) => r.json())));
  await settle();
  const by = (uid: string) => counted.filter((c) => c[0] === uid).reduce((n, c) => n + c[2], 0);
  assert.equal(by('student-a'), 246);
  assert.equal(by('student-b'), 123);
});

test('calls before sign-in is known, or outside a request, count for no one', async () => {
  counted.length = 0;
  await (await ask()).json();
  await (await fetch(providerUrl)).json();
  await settle();
  assert.deepEqual(counted, []);
});
