/**
 * One device per account. Signing in claims the account for that device (a random id the app
 * keeps in its storage and sends as `X-Slate-Device`); requests from any other device are then
 * refused with 401 and that device signs out. The newest sign-in always wins, so a lost phone
 * never locks anyone out.
 *
 * The claim is stored in `devices/{uid}` (server-written only; the owner may read it), and read through a short
 * cache so most requests cost no Firestore read.
 */
import type { NextFunction, Request, Response } from 'express';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { authDisabled, caller, firebaseApp } from './auth.ts';
import { HttpError } from './http.ts';

export const DEVICE_HEADER = 'x-slate-device';
const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/;
const CACHE_MS = 15_000;

export interface DeviceStore {
  get(uid: string): Promise<string | null>;
  set(uid: string, device: string, at: number): Promise<void>;
}

export class MemoryDeviceStore implements DeviceStore {
  private map = new Map<string, string>();
  async get(uid: string) {
    return this.map.get(uid) ?? null;
  }
  async set(uid: string, device: string, _at: number) {
    this.map.set(uid, device);
  }
}

export class FirestoreDeviceStore implements DeviceStore {
  private dbInstance: Firestore | null = null;
  private get db(): Firestore {
    return (this.dbInstance ??= getFirestore(firebaseApp()));
  }
  async get(uid: string) {
    const snap = await this.db.doc(`devices/${uid}`).get();
    const d = snap.get('id');
    return typeof d === 'string' ? d : null;
  }
  async set(uid: string, device: string, at: number) {
    await this.db.doc(`devices/${uid}`).set({ id: device, at });
  }
}

let store: DeviceStore | null = null;
const deviceStore = (): DeviceStore => (store ??= authDisabled() ? new MemoryDeviceStore() : new FirestoreDeviceStore());
/** For tests. */
export function setDeviceStore(s: DeviceStore | null): void {
  store = s;
  cache.clear();
}

const cache = new Map<string, { id: string | null; at: number }>();

async function claimed(uid: string): Promise<string | null> {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.id;
  const id = await deviceStore().get(uid);
  cache.set(uid, { id, at: Date.now() });
  if (cache.size > 20_000) cache.delete(cache.keys().next().value!);
  return id;
}

export const deviceOf = (req: Request): string | null => {
  const v = req.headers[DEVICE_HEADER];
  const s = Array.isArray(v) ? v[0] : v;
  return s && DEVICE_ID.test(s) ? s : null;
};

/** Makes this device the account's only one. Returns when it did, for the app to compare with. */
export async function claimDevice(uid: string, device: string): Promise<number> {
  const at = Date.now();
  await deviceStore().set(uid, device, at);
  cache.set(uid, { id: device, at });
  return at;
}

/**
 * Refuses a request from a device other than the one that signed in last. Runs after
 * requireAuth. A request without the header comes from an app built before this check and is let
 * through, so an older installed app keeps working until it updates.
 */
export async function requireDevice(req: Request, res: Response, next: NextFunction): Promise<void> {
  const device = deviceOf(req);
  // With sign-in checks off (local tests) every browser is the same "dev" user: no limit.
  if (!device || authDisabled()) return next();
  try {
    const { uid } = caller(res);
    const current = await claimed(uid);
    // No claim yet (an account from before this check): this device takes it.
    if (current === null) {
      await claimDevice(uid, device);
      return next();
    }
    if (current !== device) {
      return next(new HttpError(401, 'Your account was signed in on another device, so it was signed out here.', { 'X-Slate-Reason': 'other-device' }));
    }
    next();
  } catch (err) {
    // A Firestore hiccup must not take the app down: let the request through and log the kind.
    console.error('[device] check failed:', (err as Error).name, String((err as Error).message).slice(0, 200));
    next();
  }
}
