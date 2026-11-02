import { isFigureKind } from './figures';
import { markDirty } from './sync/dirty';
import { fullParams, isSimKind } from './sim';
import { normalize } from './diagram/normalize';
import type { AiEl, El } from './model';
import { boardKey, onBeforeView } from './workspace/key';


const MAX_HISTORY = 100;
const TYPES = new Set(['stroke', 'rect', 'ellipse', 'diamond', 'line', 'arrow', 'text', 'ai', 'figure', 'sim', 'diagram', 'image', 'note']);

export interface Camera {
  x: number;
  y: number;
  z: number;
}

function shallowEqual(a: El, b: El): boolean {
  if (a === b) return true;
  const ra = a as unknown as Record<string, unknown>;
  const rb = b as unknown as Record<string, unknown>;
  const keys = Object.keys(ra);
  if (keys.length !== Object.keys(rb).length) return false;
  return keys.every((k) => ra[k] === rb[k]);
}

function sameElements(a: El[], b: El[]): boolean {
  if (a === b) return true;
  return a.length === b.length && a.every((el, i) => shallowEqual(el, b[i]));
}

/** The elements on the board plus undo/redo. Elements are immutable, so snapshots are cheap. */
export class Board {
  elements: El[] = [];
  version = 0;
  private undoStack: El[][] = [];
  private redoStack: El[][] = [];
  private checkpoint: El[] | null = null;
  private listeners = new Set<() => void>();

  /** The storage key this board was loaded from; its saves always go back there. */
  readonly key = boardKey();

  constructor() {
    live.add(this);
    // Only the last few boards can still have a save pending.
    if (live.size > 4) live.delete(live.values().next().value!);
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    // The board the app subscribes to is the one on screen. (React may build a second board in
    // development and throw it away; that one is never subscribed to.)
    if (current !== this) {
      current = this;
      shown.forEach((f) => f(this));
    }
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;

  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  private push(snapshot: El[]) {
    this.undoStack.push(snapshot);
    if (this.undoStack.length > MAX_HISTORY) this.undoStack.shift();
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }

  /** Replace the elements as one undo step. */
  commit(next: El[]) {
    if (sameElements(next, this.elements)) return;
    this.push(this.elements);
    this.redoStack = [];
    this.elements = next;
    this.emit();
  }

  /** Change the elements with no history entry; used while dragging. Pair with begin()/end(). */
  live(next: El[]) {
    this.elements = next;
    this.emit();
  }

  begin() {
    this.checkpoint = this.elements;
  }

  /** Records one undo step for everything done since begin(), if anything changed. */
  end() {
    const start = this.checkpoint;
    this.checkpoint = null;
    if (start && !sameElements(start, this.elements)) {
      this.push(start);
      this.redoStack = [];
    }
    this.emit();
  }

  /** Abandons everything done since begin(). */
  revert() {
    if (this.checkpoint) this.elements = this.checkpoint;
    this.checkpoint = null;
    this.emit();
  }

  undo(): boolean {
    const prev = this.undoStack.pop();
    if (!prev) return false;
    this.redoStack.push(this.elements);
    this.elements = prev;
    this.emit();
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.push(this.elements);
    this.elements = next;
    this.emit();
    return true;
  }

  /**
   * Updates an AI note without making an undo step. Applied to the history too, so undoing
   * never brings back a note that is still "loading".
   */
  patchAi(id: string, patch: Partial<AiEl>) {
    const apply = (list: El[]) =>
      list.map((e) => (e.id === id && e.type === 'ai' ? { ...e, ...patch } : e));
    this.elements = apply(this.elements);
    this.undoStack = this.undoStack.map(apply);
    this.redoStack = this.redoStack.map(apply);
    if (this.checkpoint) this.checkpoint = apply(this.checkpoint);
    this.emit();
  }

  /**
   * Applies changes made by someone else in a shared room: elements added or replaced by id, and
   * ids removed. The same change goes into the undo history, so undo only ever takes back your
   * own work and never brings back or removes someone else's.
   */
  applyRemote(puts: El[], dels: string[]) {
    if (!puts.length && !dels.length) return;
    const byId = new Map(puts.map((e) => [e.id, e]));
    const gone = new Set(dels);
    const apply = (list: El[]) => {
      const seen = new Set<string>();
      const out: El[] = [];
      for (const e of list) {
        if (gone.has(e.id)) continue;
        const next = byId.get(e.id);
        seen.add(e.id);
        out.push(next ?? e);
      }
      for (const e of puts) if (!seen.has(e.id) && !gone.has(e.id)) out.push(e);
      return out;
    };
    this.elements = apply(this.elements);
    this.undoStack = this.undoStack.map(apply);
    this.redoStack = this.redoStack.map(apply);
    if (this.checkpoint) this.checkpoint = apply(this.checkpoint);
    this.emit();
  }
}

// --- the board on screen ----------------------------------------------------

let current: Board | null = null;
const live = new Set<Board>();
const shown = new Set<(b: Board) => void>();

/** The board the app is showing, for features outside the board (rooms, notebook). */
export const currentBoard = (): Board | null => current;

/** Calls `fn` with each board as it comes on screen (the app makes a new one when the slate changes). */
export function onBoardShown(fn: (b: Board) => void): () => void {
  shown.add(fn);
  // A feature loaded after the board came on screen still gets it.
  if (current) fn(current);
  return () => {
    shown.delete(fn);
  };
}

// --- persistence ------------------------------------------------------------

export interface Saved {
  elements: El[];
  cam: Camera | null;
  theme: 'light' | 'dark' | null;
}

const THEME_KEY = 'slate.theme.last';

/** A new slate opens in the theme last used, not the system default. */
function lastTheme(): 'light' | 'dark' | null {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === 'dark' || t === 'light' ? t : null;
  } catch {
    return null;
  }
}

export function loadSaved(key = boardKey()): Saved {
  const empty: Saved = { elements: [], cam: null, theme: null };
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...empty, theme: lastTheme() };
    const data = JSON.parse(raw) as Partial<Saved>;
    const elements = cleanElements(data.elements);
    const c = data.cam;
    const cam = c && [c.x, c.y, c.z].every(Number.isFinite) ? c : null;
    return { elements, cam, theme: data.theme === 'dark' || data.theme === 'light' ? data.theme : lastTheme() };
  } catch {
    return empty;
  }
}

/**
 * Keeps only elements the board can draw and fills in fields older versions lack. Used for saved
 * boards and for elements that arrive from other people in a shared room.
 */
export function cleanElements(list: unknown, remote = false): El[] {
  return (Array.isArray(list) ? (list as El[]) : [])
      .filter(
        (e): e is El =>
          !!e && typeof e.id === 'string' && TYPES.has(e.type) &&
          (e.type !== 'figure' || isFigureKind(e.kind)) && (e.type !== 'sim' || isSimKind(e.kind)) &&
          (e.type !== 'image' || (typeof e.src === 'string' && e.src.startsWith('data:image/'))) &&
          (e.type !== 'note' || (!!e.block && typeof e.block === 'object' && typeof e.block.t === 'string')),
      )
      .map((e) => {
        // A simulator saved by an older version gets any setting it is missing.
        if (e.type === 'sim') return { ...e, params: fullParams(e.kind, e.params) };
        // A diagram is re-checked on load, so a hand-edited or older save can't break the board.
        if (e.type === 'diagram') return { ...e, diagram: normalize(e.diagram).diagram };
        if (e.type !== 'ai') return e;
        // A request can't survive a reload, and boards saved before handwriting
        // existed have no pen fields; fill them in so the ink can be drawn.
        const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
        const fontSize = num(e.fontSize, 32);
        return {
          ...e,
          fontSize,
          ascent: num(e.ascent, fontSize),
          penWidth: num(e.penWidth, Math.max(2.5, fontSize * 0.1)),
          seed: num(e.seed, 1),
          slant: num(e.slant, 7),
          boxed: typeof e.boxed === 'boolean' ? e.boxed : false,
          typeset: typeof e.typeset === 'boolean' ? e.typeset : false,
          // In a shared room an answer still loading belongs to someone else's request that is running.
          // Cut off by a reload, a closed tab or a switch of board: kept as it was, with what had
          // been read, so Continue carries on from there instead of starting over.
          ...(!remote && e.status === 'loading' ? { status: 'error' as const, error: 'Stopped part-way.', interrupted: true } : null),
          ...(!remote && e.work && e.work.phase !== 'done' && e.work.phase !== 'error'
            ? { work: { ...e.work, phase: 'error' as const, error: 'Stopped part-way. Continue picks up from what was read.' } }
            : null),
        };
      });
}

// Switching slates remounts the board, which cancels its pending autosave; save it now instead.
export function flushBoard(): void {
  if (current) saveBoard({ elements: current.elements, cam: lastSaved?.cam ?? null, theme: lastSaved?.theme ?? null }, current.key);
}
onBeforeView(flushBoard);

/** The last thing saved to the current key: the camera, for features that place things in view. */
export let lastSaved: Saved | null = null;
const savedListeners = new Set<(s: Saved) => void>();

/** Calls `fn` after every save of the board on screen. */
export function onSaved(fn: (s: Saved) => void): () => void {
  savedListeners.add(fn);
  return () => {
    savedListeners.delete(fn);
  };
}

export function saveBoard(saved: Saved, key?: string): boolean {
  // A save still pending from a board that was just switched away from goes to that board's key,
  // never to the slate now on screen.
  key ??= [...live].find((b) => b.elements === saved.elements)?.key ?? boardKey();
  if (key === boardKey()) {
    lastSaved = saved;
    savedListeners.forEach((fn) => fn(saved));
  }
  try {
    if (saved.theme) localStorage.setItem(THEME_KEY, saved.theme);
    const raw = JSON.stringify({ v: 1, ...saved });
    if (localStorage.getItem(key) !== raw) {
      localStorage.setItem(key, raw);
      markDirty(key);
    }
    return true;
  } catch {
    return false; // storage full or blocked
  }
}
