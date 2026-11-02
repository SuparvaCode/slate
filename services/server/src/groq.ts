/** One non-streaming Groq chat request with the key pool's rest-on-rate-limit handling. */
import { ClientGone } from './errors.ts';
import { POOL, afterLimit, afterReject, retryAfter, sleep } from './keys.ts';

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const NO_KEY = 'No Groq key is set. Add GROQ_API_KEY or GROQ_API_KEYS to services/server/.env.';
export const TIMEOUT_MS = 90_000;

type Fail = (message: string, status?: number) => Error;

/** The kind of network failure, for messages: "ConnectError", "ENOTFOUND", ... */
export function errName(e: unknown): string {
  const cause = (e as { cause?: { code?: string } })?.cause;
  if (cause?.code) return cause.code;
  const name = (e as { name?: string })?.name;
  return name && name !== 'TypeError' ? name : 'ConnectError';
}

export interface GroqOptions {
  maxWaitS: number;
  fail: Fail;
  signal?: AbortSignal;
  /** On a dropped connection, wait briefly and move to the next key (the diagram builder does this). */
  retryNextKey?: boolean;
}

/** Returns choices[0] of a successful response. Every failure is thrown through opts.fail. */
export async function groqChoice(body: object, opts: GroqOptions): Promise<any> {
  // Groq's limits are per model, so keys rest per model: a limit on one leaves the others free.
  const model = String((body as { model?: unknown }).model ?? '');
  let key = POOL.take(model);
  if (!key) throw opts.fail(NO_KEY, 500);
  let waited = 0;
  let reconnected = false;
  let status = 0;
  let text = '';
  for (;;) {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let r: Response;
    try {
      r = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
      text = await r.text();
    } catch (e) {
      if (opts.signal?.aborted) throw new ClientGone();
      if (timeout.aborted) throw opts.fail('The model API timed out.', 504);
      // A connection that went stale while idle fails once even though the API is fine.
      if (!reconnected) {
        reconnected = true;
        if (opts.retryNextKey) {
          await sleep(0.6, opts.signal);
          key = POOL.take(model) ?? key;
        }
        continue;
      }
      throw opts.fail(`Could not reach the model API (${errName(e)}). Check your internet connection.`, 502);
    }
    status = r.status;
    if (status === 429) {
      // This key rests; the next free key is used at once, and only when all rest is there a wait.
      const [nxt, wait] = afterLimit(key, retryAfter(r.headers, 5) + 0.5, model);
      key = nxt;
      if (waited + wait > opts.maxWaitS) throw opts.fail(`Rate limited by Groq. Try again in about ${Math.round(wait)} seconds.`, 429);
      if (wait) {
        await sleep(wait, opts.signal);
        waited += wait;
      }
      continue;
    }
    if (status === 401 || status === 403) {
      const nxt = afterReject(key, model);
      if (nxt) {
        key = nxt;
        continue;
      }
    }
    break;
  }

  if (status === 401 || status === 403) throw opts.fail('Groq rejected the API key.', 500);
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (status !== 200) {
    // Groq's own text names our organisation and model; it goes to the log, never to the student.
    const message = typeof data?.error?.message === 'string' ? data.error.message : text.slice(0, 200);
    console.error(`[groq] error ${status}:`, message.slice(0, 300));
    throw opts.fail(status === 413 ? 'That request was too long for the AI. Try a shorter one.' : 'The AI service had a problem. Please try again.', 502);
  }
  const choice = data?.choices?.[0];
  if (!choice) throw opts.fail('The model returned malformed JSON.', 502);
  return choice;
}
