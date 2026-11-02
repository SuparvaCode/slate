/** Interface preferences, kept apart from the board so clearing the board keeps them. */

export interface Prefs {
  /** Write the full working instead of only the answer. */
  solution: boolean;
  /** Box the final answer. */
  box: boolean;
  /** Typeset answers instead of handwriting them. */
  typeset: boolean;
  /** What a finger does on a touch screen: draw, or only move and zoom the board. */
  fingers: 'draw' | 'pan';
  /** Eraser: rub out part of a stroke, or remove whole strokes. */
  eraser: 'part' | 'stroke';
  /** Index into the eraser sizes. */
  eraserSize: number;
  workOpen: boolean;
  workCollapsed: boolean;
  /** Top-left of the Work window in screen pixels, or null for the default spot. */
  workPos: { x: number; y: number } | null;
}

const KEY = 'slate.ui.v1';

const DEFAULTS: Prefs = {
  solution: false, box: true, typeset: false, fingers: 'draw', eraser: 'part', eraserSize: 1,
  // On a phone the Work window would cover the board, so it starts closed there.
  workOpen: typeof window === 'undefined' ? true : window.innerWidth >= 900,
  workCollapsed: false, workPos: null,
};

export function loadPrefs(): Prefs {
  try {
    const data = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Prefs>;
    const pos = data.workPos;
    return {
      solution: typeof data.solution === 'boolean' ? data.solution : DEFAULTS.solution,
      box: typeof data.box === 'boolean' ? data.box : DEFAULTS.box,
      typeset: typeof data.typeset === 'boolean' ? data.typeset : DEFAULTS.typeset,
      fingers: data.fingers === 'pan' || data.fingers === 'draw' ? data.fingers : DEFAULTS.fingers,
      eraser: data.eraser === 'stroke' || data.eraser === 'part' ? data.eraser : DEFAULTS.eraser,
      eraserSize:
        typeof data.eraserSize === 'number' && data.eraserSize >= 0 && data.eraserSize < 4
          ? Math.floor(data.eraserSize)
          : DEFAULTS.eraserSize,
      workOpen: typeof data.workOpen === 'boolean' ? data.workOpen : DEFAULTS.workOpen,
      workCollapsed: typeof data.workCollapsed === 'boolean' ? data.workCollapsed : DEFAULTS.workCollapsed,
      workPos: pos && Number.isFinite(pos.x) && Number.isFinite(pos.y) ? pos : null,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // storage blocked; preferences last for this session only
  }
}

export const WORK_W = 372;
const TITLE_H = 40;
const MARGIN = 12;
const TOP = 64;

/** Where the Work window sits on screen, clamped so it can always be reached. */
export function workRect(p: Prefs, vw: number, vh: number) {
  const h = p.workCollapsed ? TITLE_H : Math.max(TITLE_H, Math.min(580, vh - TOP - 104));
  // On a narrow screen the window is as wide as the screen allows.
  const w = Math.min(WORK_W, Math.max(280, vw - MARGIN * 2));
  const pos = p.workPos ?? { x: vw - w - 16, y: TOP };
  const x = Math.min(Math.max(MARGIN, pos.x), Math.max(MARGIN, vw - w - MARGIN));
  const y = Math.min(Math.max(MARGIN, pos.y), Math.max(MARGIN, vh - TITLE_H - MARGIN));
  return { x, y, w, h };
}
