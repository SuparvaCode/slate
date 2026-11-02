/**
 * The Groq API keys, shared by the reader, the solver and the diagram builder. Port of groq_keys.py.
 *
 * Keys come from GROQ_API_KEYS (comma-separated) and GROQ_API_KEY, in that order, without repeats.
 * Requests take keys in turn. A rate-limited key rests for as long as Groq's retry-after says and
 * the request moves on to the next free key; only when every key rests does a request wait. A key
 * Groq rejects is set aside for the session.
 *
 * Groq's limits are per model, so a key rests only for the model that hit the limit: another
 * model can still use it. Callers that pass no model share one limit, as before.
 */
import { performance } from 'node:perf_hooks';
import { panelGroqKeys } from './runtime.ts';

/** A rejected key stays out of use this long (effectively until the server restarts). */
export const REJECTED_REST_S = 12 * 3600;

const now = (): number => performance.now() / 1000;

export class KeyPool {
  private next = 0;
  private until = new Map<string, number>();
  /** Rejections are for the key itself, whatever the model. */
  private rejected = new Map<string, number>();

  private restEnd(key: string, model: string): number {
    return Math.max(this.until.get(`${model}|${key}`) ?? 0, this.rejected.get(key) ?? 0);
  }

  keys(): string[] {
    // Keys saved in the admin panel come first, then the ones in the environment.
    const raw = [...panelGroqKeys(), ...(process.env.GROQ_API_KEYS ?? '').split(','), process.env.GROQ_API_KEY ?? ''];
    const out: string[] = [];
    for (const k of raw.map((s) => s.trim())) if (k && !out.includes(k)) out.push(k);
    return out;
  }

  /** The next free key in turn, or, when every key rests, the one that frees up first. */
  take(model = ''): string | null {
    const keys = this.keys();
    if (!keys.length) return null;
    const t = now();
    for (let i = 0; i < keys.length; i++) {
      const k = keys[(this.next + i) % keys.length];
      if (this.restEnd(k, model) <= t) {
        this.next = (this.next + i + 1) % keys.length;
        return k;
      }
    }
    return keys.reduce((a, b) => (this.restEnd(b, model) < this.restEnd(a, model) ? b : a));
  }

  rest(key: string, seconds: number, model = ''): void {
    const id = `${model}|${key}`;
    this.until.set(id, Math.max(this.until.get(id) ?? 0, now() + Math.max(0, seconds)));
  }

  reject(key: string): void {
    this.rejected.set(key, now() + REJECTED_REST_S);
  }

  /** Seconds until this key may be used again for `model`; 0 when it is free now. */
  waitFor(key: string, model = ''): number {
    return Math.max(0, this.restEnd(key, model) - now());
  }

  /** Keys not set aside as rejected. */
  usable(): number {
    const t = now();
    return this.keys().filter((k) => (this.rejected.get(k) ?? 0) <= t).length;
  }
}

export const POOL = new KeyPool();

/** After a 429 on `key`: rests it, and returns the key to use next and how long to wait first. */
export function afterLimit(key: string, retryAfterS: number, model = ''): [string, number] {
  POOL.rest(key, retryAfterS, model);
  const nxt = POOL.take(model) ?? key;
  return [nxt, POOL.waitFor(nxt, model)];
}

/** After a 401 or 403 on `key`: sets it aside, and returns another key to try, if any. */
export function afterReject(key: string, model = ''): string | null {
  POOL.reject(key);
  const nxt = POOL.take(model);
  return nxt && nxt !== key && POOL.waitFor(nxt, model) < REJECTED_REST_S / 2 ? nxt : null;
}

/** Groq's retry-after header in seconds, with the same default Python used. */
export function retryAfter(headers: Headers, fallback: number): number {
  const v = Number.parseFloat(headers.get('retry-after') ?? '');
  return Number.isFinite(v) ? v : fallback;
}

/** Sleeps, waking early (rejecting) when the signal aborts. */
export function sleep(seconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error('Aborted'));
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason ?? new Error('Aborted'));
    };
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, seconds * 1000));
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
