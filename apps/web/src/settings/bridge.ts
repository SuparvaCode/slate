/**
 * Reads and changes the board's own preferences (theme, write-every-step, finger drawing)
 * without a second copy of their storage. The board keeps these in React state and saves them
 * itself, so it publishes its current values here and registers the setters Settings calls.
 */

export type Theme = 'light' | 'dark';
export type Fingers = 'draw' | 'pan';

interface BoardPrefs {
  theme: Theme;
  solution: boolean;
  fingers: Fingers;
}

interface BoardSetters {
  setTheme: (t: Theme) => void;
  setSolution: (on: boolean) => void;
  setFingers: (f: Fingers) => void;
}

let current: BoardPrefs | null = null;
let setters: BoardSetters | null = null;
let pending: (() => void)[] = [];

/** Called by the board whenever these preferences change. */
export function publishBoard(prefs: BoardPrefs): void {
  current = prefs;
}

/** Called by the board on mount; returns the disconnect. Runs anything waiting for the board. */
export function connectBoard(s: BoardSetters): () => void {
  setters = s;
  const waiting = pending;
  pending = [];
  for (const run of waiting) run();
  return () => {
    if (setters === s) setters = null;
  };
}

/** The board shows the finger-drawing option only on screens with touch input. */
const touchy = () =>
  typeof navigator !== 'undefined' &&
  (navigator.maxTouchPoints > 0 || (typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches));

const THEME_KEY = 'slate.theme.last';
const themeListeners = new Set<() => void>();

/** The theme with no board open: the last one used, dark by default. */
export function storedTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    if (t === 'light' || t === 'dark') return t;
  } catch {
    // storage blocked
  }
  return 'dark';
}

/** Calls `fn` when the theme is changed with no board open (from Settings on the dashboard). */
export function onStoredTheme(fn: () => void): () => void {
  themeListeners.add(fn);
  return () => {
    themeListeners.delete(fn);
  };
}

export const readTheme = (): Theme | null => current?.theme ?? (setters ? null : storedTheme());

export const canSetTheme = () => true;

export function setTheme(t: Theme): boolean {
  if (setters) {
    if (current?.theme !== t) setters.setTheme(t);
    return true;
  }
  try {
    localStorage.setItem(THEME_KEY, t);
  } catch {
    // storage blocked; it still applies for this visit
  }
  document.documentElement.dataset.theme = t;
  themeListeners.forEach((fn) => fn());
  return true;
}

export const readSolution = (): boolean | null => (setters ? (current?.solution ?? null) : null);

export function setSolution(on: boolean): boolean {
  if (!setters) return false;
  if (current?.solution !== on) setters.setSolution(on);
  return true;
}

/** null when the screen has no touch input. */
export const readFingers = (): Fingers | null => (setters && touchy() ? (current?.fingers ?? null) : null);

export function setFingers(mode: Fingers): boolean {
  if (readFingers() === null) return false;
  if (current?.fingers !== mode) setters!.setFingers(mode);
  return true;
}

/** Runs `apply` once the board is mounted (at once if it already is). */
export function whenBoardReady(apply: () => void): void {
  if (setters) apply();
  else pending.push(apply);
}
