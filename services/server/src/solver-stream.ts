/** One streamed Groq turn for the solver: think deltas, wait notices, then a final 'turn' event. */
import { ClientGone, SolveError, type Event } from './errors.ts';
import { EXPLABS_CHAT_URL, explabsDown, explabsKey } from './explabs.ts';
import { GROQ_URL, errName } from './groq.ts';
import { afterLimit, afterReject, retryAfter, sleep } from './keys.ts';
import { MAX_WAIT_S } from './solver-prompt.ts';

export interface Call { id: string; name: string; args: string }
export interface Turn { type: 'turn'; content: string; calls: Call[]; finish: string | null }
/**
 * noWait: a rate limit is reported at once (as Limited) instead of waited out, so a backup model can answer.
 * explabs: the turn goes to Experiential Labs with its one key; it is never retried there, since a
 * timed-out request may still be charged.
 */
export interface TurnOptions { noWait?: boolean; explabs?: boolean }
export type TurnStream = (key: string, body: object, waited: number[], signal?: AbortSignal, opts?: TurnOptions) => AsyncGenerator<Event | Turn>;

/** Groq could not be reached or had a server error before anything arrived; another model may answer. */
export class Unreachable extends SolveError {
  constructor(message: string) {
    super(message);
    this.name = 'Unreachable';
  }
}

/** Every key is resting for this model; the caller may hand the turn to another model. */
export class Limited extends SolveError {
  constructor(seconds: number) {
    super(`Groq's free-tier limit was reached. Try again in about ${Math.round(seconds)} seconds.`);
    this.name = 'Limited';
  }
}

class TransportError extends Error {
  kind: string;
  constructor(kind: string) {
    super(kind);
    this.kind = kind;
  }
}

/** Server-sent-event lines from a fetch body. */
async function* lines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
    }
  }
  if (buf) yield buf;
}

async function* attempt(key: string, body: object, waited: number[], signal?: AbortSignal, opts: TurnOptions = {}): AsyncGenerator<Event | Turn> {
  // Groq's limits are per model, so a key rests only for this model.
  const model = String((body as { model?: unknown }).model ?? '');
  for (;;) {
    let r: Response;
    try {
      const timeout = AbortSignal.timeout(90_000);
      r = await fetch(opts.explabs ? EXPLABS_CHAT_URL : GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${opts.explabs ? explabsKey() : key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (e) {
      if (signal?.aborted) throw new ClientGone();
      if (opts.explabs) {
        explabsDown();
        throw new SolveError(`Lost the connection to the AI (${errName(e)}). Try again in a moment.`);
      }
      throw new TransportError(errName(e));
    }
    if (opts.explabs && r.status !== 200) {
      const text = await r.text().catch(() => '');
      console.error(`[solve] backup model error ${r.status}:`, text.slice(0, 200));
      if (r.status >= 500) explabsDown();
      throw r.status === 429 ? new Limited(30) : new SolveError('The AI service had a problem. Please try again.');
    }
    if (r.status === 429) {
      await r.text().catch(() => '');
      // This key rests and the next free one is used; only when all are resting is there a wait.
      const [nxt, wait] = afterLimit(key, retryAfter(r.headers, 6) + 0.5, model);
      key = nxt;
      if (!wait) continue;
      if (opts.noWait) throw new Limited(wait);
      if (waited[0] + wait > MAX_WAIT_S) throw new SolveError(`Groq's free-tier limit was reached. Try again in about ${Math.round(wait)} seconds.`);
      waited[0] += wait;
      yield { type: 'wait', seconds: Math.round(wait * 10) / 10, reason: 'Groq free-tier limit' };
      await sleep(wait, signal);
      continue;
    }
    if (r.status === 401 || r.status === 403) {
      await r.text().catch(() => '');
      const nxt = afterReject(key, model);
      if (nxt) {
        key = nxt;
        continue;
      }
      throw new SolveError('Groq rejected the API key.');
    }
    if (r.status !== 200 || !r.body) {
      const text = await r.text().catch(() => '');
      let message = text.slice(0, 200);
      try {
        const m = JSON.parse(text)?.error?.message;
        if (typeof m === 'string') message = m;
      } catch {
        // keep the raw text
      }
      throw r.status >= 500 ? new Unreachable(`Groq error ${r.status}: ${message}`) : new SolveError(`Groq error ${r.status}: ${message}`);
    }

    let content = '';
    let finish: string | null = null;
    const calls = new Map<number, Call>();
    try {
      for await (const line of lines(r.body)) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') break;
        let chunk: any;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        for (const ch of chunk?.choices ?? []) {
          const delta = ch?.delta ?? {};
          if (typeof delta.content === 'string' && delta.content) {
            content += delta.content;
            yield { type: 'think', delta: delta.content };
          }
          for (const tc of delta.tool_calls ?? []) {
            const index = typeof tc.index === 'number' ? tc.index : 0;
            const slot = calls.get(index) ?? { id: '', name: '', args: '' };
            slot.id = tc.id || slot.id;
            slot.name += tc.function?.name ?? '';
            slot.args += tc.function?.arguments ?? '';
            calls.set(index, slot);
          }
          finish = ch?.finish_reason || finish;
        }
      }
    } catch (e) {
      if (signal?.aborted) throw new ClientGone();
      throw new TransportError(errName(e));
    }
    yield { type: 'turn', content, calls: [...calls.keys()].sort((a, b) => a - b).map((k) => calls.get(k)!), finish };
    return;
  }
}

/**
 * One model turn with one retry when the connection fails before anything has arrived. Retrying
 * later would show the user the same thinking twice, so a later failure is reported plainly.
 */
export async function* streamTurn(key: string, body: object, waited: number[], signal?: AbortSignal, opts: TurnOptions = {}): AsyncGenerator<Event | Turn> {
  let retried = false;
  for (;;) {
    let started = false;
    try {
      for await (const ev of attempt(key, body, waited, signal, opts)) {
        started = true;
        yield ev;
      }
      return;
    } catch (e) {
      if (!(e instanceof TransportError)) throw e;
      if (started) throw new SolveError(`Lost the connection to Groq (${e.kind}). Try again in a moment.`);
      if (retried) throw new Unreachable(`Lost the connection to Groq (${e.kind}). Try again in a moment.`);
      retried = true;
      await sleep(1, signal);
    }
  }
}
