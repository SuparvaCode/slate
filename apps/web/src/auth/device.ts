/**
 * One device per account. This device keeps a random id in its storage and sends it with every
 * API request. A fresh sign-in claims the account for this device; the server then refuses the
 * other devices, and they sign out with a message. The newest sign-in always wins.
 */
import type { User } from 'firebase/auth';

const KEY = 'slate.device.v1';
const CLAIMED = 'slate.device.claimed';

function make(): string {
  const a = new Uint8Array(18);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let id: string | null = null;
export function deviceId(): string {
  if (id) return id;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && /^[A-Za-z0-9_-]{16,64}$/.test(saved)) return (id = saved);
    id = make();
    localStorage.setItem(KEY, id);
  } catch {
    id ??= make();
  }
  return id;
}

/** The uid this device last claimed, so a reload does not claim again (and sign others out). */
const claimedFor = (): string | null => {
  try {
    return localStorage.getItem(CLAIMED);
  } catch {
    return null;
  }
};

let claiming: Promise<void> | null = null;

/**
 * Claims the account for this device after a sign-in. Requests wait for it, so the first ones
 * are not refused because an older device still holds the claim. A restored session (a reload)
 * keeps the claim it had: if another device took it meanwhile, this one is signed out.
 */
export function claimAfterSignIn(user: User, fresh: boolean): Promise<void> {
  if (!fresh && claimedFor() === user.uid) return Promise.resolve();
  let mine: Promise<void> | null = null;
  mine = (async () => {
    try {
      const token = await user.getIdToken();
      const r = await fetch('/api/me/device', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'X-Slate-Device': deviceId() },
      });
      if (r.ok) localStorage.setItem(CLAIMED, user.uid);
    } catch {
      // offline: the next sign-in claims it
    } finally {
      // A later claim may have started meanwhile; only this one's own marker is cleared.
      if (claiming === mine) claiming = null;
    }
  })();
  claiming = mine;
  return mine;
}

export const pendingClaim = (): Promise<void> | null => claiming;

export function forgetClaim(): void {
  try {
    localStorage.removeItem(CLAIMED);
  } catch {
    // ignore
  }
}

/**
 * Watches the account's claim while signed in, so a device that is only reading its board also
 * learns at once that the account was opened elsewhere. Firestore is loaded only for this.
 */
export function watchClaim(uid: string, onLost: () => void): () => void {
  let stop: (() => void) | null = null;
  let done = false;
  void (async () => {
    try {
      const fs = await import('firebase/firestore');
      const { app } = await import('../firebase');
      if (done) return;
      stop = fs.onSnapshot(
        fs.doc(fs.getFirestore(app), 'devices', uid),
        (snap) => {
          const d = snap.get('id');
          // Only a claim by another device counts; no claim yet is fine. The caller asks the
          // server before signing out, so a stale copy can never sign out the newest device.
          if (typeof d === 'string' && d !== deviceId() && !claiming && !snap.metadata.fromCache) onLost();
        },
        () => {
          // rules not deployed or offline: the API check still applies
        },
      );
    } catch {
      // the API check still applies
    }
  })();
  return () => {
    done = true;
    stop?.();
  };
}
