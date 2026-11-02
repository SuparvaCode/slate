/**
 * The signed-in user's Firestore document, `users/{uid}`. Created on first sign-in, updated
 * with lastLoginAt afterwards, and used to sync settings. Firestore is loaded on demand so it
 * is not part of the first download.
 */
import type { User } from 'firebase/auth';
import { app } from '../firebase';
import { reconcile, setRemotePusher } from '../settings/store';
import type { SyncedSettings } from '../settings/store';

const firestore = () => import('firebase/firestore');

let syncing: { uid: string; done: Promise<void> } | null = null;

/** Rules reject null and oversize fields, so only send what is set. */
function profile(user: User) {
  const out: Record<string, string> = {};
  if (user.displayName) out.displayName = user.displayName.slice(0, 200);
  if (user.email && user.email.length <= 320) out.email = user.email;
  if (user.photoURL && user.photoURL.length <= 2048) out.photoURL = user.photoURL;
  return out;
}

async function run(user: User): Promise<void> {
  const fs = await firestore();
  const db = fs.getFirestore(app);
  const ref = fs.doc(db, 'users', user.uid);
  const snap = await fs.getDoc(ref);

  if (!snap.exists()) {
    const settings = reconcile(null) ?? {};
    await fs.setDoc(ref, {
      ...profile(user),
      createdAt: fs.serverTimestamp(),
      lastLoginAt: fs.serverTimestamp(),
      settings,
    });
  } else {
    const data = snap.data();
    const toPush = reconcile(data.settings);
    const patch: Record<string, unknown> = { lastLoginAt: fs.serverTimestamp() };
    if (user.displayName && user.displayName !== data.displayName) patch.displayName = user.displayName.slice(0, 200);
    if (toPush) patch.settings = toPush;
    await fs.updateDoc(ref, patch);
  }

  setRemotePusher(async (settings: SyncedSettings) => {
    await fs.updateDoc(ref, { settings });
  });
}

/** Creates or refreshes the user's document. Safe to call more than once per sign-in. */
export function syncUserDoc(user: User): Promise<void> {
  if (syncing?.uid === user.uid) return syncing.done;
  setRemotePusher(null);
  const done = run(user).catch((err) => {
    // Sign-in still works without Firestore (offline, rules not deployed yet).
    if (import.meta.env.DEV) console.warn('Slate: could not sync the user profile.', err);
    syncing = null;
  });
  syncing = { uid: user.uid, done };
  return done;
}
