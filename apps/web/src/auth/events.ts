/**
 * Small event bus for API conditions the UI may want to show: the daily limit being reached,
 * the latest quota headers, and the session ending.
 *
 *   import { apiEvents } from './auth/events';
 *   const off = apiEvents.on('limit', (e) => showToast(e.message));
 */

export interface LimitEvent {
  /** Friendly text, built from the server's `detail` and `Retry-After`. */
  message: string;
  /** The server's own `detail`, if it sent one. */
  detail: string | null;
  /** Seconds until requests are allowed again, if known. */
  retryAfter: number | null;
  path: string;
}

export interface QuotaInfo {
  limit: number | null;
  remaining: number | null;
  /** Reset time as the server sent it (epoch seconds or a date string). */
  reset: string | null;
  path: string;
}

interface EventMap {
  limit: LimitEvent;
  quota: QuotaInfo;
  'session-expired': { path: string };
  /** Someone signed in to this account on another device, which signs this one out. */
  'other-device': { path: string };
}

type Listener<T> = (payload: T) => void;

class Emitter {
  private listeners = new Map<keyof EventMap, Set<(payload: never) => void>>();

  on<K extends keyof EventMap>(type: K, fn: Listener<EventMap[K]>): () => void {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    const entry = fn as (payload: never) => void;
    set.add(entry);
    return () => {
      set.delete(entry);
    };
  }

  emit<K extends keyof EventMap>(type: K, payload: EventMap[K]): void {
    this.listeners.get(type)?.forEach((fn) => {
      try {
        (fn as Listener<EventMap[K]>)(payload);
      } catch {
        // one bad listener must not stop the others
      }
    });
  }
}

export const apiEvents = new Emitter();

/** The most recent quota headers, or null if the server has not sent any yet. */
export let lastQuota: QuotaInfo | null = null;
apiEvents.on('quota', (q) => {
  lastQuota = q;
});
