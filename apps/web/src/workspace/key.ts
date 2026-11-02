/**
 * Which board is on screen: a slate, or one of its rough boards. Kept apart from the slate list
 * and the board code so the sign-in gate can read it without loading either. Changing the view
 * changes the storage key, and the app remounts the board with the new key.
 */

/** The first slate keeps the original storage key, so a board drawn before slates existed opens as it was. */
export const DEFAULT_KEY = 'slate.board.v1';
const VIEW_KEY = 'slate.view.v1';
const ID = /^[a-z0-9]{1,24}$/;

export interface View {
  slate: string;
  /** A rough board of this slate, or null for the slate itself. */
  sub: string | null;
}

function load(): View {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
    if (v && typeof v.slate === 'string' && ID.test(v.slate)) {
      return { slate: v.slate, sub: typeof v.sub === 'string' && ID.test(v.sub) ? v.sub : null };
    }
  } catch {
    // storage blocked or junk
  }
  return { slate: 'first', sub: null };
}

let view: View = load();
const listeners = new Set<() => void>();
const beforeChange = new Set<() => void>();

/** Runs `fn` just before the board on screen changes. */
export function onBeforeView(fn: () => void): () => void {
  beforeChange.add(fn);
  return () => {
    beforeChange.delete(fn);
  };
}

export const slateKey = (id: string): string => (id === 'first' ? DEFAULT_KEY : `slate.board.${id}`);
export const subKey = (slate: string, sub: string): string => `${slateKey(slate)}.sub.${sub}`;

/** The storage key of the board on screen. Also used as the board's React key. */
export const boardKey = (): string => (view.sub ? subKey(view.slate, view.sub) : slateKey(view.slate));
export const currentView = (): View => view;

export function setView(next: View): void {
  if (!ID.test(next.slate) || (next.sub !== null && !ID.test(next.sub))) return;
  if (next.slate === view.slate && next.sub === view.sub) return;
  // The board on screen saves what is pending before its key changes.
  beforeChange.forEach((fn) => fn());
  view = { slate: next.slate, sub: next.sub };
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(view));
  } catch {
    // the view lasts for this visit
  }
  listeners.forEach((fn) => fn());
}

export function onView(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
