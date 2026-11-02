/** Worker thread: answers one calculation at a time. Every failure goes back as {error} text. */
import { parentPort } from 'node:worker_threads';
import { run } from './calc-engine.ts';

if (!parentPort) throw new Error('calc-worker must run in a worker thread');
const port = parentPort;

port.on('message', (req: { id: number; op: string; args: Record<string, unknown> }) => {
  let out: Record<string, unknown>;
  try {
    out = run(req.op, req.args);
  } catch (exc) {
    const e = exc as Error;
    const name = e?.name && e.name !== 'Error' ? e.name : 'ValueError';
    out = { error: `${name}: ${e?.message || name}`.slice(0, 400) };
  }
  port.postMessage({ id: req.id, out });
});

port.postMessage({ ready: true });
