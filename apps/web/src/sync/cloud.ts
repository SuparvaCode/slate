/**
 * Copies the account's boards between this device and Firestore, so they open on any device.
 *
 * Firestore, under users/{uid}:
 * - store/slates          the slate list (JSON) and when it changed
 * - store/extra           small per-user data (pins, notebook, study history, diagrams, …)
 * - boards/{key}          one board (a slate or a rough board): which version it is and how many parts
 * - boards/{key}/parts/{version}_{n}   the board's saved JSON, cut into parts that fit in a document
 *
 * One device holds an account at a time (see auth/device.ts), so two devices never edit at once.
 * On sign-in the account's copy is read first; a board changed here since it was last sent (an
 * offline change) wins if it is newer. After that each change is sent a few seconds later, and at
 * once when the app goes to the background. A different account signing in on this device first
 * clears the boards of the one before.
 */
import type { User } from 'firebase/auth';
import { app } from '../firebase';
import { slateKey, subKey } from '../workspace/key';
import { clearMark, dirtyMarks, markDirty, onDirty, resetMarks } from './dirty';

const firestore = () => import('firebase/firestore');
type FS = Awaited<ReturnType<typeof firestore>>;

const OWNER_KEY = 'slate.sync.owner';
const VER_KEY = 'slate.sync.ver.v1';
const LIST_KEY = 'slate.slates.v1';
/** Small data that follows the account, sent whole when it changes. */
const EXTRA_KEYS = [
  'slate.dash.v1', 'slate.notebook.v1', 'slate.study.profile.v1', 'slate.study.days.v1', 'slate.study.reviews.v1',
  'slate.memory.v1', 'slate.diagrams.v1', 'slate.hand.v1', 'slate.instruments', 'slate.activity.v1', 'slate.ui.v1',
];
/** Kept when another account signs in on this device: they belong to the device, not the account. */
const DEVICE_KEYS = new Set(['slate.device.v1', 'slate.device.claimed', 'slate.theme.last', 'slate.analytics', 'slate.haptics', 'slate.pen', OWNER_KEY, 'slate.pending-share']);
/** Characters per part. Firestore allows 1 MiB per document; 300k UTF-16 units are at most 900 KB. */
const PART = 300_000;
/** Parts per batch: a commit must stay under 10 MiB. */
const PARTS_PER_BATCH = 8;
const QUIET_MS = 4000;
const MAX_WAIT_MS = 30_000;
const EXTRA_EVERY_MS = 20_000;

const read = (k: string): string | null => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string | null) => {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, v);
  } catch {
    // storage full: this device keeps what it has; the account's copy is still there
  }
};

/** Short, stable fingerprint of a string, to skip sending what the account already has. */
function hash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x5bd1e995);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}${s.length.toString(36)}`;
}

/** key -> fingerprint of what the account has, as far as this device knows. */
function loadVers(): Record<string, string> {
  try {
    const v = JSON.parse(read(VER_KEY) ?? '{}');
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}
let vers = loadVers();
const saveVers = () => write(VER_KEY, JSON.stringify(vers));

interface ListEntry {
  id: string;
  title?: string;
  updatedAt: number;
  subs?: { id: string }[];
}

function parseList(raw: string | null): ListEntry[] {
  try {
    const l = JSON.parse(raw ?? '[]');
    return Array.isArray(l) ? l.filter((s) => s && typeof s.id === 'string') : [];
  } catch {
    return [];
  }
}

/** Every board storage key the slate list names. */
function boardKeys(list: ListEntry[]): string[] {
  const out: string[] = [];
  for (const s of list) {
    out.push(slateKey(s.id));
    for (const b of Array.isArray(s.subs) ? s.subs : []) if (b && typeof b.id === 'string') out.push(subKey(s.id, b.id));
  }
  return out;
}

/** Firestore document ids can't contain "/"; board keys never do, but be safe. */
const docId = (key: string) => key.replace(/\//g, '_');

// --- reading the account's copy ------------------------------------------------------------------

async function fetchBoard(fs: FS, base: ReturnType<FS['doc']>, head: { v: string; n: number }): Promise<string | null> {
  const parts = await Promise.all(
    Array.from({ length: head.n }, (_, i) => fs.getDoc(fs.doc(base, 'parts', `${head.v}_${i}`))),
  );
  let out = '';
  for (const p of parts) {
    const d = p.get('d');
    if (typeof d !== 'string') return null; // torn or missing: keep what this device has
    out += d;
  }
  return out;
}

/** The slate list after sign-in: the account's, plus anything changed here while offline. */
function mergeLists(local: ListEntry[], remote: ListEntry[] | null, localDirty: boolean): ListEntry[] {
  if (!remote) return local;
  if (!localDirty) return remote;
  const byId = new Map<string, ListEntry>();
  for (const s of remote) byId.set(s.id, s);
  for (const s of local) {
    const r = byId.get(s.id);
    if (!r || (s.updatedAt ?? 0) >= (r.updatedAt ?? 0)) byId.set(s.id, s);
  }
  return [...byId.values()];
}

async function pull(fs: FS, uid: string): Promise<void> {
  const db = fs.getFirestore(app);
  const user = fs.doc(db, 'users', uid);
  const marks = dirtyMarks();

  // The slate list.
  const listSnap = await fs.getDoc(fs.doc(user, 'store', 'slates'));
  const remoteRaw = listSnap.exists() ? listSnap.get('list') : null;
  const remote = typeof remoteRaw === 'string' ? parseList(remoteRaw) : null;
  let localList = parseList(read(LIST_KEY));
  // First sync of a device used before boards were synced: a board here with the same id as one in
  // the account (every device's first board is "first") is a different board. It is kept under a
  // new id instead of replacing the account's.
  if (!vers.list && remote?.length) {
    const ids = new Set(remote.map((s) => s.id));
    localList = localList.flatMap((s) => {
      if (!ids.has(s.id)) return [s];
      const raw = read(slateKey(s.id));
      if (!raw || !raw.includes('"elements":[{')) return []; // empty: the account's board is used
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      write(slateKey(id), raw);
      for (const b of s.subs ?? []) {
        const r = read(subKey(s.id, b.id));
        if (r !== null) write(subKey(id, b.id), r);
      }
      const title = typeof s.title === 'string' ? s.title : 'Untitled slate';
      return [{ ...s, id, title: `${title} (this device)`.slice(0, 60), updatedAt: Date.now() }];
    });
  }
  const merged = mergeLists(localList, remote && remote.length ? remote : null, !!marks.changed.list || !vers.list);
  const mergedRaw = JSON.stringify(merged);
  if (merged.length && mergedRaw !== read(LIST_KEY)) write(LIST_KEY, mergedRaw);
  if (typeof remoteRaw === 'string') vers.list = hash(remoteRaw);
  // Anything that differs from the account's copy goes back up.
  if (!remote || mergedRaw !== remoteRaw) markDirty('list');

  // The boards it names.
  const wanted = new Set(boardKeys(merged));
  const heads = await fs.getDocs(fs.collection(user, 'boards'));
  const seen = new Set<string>();
  const jobs: Promise<void>[] = [];
  heads.forEach((h) => {
    const key = h.get('key');
    const v = h.get('v');
    const n = h.get('n');
    const at = h.get('at');
    if (typeof key !== 'string' || typeof v !== 'string' || typeof n !== 'number') return;
    seen.add(key);
    if (!wanted.has(key)) return;
    if (vers[key] === v) return; // this device already has it
    const mine = marks.changed[key];
    if (mine && mine > (typeof at === 'number' ? at : 0)) return; // changed here more recently; sent below
    jobs.push(
      fetchBoard(fs, h.ref, { v, n }).then((raw) => {
        if (raw === null) return;
        write(key, raw);
        vers[key] = v;
        clearMark(key, Date.now());
      }),
    );
  });
  await Promise.all(jobs);

  // Boards here that the account doesn't have yet (made offline, or from before sync) go up.
  for (const key of wanted) if (!seen.has(key) && read(key) !== null) markDirty(key);

  // Small data: the account's copy, unless it changed here since it was last sent.
  const extraSnap = await fs.getDoc(fs.doc(user, 'store', 'extra'));
  const extra = extraSnap.exists() ? extraSnap.data() : null;
  for (const k of EXTRA_KEYS) {
    const field = k.replace(/\./g, '_');
    const remoteV = extra?.[field];
    const localV = read(k);
    const known = vers[`x:${k}`];
    const changedHere = localV !== null && hash(localV) !== known;
    if (typeof remoteV === 'string' && !(changedHere && known)) {
      write(k, remoteV);
      vers[`x:${k}`] = hash(remoteV);
    }
  }
  saveVers();
}

// --- sending changes ---------------------------------------------------------------------------

let ctx: { fs: FS; uid: string } | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let firstDirtyAt = 0;
let pushing: Promise<void> | null = null;
let again = false;

async function pushBoard(fs: FS, uid: string, key: string, raw: string): Promise<void> {
  const db = fs.getFirestore(app);
  const base = fs.doc(db, 'users', uid, 'boards', docId(key));
  const v = hash(raw);
  if (vers[key] === v) return;
  const old = await fs.getDoc(base);
  const n = Math.max(1, Math.ceil(raw.length / PART));
  for (let i = 0; i < n; i += PARTS_PER_BATCH) {
    const batch = fs.writeBatch(db);
    for (let j = i; j < Math.min(n, i + PARTS_PER_BATCH); j++) {
      batch.set(fs.doc(base, 'parts', `${v}_${j}`), { d: raw.slice(j * PART, (j + 1) * PART) });
    }
    await batch.commit();
  }
  // The head moves to the new parts only once they are all written, so a reader never sees half.
  await fs.setDoc(base, { key, v, n, at: Date.now() });
  vers[key] = v;
  saveVers();
  // The previous version's parts go.
  const ov = old.get('v');
  const on = old.get('n');
  if (typeof ov === 'string' && ov !== v && typeof on === 'number') {
    const batch = fs.writeBatch(db);
    for (let j = 0; j < Math.min(on, 400); j++) batch.delete(fs.doc(base, 'parts', `${ov}_${j}`));
    await batch.commit().catch(() => {});
  }
}

async function removeBoard(fs: FS, uid: string, key: string): Promise<void> {
  const db = fs.getFirestore(app);
  const base = fs.doc(db, 'users', uid, 'boards', docId(key));
  const old = await fs.getDoc(base);
  const batch = fs.writeBatch(db);
  const ov = old.get('v');
  const on = old.get('n');
  if (typeof ov === 'string' && typeof on === 'number') {
    for (let j = 0; j < Math.min(on, 400); j++) batch.delete(fs.doc(base, 'parts', `${ov}_${j}`));
  }
  batch.delete(base);
  await batch.commit();
  delete vers[key];
  saveVers();
}

async function pushExtra(fs: FS, uid: string): Promise<void> {
  const patch: Record<string, string> = {};
  for (const k of EXTRA_KEYS) {
    const v = read(k);
    // Each field must fit; a very large diagram library stays on this device.
    if (v === null || v.length > 80_000) continue;
    const h = hash(v);
    if (vers[`x:${k}`] === h) continue;
    patch[k.replace(/\./g, '_')] = v;
    vers[`x:${k}`] = h;
  }
  if (!Object.keys(patch).length) return;
  await fs.setDoc(fs.doc(fs.getFirestore(app), 'users', uid, 'store', 'extra'), patch, { merge: true });
  saveVers();
}

async function pushAll(): Promise<void> {
  if (!ctx) return;
  const { fs, uid } = ctx;
  const marks = dirtyMarks();
  for (const [key, at] of Object.entries(marks.changed)) {
    if (ctx?.uid !== uid) return;
    try {
      if (key === 'list') {
        const raw = read(LIST_KEY);
        if (raw && vers.list !== hash(raw)) {
          await fs.setDoc(fs.doc(fs.getFirestore(app), 'users', uid, 'store', 'slates'), { list: raw, at: Date.now() });
          vers.list = hash(raw);
          saveVers();
        }
      } else {
        const raw = read(key);
        if (raw === null) await removeBoard(fs, uid, key);
        else await pushBoard(fs, uid, key, raw);
      }
      clearMark(key, at);
    } catch {
      // offline or refused: the mark stays, and the change is sent next time
    }
  }
  for (const [key, at] of Object.entries(marks.removed)) {
    try {
      await removeBoard(fs, uid, key);
      clearMark(key, at, 'removed');
    } catch {
      // sent next time
    }
  }
  await pushExtra(fs, uid).catch(() => {});
}

/** Sends what changed; a call while sending runs once more afterwards. */
export function flushSync(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  firstDirtyAt = 0;
  if (pushing) {
    again = true;
    return pushing;
  }
  pushing = pushAll().finally(() => {
    pushing = null;
    if (again) {
      again = false;
      void flushSync();
    }
  });
  return pushing;
}

function schedule() {
  if (!ctx) return;
  const now = Date.now();
  if (!firstDirtyAt) firstDirtyAt = now;
  clearTimeout(timer);
  // Waits for a pause in the work, but never longer than MAX_WAIT_MS while drawing goes on.
  const wait = Math.max(0, Math.min(QUIET_MS, firstDirtyAt + MAX_WAIT_MS - now));
  timer = setTimeout(() => void flushSync(), wait);
}

// --- starting and stopping ---------------------------------------------------------------------

/** Removes the previous account's data from this device. */
function clearDevice() {
  const drop: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('slate.') && !DEVICE_KEYS.has(k)) drop.push(k);
    }
  } catch {
    return;
  }
  for (const k of drop) write(k, null);
  resetMarks();
  vers = {};
}

export type SyncResult = 'ready' | 'reload';

/**
 * Brings this device up to date with the account. Resolves 'reload' when another account's data
 * was cleared and the page must start again; otherwise 'ready' (also when offline, after a wait).
 */
export async function startSync(user: User, timeoutMs = 10_000): Promise<SyncResult> {
  const owner = read(OWNER_KEY);
  if (owner && owner !== user.uid) {
    clearDevice();
    write(OWNER_KEY, user.uid);
    return 'reload';
  }
  const fs = await firestore();
  ctx = { fs, uid: user.uid };
  const first = !owner;
  write(OWNER_KEY, user.uid);
  // A device that had boards before sync existed sends them all to the account.
  if (first) {
    vers = {};
    saveVers();
  }
  let timedOut = false;
  await Promise.race([
    pull(fs, user.uid).catch((e) => {
      if (import.meta.env.DEV) console.warn('Slate: could not read boards from the account.', e);
    }),
    new Promise<void>((r) =>
      setTimeout(() => {
        timedOut = true;
        r();
      }, timeoutMs),
    ),
  ]);
  if (timedOut && import.meta.env.DEV) console.warn('Slate: the account took too long; using this device’s boards.');
  if (Object.keys(dirtyMarks().changed).length || Object.keys(dirtyMarks().removed).length) schedule();
  return 'ready';
}

let stopFns: (() => void)[] = [];

/** Keeps sending changes while signed in. Returns a function that stops it. */
export function runSync(): () => void {
  const onHide = () => {
    if (document.visibilityState === 'hidden') void flushSync();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', onHide);
  const extra = setInterval(() => ctx && void pushExtra(ctx.fs, ctx.uid).catch(() => {}), EXTRA_EVERY_MS);
  stopFns = [
    onDirty(schedule),
    () => document.removeEventListener('visibilitychange', onHide),
    () => window.removeEventListener('pagehide', onHide),
    () => clearInterval(extra),
  ];
  return () => {
    void flushSync();
    stopFns.forEach((fn) => fn());
    stopFns = [];
    ctx = null;
  };
}

/** Deletes the account's boards from Firestore and this device. Called just before the account is deleted. */
export async function wipeAccountData(uid: string): Promise<void> {
  ctx = null;
  const fs = await firestore();
  const db = fs.getFirestore(app);
  const user = fs.doc(db, 'users', uid);
  const heads = await fs.getDocs(fs.collection(user, 'boards'));
  for (const h of heads.docs) {
    const parts = await fs.getDocs(fs.collection(h.ref, 'parts'));
    const refs = [...parts.docs.map((p) => p.ref), h.ref];
    for (let i = 0; i < refs.length; i += 400) {
      const batch = fs.writeBatch(db);
      for (const r of refs.slice(i, i + 400)) batch.delete(r);
      await batch.commit();
    }
  }
  const batch = fs.writeBatch(db);
  batch.delete(fs.doc(user, 'store', 'slates'));
  batch.delete(fs.doc(user, 'store', 'extra'));
  await batch.commit();
  clearDevice();
  write(OWNER_KEY, null);
}
