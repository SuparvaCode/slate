/**
 * Public share links. The owner shares a board from the dashboard: a snapshot of it is stored
 * under an unguessable id, and anyone with the link can view it, signed in or not, until it
 * expires or the owner stops sharing. One link per board: sharing again updates the snapshot and
 * keeps the link.
 *
 * Stored in `shares/{id}` (server only; the Firestore rules close it to clients).
 */
import { randomBytes } from 'node:crypto';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { authDisabled, firebaseApp } from './auth.ts';
import { HttpError } from './http.ts';

export const SHARE_ID = /^[A-Za-z0-9_-]{22}$/;
/** A Firestore document holds at most 1 MiB; the snapshot leaves room for the other fields. */
export const MAX_SNAPSHOT_CHARS = 900_000;
const MAX_SHARES_PER_USER = 200;

export interface Share {
  id: string;
  uid: string;
  slate: string;
  title: string;
  theme: 'light' | 'dark';
  /** The board's elements, as JSON. */
  elements: string;
  createdAt: number;
  updatedAt: number;
  /** Epoch ms, or null for a link that never expires. */
  expiresAt: number | null;
}

export type ShareInfo = Pick<Share, 'id' | 'slate' | 'title' | 'updatedAt' | 'expiresAt'>;

export interface ShareStore {
  get(id: string): Promise<Share | null>;
  byOwner(uid: string): Promise<Share[]>;
  put(share: Share): Promise<void>;
  remove(id: string): Promise<void>;
}

export class MemoryShareStore implements ShareStore {
  private map = new Map<string, Share>();
  async get(id: string) {
    return this.map.get(id) ?? null;
  }
  async byOwner(uid: string) {
    return [...this.map.values()].filter((s) => s.uid === uid);
  }
  async put(share: Share) {
    this.map.set(share.id, share);
  }
  async remove(id: string) {
    this.map.delete(id);
  }
}

export class FirestoreShareStore implements ShareStore {
  private dbInstance: Firestore | null = null;
  private get db(): Firestore {
    return (this.dbInstance ??= getFirestore(firebaseApp()));
  }
  async get(id: string) {
    const d = await this.db.doc(`shares/${id}`).get();
    return d.exists ? ({ ...(d.data() as Omit<Share, 'id'>), id } as Share) : null;
  }
  async byOwner(uid: string) {
    const q = await this.db.collection('shares').where('uid', '==', uid).limit(MAX_SHARES_PER_USER + 1).get();
    return q.docs.map((d) => ({ ...(d.data() as Omit<Share, 'id'>), id: d.id }) as Share);
  }
  async put(share: Share) {
    const { id, ...rest } = share;
    await this.db.doc(`shares/${id}`).set(rest);
  }
  async remove(id: string) {
    await this.db.doc(`shares/${id}`).delete();
  }
}

let store: ShareStore | null = null;
const shareStore = (): ShareStore => (store ??= authDisabled() ? new MemoryShareStore() : new FirestoreShareStore());
/** For tests. */
export function setShareStore(s: ShareStore | null): void {
  store = s;
}

const newId = () => randomBytes(16).toString('base64url');
const info = (s: Share): ShareInfo => ({ id: s.id, slate: s.slate, title: s.title, updatedAt: s.updatedAt, expiresAt: s.expiresAt });
const expired = (s: Share, now = Date.now()) => s.expiresAt !== null && s.expiresAt <= now;

/** Makes or updates the link for one of the owner's boards. `days` 0 means it never expires. */
export async function shareBoard(
  uid: string,
  input: { slate: string; title: string; theme: 'light' | 'dark'; elements: unknown[]; days: number },
): Promise<ShareInfo> {
  const elements = JSON.stringify(input.elements);
  if (elements.length > MAX_SNAPSHOT_CHARS) {
    throw new HttpError(413, 'This board is too big to share. Pictures take the most room: remove some and try again.');
  }
  const now = Date.now();
  const mine = await shareStore().byOwner(uid);
  const existing = mine.find((s) => s.slate === input.slate);
  if (!existing && mine.filter((s) => !expired(s, now)).length >= MAX_SHARES_PER_USER) {
    throw new HttpError(429, `You can share up to ${MAX_SHARES_PER_USER} boards at once. Stop sharing one first.`);
  }
  const share: Share = {
    // An expired link is not brought back: sharing again gives a new one.
    id: existing && !expired(existing, now) ? existing.id : newId(),
    uid,
    slate: input.slate,
    title: input.title,
    theme: input.theme,
    elements,
    createdAt: existing && !expired(existing, now) ? existing.createdAt : now,
    updatedAt: now,
    expiresAt: input.days > 0 ? now + input.days * 86_400_000 : null,
  };
  if (existing && existing.id !== share.id) await shareStore().remove(existing.id);
  await shareStore().put(share);
  return info(share);
}

export async function myShares(uid: string): Promise<ShareInfo[]> {
  const now = Date.now();
  return (await shareStore().byOwner(uid)).filter((s) => !expired(s, now)).map(info);
}

/** Stops sharing. Only the owner can. */
export async function stopSharing(uid: string, id: string): Promise<void> {
  const s = await shareStore().get(id);
  if (!s || s.uid !== uid) throw new HttpError(404, 'That link was not found.');
  await shareStore().remove(id);
}

/** What anyone with the link sees. */
export async function viewShare(id: string): Promise<Pick<Share, 'title' | 'theme' | 'updatedAt' | 'expiresAt'> & { elements: unknown }> {
  if (!SHARE_ID.test(id)) throw new HttpError(404, 'This link does not exist.');
  const s = await shareStore().get(id);
  if (!s) throw new HttpError(404, 'This link does not exist, or its owner stopped sharing it.');
  if (expired(s)) {
    // Expired snapshots are removed when someone tries them.
    void shareStore().remove(id).catch(() => {});
    throw new HttpError(410, 'This link has expired.');
  }
  return { title: s.title, theme: s.theme, updatedAt: s.updatedAt, expiresAt: s.expiresAt, elements: JSON.parse(s.elements) };
}
