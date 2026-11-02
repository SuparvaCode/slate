/**
 * Which boards changed on this device since they were last copied to the account (see cloud.ts).
 * Kept apart from cloud.ts so the board and the slate list can report changes without loading
 * Firestore. The marks are stored, so a change made just before the app closed is still sent
 * the next time it opens.
 */
const KEY = 'slate.sync.dirty.v1';

interface Marks {
  /** Board storage key -> when it last changed here (ms). "list" is the slate list. */
  changed: Record<string, number>;
  /** Board storage keys removed here, to remove from the account too. */
  removed: Record<string, number>;
}

function load(): Marks {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return {
      changed: d && typeof d.changed === 'object' && d.changed ? d.changed : {},
      removed: d && typeof d.removed === 'object' && d.removed ? d.removed : {},
    };
  } catch {
    return { changed: {}, removed: {} };
  }
}

let marks = load();
let quiet = 0;
const listeners = new Set<() => void>();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(marks));
  } catch {
    // storage full; the change is still sent while the app stays open
  }
  listeners.forEach((fn) => fn());
}

/** A board (or "list") changed on this device. */
export function markDirty(key: string): void {
  if (quiet) return;
  marks.changed[key] = Date.now();
  delete marks.removed[key];
  save();
}

/** A board was deleted on this device. */
export function markRemoved(key: string): void {
  if (quiet) return;
  delete marks.changed[key];
  marks.removed[key] = Date.now();
  save();
}

/** Runs `fn` without marking anything: used while writing what came from the account. */
export function withoutMarks<T>(fn: () => T): T {
  quiet++;
  try {
    return fn();
  } finally {
    quiet--;
  }
}

export const dirtyMarks = (): Marks => ({ changed: { ...marks.changed }, removed: { ...marks.removed } });

/** Clears a mark once the account has the change, unless it changed again meanwhile. */
export function clearMark(key: string, at: number, kind: 'changed' | 'removed' = 'changed'): void {
  if ((marks[kind][key] ?? 0) <= at) {
    delete marks[kind][key];
    save();
  }
}

export function resetMarks(): void {
  marks = { changed: {}, removed: {} };
  save();
}

export function reloadMarks(): void {
  marks = load();
}

export function onDirty(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
