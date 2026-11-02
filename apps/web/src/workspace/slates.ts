/**
 * Slates: separate boards with titles, like chats in a chat app. Each slate keeps its own board
 * (and its rough boards) in its own storage keys; see key.ts. A slate without a title the user
 * typed is named automatically from what is on it.
 */
import { currentView, setView, slateKey, subKey } from './key';
import { markDirty, markRemoved } from '../sync/dirty';

export interface RoughBoard {
  id: string;
  title: string;
}

export interface SlateInfo {
  id: string;
  title: string;
  /** True once the user typed a title; automatic naming never replaces it. */
  named: boolean;
  createdAt: number;
  updatedAt: number;
  /** Rough boards: scratch work that never touches the slate itself. */
  subs: RoughBoard[];
  /** Set when this slate is the shared board of a Collaborate room. */
  room?: string;
}

const LIST_KEY = 'slate.slates.v1';
const MAX_SLATES = 200;
export const MAX_SUBS = 8;
const ID = /^[a-z0-9]{1,24}$/;

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function fresh(id = 'first'): SlateInfo {
  const now = Date.now();
  return { id, title: 'Untitled slate', named: false, createdAt: now, updatedAt: now, subs: [] };
}

function read(): SlateInfo[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LIST_KEY) ?? '[]');
    if (Array.isArray(raw)) {
      const list: SlateInfo[] = raw
        .filter((s) => s && typeof s.id === 'string' && ID.test(s.id) && typeof s.title === 'string')
        .map((s) => ({
          ...s,
          subs: Array.isArray(s.subs) ? s.subs.filter((b: RoughBoard) => b && ID.test(b.id) && typeof b.title === 'string') : [],
          room: typeof s.room === 'string' && /^[A-Z2-9]{6}$/.test(s.room) ? s.room : undefined,
        }));
      if (list.length) return list;
    }
  } catch {
    // fall through to the first slate
  }
  return [fresh()];
}

let list: SlateInfo[] = read();
// The view must name a slate that exists.
if (!list.some((s) => s.id === currentView().slate)) setView({ slate: list[0].id, sub: null });

/** Reads the list again after the account's copy was written to this device (sync/cloud.ts). */
export function reloadSlates(): void {
  list = read();
  if (!list.some((s) => s.id === currentView().slate)) setView({ slate: list[0].id, sub: null });
  version++;
  listeners.forEach((fn) => fn());
}

const listeners = new Set<() => void>();
let version = 0;

function persist() {
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(list));
    markDirty('list');
  } catch {
    // storage full; the list lasts for this visit
  }
  version++;
  listeners.forEach((fn) => fn());
}

export const slatesVersion = () => version;
export function onSlates(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Newest first. */
export const slates = (): SlateInfo[] => [...list].sort((a, b) => b.updatedAt - a.updatedAt);
export const getSlate = (id: string): SlateInfo | undefined => list.find((s) => s.id === id);
export const activeSlate = (): SlateInfo => getSlate(currentView().slate) ?? list[0];

export function openSlate(id: string, sub: string | null = null): void {
  const s = getSlate(id);
  if (!s) return;
  setView({ slate: id, sub: sub && s.subs.some((b) => b.id === sub) ? sub : null });
  version++;
  listeners.forEach((fn) => fn());
}

export function newSlate(title = '', room?: string): SlateInfo {
  const s: SlateInfo = { ...fresh(newId()), title: title.trim().slice(0, 60) || 'Untitled slate', named: !!title.trim(), room };
  list.push(s);
  // The oldest slates beyond the cap are forgotten along with their boards.
  while (list.length > MAX_SLATES) {
    const old = [...list].sort((a, b) => a.updatedAt - b.updatedAt).find((x) => x.id !== currentView().slate);
    if (!old) break;
    dropStorage(old);
    list = list.filter((x) => x !== old);
  }
  persist();
  openSlate(s.id);
  return s;
}

/** A new slate whose board is `raw` (a saved board's JSON), already open. Used for copies of shared boards. */
export function newSlateWithBoard(title: string, raw: string): SlateInfo {
  const s = newSlate(title);
  try {
    localStorage.setItem(slateKey(s.id), raw);
    markDirty(slateKey(s.id));
  } catch {
    // storage full; the empty slate is still there
  }
  return s;
}

export function renameSlate(id: string, title: string, byUser = true): void {
  const s = getSlate(id);
  const t = title.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!s || !t || (!byUser && s.named)) return;
  s.title = t;
  if (byUser) s.named = true;
  persist();
}

/** Marks the slate as used now, so it moves to the top of the list. */
export function touchSlate(id = currentView().slate): void {
  const s = getSlate(id);
  if (!s || Date.now() - s.updatedAt < 30_000) return;
  s.updatedAt = Date.now();
  persist();
}

export function setSlateRoom(id: string, room: string | undefined): void {
  const s = getSlate(id);
  if (!s) return;
  s.room = room;
  persist();
}

function dropStorage(s: SlateInfo) {
  try {
    localStorage.removeItem(slateKey(s.id));
    markRemoved(slateKey(s.id));
    for (const b of s.subs) {
      localStorage.removeItem(subKey(s.id, b.id));
      markRemoved(subKey(s.id, b.id));
    }
  } catch {
    // storage blocked
  }
}

export function removeSlate(id: string): void {
  const s = getSlate(id);
  if (!s) return;
  const wasOpen = currentView().slate === id;
  // Switch away first, so the board on screen saves to its own key and not to a removed one.
  list = list.filter((x) => x !== s);
  if (!list.length) list.push(fresh(newId()));
  if (wasOpen) setView({ slate: slates()[0].id, sub: null });
  dropStorage(s);
  persist();
}

// --- rough boards ----------------------------------------------------------------------------

export function newRough(slateId: string, title = '', id = newId()): RoughBoard | null {
  const s = getSlate(slateId);
  if (!s || !ID.test(id)) return null;
  const existing = s.subs.find((b) => b.id === id);
  if (existing) return existing;
  if (s.subs.length >= MAX_SUBS) return null;
  const b: RoughBoard = { id, title: title.trim().slice(0, 40) || `Rough ${s.subs.length + 1}` };
  s.subs.push(b);
  persist();
  return b;
}

export function removeRough(slateId: string, id: string): void {
  const s = getSlate(slateId);
  if (!s) return;
  const v = currentView();
  if (v.slate === slateId && v.sub === id) setView({ slate: slateId, sub: null });
  s.subs = s.subs.filter((b) => b.id !== id);
  try {
    localStorage.removeItem(subKey(slateId, id));
    markRemoved(subKey(slateId, id));
  } catch {
    // storage blocked
  }
  persist();
}
