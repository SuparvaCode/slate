/**
 * Today's AI energy: the share of the account's daily AI allowance left, 0 to 100. Read from
 * /api/me/usage, then kept current by the X-Quota-Remaining header every AI request returns.
 * Students only ever see it as a meter and a word, never as a count.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { authFetch } from '../auth/authFetch';
import { apiEvents } from '../auth/events';

export interface Energy {
  /** Percent left today. */
  left: number;
  /** When it refills (ISO time). */
  reset: string;
}

let energy: Energy | null = null;
let loadedAt = 0;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const set = (e: Energy) => {
  energy = e;
  listeners.forEach((fn) => fn());
};

export function refreshEnergy(force = false): Promise<void> {
  if (!force && (loading || (energy && Date.now() - loadedAt < 30_000))) return loading ?? Promise.resolve();
  loading = authFetch('/api/me/usage')
    .then(async (r) => {
      if (!r.ok) return;
      const u = await r.json();
      if (typeof u?.left === 'number') {
        loadedAt = Date.now();
        set({ left: u.left, reset: String(u.reset ?? '') });
      }
    })
    .catch(() => {
      // The meter stays as it was; AI requests still say when energy runs out.
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

// Every AI request reports what is left, so the meter moves without polling.
apiEvents.on('quota', (q) => {
  if (q.limit !== 100 || q.remaining === null) return;
  set({ left: Math.max(0, Math.min(100, q.remaining)), reset: q.reset ?? energy?.reset ?? '' });
});

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

export function useEnergy(): Energy | null {
  const e = useSyncExternalStore(subscribe, () => energy);
  useEffect(() => {
    void refreshEnergy();
  }, []);
  return e;
}

/** A word for the meter: no numbers, so it never reads as a count to use up. */
export function energyWord(left: number): string {
  if (left <= 0) return 'Resting until tomorrow';
  if (left < 15) return 'Running low';
  if (left < 50) return 'Plenty for today';
  if (left < 90) return 'Lots left';
  return 'Full';
}

export function refillsIn(reset: string): string {
  const t = Date.parse(reset);
  if (!Number.isFinite(t)) return 'Refills every day';
  const h = Math.max(0, (t - Date.now()) / 3_600_000);
  if (h < 1) return 'Refills in under an hour';
  return `Refills in ${Math.round(h)} hour${Math.round(h) === 1 ? '' : 's'}`;
}
