/**
 * Experiential Labs: OpenAI-style chat models (DeepSeek, which reasons before it answers) and Jev,
 * the systemone model that answers set questions about a state with a choice and a confidence.
 *
 * One request per call and no automatic retry: a timeout can leave a charged request with an
 * unknown outcome, so the caller decides what happens next (the notes fall back to Groq).
 */
import { env } from './env.ts';
import { ClientGone } from './errors.ts';
import { errName } from './groq.ts';

/** Any OpenAI-compatible gateway works; this is only the default. */
const BASE = env('EXPLABS_BASE_URL', 'https://api.experientiallabs.ai/v1').replace(/\/+$/, '');
const CHAT_TIMEOUT_MS = 90_000;
/** Jev answers in under a second; past this it is down, and the notes go on without it. */
const JEV_TIMEOUT_MS = 10_000;
/** After a network failure the provider is skipped for this long, so no student waits on it twice. */
const COOL_OFF_MS = 120_000;

type Fail = (message: string, status?: number) => Error;

export const explabsKey = (): string => env('EXPLABS_API_KEY') || env('EXPERIENTIAL_API_KEY');

let downUntil = 0;
/** True when there is a key and the provider has not just failed to answer. */
export const explabsReady = (): boolean => !!explabsKey() && Date.now() >= downUntil;

/** The chat endpoint, for callers that stream from it themselves (the solver). */
export const EXPLABS_CHAT_URL = `${BASE}/chat/completions`;

/** Marks the provider down after a failure a caller saw talking to it directly. */
export const explabsDown = (): void => {
  downUntil = Date.now() + COOL_OFF_MS;
};

async function post(path: string, body: object, timeoutMs: number, signal: AbortSignal | undefined, fail: Fail): Promise<any> {
  const key = explabsKey();
  if (!key) throw fail('No Experiential Labs key is set (EXPLABS_API_KEY).', 500);
  if (Date.now() < downUntil) throw fail('The model API is cooling off after a failure.', 503);
  const timeout = AbortSignal.timeout(timeoutMs);
  let r: Response;
  let text = '';
  try {
    r = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    text = await r.text();
  } catch (e) {
    if (signal?.aborted) throw new ClientGone();
    downUntil = Date.now() + COOL_OFF_MS;
    if (timeout.aborted) throw fail('The model API timed out.', 504);
    console.error(`[explabs] ${path} unreachable (skipped for ${COOL_OFF_MS / 1000}s):`, errName(e), String((e as Error)?.message ?? '').slice(0, 200));
    throw fail('Could not reach the model API.', 502);
  }
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!r.ok) {
    // The provider's own text goes to the log, never to the student.
    console.error(`[explabs] ${path} error ${r.status}:`, String(data?.error?.message ?? text).slice(0, 300));
    // A server error means the provider is down. A 429 is one model's limit or a model this account
    // cannot use, so the other models there stay in use.
    if (r.status >= 500) downUntil = Date.now() + COOL_OFF_MS;
    if (r.status === 429) throw fail('The AI is busy. Try again in a minute.', 429);
    throw fail('The AI service had a problem. Please try again.', 502);
  }
  return data;
}

/** One chat completion; returns choices[0]. The reasoning, when the model gives one, stays on the server. */
export async function explabsChoice(body: object, opts: { fail: Fail; signal?: AbortSignal }): Promise<any> {
  const data = await post('/chat/completions', body, CHAT_TIMEOUT_MS, opts.signal, opts.fail);
  const choice = data?.choices?.[0];
  if (!choice) throw opts.fail('The model returned malformed JSON.', 502);
  return choice;
}

export interface JevAnswer {
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

/**
 * Asks Jev one choice question about `state`. Null when Jev could not answer: the guard is a
 * second opinion, so its failure never stops the notes.
 */
export async function jevChoice(
  state: Record<string, string>,
  question: { instructions: string; criteria: Record<string, string> },
  signal?: AbortSignal,
): Promise<JevAnswer | null> {
  if (!explabsReady()) return null;
  try {
    const data = await post(
      '/systemone',
      { model: env('SLATE_JEV_MODEL', 'jev-latest'), state, questions: { check: { type: 'choice', ...question } } },
      JEV_TIMEOUT_MS,
      signal,
      (m, s) => Object.assign(new Error(m), { status: s }),
    );
    const a = data?.answers?.check;
    if (!a || typeof a.choice !== 'string' || !(a.choice in question.criteria)) return null;
    return {
      choice: a.choice,
      confidence: Number(a.confidence) || 0,
      probabilities: a.probabilities && typeof a.probabilities === 'object' ? a.probabilities : {},
    };
  } catch (e) {
    if (e instanceof ClientGone) throw e;
    return null;
  }
}
