import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import 'katex/dist/katex.min.css';
import './touch.css';
import { haptic } from './haptics';
import { copyText, latexOfAi } from './copy';
import { CopyLayer } from './CopyLayer';
import { fetchAccuracy, fetchHealth, recognizeImage, sendFeedback } from './api';
import { findSpot, handBank, learnHand, readHand, seedFrom, undrawableIn, writeDuration, writtenFor } from './hand';
import { Board, loadSaved, saveBoard } from './board';
import type { Camera } from './board';
import { quantizeStroke } from './model';
import {
  LINE_HEIGHT, SIZES, TEXT_SIZES, boundsIntersect, boundsOf, clamp, highlightSize, hitEl, lassoPick,
  canRotate, flipEl, makeText, rotateEl, scaleEl, textSize, translateEl, uid, unionBounds, visualBounds,
} from './model';
import type { AiEl, Bounds, ColorKey, DiagramEl, El, FigureEl, LineEl, ShapeEl, SimEl, StrokeEl, TextEl, ImageEl } from './model';
import { DiagramStudio } from './diagram/Studio';
import { ProgressPanel } from './ProgressPanel';
import { memorySummary, remember } from './memory';
import { drawGhosts } from './workspace/ghosts';
import { inRoom, localPointer, localStroke, onGhosts } from './workspace/livebus';
import type { DiagramSource, StudioTab } from './diagram/Studio';
import { cardBase, diagramButtonAt, pruneMotions, stepMotion, togglePlay } from './diagram/draw';
import type { Diagram } from './diagram/types';
import { Dock, EraserPanel, History, Status, StylePanel, TopRight, ZoomControls } from './Panels';
import { FigurePicker, pickerTab } from './FigurePicker';
import { SimPanel } from './SimPanel';
import { molFromDiagram } from './sim/molecule';
import {
  CM, INST_CURSOR, INST_LABEL, compassArc, compassParts, dragInstrument, drawInstrument, drawInstrumentSelection, instOutline,
  instrumentHit, loadInstruments, nearestEdge, newInstrument, projectOn, saveInstruments, turnBetween, turnInstrument,
} from './classroom/instruments';
import type { Edge, InstKind, InstPart, Instrument, Protractor } from './classroom/instruments';
import { ClassTimer, ClassroomMenu, RandomPicker, Scoreboard, ScreenShade, Spotlight } from './classroom/Overlays';
import type { OverlayKind } from './classroom/Overlays';
import { ContextMenu } from './ContextMenu';
import type { MenuItem, MenuSpec } from './ContextMenu';
import { Icon } from './icons';
import { CARD_RATIO, CARD_W, SIMS, advance, commitRun, fullParams, pruneRuns, resetPatch, resetRun, runOf, setPlaying, simButtonAt, simGrabAt, simPoint } from './sim';
import type { SimButton, SimKind, SimParams } from './sim';
import { FIGURES } from './figures';
import type { FigureKind } from './figures';
import { ERASER_RADII, cutStroke } from './eraser';
import {
  cornerPoint, drawElement, drawGrid, drawOverlay, exportBoard, renderRegion, rotatable, scalesEvenly, selectionBox,
  selectionHandles, setImageLoadListener,
} from './render';
import type { Corner, Handle } from './render';
import { sharePng } from './native/share';
import { ACCENT, PALETTE, THEME_BG } from './theme';
import type { Theme } from './theme';
import { DRAWING_TOOLS, TOOLS, TOOL_KEYS } from './tools';
import type { Tool } from './tools';
import type { Health, Recognition, RecognizeResponse, SolveEvent, SolveMode, Work } from './types';
import { loadPrefs, savePrefs, workRect } from './prefs';
import type { Prefs } from './prefs';
import { connectBoard, publishBoard } from './settings/bridge';
import { newWork, reduceWork, solveStream } from './solve';
import { WorkWindow } from './WorkWindow';
import { ReadChip } from './ReadChip';
import { chipSpot } from './chipSpot';
import { TypesetNote } from './TypesetNote';
import { StudyPanel } from './StudyPanel';
import type { PlacedImage, StudyTab } from './StudyPanel';
import { NotesWriter } from './notes/session';
import type { WriterHost } from './notes/session';
import { blockText } from './notes/compose';
import { loadProfile } from './notes/study';
import { imageFileIn, shrinkImage } from './notes/image';
import { findColumn } from './notes/space';
import { FONT } from './model';
import { useBack } from './back';

const MIN_Z = 0.1;
const MAX_Z = 8;
const HANDLE_HIT = 14; // screen px
const PALM_SIZE = 48; // a touch contact this wide (CSS px) is a palm, not a finger
const PEN_GUARD_MS = 700; // touches this soon after the pen was last seen are ignored
const LONG_PRESS_MS = 450; // a still finger held this long opens the menu
const LONG_PRESS_SLOP = 8; // px a held finger may drift before the press stops counting
const GESTURE_TICK_MS = 120; // while panning or pinching, React hears about the camera this often
/** Fingers, not a mouse: bigger handles, and a bar of actions over the selection. */
const COARSE = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const penSeenBefore = () => {
  try {
    return localStorage.getItem('slate.pen') === '1';
  } catch {
    return false;
  }
};

type Drag =
  | { kind: 'pan'; id: number; lx: number; ly: number; sx?: number; sy?: number; menu?: boolean }
  /** `rule`: the pen started on an instrument's straight edge, so the line follows it. */
  | { kind: 'stroke'; id: number; rule?: Edge }
  | { kind: 'erase'; id: number; lx: number; ly: number }
  | { kind: 'move'; id: number; sx: number; sy: number; orig: Map<string, El> }
  | { kind: 'simgrab'; id: number; el: string; drag?: (x: number, y: number) => SimParams; drop?: (x: number, y: number) => SimParams | null }
  /** `arc`: the compass pencil is drawing, and has swung round to angle `a` so far. */
  | { kind: 'inst'; id: number; inst: string; part: InstPart; start: Instrument; from: [number, number]; arc?: { a: number } }
  | {
      kind: 'resize'; id: number; anchor: [number, number]; origCorner: [number, number];
      offset: [number, number]; orig: Map<string, El>; uniform: boolean;
      /** A side handle stretches along one axis only. */
      axis?: 'x' | 'y';
    }
  | {
      kind: 'rotate'; id: number; cx: number; cy: number; a0: number;
      px: number; py: number; angle: number; orig: Map<string, El>;
    }
  | { kind: 'marquee'; id: number; sx: number; sy: number; base: string[] }
  | { kind: 'shape'; id: number; sx: number; sy: number }
  | { kind: 'lasso'; id: number }
  | { kind: 'text'; id: number; wx: number; wy: number; cx: number; cy: number };

interface Editing {
  id: string | null;
  x: number;
  y: number;
  value: string;
  fontSize: number;
  color: ColorKey;
}


function makeDraft(
  tool: Tool, sx: number, sy: number, ex: number, ey: number, shift: boolean,
  style: { color: ColorKey; size: number; fill: boolean; figure: FigureKind },
): ShapeEl | LineEl | FigureEl {
  let dx = ex - sx;
  let dy = ey - sy;
  if (tool === 'figure') {
    let w = Math.abs(dx);
    let h = Math.abs(dy);
    if (shift) {
      // Shift keeps the figure's natural proportions.
      const r = FIGURES[style.figure].ratio;
      if (w / r > h) h = w / r;
      else w = h * r;
    }
    return {
      id: 'draft', type: 'figure', kind: style.figure,
      x: dx < 0 ? sx - w : sx, y: dy < 0 ? sy - h : sy, w, h,
      color: style.color, size: style.size, fill: style.fill,
    };
  }
  if (tool === 'line' || tool === 'arrow') {
    if (shift) {
      const len = Math.hypot(dx, dy);
      const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
      dx = Math.cos(a) * len;
      dy = Math.sin(a) * len;
    }
    return { id: 'draft', type: tool, x1: sx, y1: sy, x2: sx + dx, y2: sy + dy, color: style.color, size: style.size };
  }
  if (shift) {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * s;
    dy = Math.sign(dy || 1) * s;
  }
  return {
    id: 'draft', type: tool as 'rect' | 'ellipse' | 'diamond',
    x: Math.min(sx, sx + dx), y: Math.min(sy, sy + dy), w: Math.abs(dx), h: Math.abs(dy),
    color: style.color, size: style.size, fill: style.fill,
  };
}

/** How much two regions overlap, from 0 (apart) to 1 (the same), by intersection over union. */
function overlapRatio(a: Bounds, b: Bounds): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  const inter = w * h;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

function oppositeCorner(c: Corner): Corner {
  return ((c[0] === 't' ? 'b' : 't') + (c[1] === 'l' ? 'r' : 'l')) as Corner;
}

type Side = 'tm' | 'bm' | 'ml' | 'mr';
const OPPOSITE_SIDE: Record<Side, Side> = { tm: 'bm', bm: 'tm', ml: 'mr', mr: 'ml' };
const isSide = (h: Handle): h is Side => h === 'tm' || h === 'bm' || h === 'ml' || h === 'mr';

function sidePoint(b: Bounds, side: Side): [number, number] {
  if (side === 'tm') return [b.x + b.w / 2, b.y];
  if (side === 'bm') return [b.x + b.w / 2, b.y + b.h];
  if (side === 'ml') return [b.x, b.y + b.h / 2];
  return [b.x + b.w, b.y + b.h / 2];
}

const HANDLE_CURSOR: Record<Handle, string> = {
  tl: 'nwse-resize', br: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize',
  tm: 'ns-resize', bm: 'ns-resize', ml: 'ew-resize', mr: 'ew-resize', rot: 'grab',
};

/** A two- or three-finger tap this quick, with the fingers barely moving, is undo or redo. */
const TAP_MS = 280;

/**
 * The selection plus the marks drawn on its cards: ink, shapes and text that lie inside a
 * simulator or diagram and were drawn after it. They move and resize with the card.
 */
function withMarks(elements: El[], sel: El[]): El[] {
  const ids = new Set(sel.map((e) => e.id));
  const out = [...sel];
  elements.forEach((card, i) => {
    if (!ids.has(card.id) || (card.type !== 'sim' && card.type !== 'diagram' && card.type !== 'image')) return;
    for (const el of elements.slice(i + 1)) {
      if (ids.has(el.id) || el.type === 'sim' || el.type === 'diagram' || el.type === 'image' || el.type === 'ai') continue;
      const b = boundsOf(el);
      if (b.x >= card.x - 2 && b.y >= card.y - 2 && b.x + b.w <= card.x + card.w + 2 && b.y + b.h <= card.y + card.h + 2) {
        ids.add(el.id);
        out.push(el);
      }
    }
  });
  return out;
}

const inBox = (b: Bounds, x: number, y: number, pad: number) =>
  x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;


/** Nearest S/M/L/XL index for a stroke width or font size. */
function nearestIdx(value: number, table: number[]): number {
  let best = 0;
  table.forEach((v, i) => {
    if (Math.abs(v - value) < Math.abs(table[best] - value)) best = i;
  });
  return best;
}

export default function App() {
  const [init] = useState(() => {
    const board = new Board();
    const saved = loadSaved();
    board.elements = saved.elements;
    const theme: Theme =
      saved.theme ?? 'dark';
    return { board, cam: saved.cam, theme };
  });
  const board = init.board;
  const version = useSyncExternalStore(board.subscribe, board.getVersion);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const typesetRef = useRef<HTMLDivElement>(null);
  const camRef = useRef<Camera>(init.cam ?? { x: 0, y: 0, z: 1 });
  const [camTick, setCamTick] = useState(0);
  const camDirty = useRef(false);
  const rafRef = useRef(0);
  const animRef = useRef(0);
  const animTimer = useRef(0);

  const [theme, setTheme] = useState<Theme>(init.theme);
  const [tool, setToolState] = useState<Tool>('pen');
  const toolRef = useRef<Tool>('pen');
  const toolBeforeSolve = useRef<Tool>('pen');
  const [color, setColor] = useState<ColorKey>('ink');
  const [sizeIdx, setSizeIdx] = useState(1);
  const [fill, setFill] = useState(false);
  const [figureKind, setFigureKind] = useState<FigureKind>('triangle');
  const [figOpen, setFigOpen] = useState(false);
  /** The simulator whose settings panel is open. */
  const [simPanelId, setSimPanelId] = useState<string | null>(null);
  /** Rulers, set squares, protractors and compasses: over the board, kept apart from its elements. */
  const [instruments, setInstruments] = useState<Instrument[]>(loadInstruments);
  const instRef = useRef(instruments);
  const instHover = useRef(false);
  const [classroomOpen, setClassroomOpen] = useState(false);
  const closeClassroom = useCallback(() => setClassroomOpen(false), []);
  const [overlays, setOverlays] = useState<OverlayKind[]>([]);
  /** The instrument last touched: outlined, given its own bar, and what Delete removes. */
  const [instSel, setInstSel] = useState<string | null>(null);
  const instSelRef = useRef<string | null>(null);
  /** An instrument is in hand: its bar hides until it is let go. */
  const [instBusy, setInstBusy] = useState(false);
  const [instMenu, setInstMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  /** The open context menu: where on screen, and the board point it was opened on. */
  const [menu, setMenu] = useState<{ x: number; y: number; wx: number; wy: number } | null>(null);
  const [, setUiTick] = useState(0);
  /** The AI Diagram studio: which tab, where on the board a new diagram goes, and the diagram being changed. */
  const [studio, setStudio] = useState<{ tab: StudioTab; at: [number, number] | null; editId: string | null; prompt?: string } | null>(null);
  const [progressOpen, setProgressOpen] = useState(false);
  const closeProgress = useCallback(() => setProgressOpen(false), []);
  /** The AI study panel: which tab, where on the board new notes or pictures go, and whether it is minimised. */
  const [study, setStudy] = useState<{ tab: StudyTab; at: [number, number] | null; collapsed: boolean } | null>(null);
  const studyRef = useRef(study);
  studyRef.current = study;
  /** Work marked on the board that a typed question is about; answered beside it, not as notes. */
  const [askFocus, setAskFocus] = useState<{ digest: string; at: [number, number]; label: string } | null>(null);
  const [dropping, setDropping] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  /** Where the next uploaded picture goes, when it was asked for from the board's menu. */
  const uploadAt = useRef<[number, number] | null>(null);
  const studyHost = useRef<WriterHost | null>(null);
  // One teacher per board. It reaches the board through studyHost, which is refreshed every render.
  const [writer] = useState(() => {
    const h = (): WriterHost => studyHost.current!;
    return new NotesWriter({
      elements: () => h().elements(),
      add: (el) => h().add(el),
      view: () => h().view(),
      zoom: () => h().zoom(),
      frame: (b) => h().frame(b),
      write: (id, ms, delay) => h().write(id, ms, delay),
      finish: (id) => h().finish(id),
      context: () => h().context(),
      profile: () => h().profile(),
      onFinished: (plan) => h().onFinished?.(plan),
    });
  });
  useEffect(() => () => writer.stop(), [writer]);
  const writerState = useSyncExternalStore(writer.subscribe, writer.get);
  const studyBusy = writerState.phase === 'planning' || writerState.phase === 'writing' || writerState.phase === 'asking';
  const longPress = useRef<{ id: number; x: number; y: number; timer: number } | null>(null);
  const lastFrame = useRef(0);
  /** A slider in the simulator panel is being dragged: one undo step for the whole drag. */
  const simEditing = useRef(false);
  const [space, setSpace] = useState(false);
  const spaceRef = useRef(false);
  const [panning, setPanning] = useState(false);
  const [selIds, setSelIdsState] = useState<string[]>([]);
  const selIdsRef = useRef<string[]>([]);
  const [editing, setEditingState] = useState<Editing | null>(null);
  const editingRef = useRef<Editing | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [apiDown, setApiDown] = useState(false);
  const [accuracy, setAccuracy] = useState<{ rated: number; correct: number } | null>(null);
  const [handLetters, setHandLetters] = useState(() => Object.keys(handBank().glyphs).length);
  const [prefs, setPrefs] = useState<Prefs>(loadPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  /** Work for solves still in progress; finished work is stored on the answer itself. */
  const [liveWork, setLiveWork] = useState<Record<string, Work>>({});
  /** The answer whose work the Work window shows. */
  const [workId, setWorkId] = useState<string | null>(null);
  const aborts = useRef(new Map<string, AbortController>());
  const [notice, setNoticeState] = useState<string | null>(null);
  const noticeTimer = useRef(0);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });

  /** AI answers currently being written: id -> {start, duration}. */
  const writing = useRef(new Map<string, { t0: number; ms: number }>());
  const writeRaf = useRef(0);
  const drag = useRef<Drag | null>(null);
  const live = useRef<StrokeEl | null>(null);
  const draft = useRef<ShapeEl | LineEl | FigureEl | null>(null);
  const lassoPts = useRef<[number, number][] | null>(null);
  const marquee = useRef<Bounds | null>(null);
  const touches = useRef(new Map<number, { x: number; y: number }>());
  /**
   * Two fingers: they move and zoom the board, or, when they land on the selection, move, turn
   * and scale it about the point between them.
   */
  const pinch = useRef<{
    dist: number; mx: number; my: number; cam: Camera; ang: number; ox: number; oy: number;
    sel: { orig: Map<string, El>; wx: number; wy: number; turn: boolean } | null;
  } | null>(null);
  const tapGesture = useRef<{ t0: number; n: number; moved: boolean; start: Map<number, { x: number; y: number }> } | null>(null);
  const lastPenAt = useRef(-1e9);
  /** The pen pointer that is down right now; touches are ignored while it is. */
  const penDown = useRef<number | null>(null);
  const appRef = useRef<HTMLDivElement>(null);
  /** A pan or pinch is under way: overlays tied to the board fade and React re-renders less. */
  const gesturing = useRef(false);
  const lastCamTick = useRef(0);
  const penNoted = useRef(penSeenBefore());
  const hover = useRef<[number, number] | null>(null);
  const clipboard = useRef<El[]>([]);
  const pasteCount = useRef(0);
  const cursorRef = useRef('crosshair');
  const drawRef = useRef<() => void>(() => {});
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});

  const colors = PALETTE[theme];

  // --- small helpers --------------------------------------------------------

  const setNotice = useCallback((msg: string) => {
    setNoticeState(msg);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNoticeState(null), 3800);
  }, []);

  const requestDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      drawRef.current();
      if (camDirty.current) {
        // The canvas and the typeset layer follow the camera every frame; the React overlays
        // (zoom level, selection bar, chips) only need a few updates while fingers move.
        const now = performance.now();
        if (gesturing.current && now - lastCamTick.current < GESTURE_TICK_MS) return;
        lastCamTick.current = now;
        camDirty.current = false;
        setCamTick((t) => t + 1);
      }
    });
  }, []);

  const setGesturing = useCallback((on: boolean) => {
    if (gesturing.current === on) return;
    gesturing.current = on;
    const app = appRef.current;
    if (app) {
      if (on) app.setAttribute('data-gesture', '');
      else app.removeAttribute('data-gesture');
    }
    // Flush the last camera position to React once the gesture ends.
    if (!on && camDirty.current) {
      lastCamTick.current = 0;
      requestDraw();
    }
  }, [requestDraw]);

  const moveCamera = useCallback(() => {
    camDirty.current = true;
    requestDraw();
  }, [requestDraw]);

  /** Keeps frames coming while an answer is pending or being written. */
  const ensureAnimating = useCallback(() => {
    if (writeRaf.current) return;
    lastFrame.current = performance.now();
    const tick = () => {
      const now = performance.now();
      const dt = (now - lastFrame.current) / 1000;
      lastFrame.current = now;
      for (const [key, anim] of writing.current) {
        if (now - anim.t0 >= anim.ms) writing.current.delete(key);
      }
      // Simulators run on real time; a hidden tab pauses them rather than jumping ahead.
      let sims = false;
      let stopped = false;
      for (const el of board.elements) {
        if (el.type === 'diagram') {
          if (stepMotion(el.id, el.diagram, dt)) sims = true;
          continue;
        }
        if (el.type !== 'sim') continue;
        const was = runOf(el).playing;
        if (advance(el, dt)) sims = true;
        else if (was) stopped = true;
      }
      // A run that just finished changes the Play buttons drawn by the page, not only the canvas,
      // and may want its progress saved in its settings.
      if (stopped) {
        setUiTick((n) => n + 1);
        for (const el of board.elements) {
          if (el.type !== 'sim' || runOf(el).playing) continue;
          const keep = commitRun(el);
          if (keep) setSimParamsRef.current(el.id, keep, false);
        }
      }
      drawRef.current();
      const pending = board.elements.some((e) => e.type === 'ai' && e.status === 'loading');
      writeRaf.current = writing.current.size || pending || sims ? requestAnimationFrame(tick) : 0;
    };
    writeRaf.current = requestAnimationFrame(tick);
  }, [board]);

  /**
   * Runs the pen across an answer, so it appears as if it is being written. With a delay the
   * answer stays hidden until then, so nothing appears while the board is still moving.
   */
  const startWriting = useCallback((id: string, ms: number, delay = 0) => {
    writing.current.set(id, { t0: performance.now() + delay, ms });
    ensureAnimating();
  }, [ensureAnimating]);

  const setSel = useCallback((ids: string[]) => {
    selIdsRef.current = ids;
    setSelIdsState(ids);
    requestDraw();
  }, [requestDraw]);

  const setEditing = useCallback((v: Editing | null) => {
    editingRef.current = v;
    setEditingState(v);
    requestDraw();
  }, [requestDraw]);

  const selectedNow = () => {
    const ids = new Set(selIdsRef.current);
    return board.elements.filter((e) => ids.has(e.id));
  };

  const toWorld = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    const c = camRef.current;
    return [(e.clientX - r.left - c.x) / c.z, (e.clientY - r.top - c.y) / c.z];
  };

  const setTool = useCallback((t: Tool) => {
    if (toolRef.current === t) return;
    if (editingRef.current) finishTextRef.current();
    if (t === 'solve') toolBeforeSolve.current = DRAWING_TOOLS.includes(toolRef.current) || toolRef.current === 'select' ? toolRef.current : 'pen';
    if (t === 'highlight') setColor((c) => (c === 'ink' || c === 'gray' ? 'yellow' : c));
    if (DRAWING_TOOLS.includes(t) || t === 'solve' || t === 'eraser') {
      selIdsRef.current = [];
      setSelIdsState([]);
    }
    toolRef.current = t;
    setToolState(t);
    requestDraw();
  }, [requestDraw]);

  // --- camera ---------------------------------------------------------------

  const animateCam = useCallback((to: Camera, ms = 280) => {
    cancelAnimationFrame(animRef.current);
    window.clearTimeout(animTimer.current);
    const from = { ...camRef.current };
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / ms);
      const k = 1 - Math.pow(1 - p, 3);
      camRef.current = {
        x: from.x + (to.x - from.x) * k,
        y: from.y + (to.y - from.y) * k,
        z: from.z * Math.pow(to.z / from.z, k),
      };
      moveCamera();
      if (p < 1) animRef.current = requestAnimationFrame(step);
    };
    animRef.current = requestAnimationFrame(step);
    // Animation frames pause when the page is hidden; make sure the camera still lands.
    animTimer.current = window.setTimeout(() => {
      cancelAnimationFrame(animRef.current);
      camRef.current = to;
      moveCamera();
    }, ms + 80);
  }, [moveCamera]);

  const stopCamAnim = () => {
    cancelAnimationFrame(animRef.current);
    window.clearTimeout(animTimer.current);
  };

  const zoomAbout = useCallback((factor: number, cx: number, cy: number, animate: boolean) => {
    const c = camRef.current;
    const z = clamp(c.z * factor, MIN_Z, MAX_Z);
    const next = { x: cx - ((cx - c.x) * z) / c.z, y: cy - ((cy - c.y) * z) / c.z, z };
    if (animate) animateCam(next);
    else {
      camRef.current = next;
      moveCamera();
    }
  }, [animateCam, moveCamera]);

  const zoomStep = (factor: number) => zoomAbout(factor, viewport.w / 2, viewport.h / 2, true);

  const resetZoom = () => {
    const c = camRef.current;
    const cx = viewport.w / 2;
    const cy = viewport.h / 2;
    animateCam({ x: cx - ((cx - c.x) / c.z), y: cy - ((cy - c.y) / c.z), z: 1 });
  };

  const fitContent = () => {
    const b = unionBounds(board.elements.map(visualBounds));
    if (!b) {
      animateCam({ x: 0, y: 0, z: 1 });
      return;
    }
    const z = clamp(Math.min((viewport.w - 200) / Math.max(b.w, 1), (viewport.h - 280) / Math.max(b.h, 1)), 0.2, 1.5);
    animateCam({ x: viewport.w / 2 - (b.x + b.w / 2) * z, y: viewport.h / 2 - (b.y + b.h / 2) * z - 10, z });
  };

  // --- drawing --------------------------------------------------------------

  const draw = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    // Above 2x the extra pixels can't be seen, and on 3x phones they cost more than half the frame.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cam = camRef.current;
    const vw = canvas.clientWidth;
    const vh = canvas.clientHeight;

    // Typeset answers are page elements; they follow the camera with the canvas.
    if (typesetRef.current) {
      typesetRef.current.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * cam.x, dpr * cam.y);
    drawGrid(ctx, cam, vw, vh, theme);

    const view: Bounds = { x: -cam.x / cam.z, y: -cam.y / cam.z, w: vw / cam.z, h: vh / cam.z };
    const hidden = editingRef.current?.id;
    const now = performance.now();
    for (const el of board.elements) {
      if (el.id === hidden) continue;
      if (!boundsIntersect(visualBounds(el), view)) continue;
      if (el.type === 'ai' || el.type === 'diagram' || el.type === 'note') {
        const anim = writing.current.get(el.id);
        const progress = anim ? Math.min(1, (now - anim.t0) / anim.ms) : 1;
        drawElement(ctx, el, colors, { progress, now });
      } else {
        drawElement(ctx, el, colors);
      }
    }
    if (live.current) drawElement(ctx, live.current, colors, { live: true });
    // Collaborate: what others are drawing right now, and where their pointers are.
    if (inRoom()) drawGhosts(ctx, cam.z, colors, (id) => board.elements.some((e) => e.id === id));
    if (draft.current) drawElement(ctx, draft.current, colors);
    const instLook = { ink: colors.ink, accent: ACCENT[theme], dark: theme === 'dark' };
    for (const inst of instRef.current) {
      drawInstrument(ctx, inst, cam.z, instLook);
      if (inst.id === instSelRef.current) drawInstrumentSelection(ctx, inst, cam.z, instLook);
    }

    if (hover.current && (toolRef.current === 'eraser' || drag.current?.kind === 'erase')) {
      const r = ERASER_RADII[prefsRef.current.eraserSize] / cam.z;
      ctx.save();
      ctx.beginPath();
      ctx.arc(hover.current[0], hover.current[1], r, 0, Math.PI * 2);
      ctx.fillStyle = colors.ink;
      ctx.globalAlpha = 0.08;
      ctx.fill();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = colors.ink;
      ctx.lineWidth = 1.2 / cam.z;
      ctx.stroke();
      ctx.restore();
    }

    const sel = selectedNow();
    const only = sel.length === 1 ? sel[0] : null;
    const src = only && only.type === 'ai' ? only.sourceBox : null;
    drawOverlay(ctx, {
      selected: sel,
      showHandles: toolRef.current === 'select' && sel.length > 0,
      accent: ACCENT[theme],
      z: cam.z,
      marquee: marquee.current,
      lasso: lassoPts.current,
      sourceBox: src,
      theme,
      handleR: COARSE ? 9 : 6.5,
      angle: drag.current?.kind === 'rotate'
        ? { x: drag.current.px, y: drag.current.py, deg: (drag.current.angle * 180) / Math.PI }
        : null,
    });
  };
  drawRef.current = draw;

  // Redraw whenever the board, selection, theme or tool change.
  useEffect(() => {
    requestDraw();
  }, [version, selIds, theme, editing, tool, requestDraw]);

  // Simulators keep their motion apart from the board: start the clock for any that run (circuits
  // run from the start), and forget the motion of ones that were deleted.
  useEffect(() => {
    const sims = board.elements.filter((e): e is SimEl => e.type === 'sim');
    pruneRuns(new Set(sims.map((e) => e.id)));
    pruneMotions(new Set(board.elements.filter((e) => e.type === 'diagram').map((e) => e.id)));
    if (sims.some((e) => runOf(e).playing)) ensureAnimating();
  }, [version, board, ensureAnimating]);

  // Canvas size.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      // A hidden page measures 0 by 0; keep the last real size until it is shown.
      if (canvas.clientWidth && canvas.clientHeight) setViewport({ w: canvas.clientWidth, h: canvas.clientHeight });
      drawRef.current();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Wheel: scroll pans, Ctrl/Cmd + wheel and trackpad pinch zoom around the cursor.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stopCamAnim();
      if (e.ctrlKey || e.metaKey) {
        const rect = canvas.getBoundingClientRect();
        const d = clamp(e.deltaY, -40, 40);
        zoomAbout(Math.exp(-d * 0.012), e.clientX - rect.left, e.clientY - rect.top, false);
      } else {
        const c = camRef.current;
        c.x -= e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
        c.y -= e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
        moveCamera();
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomAbout, moveCamera]);

  // Collaborate: a frame whenever someone else's live stroke or pointer moves.
  useEffect(() => onGhosts(requestDraw), [requestDraw]);

  // Theme.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Autosave.
  useEffect(() => {
    const t = setTimeout(() => {
      if (!saveBoard({ elements: board.elements, cam: camRef.current, theme })) {
        setNotice("Couldn't save: browser storage is full.");
      }
    }, 500);
    return () => clearTimeout(t);
  }, [version, camTick, theme, board, setNotice]);

  // API health.
  const refreshAccuracy = useCallback(() => {
    fetchAccuracy()
      .then((a) => setAccuracy({ rated: a.rated, correct: a.correct }))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let stopped = false;
    let first = true;
    let timer = 0;
    const check = () => {
      fetchHealth()
        .then((h) => {
          if (stopped) return;
          setHealth(h);
          setApiDown(false);
          if (first) {
            first = false;
            refreshAccuracy();
          }
        })
        .catch(() => !stopped && setApiDown(true))
        .finally(() => {
          if (!stopped) timer = window.setTimeout(check, 10000);
        });
    };
    check();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [refreshAccuracy]);

  // --- text editing ---------------------------------------------------------

  const finishText = () => {
    const ed = editingRef.current;
    if (!ed) return;
    setEditing(null);
    const value = ed.value.replace(/\s+$/, '');
    if (ed.id) {
      const id = ed.id;
      if (!value) board.commit(board.elements.filter((e) => e.id !== id));
      else board.commit(board.elements.map((e) => (e.id === id ? makeText(id, ed.x, ed.y, value, ed.fontSize, ed.color) : e)));
    } else if (value) {
      const el = makeText(uid(), ed.x, ed.y, value, ed.fontSize, ed.color);
      board.commit([...board.elements, el]);
      setTool('select');
      setSel([el.id]);
    }
  };
  const finishTextRef = useRef(finishText);
  finishTextRef.current = finishText;
  // Back: a selection clears first, then text being typed is finished (newest layer wins).
  useBack(selIds.length > 0, () => setSel([]));
  useBack(!!editing, () => finishTextRef.current());

  const startEdit = (el: TextEl) => {
    setSel([]);
    setEditing({ id: el.id, x: el.x, y: el.y, value: el.text, fontSize: el.fontSize, color: el.color });
  };

  const startNewText = (wx: number, wy: number) => {
    const fontSize = TEXT_SIZES[sizeIdx];
    setSel([]);
    setEditing({ id: null, x: wx, y: wy - (fontSize * LINE_HEIGHT) / 2, value: '', fontSize, color });
  };

  // --- AI -------------------------------------------------------------------

  const updatePrefs = (patch: Partial<Prefs>) => setPrefs((p) => ({ ...p, ...patch }));

  useEffect(() => savePrefs(prefs), [prefs]);

  // Settings reads and changes these through the bridge instead of a second copy of their storage.
  useEffect(() => publishBoard({ theme, solution: prefs.solution, fingers: prefs.fingers }),
    [theme, prefs.solution, prefs.fingers]);
  useEffect(() => connectBoard({
    setTheme,
    setSolution: (solution) => setPrefs((p) => ({ ...p, solution })),
    setFingers: (fingers) => setPrefs((p) => ({ ...p, fingers })),
  }), []);

  /** The part of the screen nothing floats over, in pixels: where the AI can be seen writing. */
  const safeArea = () => {
    let left = 20;
    let right = viewport.w - 20;
    const top = 70;
    const bottom = viewport.h - 150; // dock and style panel
    const p = prefsRef.current;
    if (p.workOpen && !p.workCollapsed) {
      const r = workRect(p, viewport.w, viewport.h);
      if (r.x + r.w / 2 > viewport.w / 2) right = Math.min(right, r.x - 16);
      else left = Math.max(left, r.x + r.w + 16);
      // On a narrow screen there is no room beside the window; use the whole width.
      if (right - left < 280) {
        left = 20;
        right = viewport.w - 20;
      }
    }
    // The study panel covers the top right of the board on wider screens.
    const sp = studyRef.current;
    if (sp && !sp.collapsed && viewport.w > 640 && Math.min(right, viewport.w - 412) - left >= 280) right = Math.min(right, viewport.w - 412);
    return { left, right, top, bottom: Math.max(top + 120, bottom) };
  };

  /**
   * Brings a region into view before writing in it, the way a person shifts the page: no move
   * when it is already in view, the smallest pan that fits it otherwise, and a zoom out only
   * when it is too big to fit. Returns how long the move takes.
   */
  const frameRegion = (region: Bounds): number => {
    const safe = safeArea();
    const c = camRef.current;
    const PAD = 28;
    const sw = safe.right - safe.left - PAD * 2;
    const sh = safe.bottom - safe.top - PAD * 2;
    // A window with almost no room (split view, a keyboard over it, mid-resize): leave the camera
    // alone, or it zooms all the way out to fit and stays there once the window is back.
    if (sw < 200 || sh < 120 || document.hidden) return 0;
    const fit = Math.min(sw / Math.max(1, region.w), sh / Math.max(1, region.h));
    let to: Camera;
    if (fit < c.z) {
      const z = Math.max(MIN_Z, fit);
      to = {
        z,
        x: (safe.left + safe.right) / 2 - (region.x + region.w / 2) * z,
        y: (safe.top + safe.bottom) / 2 - (region.y + region.h / 2) * z,
      };
    } else {
      const l = region.x * c.z + c.x;
      const r = (region.x + region.w) * c.z + c.x;
      const t = region.y * c.z + c.y;
      const b = (region.y + region.h) * c.z + c.y;
      let dx = 0;
      let dy = 0;
      if (l < safe.left + PAD) dx = safe.left + PAD - l;
      else if (r > safe.right - PAD) dx = safe.right - PAD - r;
      if (t < safe.top + PAD) dy = safe.top + PAD - t;
      else if (b > safe.bottom - PAD) dy = safe.bottom - PAD - b;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return 0;
      to = { z: c.z, x: c.x + dx, y: c.y + dy };
    }
    animateCam(to, 460);
    return 480;
  };

  /** The part of the board the AI can be seen writing on, in board units. */
  const viewWorld = (): Bounds => {
    const safe = safeArea();
    const c = camRef.current;
    return { x: (safe.left - c.x) / c.z, y: (safe.top - c.y) / c.z, w: (safe.right - safe.left) / c.z, h: (safe.bottom - safe.top) / c.z };
  };

  studyHost.current = {
    elements: () => board.elements,
    add: (el) => board.commit([...board.elements, el]),
    view: viewWorld,
    zoom: () => camRef.current.z,
    frame: frameRegion,
    write: startWriting,
    finish: (id) => {
      writing.current.delete(id);
      requestDraw();
    },
    context: () => memorySummary(),
    profile: loadProfile,
    onFinished: (plan) => {
      haptic('success');
      setNotice(`Notes finished: ${plan.title}`);
    },
  };

  // A picture that finishes decoding is drawn at once.
  useEffect(() => {
    setImageLoadListener(requestDraw);
    return () => setImageLoadListener(null);
  }, [requestDraw]);

  /** Puts a picture on the board in clear space, about a third of the screen wide, and selects it. */
  const placeImage = (img: PlacedImage, at: [number, number] | null) => {
    const c = camRef.current;
    const view = viewWorld();
    const w = Math.min(view.w * 0.6, 340 / c.z);
    const h = (w * img.h) / Math.max(1, img.w);
    const want: [number, number] | null = at ? [at[0] - w / 2, at[1] - h / 2] : null;
    const pos = findColumn(board.elements, view, w, h, 16 / c.z, want);
    const el: ImageEl = {
      id: uid(), type: 'image', color: 'ink', size: SIZES[1], x: pos.x, y: pos.y, w, h, src: img.src,
      ...(img.title ? { title: img.title.slice(0, 160) } : {}), ...(img.source ? { source: img.source.slice(0, 500) } : {}),
    };
    board.commit([...board.elements, el]);
    setTool('select');
    setSel([el.id]);
    frameRegion({ x: el.x, y: el.y, w: el.w, h: el.h });
    haptic('success');
  };

  const addImageFile = async (file: Blob, at: [number, number] | null) => {
    try {
      placeImage(await shrinkImage(file), at);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };
  const addImageRef = useRef(addImageFile);
  addImageRef.current = addImageFile;

  // A picture pasted with Ctrl+V goes on the board (text fields keep their own paste).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const file = imageFileIn(e.clipboardData);
      if (!file) return;
      e.preventDefault();
      void addImageRef.current(file, null);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  /** What the board holds that the AI can read, for "Summarise this board". */
  const boardDigest = (): string => digestOf(board.elements);

  /**
   * What a set of board items says, in words the AI can read. Notes written by the AI count by
   * their whole text, not just their headings: marking a written answer and asking about it used
   * to find "nothing to read".
   */
  const digestOf = (els: readonly El[], max = 440): string => {
    const out: string[] = [];
    for (const e of els) {
      if (e.type === 'ai' && e.status === 'done') {
        const r = e.response?.result;
        const q = r?.latex || r?.text;
        if (q) out.push(`${q} = ${r?.answer_latex || r?.answer_text || '?'}`);
        const steps = e.work?.answer?.steps;
        if (steps?.length) out.push(`working: ${steps.join(' | ')}`);
      } else if (e.type === 'text' && e.text.trim()) out.push(e.text.trim());
      else if (e.type === 'note') {
        const text = blockText(e.block).replace(/\s+/g, ' ').trim();
        if (text) out.push(text);
      } else if (e.type === 'diagram') out.push(`diagram: ${[e.diagram.title, e.prompt].filter(Boolean).join(' — ')}`);
      else if (e.type === 'image') out.push(`picture: ${[e.title, e.source].filter(Boolean).join(' — ')}`);
      else if (e.type === 'sim') out.push(`simulator: ${e.kind}`);
    }
    return [...new Set(out)].join('; ').slice(0, max);
  };

  const summariseBoard = () => {
    const digest = boardDigest();
    if (!digest) {
      setNotice('Solve or type something on the board first, so the AI can read it.');
      return;
    }
    setStudy({ tab: 'notes', at: null, collapsed: false });
    void writer.start({ prompt: `Summarise everything on my board into one page of revision notes, with a checklist at the end. On the board: ${digest}` });
  };

  /**
   * What the student marked, in words the AI can read, and where an answer should be written.
   * Handwriting with no answer yet is read first, so a circled line of working can be explained
   * too. Null when the marks hold nothing that can be read.
   */
  const readSelection = async (els: El[]): Promise<{ digest: string; at: [number, number]; label: string } | null> => {
    const box = selectionBox(els);
    if (!box) return null;
    let digest = digestOf(els, 1100);
    const ink = els.filter((e) => e.type === 'stroke' || e.type === 'text' || e.type === 'line' || e.type === 'rect' || e.type === 'ellipse');
    if (ink.length && els.some((e) => e.type === 'stroke')) {
      setNotice('Reading what you marked…');
      try {
        const r = await recognizeImage(renderRegion(ink, selectionBox(ink)!, PALETTE.light));
        const read = r.result.latex || r.result.text;
        if (read) digest = [read, digest].filter(Boolean).join('; ');
      } catch {
        // explain what was typed, solved or already written, if anything
      }
    }
    digest = digest.slice(0, 1200).trim();
    if (!digest) return null;
    const fs = clamp(19 / camRef.current.z, 4, 200);
    return {
      digest,
      at: [box.x + box.w + fs * 2, box.y],
      label: digest.length > 64 ? `${digest.slice(0, 61)}…` : digest,
    };
  };

  /**
   * "Explain this" / "Summarise selection": a short answer written beside the marks. This used
   * to go through the notes planner, which wrote a whole page about the topic for one question.
   */
  const askAbout = async (els: El[], kind: 'explain' | 'summarise') => {
    const focus = await readSelection(els);
    if (!focus) {
      setNotice('Nothing to read in what you marked. Write, solve or add notes first.');
      return;
    }
    setNoticeState(null);
    setAskFocus(focus);
    setStudy({ tab: 'notes', at: null, collapsed: true });
    try {
      await writer.explain({
        question: kind === 'explain'
          ? 'Explain what I marked, step by step and in simple words, so I understand why each step is done.'
          : 'Summarise what I marked into a few short revision points.',
        context: focus.digest,
        at: focus.at,
      });
    } catch (err) {
      setNotice(`Couldn't explain that: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** "Ask about this…": opens the teacher panel to type a question about the marks. */
  const askSelection = async (els: El[]) => {
    const focus = await readSelection(els);
    if (!focus) {
      setNotice('Nothing to read in what you marked. Write, solve or add notes first.');
      return;
    }
    setNoticeState(null);
    setAskFocus(focus);
    setStudy({ tab: 'notes', at: null, collapsed: false });
  };

  /** One step of a solution the student did not follow, explained beside the answer. */
  const explainStep = (ai: AiEl, index: number) => {
    const a = ai.work?.answer ?? liveWork[ai.id]?.answer;
    if (!a) return;
    const r = ai.response?.result;
    const read = r?.latex || r?.text || ai.work?.read?.latex || '';
    const box = unionBounds([ai.sourceBox, ...(ai.w > 0 ? [boundsOf(ai)] : [])])!;
    const context = `Question: ${read}. Steps: ${a.steps.map((st, i) => `(${i + 1}) ${st}`).join(' ')}`.slice(0, 1200);
    const focus = { digest: context, at: [box.x + box.w + 60, box.y] as [number, number], label: `step ${index + 1} of this answer` };
    setAskFocus(focus);
    setStudy({ tab: 'notes', at: null, collapsed: true });
    void writer
      .explain({
        question: `Explain step ${index + 1} of this solution in more detail, simply, and why it follows.`,
        context,
        at: focus.at,
      })
      .catch((err: unknown) => setNotice(`Couldn't explain that step: ${err instanceof Error ? err.message : String(err)}`));
  };

  const openStudy = (tab: StudyTab, at: [number, number] | null = null) => {
    setProgressOpen(false);
    setClassroomOpen(false);
    setStudy({ tab, at, collapsed: false });
  };

  const pickUpload = (at: [number, number] | null) => {
    uploadAt.current = at;
    uploadRef.current?.click();
  };

  /** Pictures live in the shapes picker, on its Images tab; `at` is where the picture goes. */
  const [figKey, setFigKey] = useState(0);
  const openImages = (at: [number, number] | null) => {
    uploadAt.current = at;
    pickerTab('images');
    // Already open on another tab: open it again on Images.
    setFigKey((n) => n + 1);
    if (toolRef.current === 'figure') setFigOpen(true);
    else setTool('figure');
  };

  const runSolve = (id: string, sources: El[], mode: SolveMode, readLatex?: string) => {
    aborts.current.get(id)?.abort();
    const ctrl = new AbortController();
    aborts.current.set(id, ctrl);
    const current = () => aborts.current.get(id) === ctrl;

    const box = selectionBox(sources)!;
    const png = renderRegion(sources, box, PALETTE.light);
    board.patchAi(id, {
      status: 'loading', error: undefined, interrupted: false, sourceBox: box, w: 0, h: 0, ascent: 0,
      work: undefined, readOverride: readLatex,
    });
    ensureAnimating();
    setWorkId(id);

    let work = newWork(mode);
    setLiveWork((m) => ({ ...m, [id]: work }));
    const ctx: { read: Recognition | null; model: string; corrected: boolean } = {
      read: null, model: '', corrected: false,
    };

    const update = (ev: SolveEvent) => {
      work = reduceWork(work, ev);
      setLiveWork((m) => ({ ...m, [id]: work }));
    };
    /** Stores the finished work on the answer, where it outlives this session. */
    const settle = (final: Work) => {
      if (!current()) return;
      aborts.current.delete(id);
      board.patchAi(id, { work: final });
      setLiveWork((m) => {
        const next = { ...m };
        delete next[id];
        return next;
      });
    };
    const fail = (message: string) => {
      haptic('error');
      board.patchAi(id, { status: 'error', error: message });
      settle(work);
      if (!prefsRef.current.workOpen) setNotice(`Couldn't solve: ${message}`);
    };

    const onAnswer = (ev: Extract<SolveEvent, { type: 'answer' }>) => {
      const read = ctx.read;
      const result: Recognition = {
        kind: read?.kind ?? 'math',
        latex: read?.latex ?? '',
        text: read?.text ?? '',
        sketch_description: read?.sketch_description ?? '',
        intent: read?.intent ?? 'solve',
        answer_latex: ev.answer_latex,
        answer_text: '',
        placement: ev.placement,
        steps: ev.steps,
        columns: ev.columns ?? [],
        uncertain: read?.uncertain ?? [],
        confidence: read?.confidence ?? 0,
      };
      const response: RecognizeResponse = { id: ev.id, saved: ev.saved, model: ctx.model, latency_ms: ev.ms, result };
      board.patchAi(id, { status: 'done', response, doneAt: Date.now() });
      haptic('success');
      // Board memory: what was asked and the answer, filed under its topic.
      if (ev.answer_latex) {
        const asked = read?.latex || read?.text || '';
        remember({
          kind: 'solve', title: asked || ev.answer_latex, tex: !!read?.latex || !asked,
          result: asked ? ev.answer_latex : undefined, words: read?.sketch_description,
        });
      }

      // Learn the user's letterforms from what they wrote, but only from a reading that is
      // right: one the user gave, or one the reader was sure of. Learning from a misread
      // (tan taken for sin) would save their "tan" strokes under the wrong letters.
      const ink = sources.filter((s): s is StrokeEl => s.type === 'stroke');
      const trusted = ctx.corrected || ((read?.alternatives?.length ?? 0) === 0 && (read?.confidence ?? 0) >= 0.9);
      if (trusted && ink.length && read?.latex && learnHand(ink, read.latex).length) {
        setHandLetters(Object.keys(handBank().glyphs).length);
      }

      // If the answer holds a character the hand cannot draw, typeset it rather than show a "?".
      const drawn = board.elements.find((e) => e.id === id);
      if (drawn?.type === 'ai' && !drawn.typeset) {
        const missing = undrawableIn(drawn);
        if (missing.length) {
          board.patchAi(id, { typeset: true });
          setNotice(`Typeset this one: the hand can't draw ${missing.slice(0, 3).join(' ')} yet.`);
        }
      }

      const el = board.elements.find((e) => e.id === id);
      const written = el?.type === 'ai' ? writtenFor(el) : null;
      if (!el || el.type !== 'ai' || !written) {
        board.patchAi(id, { w: 0, h: 0, ascent: 0 });
        settle({ ...work, phase: 'done' });
        return;
      }

      // Measure, find free space for that size, bring it into view, then write.
      const spot = findSpot(
        board.elements,
        new Set([...el.sourceIds, el.id]),
        readHand(sources),
        written,
        ev.placement === 'none' ? 'inline' : ev.placement,
      );
      board.patchAi(id, { x: spot.x, y: spot.y, w: written.w, h: written.h, ascent: written.ascent });
      const answerBox: Bounds = { x: spot.x, y: spot.y - written.ascent, w: written.w, h: written.h };
      const delay = frameRegion(unionBounds([box, answerBox])!);
      const ms = writeDuration(written, el.fontSize);
      startWriting(id, ms, delay);
      window.setTimeout(() => settle({ ...work, phase: 'done' }), delay + ms);
    };

    solveStream(png, mode, (ev) => {
      if (!current()) return;
      if (ev.type === 'read') {
        ctx.read = ev.result;
        ctx.model = ev.model;
        ctx.corrected = !!ev.corrected;
      }
      update(ev);
      // Saved with the board at once, so an answer cut off by a reload continues from this reading.
      if (ev.type === 'read') board.patchAi(id, { work });
      if (ev.type === 'error') fail(ev.message);
      else if (ev.type === 'answer') onAnswer(ev);
    }, ctrl.signal, readLatex, memorySummary()).catch((err: unknown) => {
      if (ctrl.signal.aborted || !current()) return;
      const message = err instanceof Error ? err.message : String(err);
      update({ type: 'error', message });
      fail(message);
    });
  };

  const startSolve = (sources: El[]) => {
    const box = selectionBox(sources)!;
    // Size and pen come from the user's writing. Where the answer goes is decided once it has
    // been written and measured; until then the waiting dots sit at the end of the last line.
    const hand = readHand(sources);
    const inkColor = sources.find((s) => s.type === 'stroke')?.color ?? 'ink';
    const ai: AiEl = {
      id: uid(), type: 'ai', color: inkColor,
      x: hand.lastLine.x + hand.lastLine.w + hand.fontSize * 0.34,
      y: hand.lastLine.y + hand.lastLine.h,
      w: 0, h: 0, ascent: 0,
      fontSize: hand.fontSize, penWidth: hand.penWidth, seed: seedFrom(uid()),
      slant: hand.slant, boxed: prefsRef.current.box, typeset: prefsRef.current.typeset,
      status: 'loading', sourceIds: sources.map((s) => s.id), sourceBox: box, createdAt: Date.now(),
    };
    // One answer per question: an earlier answer to this same writing is replaced, not left
    // behind to be mistaken for the new one.
    const ids = new Set(sources.map((s) => s.id));
    const stale = board.elements.filter(
      (e): e is AiEl => e.type === 'ai' && (e.sourceIds.some((i) => ids.has(i)) || overlapRatio(e.sourceBox, box) > 0.5),
    );
    for (const old of stale) {
      aborts.current.get(old.id)?.abort();
      aborts.current.delete(old.id);
    }
    const staleIds = new Set(stale.map((e) => e.id));
    if (staleIds.size) {
      setLiveWork((m) => Object.fromEntries(Object.entries(m).filter(([k]) => !staleIds.has(k))));
    }
    board.commit([...board.elements.filter((e) => !staleIds.has(e.id)), ai]);
    runSolve(ai.id, sources, prefsRef.current.solution ? 'solution' : 'answer');
  };

  const retrySolve = (ai: AiEl, readLatex?: string) => {
    const ids = new Set(ai.sourceIds);
    const sources = board.elements.filter((e) => ids.has(e.id));
    if (sources.length === 0) {
      board.patchAi(ai.id, { status: 'error', error: 'The writing was erased.' });
      setNotice('The writing for this answer was erased.');
      return;
    }
    runSolve(ai.id, sources, prefsRef.current.solution ? 'solution' : 'answer', readLatex ?? ai.readOverride);
  };

  /** Answers and notes on this board that were cut off part-way. */
  const unfinished = board.elements.filter((e): e is AiEl => e.type === 'ai' && e.status === 'error' && e.interrupted === true);
  const [continueHidden, setContinueHidden] = useState<string | null>(null);
  const continueKey = `${unfinished.map((e) => e.id).join(',')}|${writerState.resumable?.title ?? ''}`;
  const showContinue = (unfinished.length > 0 || (!!writerState.resumable && writerState.phase === 'idle')) && continueHidden !== continueKey;

  /** Picks every cut-off task up where it stopped: answers from what was read, notes from the last block. */
  const continueAll = () => {
    for (const ai of unfinished) {
      // What was read is reused only when it would be trusted anyway (the student's own, or a
      // sure reading); otherwise the writing is read again, so a misread is never kept.
      const r = ai.work?.read;
      const sure = !!r?.latex && (r.corrected || (r.alternatives.length === 0 && r.confidence >= 0.9));
      retrySolve(ai, ai.readOverride ?? (sure ? r!.latex : undefined));
    }
    if (writerState.resumable && writerState.phase === 'idle') {
      setStudy({ tab: 'notes', at: null, collapsed: true });
      writer.resume();
    }
  };

  const giveFeedback = async (ai: AiEl, correct: boolean, corrected?: string) => {
    if (!ai.response) return;
    try {
      await sendFeedback(ai.response.id, correct, corrected);
      board.patchAi(ai.id, { feedback: correct ? 'correct' : 'wrong' });
      refreshAccuracy();
    } catch (err) {
      setNotice(`Couldn't save feedback: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const toggleSolution = () => {
    const on = !prefsRef.current.solution;
    updatePrefs({ solution: on });
    setNotice(on ? 'Solution on: answers include every step of working.' : 'Solution off: only the answer is written.');
  };

  const toggleFingers = () => {
    const next = prefsRef.current.fingers === 'draw' ? 'pan' : 'draw';
    updatePrefs({ fingers: next });
    setNotice(next === 'draw'
      ? 'Fingers draw. Two fingers still move and zoom the board.'
      : 'Fingers move the board. Draw with a pen or the mouse.');
  };

  // The shapes picker opens with the Shapes tool and closes when another tool is chosen.
  useEffect(() => {
    setFigOpen(tool === 'figure');
  }, [tool]);

  const toggleWork = () => {
    const open = !prefsRef.current.workOpen;
    updatePrefs(open ? { workOpen: true, workCollapsed: false } : { workOpen: false });
  };

  /** Changes how one answer looks (handwritten or typeset, boxed or not) and remembers the choice. */
  const restyle = (ai: AiEl, patch: { typeset?: boolean; boxed?: boolean }) => {
    const written = writtenFor({ ...ai, ...patch });
    board.patchAi(ai.id, {
      ...patch,
      ...(written ? { w: written.w, h: written.h, ascent: written.ascent } : null),
    });
    updatePrefs({
      ...(patch.typeset !== undefined ? { typeset: patch.typeset } : null),
      ...(patch.boxed !== undefined ? { box: patch.boxed } : null),
    });
  };

  /** Typeset answers report their real size once the page has laid them out. */
  const onMeasure = useCallback((id: string, w: number, h: number) => {
    const el = board.elements.find((e) => e.id === id);
    if (el && el.type === 'ai' && (Math.abs(el.w - w) > 0.5 || Math.abs(el.h - h) > 0.5)) {
      board.patchAi(id, { w, h });
    }
  }, [board]);

  // Selecting an answer shows how it was worked out.
  useEffect(() => {
    if (selIds.length !== 1) return;
    const el = board.elements.find((e) => e.id === selIds[0]);
    if (el?.type === 'ai') setWorkId(el.id);
  }, [selIds, board]);

  // --- pointer --------------------------------------------------------------

  const cancelDrag = () => {
    const d = drag.current;
    drag.current = null;
    live.current = null;
    draft.current = null;
    lassoPts.current = null;
    marquee.current = null;
    if (d && (d.kind === 'move' || d.kind === 'resize' || d.kind === 'rotate' || d.kind === 'erase' || (d.kind === 'simgrab' && d.drag))) board.revert();
    if (d?.kind === 'inst') {
      instRef.current = instRef.current.map((x) => (x.id === d.inst ? d.start : x));
      setInstBusy(false);
    }
    setPanning(false);
    if (!pinch.current) setGesturing(false);
    requestDraw();
  };

  /** The handle under (wx, wy): the nearest one in reach, so close handles on a small selection still work. */
  const handleAt = (wx: number, wy: number, sel: El[]): Handle | null => {
    const z = camRef.current.z;
    const hs = selectionHandles(sel, z);
    if (!hs) return null;
    const reach = COARSE ? 22 : HANDLE_HIT;
    let best: Handle | null = null;
    let bd = Infinity;
    for (const h of hs.list) {
      const dist = Math.hypot(wx - h.x, wy - h.y) * z;
      if (dist <= reach && dist < bd) {
        best = h.h;
        bd = dist;
      }
    }
    return best;
  };

  /** Rubs out under the eraser: through the ink in "part" mode, whole elements in "stroke" mode. */
  const eraseAt = (wx: number, wy: number) => {
    const r = ERASER_RADII[prefsRef.current.eraserSize] / camRef.current.z;
    if (prefsRef.current.eraser === 'stroke') {
      // Simulators are never rubbed out by accident; delete them from the menu or with Delete.
      const kept = board.elements.filter((el) => el.type === 'sim' || el.type === 'diagram' || el.type === 'image' || !hitEl(el, wx, wy, r));
      if (kept.length !== board.elements.length) board.live(kept);
      return;
    }
    let changed = false;
    const next: El[] = [];
    for (const el of board.elements) {
      if (el.type === 'stroke') {
        const cut = cutStroke(el, wx, wy, r, uid);
        if (cut) {
          changed = true;
          next.push(...cut);
          continue;
        }
      } else if (el.type !== 'sim' && el.type !== 'diagram' && el.type !== 'image' && hitEl(el, wx, wy, r)) {
        changed = true;
        continue;
      }
      next.push(el);
    }
    if (changed) board.live(next);
  };

  /** The first time a pen is seen, fingers stop drawing and only move the board. */
  const noteFirstPen = () => {
    if (penNoted.current) return;
    penNoted.current = true;
    try {
      localStorage.setItem('slate.pen', '1');
    } catch {
      // storage blocked; this just means the notice can show again next visit
    }
    if (prefsRef.current.fingers === 'draw') {
      updatePrefs({ fingers: 'pan' });
      setNotice('Pen detected. Fingers now move and zoom the board; the hand button lets them draw again.');
    }
  };

  // --- simulators -------------------------------------------------------------

  /** The play, reset and settings buttons in a simulator's title bar. */
  const simButton = (el: SimEl, btn: SimButton) => {
    if (btn === 'settings') {
      setSimPanelId((id) => (id === el.id ? null : el.id));
    } else if (btn === 'play') {
      const pausing = runOf(el).playing;
      setPlaying(el, !pausing);
      const keep = pausing ? commitRun(el) : null;
      if (keep) setSimParams(el.id, keep, false);
      ensureAnimating();
    } else {
      resetRun(el);
      const back = resetPatch(el);
      if (back) setSimParams(el.id, back, false);
    }
    setUiTick((n) => n + 1);
    requestDraw();
  };

  /**
   * Puts a diagram from the studio on the board, built up piece by piece. A changed diagram
   * replaces the one it came from in place; a new one goes where the menu was opened.
   */
  const placeDiagram = (diagram: Diagram, promptText: string, source: DiagramSource) => {
    // Structures go on the board as the molecule builder, so every atom and bond stays editable.
    if (diagram.kind === 'chemistry' && !studio?.editId) {
      const mol = molFromDiagram(diagram);
      if (mol) {
        setStudio(null);
        placeSim('molecule', mol, `${String(mol.name) || 'Molecule'}: tap atoms and bonds to edit it.`);
        return;
      }
    }
    const c = camRef.current;
    const [bw, bh] = cardBase(diagram);
    const ratio = bw / bh;
    const target = board.elements.find((e): e is DiagramEl => e.id === studio?.editId && e.type === 'diagram');
    let el: DiagramEl;
    if (target) {
      // Keep the card's width and top-left corner; the height follows the new shape.
      el = { ...target, diagram, prompt: promptText, source, h: target.w / ratio };
      board.commit(board.elements.map((e) => (e.id === target.id ? el : e)));
    } else {
      const screenW = Math.max(280, Math.min(bw, viewport.w - 48, (viewport.h - 140) * ratio));
      const w = screenW / c.z;
      const h = w / ratio;
      const [cx, cy] = studio?.at ?? [(viewport.w / 2 - c.x) / c.z, (viewport.h / 2 - c.y) / c.z];
      el = {
        id: uid(), type: 'diagram', x: cx - w / 2, y: cy - h / 2, w, h, color: 'ink', size: SIZES[1],
        diagram, prompt: promptText, source,
      };
      board.commit([...board.elements, el]);
    }
    remember({ kind: 'diagram', title: diagram.title, hint: diagram.kind, words: promptText });
    setStudio(null);
    setTool('select');
    setSel([el.id]);
    startWriting(el.id, 1500);
    setNotice(target ? 'Diagram updated.' : 'Diagram placed. Double-click it to change it.');
  };

  const putInstruments = (list: Instrument[]) => {
    instRef.current = list;
    setInstruments(list);
    saveInstruments(list);
    requestDraw();
  };

  /** Puts an instrument in the middle of the screen. */
  const placeInstrument = (kind: InstKind) => {
    const c = camRef.current;
    const w = canvasRef.current?.clientWidth || viewport.w;
    const h = canvasRef.current?.clientHeight || viewport.h;
    const inst = newInstrument(kind, (w / 2 - c.x) / c.z, (h / 2 - c.y) / c.z, uid());
    putInstruments([...instRef.current, inst].slice(-12));
    setClassroomOpen(false);
    setNotice(kind === 'compass'
      ? 'Compass: drag the pencil to draw an arc, the hinge to open it, the needle to move it.'
      : `${INST_LABEL[kind]}: drag to move, turn with the blue knob, draw along an edge with the pen.`);
  };

  const toggleOverlay = (k: OverlayKind) => {
    setOverlays((o) => (o.includes(k) ? o.filter((x) => x !== k) : [...o, k]));
    setClassroomOpen(false);
  };

  const selectInst = (id: string | null) => {
    instSelRef.current = id;
    setInstSel(id);
    if (id) setSel([]);
    requestDraw();
  };
  const updateInst = (id: string, f: (i: Instrument) => Instrument) =>
    putInstruments(instRef.current.map((x) => (x.id === id ? f(x) : x)));
  const removeInst = (id: string) => {
    const gone = instRef.current.find((x) => x.id === id);
    putInstruments(instRef.current.filter((x) => x.id !== id));
    if (instSelRef.current === id) selectInst(null);
    setInstMenu(null);
    if (gone) setNotice(`${INST_LABEL[gone.kind]} put away. Add it again from Classroom tools.`);
  };
  const duplicateInst = (id: string) => {
    const src = instRef.current.find((x) => x.id === id);
    if (!src) return;
    const copy = { ...src, id: uid(), x: src.x + CM, y: src.y + CM } as Instrument;
    putInstruments([...instRef.current, copy].slice(-12));
    selectInst(copy.id);
  };
  const openInstMenu = (x: number, y: number, id: string) => {
    setInstBusy(false);
    selectInst(id);
    setInstMenu({ x, y, id });
  };
  const buildInstMenu = (m: { x: number; y: number; id: string }): MenuSpec => {
    const it = instRef.current.find((x) => x.id === m.id)!;
    const groups: MenuItem[][] = [[
      { label: 'Duplicate', icon: 'copy', run: () => duplicateInst(it.id) },
      { label: 'Bring to front', icon: 'front', run: () => putInstruments([...instRef.current.filter((x) => x.id !== it.id), it]) },
    ]];
    if (it.kind !== 'compass') {
      groups.push([
        { label: 'Turn 90°', icon: 'rotate', run: () => updateInst(it.id, (x) => turnInstrument(x, -Math.PI / 2)) },
        { label: 'Turn 15°', icon: 'rotate', run: () => updateInst(it.id, (x) => turnInstrument(x, -Math.PI / 12)) },
        { label: 'Straighten', icon: 'retry', disabled: Math.abs(it.a) < 1e-9, run: () => updateInst(it.id, (x) => turnInstrument(x, -x.a)) },
      ]);
    }
    if (it.kind === 'protractor') {
      groups.push([{
        label: it.full ? 'Half protractor (180°)' : 'Full protractor (360°)', icon: 'target',
        run: () => updateInst(it.id, (x) => ({ ...x, full: !(x as Protractor).full }) as Instrument),
      }]);
    }
    groups.push([{ label: 'Delete', icon: 'trash', keys: 'Del', danger: true, run: () => removeInst(it.id) }]);
    return { x: m.x, y: m.y, groups };
  };

  /** Puts a simulator in the middle of the free part of the screen, at a readable size. */
  const placeSim = (kind: SimKind, params?: SimParams, notice?: string) => {
    const safe = safeArea();
    const c = camRef.current;
    // On wide screens the settings panel opens on the left; keep the card clear of it.
    const left = viewport.w >= 900 ? Math.max(safe.left, 372) : safe.left;
    const screenW = Math.max(240, Math.min(CARD_W, safe.right - left - 24, (safe.bottom - safe.top - 24) * CARD_RATIO));
    const w = screenW / c.z;
    const h = w / CARD_RATIO;
    let cx = ((left + safe.right) / 2 - c.x) / c.z;
    let cy = ((safe.top + safe.bottom) / 2 - c.y) / c.z;
    // Never stack exactly on another simulator: step down and right until the spot is clear.
    const step = 36 / c.z;
    for (let i = 0; i < 12; i++) {
      const taken = board.elements.some(
        (e) => e.type === 'sim' && Math.abs(e.x + e.w / 2 - cx) < step / 2 && Math.abs(e.y + e.h / 2 - cy) < step / 2,
      );
      if (!taken) break;
      cx += step;
      cy += step;
    }
    const el: SimEl = {
      id: uid(), type: 'sim', kind, x: cx - w / 2, y: cy - h / 2, w, h,
      color: 'ink', size: SIZES[1], params: fullParams(kind, params),
    };
    board.commit([...board.elements, el]);
    setTool('select');
    setSel([el.id]);
    if (viewport.w >= 900) setSimPanelId(el.id);
    remember({ kind: 'sim', title: SIMS[kind].label, hint: kind });
    setNotice(notice ?? `${SIMS[kind].label}: press play, or open its settings to change it.`);
  };

  const setSimParams = (id: string, patch: SimParams, liveChange: boolean) => {
    const next = board.elements.map((e) => (e.id === id && e.type === 'sim' ? { ...e, params: { ...e.params, ...patch } } : e));
    if (liveChange) {
      if (!simEditing.current) {
        simEditing.current = true;
        board.begin();
      }
      board.live(next);
      return;
    }
    if (simEditing.current) {
      simEditing.current = false;
      board.end();
    }
    board.commit(next);
  };

  // The animation loop outlives renders, so it reaches the latest version through a ref.
  const setSimParamsRef = useRef(setSimParams);
  setSimParamsRef.current = setSimParams;

  const commitSimParams = () => {
    if (!simEditing.current) return;
    simEditing.current = false;
    board.end();
  };

  // --- context menu -------------------------------------------------------------

  /** Opens the menu for what is under a screen point, selecting it first like a desktop app. */
  const openMenu = (clientX: number, clientY: number) => {
    if (editingRef.current) finishText();
    const [wx, wy] = toWorld({ clientX, clientY });
    const tol = 8 / camRef.current.z;
    let hit: El | undefined;
    for (let i = board.elements.length - 1; i >= 0; i--) {
      if (hitEl(board.elements[i], wx, wy, tol)) {
        hit = board.elements[i];
        break;
      }
    }
    if (hit) {
      setTool('select');
      if (!selIdsRef.current.includes(hit.id)) setSel([hit.id]);
    } else {
      const box = selectionBox(selectedNow());
      if (!box || wx < box.x || wx > box.x + box.w || wy < box.y || wy > box.y + box.h) setSel([]);
    }
    setMenu({ x: clientX, y: clientY, wx, wy });
  };

  const closeMenu = useCallback(() => setMenu(null), []);

  /** Press and hold a dock tool: its colour, size or mode, without opening the style panel. */
  const [toolMenu, setToolMenu] = useState<MenuSpec | null>(null);
  const closeToolMenu = useCallback(() => setToolMenu(null), []);
  const openToolMenu = (t: Tool, anchor: DOMRect) => {
    const pick = () => setTool(t);
    const sizeNames = ['Small', 'Medium', 'Large', 'Extra large'];
    const at = { x: anchor.left, y: Math.max(8, anchor.top - 8) };
    if (t === 'eraser') {
      setToolMenu({
        ...at,
        groups: [
          [
            { label: 'Erase parts of strokes', icon: prefsRef.current.eraser === 'part' ? 'check' : undefined, run: () => { pick(); updatePrefs({ eraser: 'part' }); } },
            { label: 'Erase whole strokes', icon: prefsRef.current.eraser === 'stroke' ? 'check' : undefined, run: () => { pick(); updatePrefs({ eraser: 'stroke' }); } },
          ],
          sizeNames.map((name, i) => ({
            label: name, icon: prefsRef.current.eraserSize === i ? 'check' as const : undefined,
            run: () => { pick(); updatePrefs({ eraserSize: i }); },
          })),
        ],
      });
      return;
    }
    setToolMenu({
      ...at,
      colors: { current: color, pick: (c) => { pick(); applyStyle({ color: c }); } },
      groups: [
        sizeNames.map((name, i) => ({
          label: name, icon: sizeIdx === i ? 'check' as const : undefined,
          run: () => { pick(); applyStyle({ sizeIdx: i }); },
        })),
      ],
    });
  };

  const cancelLongPress = () => {
    if (!longPress.current) return;
    window.clearTimeout(longPress.current.timer);
    longPress.current = null;
  };

  /** A still finger held down opens the menu, the way a right-click does. */
  const startLongPress = (e: { pointerId: number; clientX: number; clientY: number }, onHold?: () => void) => {
    cancelLongPress();
    const { pointerId, clientX, clientY } = e;
    const timer = window.setTimeout(() => {
      longPress.current = null;
      if (touches.current.size > 1 || pinch.current) return;
      cancelDrag();
      if (onHold) onHold();
      else openMenu(clientX + 8, clientY + 8);
      haptic('longPress');
    }, LONG_PRESS_MS);
    longPress.current = { id: pointerId, x: clientX, y: clientY, timer };
  };

  const pressureOf = (e: { pointerType: string; pressure: number }) =>
    e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5;

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen') {
      lastPenAt.current = performance.now();
      penDown.current = e.pointerId;
      noteFirstPen();
      // A palm that landed just before the pen: drop whatever it started.
      const d = drag.current;
      if (d && touches.current.has(d.id)) cancelDrag();
      if (pinch.current && !pinch.current.sel) pinch.current = null;
      cancelLongPress();
      touches.current.clear();
      tapGesture.current = null;
      setGesturing(false);
    }
    // A palm resting on the screen: a large contact, or any touch while the pen is down.
    if (e.pointerType === 'touch' && (Math.max(e.width, e.height) >= PALM_SIZE || penDown.current !== null)) {
      return;
    }
    // Just after the pen lifted, one touch is a resting hand; two fingers may still move the board.
    const penNear = e.pointerType === 'touch' && performance.now() - lastPenAt.current < PEN_GUARD_MS;

    if (editingRef.current) finishText();
    stopCamAnim();

    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // Count the fingers of a possible undo or redo tap.
      if (touches.current.size === 1) tapGesture.current = null;
      else if (!tapGesture.current) {
        tapGesture.current = { t0: performance.now(), n: touches.current.size, moved: false, start: new Map(touches.current) };
      } else {
        tapGesture.current.n = Math.max(tapGesture.current.n, touches.current.size);
        tapGesture.current.start.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (touches.current.size === 2) {
        cancelLongPress();
        cancelDrag();
        const [a, b] = [...touches.current.values()];
        const r = canvasRef.current!.getBoundingClientRect();
        const c = camRef.current;
        const mx = (a.x + b.x) / 2 - r.left;
        const my = (a.y + b.y) / 2 - r.top;
        const wx = (mx - c.x) / c.z;
        const wy = (my - c.y) / c.z;
        // On the selection the fingers transform it; anywhere else they move the board.
        const sel = toolRef.current === 'select' ? selectedNow() : [];
        const box = sel.length ? selectionBox(sel) : null;
        const onSel = !!box && inBox(box, wx, wy, 28 / c.z);
        if (onSel) board.begin();
        else setGesturing(true);
        pinch.current = {
          dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
          mx,
          my,
          cam: { ...c },
          ang: Math.atan2(b.y - a.y, b.x - a.x),
          ox: r.left,
          oy: r.top,
          sel: onSel ? { orig: new Map(sel.map((el) => [el.id, el])), wx, wy, turn: rotatable(sel) } : null,
        };
        return;
      }
      if (touches.current.size > 2) return;
      if (penNear) return;
    }
    if (drag.current || pinch.current) return;

    let t: Tool = toolRef.current;
    const mouse = e.pointerType === 'mouse';
    // Middle button, Space, Ctrl or Cmd with the mouse, and the right button all move the board.
    if (e.button === 1 || spaceRef.current || (mouse && (e.button === 2 || (e.button === 0 && (e.ctrlKey || e.metaKey))))) t = 'hand';
    else if (e.pointerType === 'touch' && prefsRef.current.fingers === 'pan') t = 'hand';
    else if (e.button === 5 || (e.pointerType === 'pen' && (e.buttons & 32) !== 0)) t = 'eraser';
    else if (e.button !== 0) return;

    // A simulator's title-bar buttons work with any tool that is not moving or erasing.
    if (t !== 'hand' && t !== 'eraser') {
      const [bx, by] = toWorld(e);
      for (let i = board.elements.length - 1; i >= 0; i--) {
        const el = board.elements[i];
        if (el.type === 'diagram' && diagramButtonAt(el, bx, by)) {
          togglePlay(el.id, el.diagram);
          ensureAnimating();
          requestDraw();
          return;
        }
        if (el.type !== 'sim') continue;
        const btn = simButtonAt(el, bx, by);
        if (btn) {
          simButton(el, btn);
          return;
        }
      }
    }

    // A right-click on an instrument opens its menu (elsewhere the right button pans).
    if (mouse && e.button === 2 && instRef.current.length) {
      const [ix, iy] = toWorld(e);
      const hit = [...instRef.current].reverse().find((x) => instrumentHit(x, ix, iy, camRef.current.z));
      if (hit) {
        openInstMenu(e.clientX, e.clientY, hit.id);
        return;
      }
    }
    // Instruments lie over the ink, so they take the pointer first (except for panning and erasing).
    if (t !== 'hand' && t !== 'eraser' && instRef.current.length) {
      const [ix, iy] = toWorld(e);
      const z = camRef.current.z;
      for (let i = instRef.current.length - 1; i >= 0; i--) {
        const inst = instRef.current[i];
        const part = instrumentHit(inst, ix, iy, z);
        if (!part) continue;
        if (part === 'close') {
          putInstruments(instRef.current.filter((x) => x.id !== inst.id));
          return;
        }
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // synthetic events have no pointer to capture
        }
        const drawing = t === 'pen' || t === 'highlight';
        const hl = t === 'highlight';
        const startStroke = (x: number, y: number, pressure: number) => {
          setSel([]);
          live.current = {
            id: uid(), type: 'stroke', kind: hl ? 'highlight' : 'pen', color, points: [[x, y, pressure]],
            size: hl ? highlightSize(sizeIdx) : SIZES[sizeIdx], simulate: e.pointerType !== 'pen',
          };
        };
        if (part === 'edge' && drawing) {
          const edge = nearestEdge(inst, ix, iy, 10 / z)!;
          startStroke(...projectOn(edge, ix, iy), pressureOf(e));
          drag.current = { kind: 'stroke', id: e.pointerId, rule: edge };
          return;
        }
        let arc: { a: number } | undefined;
        if (part === 'pencil' && drawing && inst.kind === 'compass') {
          startStroke(...compassParts(inst).pencil, 0.5);
          arc = { a: inst.a };
        }
        drag.current = { kind: 'inst', id: e.pointerId, inst: inst.id, part, start: inst, from: [ix, iy], arc };
        if (instSelRef.current !== inst.id) selectInst(inst.id);
        setInstBusy(true);
        // Held still, it opens the menu: with a finger, a pen or a long mouse press.
        if (!arc) {
          const hx = e.clientX;
          const hy = e.clientY;
          startLongPress(e, () => openInstMenu(hx + 8, hy + 8, inst.id));
        }
        // The one in hand comes to the top.
        instRef.current = [...instRef.current.filter((x) => x.id !== inst.id), inst];
        requestDraw();
        return;
      }
    }

    // Anywhere else on the board lets go of the instrument.
    if (t !== 'hand' && instSelRef.current) selectInst(null);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // not an active pointer (synthetic events); safe to continue
    }
    const [wx, wy] = toWorld(e);
    const id = e.pointerId;

    switch (t) {
      case 'hand':
        // A right-click that does not move opens the menu instead of panning.
        drag.current = { kind: 'pan', id, lx: e.clientX, ly: e.clientY, sx: e.clientX, sy: e.clientY, menu: mouse && e.button === 2 };
        setPanning(true);
        setGesturing(true);
        break;

      case 'pen':
      case 'highlight': {
        setSel([]);
        const hl = t === 'highlight';
        live.current = {
          id: uid(), type: 'stroke', kind: hl ? 'highlight' : 'pen', color,
          points: [[wx, wy, pressureOf(e)]], size: hl ? highlightSize(sizeIdx) : SIZES[sizeIdx],
          simulate: e.pointerType !== 'pen',
        };
        drag.current = { kind: 'stroke', id };
        break;
      }

      case 'eraser':
        setSel([]);
        board.begin();
        eraseAt(wx, wy);
        drag.current = { kind: 'erase', id, lx: wx, ly: wy };
        break;

      case 'rect':
      case 'ellipse':
      case 'diamond':
      case 'line':
      case 'arrow':
      case 'figure':
        setSel([]);
        drag.current = { kind: 'shape', id, sx: wx, sy: wy };
        break;

      case 'text':
        drag.current = { kind: 'text', id, wx, wy, cx: e.clientX, cy: e.clientY };
        break;

      case 'solve':
        lassoPts.current = [[wx, wy]];
        drag.current = { kind: 'lasso', id };
        break;

      case 'select': {
        const sel = selectedNow();
        const z = camRef.current.z;
        const handle = sel.length ? handleAt(wx, wy, sel) : null;
        if (handle === 'rot') {
          const box = selectionBox(sel)!;
          const cx = box.x + box.w / 2;
          const cy = box.y + box.h / 2;
          board.begin();
          drag.current = {
            kind: 'rotate', id, cx, cy, a0: Math.atan2(wy - cy, wx - cx), px: wx, py: wy, angle: 0,
            orig: new Map(sel.map((s) => [s.id, s])),
          };
          break;
        }
        if (handle) {
          const box = selectionBox(sel)!;
          const grab = isSide(handle) ? sidePoint(box, handle) : cornerPoint(box, handle);
          const anchor = isSide(handle) ? sidePoint(box, OPPOSITE_SIDE[handle]) : cornerPoint(box, oppositeCorner(handle));
          board.begin();
          drag.current = {
            kind: 'resize', id, anchor, origCorner: grab,
            offset: [wx - grab[0], wy - grab[1]],
            orig: new Map(withMarks(board.elements, sel).map((s) => [s.id, s])),
            uniform: scalesEvenly(sel),
            axis: handle === 'tm' || handle === 'bm' ? 'y' : handle === 'ml' || handle === 'mr' ? 'x' : undefined,
          };
          break;
        }
        // Switches, lenses, magnets and the like are operated by hand, right on the card.
        for (let i = board.elements.length - 1; i >= 0; i--) {
          const el = board.elements[i];
          if (el.type !== 'sim' || !inBox(el, wx, wy, 0)) continue;
          const g = simGrabAt(el, wx, wy);
          if (!g) break;
          setSel([el.id]);
          if (g.tap) setSimParams(el.id, g.tap, false);
          if (g.drag) {
            board.begin();
            drag.current = { kind: 'simgrab', id, el: el.id, drag: g.drag, drop: g.drop };
          } else drag.current = { kind: 'simgrab', id, el: el.id };
          ensureAnimating();
          requestDraw();
          return;
        }
        // Fingers are wider than a mouse pointer, so they get more reach.
        const tol = (e.pointerType === 'touch' ? 14 : 6) / z;
        let hit: El | undefined;
        for (let i = board.elements.length - 1; i >= 0; i--) {
          if (hitEl(board.elements[i], wx, wy, tol)) {
            hit = board.elements[i];
            break;
          }
        }
        // A press anywhere inside the selection moves it, not only one right on its ink.
        const box = sel.length ? selectionBox(sel) : null;
        if (box && !e.shiftKey && inBox(box, wx, wy, 6 / z) && (!hit || selIdsRef.current.includes(hit.id))) {
          board.begin();
          drag.current = { kind: 'move', id, sx: wx, sy: wy, orig: new Map(withMarks(board.elements, sel).map((el) => [el.id, el])) };
          break;
        }
        if (hit) {
          let ids = selIdsRef.current;
          if (e.shiftKey) {
            ids = ids.includes(hit.id) ? ids.filter((i) => i !== hit!.id) : [...ids, hit.id];
            setSel(ids);
            if (!ids.includes(hit.id)) break;
          } else if (!ids.includes(hit.id)) {
            ids = [hit.id];
            setSel(ids);
          }
          const idSet = new Set(ids);
          board.begin();
          drag.current = {
            kind: 'move', id, sx: wx, sy: wy,
            orig: new Map(withMarks(board.elements, board.elements.filter((el) => idSet.has(el.id))).map((el) => [el.id, el])),
          };
        } else {
          const base = e.shiftKey ? selIdsRef.current : [];
          if (!e.shiftKey) setSel([]);
          drag.current = { kind: 'marquee', id, sx: wx, sy: wy, base };
        }
        break;
      }
    }
    if (e.pointerType === 'touch' || (e.pointerType === 'pen' && t === 'select')) startLongPress(e);
    requestDraw();
  };

  const eventsOf = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const native = e.nativeEvent;
    const list = typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [];
    return list.length ? list : [native];
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'pen') lastPenAt.current = performance.now();
    if (inRoom() && e.isPrimary) localPointer(...toWorld(e));
    const lp = longPress.current;
    if (lp && lp.id === e.pointerId && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > LONG_PRESS_SLOP) cancelLongPress();
    // The eraser circle follows the pointer that is erasing, not a palm resting beside it.
    const own = drag.current ? drag.current.id === e.pointerId : e.pointerType !== 'touch';
    if ((toolRef.current === 'eraser' || drag.current?.kind === 'erase') && own) {
      hover.current = toWorld(e);
      requestDraw();
    }
    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const tg = tapGesture.current;
      const s0 = tg?.start.get(e.pointerId);
      if (tg && s0 && Math.hypot(e.clientX - s0.x, e.clientY - s0.y) > 10) tg.moved = true;
      const p = pinch.current;
      if (p && touches.current.size >= 2) {
        const [a, b] = [...touches.current.values()];
        // The origin was read when the pinch began, so moving fingers never force a layout.
        const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mx = (a.x + b.x) / 2 - p.ox;
        const my = (a.y + b.y) / 2 - p.oy;
        if (p.sel) {
          const sel = p.sel;
          const c = camRef.current;
          const k = clamp(dist / p.dist, 0.1, 20);
          const da = sel.turn ? Math.atan2(b.y - a.y, b.x - a.x) - p.ang : 0;
          const tx = (mx - p.mx) / c.z;
          const ty = (my - p.my) / c.z;
          board.live(board.elements.map((el) => {
            const o = sel.orig.get(el.id);
            if (!o) return el;
            const scaled = Math.abs(k - 1) > 1e-3 ? scaleEl(o, k, k, sel.wx, sel.wy) : o;
            const turned = da ? rotateEl(scaled, da, sel.wx, sel.wy) : scaled;
            return translateEl(turned, tx, ty);
          }));
          return;
        }
        const z = clamp((p.cam.z * dist) / p.dist, MIN_Z, MAX_Z);
        camRef.current = {
          x: mx - ((p.mx - p.cam.x) / p.cam.z) * z,
          y: my - ((p.my - p.cam.y) / p.cam.z) * z,
          z,
        };
        moveCamera();
        return;
      }
    }

    const d = drag.current;
    if (!d) {
      if (canvasRef.current && instRef.current.length && toolRef.current !== 'hand' && toolRef.current !== 'eraser') {
        const [hx, hy] = toWorld(e);
        let part: InstPart | null = null;
        for (let i = instRef.current.length - 1; i >= 0 && !part; i--) part = instrumentHit(instRef.current[i], hx, hy, camRef.current.z);
        if (part) {
          const drawing = toolRef.current === 'pen' || toolRef.current === 'highlight';
          canvasRef.current.style.cursor = (part === 'edge' || part === 'pencil') && !drawing ? 'grab' : INST_CURSOR[part];
          instHover.current = true;
          return;
        }
        if (instHover.current) {
          instHover.current = false;
          canvasRef.current.style.cursor = cursorRef.current;
        }
      }
      // Hover: resize cursor over selection handles.
      if (toolRef.current === 'select' && canvasRef.current) {
        const sel = selectedNow();
        const [wx, wy] = toWorld(e);
        const c = sel.length ? handleAt(wx, wy, sel) : null;
        const box = !c && sel.length ? selectionBox(sel) : null;
        const inside = !!box && inBox(box, wx, wy, 6 / camRef.current.z);
        let grab: string | null = null;
        if (!c) {
          for (let i = board.elements.length - 1; i >= 0; i--) {
            const el = board.elements[i];
            if (el.type !== 'sim' || !inBox(el, wx, wy, 0)) continue;
            const g = simGrabAt(el, wx, wy);
            if (g) grab = g.cursor ?? (g.drag ? 'grab' : 'pointer');
            break;
          }
        }
        canvasRef.current.style.cursor = c ? HANDLE_CURSOR[c] : grab ?? (inside ? 'move' : cursorRef.current);
      }
      return;
    }
    if (e.pointerId !== d.id) return;

    switch (d.kind) {
      case 'pan': {
        const c = camRef.current;
        c.x += e.clientX - d.lx;
        c.y += e.clientY - d.ly;
        d.lx = e.clientX;
        d.ly = e.clientY;
        moveCamera();
        return;
      }
      case 'stroke':
        for (const ev of eventsOf(e)) {
          const [wx, wy] = toWorld(ev);
          const [px, py] = d.rule ? projectOn(d.rule, wx, wy) : [wx, wy];
          live.current?.points.push([px, py, pressureOf(ev)]);
        }
        localStroke(live.current);
        break;
      case 'inst': {
        const next = dragInstrument(d.start, d.part, d.from, toWorld(e));
        if (d.arc && next.kind === 'compass' && live.current) {
          // Follow the swing the short way round, however far it has gone.
          const a1 = d.arc.a + turnBetween(d.arc.a, next.a);
          for (const [x, y] of compassArc([next.x, next.y], next.r, d.arc.a, a1).slice(1)) live.current.points.push([x, y, 0.5]);
          d.arc.a = a1;
        }
        instRef.current = instRef.current.map((x) => (x.id === d.inst ? next : x));
        requestDraw();
        break;
      }
      case 'erase':
        for (const ev of eventsOf(e)) {
          const [wx, wy] = toWorld(ev);
          const step = 6 / camRef.current.z;
          const n = Math.max(1, Math.ceil(Math.hypot(wx - d.lx, wy - d.ly) / step));
          for (let i = 1; i <= n; i++) eraseAt(d.lx + ((wx - d.lx) * i) / n, d.ly + ((wy - d.ly) * i) / n);
          d.lx = wx;
          d.ly = wy;
        }
        break;
      case 'lasso':
        for (const ev of eventsOf(e)) lassoPts.current?.push(toWorld(ev));
        break;
      case 'shape': {
        const [wx, wy] = toWorld(e);
        const t = toolRef.current;
        draft.current = makeDraft(t, d.sx, d.sy, wx, wy, e.shiftKey, {
          color, size: SIZES[sizeIdx], fill, figure: figureKind,
        });
        break;
      }
      case 'simgrab': {
        const el = board.elements.find((x) => x.id === d.el);
        if (el?.type !== 'sim' || !d.drag) break;
        const [x, y] = simPoint(el, ...toWorld(e));
        const patch = d.drag(x, y);
        board.live(board.elements.map((x) => (x.id === el.id && x.type === 'sim' ? { ...x, params: { ...x.params, ...patch } } : x)));
        ensureAnimating();
        requestDraw();
        break;
      }
      case 'move': {
        const [wx, wy] = toWorld(e);
        let dx = wx - d.sx;
        let dy = wy - d.sy;
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        board.live(board.elements.map((el) => {
          const o = d.orig.get(el.id);
          return o ? translateEl(o, dx, dy) : el;
        }));
        return;
      }
      case 'resize': {
        const [wx, wy] = toWorld(e);
        const px = wx - d.offset[0];
        const py = wy - d.offset[1];
        const [ax, ay] = d.anchor;
        let sx = clamp((px - ax) / (d.origCorner[0] - ax || 1e-6), 0.05, 50);
        let sy = clamp((py - ay) / (d.origCorner[1] - ay || 1e-6), 0.05, 50);
        if (d.axis === 'x') sy = 1;
        else if (d.axis === 'y') sx = 1;
        else if (d.uniform || e.shiftKey) sx = sy = Math.max(sx, sy);
        board.live(board.elements.map((el) => {
          const o = d.orig.get(el.id);
          return o ? scaleEl(o, sx, sy, ax, ay) : el;
        }));
        return;
      }
      case 'rotate': {
        const [wx, wy] = toWorld(e);
        let a = Math.atan2(wy - d.cy, wx - d.cx) - d.a0;
        if (e.shiftKey) a = Math.round(a / (Math.PI / 12)) * (Math.PI / 12);
        else {
          // A light pull to square angles, so 90° and 180° are easy to land on.
          const q = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
          if (Math.abs(a - q) < 0.05) a = q;
        }
        d.angle = Math.atan2(Math.sin(a), Math.cos(a));
        d.px = wx;
        d.py = wy;
        board.live(board.elements.map((el) => {
          const o = d.orig.get(el.id);
          return o ? rotateEl(o, a, d.cx, d.cy) : el;
        }));
        break;
      }
      case 'marquee': {
        const [wx, wy] = toWorld(e);
        const m: Bounds = {
          x: Math.min(d.sx, wx), y: Math.min(d.sy, wy), w: Math.abs(wx - d.sx), h: Math.abs(wy - d.sy),
        };
        marquee.current = m;
        const ids = new Set(d.base);
        for (const el of board.elements) if (boundsIntersect(visualBounds(el), m)) ids.add(el.id);
        const next = [...ids];
        if (next.length !== selIdsRef.current.length || next.some((i, k) => i !== selIdsRef.current[k])) setSel(next);
        break;
      }
      case 'text':
        break;
    }
    requestDraw();
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (longPress.current?.id === e.pointerId) cancelLongPress();
    if (e.pointerType === 'pen' && penDown.current === e.pointerId) {
      penDown.current = null;
      lastPenAt.current = e.timeStamp;
    }
    if (e.pointerType === 'touch') {
      touches.current.delete(e.pointerId);
      if (pinch.current && touches.current.size < 2) {
        if (pinch.current.sel) board.end();
        pinch.current = null;
        if (drag.current?.kind !== 'pan') setGesturing(false);
      }
      const tg = tapGesture.current;
      if (tg && touches.current.size === 0) {
        tapGesture.current = null;
        if (e.type === 'pointerup' && !tg.moved && performance.now() - tg.t0 < TAP_MS) {
          if (tg.n === 2) {
            undo();
            setNotice('Undo');
          } else if (tg.n >= 3) {
            redo();
            setNotice('Redo');
          }
        }
      }
    }
    const d = drag.current;
    if (!d || e.pointerId !== d.id) return;
    drag.current = null;

    switch (d.kind) {
      case 'pan':
        setPanning(false);
        if (!pinch.current) setGesturing(false);
        if (d.menu && Math.hypot(e.clientX - (d.sx ?? 0), e.clientY - (d.sy ?? 0)) < 5) openMenu(e.clientX, e.clientY);
        break;
      case 'stroke':
        if (live.current) {
          const stroke = quantizeStroke(live.current);
          live.current = null;
          board.commit([...board.elements, stroke]);
          localStroke(null);
        }
        break;
      case 'inst':
        if (live.current) {
          const arc = live.current;
          live.current = null;
          if (arc.points.length > 2) board.commit([...board.elements, quantizeStroke(arc)]);
        }
        putInstruments(instRef.current);
        setInstBusy(false);
        break;
      case 'erase':
        board.end();
        break;
      case 'move':
      case 'resize':
      case 'rotate':
        board.end();
        break;
      case 'simgrab': {
        if (!d.drag) break;
        const el = board.elements.find((x) => x.id === d.el);
        if (d.drop && el?.type === 'sim' && e.type === 'pointerup') {
          const patch = d.drop(...simPoint(el, ...toWorld(e)));
          if (patch) board.live(board.elements.map((x) => (x.id === el.id && x.type === 'sim' ? { ...x, params: { ...x.params, ...patch } } : x)));
        }
        board.end();
        requestDraw();
        break;
      }
      case 'shape': {
        let el = draft.current;
        draft.current = null;
        if (toolRef.current === 'figure') {
          // A tap places the figure at a natural size, centred where it was tapped.
          const small = !el || Math.max(boundsOf(el).w, boundsOf(el).h) < 12 / camRef.current.z;
          if (small) {
            const ratio = FIGURES[figureKind].ratio;
            const base = 220 / camRef.current.z;
            const w = ratio >= 1 ? base : base * ratio;
            const h = w / ratio;
            el = {
              id: 'draft', type: 'figure', kind: figureKind, x: d.sx - w / 2, y: d.sy - h / 2, w, h,
              color, size: SIZES[sizeIdx], fill,
            };
          }
        }
        if (el) {
          const b = boundsOf(el);
          if (Math.max(b.w, b.h) > 3) board.commit([...board.elements, { ...el, id: uid() }]);
        }
        break;
      }
      case 'marquee':
        marquee.current = null;
        break;
      case 'lasso': {
        const pts = lassoPts.current;
        lassoPts.current = null;
        const picked = pts ? lassoPick(board.elements, pts) : [];
        if (picked.length === 0) {
          haptic('warning');
          setNotice('Draw a loop around your writing to solve it.');
        } else {
          haptic('select');
          startSolve(picked);
          setTool(toolBeforeSolve.current);
        }
        break;
      }
      case 'text':
        if (Math.hypot(e.clientX - d.cx, e.clientY - d.cy) < 6) {
          const hit = [...board.elements].reverse().find((el) => el.type === 'text' && hitEl(el, d.wx, d.wy, 4));
          if (hit && hit.type === 'text') startEdit(hit);
          else startNewText(d.wx, d.wy);
        }
        break;
    }
    requestDraw();
  };

  const onDoubleClick = (e: ReactPointerEvent<HTMLCanvasElement> | React.MouseEvent<HTMLCanvasElement>) => {
    if (toolRef.current !== 'select') return;
    const [wx, wy] = toWorld(e);
    const tol = 6 / camRef.current.z;
    const hit = [...board.elements].reverse().find((el) => hitEl(el, wx, wy, tol));
    if (hit?.type === 'text') startEdit(hit);
    else if (hit?.type === 'sim') setSimPanelId(hit.id);
    else if (hit?.type === 'diagram') setStudio({ tab: 'describe', at: null, editId: hit.id });
    else if (!hit) startNewText(wx, wy);
  };

  // --- commands -------------------------------------------------------------

  const undo = () => {
    if (editingRef.current) return;
    board.undo();
  };
  const redo = () => {
    if (editingRef.current) return;
    board.redo();
  };

  const deleteSelection = () => {
    const ids = new Set(selIdsRef.current);
    if (ids.size === 0) return;
    board.commit(board.elements.filter((e) => !ids.has(e.id)));
    setSel([]);
  };

  const copySelection = () => {
    clipboard.current = selectedNow().filter((e) => e.type !== 'ai');
    pasteCount.current = 0;
    return clipboard.current.length > 0;
  };

  const paste = () => {
    if (clipboard.current.length === 0) return;
    pasteCount.current += 1;
    const off = 24 * pasteCount.current;
    const copies = clipboard.current.map((e) => translateEl({ ...e, id: uid() }, off, off));
    board.commit([...board.elements, ...copies]);
    setTool('select');
    setSel(copies.map((c) => c.id));
  };

  const duplicate = () => {
    if (copySelection()) paste();
  };

  const cutSelection = () => {
    if (copySelection()) deleteSelection();
  };

  /** Pastes so the copies are centred on a board point. */
  const pasteAt = (wx: number, wy: number) => {
    if (clipboard.current.length === 0) return;
    const b = selectionBox(clipboard.current)!;
    const dx = wx - (b.x + b.w / 2);
    const dy = wy - (b.y + b.h / 2);
    const copies = clipboard.current.map((e) => translateEl({ ...e, id: uid() }, dx, dy));
    board.commit([...board.elements, ...copies]);
    setTool('select');
    setSel(copies.map((c) => c.id));
  };

  /** Turns or mirrors the selection about its centre, as one undo step. */
  const transformSel = (fn: (el: El, cx: number, cy: number) => El) => {
    const sel = selectedNow();
    const box = selectionBox(sel);
    if (!box) return;
    const ids = new Set(sel.map((el) => el.id));
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    board.commit(board.elements.map((el) => (ids.has(el.id) ? fn(el, cx, cy) : el)));
  };
  const rotate90 = () => transformSel((el, cx, cy) => rotateEl(el, Math.PI / 2, cx, cy));
  const flipSel = (axis: 'x' | 'y') => transformSel((el, cx, cy) => flipEl(el, axis, cx, cy));

  /** Brings the selection in front of everything, or sends it behind. */
  const reorder = (front: boolean) => {
    const ids = new Set(selIdsRef.current);
    if (ids.size === 0) return;
    const picked = board.elements.filter((e) => ids.has(e.id));
    const rest = board.elements.filter((e) => !ids.has(e.id));
    board.commit(front ? [...rest, ...picked] : [...picked, ...rest]);
  };

  /** What the menu offers for the current selection, or for the empty board. */
  const buildMenu = (m: { x: number; y: number; wx: number; wy: number }): MenuSpec => {
    const sel = selectedNow();
    const mod = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';
    if (sel.length === 0) {
      return {
        x: m.x,
        y: m.y,
        groups: [
          [
            { label: 'Paste here', icon: 'paste', keys: `${mod}V`, disabled: clipboard.current.length === 0, run: () => pasteAt(m.wx, m.wy) },
            {
              label: 'Select all', icon: 'selectall', keys: `${mod}A`, disabled: board.elements.length === 0,
              run: () => {
                setTool('select');
                setSel(board.elements.map((e) => e.id));
              },
            },
          ],
          [
            { label: 'AI study notes…', icon: 'sparkle', keys: 'N', accent: true, run: () => openStudy('notes', [m.wx, m.wy]) },
            { label: 'Summarise YouTube video…', icon: 'play', run: () => openStudy('video', [m.wx, m.wy]) },
            { label: 'Summarise this board', icon: 'steps', disabled: board.elements.length === 0, run: summariseBoard },
            {
              label: 'Explain this board', icon: 'help', disabled: board.elements.length === 0 || studyBusy,
              run: () => void askAbout(board.elements.filter((e) => e.type !== 'sim'), 'explain'),
            },
            { label: 'Search images…', icon: 'target', keys: 'I', run: () => openImages([m.wx, m.wy]) },
            { label: 'Upload a picture…', icon: 'plus', run: () => pickUpload([m.wx, m.wy]) },
          ],
          [
            { label: 'AI Diagram…', icon: 'wand', keys: 'K', run: () => setStudio({ tab: 'describe', at: [m.wx, m.wy], editId: null }) },
            { label: 'Build a diagram', icon: 'blocks', run: () => setStudio({ tab: 'build', at: [m.wx, m.wy], editId: null }) },
            { label: 'Diagram library', icon: 'library', run: () => setStudio({ tab: 'library', at: [m.wx, m.wy], editId: null }) },
          ],
          [
            { label: 'Add text here', icon: 'text', keys: 'T', run: () => startNewText(m.wx, m.wy) },
            { label: 'Shapes & simulators', icon: 'shapes', keys: 'F', run: () => setTool('figure') },
          ],
          [
            { label: 'Undo', icon: 'undo', keys: `${mod}Z`, disabled: !board.canUndo, run: undo },
            { label: 'Redo', icon: 'redo', keys: `${mod}Shift+Z`, disabled: !board.canRedo, run: redo },
            { label: 'Fit to content', icon: 'fit', keys: 'Shift+1', disabled: board.elements.length === 0, run: fitContent },
          ],
        ],
      };
    }
    const only = sel.length === 1 ? sel[0] : null;
    const actions: MenuItem[] = [];
    if (only?.type === 'sim') {
      const playing = runOf(only).playing;
      actions.push(
        { label: playing ? 'Pause' : 'Play', icon: playing ? 'pause' : 'play', run: () => simButton(only, 'play') },
        { label: 'Back to the start', icon: 'retry', run: () => simButton(only, 'reset') },
        { label: 'Simulator settings', icon: 'sliders', run: () => setSimPanelId(only.id) },
      );
    }
    if (only?.type === 'text') {
      actions.push(
        { label: 'Edit text', icon: 'edit', run: () => startEdit(only) },
        { label: 'Copy text', icon: 'copy', disabled: !only.text.trim(), run: () => void copyText(only.text) },
      );
    }
    if (only?.type === 'diagram') {
      actions.push(
        { label: 'Change with AI…', icon: 'wand', run: () => setStudio({ tab: 'describe', at: null, editId: only.id }) },
        { label: 'Edit parts', icon: 'blocks', run: () => setStudio({ tab: 'build', at: null, editId: only.id }) },
        { label: 'Play the motion', icon: 'play', run: () => { togglePlay(only.id, only.diagram); ensureAnimating(); requestDraw(); } },
      );
    }
    if (only?.type === 'ai') {
      actions.push(
        {
          label: 'Show work', icon: 'work', keys: 'W',
          run: () => {
            setWorkId(only.id);
            updatePrefs({ workOpen: true, workCollapsed: false });
          },
        },
        { label: 'Solve again', icon: 'retry', run: () => retrySolve(only) },
      );
      if (only.status === 'done') {
        actions.push(
          { label: 'Copy LaTeX', icon: 'copy', disabled: !latexOfAi(only), run: () => void copyText(latexOfAi(only)) },
          { label: only.typeset ? 'Write by hand' : 'Typeset', icon: 'text', run: () => restyle(only, { typeset: !only.typeset }) },
          { label: only.boxed ? 'Remove the box' : 'Box the answer', icon: 'rect', run: () => restyle(only, { boxed: !only.boxed }) },
        );
      }
    }
    const solvable = sel.filter((e) => e.type !== 'ai' && e.type !== 'sim' && e.type !== 'diagram' && e.type !== 'image' && e.type !== 'note');
    if (solvable.some((e) => e.type === 'stroke' || e.type === 'text')) {
      actions.push({ label: prefsRef.current.solution ? 'Solve with working' : 'Solve', icon: 'sparkle', run: () => startSolve(solvable) });
    }
    const askable = sel.filter((e) => e.type !== 'sim');
    if (askable.length) {
      actions.push(
        { label: 'Explain this', icon: 'help', accent: true, disabled: studyBusy, run: () => void askAbout(askable, 'explain') },
        { label: 'Ask about this…', icon: 'text', disabled: studyBusy, run: () => void askSelection(askable) },
        { label: 'Summarise selection', icon: 'steps', disabled: studyBusy, run: () => void askAbout(askable, 'summarise') },
      );
    }
    const copyable = sel.some((e) => e.type !== 'ai');
    const styled = sel.filter((e) => e.type !== 'ai');
    return {
      x: m.x,
      y: m.y,
      colors: styled.length
        ? { current: styled.every((e) => e.color === styled[0].color) ? styled[0].color : null, pick: (c) => applyStyle({ color: c }) }
        : undefined,
      groups: [
        actions,
        [
          { label: 'Cut', icon: 'cut', keys: `${mod}X`, disabled: !copyable, run: cutSelection },
          { label: 'Copy', icon: 'copy', keys: `${mod}C`, disabled: !copyable, run: () => void copySelection() },
          { label: 'Duplicate', icon: 'copy', keys: `${mod}D`, disabled: !copyable, run: duplicate },
        ],
        sel.some(canRotate)
          ? [
              { label: 'Rotate 90°', icon: 'rotate', keys: 'Shift+R', run: rotate90 },
              { label: 'Flip horizontal', icon: 'flip', keys: 'Shift+H', run: () => flipSel('x') },
              { label: 'Flip vertical', icon: 'flip', keys: 'Shift+V', run: () => flipSel('y') },
            ]
          : [],
        [
          { label: 'Bring to front', icon: 'front', keys: ']', run: () => reorder(true) },
          { label: 'Send to back', icon: 'back', keys: '[', run: () => reorder(false) },
        ],
        [{ label: sel.length > 1 ? `Delete ${sel.length} items` : 'Delete', icon: 'trash', keys: 'Del', danger: true, run: deleteSelection }],
      ],
    };
  };

  const nudge = (dx: number, dy: number) => {
    const ids = new Set(selIdsRef.current);
    if (ids.size === 0) return;
    board.commit(board.elements.map((e) => (ids.has(e.id) ? translateEl(e, dx, dy) : e)));
  };

  const clearBoard = () => {
    board.commit([]);
    setSel([]);
  };

  const exportPng = async () => {
    setNotice('Making the picture…');
    const blob = await exportBoard(board.elements, colors, THEME_BG[theme]);
    if (!blob) {
      setNotice("Couldn't make the picture: this board is too large for this device. Try again after removing a picture or two.");
      return;
    }
    // In the Android app <a download> does nothing (a WebView has no downloads), so this goes
    // through the phone's share sheet, which can save the picture as well as send it.
    const res = await sharePng(blob);
    if (res.ok) setNoticeState(null);
    else setNotice(`Couldn't export as PNG: ${res.reason}.`);
  };

  /** Applies a style change to the defaults and, with Select active, to the selection. */
  const applyStyle = (patch: { color?: ColorKey; sizeIdx?: number; fill?: boolean }) => {
    if (patch.color !== undefined) setColor(patch.color);
    if (patch.sizeIdx !== undefined) setSizeIdx(patch.sizeIdx);
    if (patch.fill !== undefined) setFill(patch.fill);
    if (toolRef.current !== 'select') return;
    const ids = new Set(selIdsRef.current);
    if (ids.size === 0) return;
    board.commit(board.elements.map((el) => {
      if (!ids.has(el.id) || el.type === 'ai') return el;
      let next: El = patch.color !== undefined ? { ...el, color: patch.color } : el;
      if (patch.sizeIdx !== undefined) {
        const i = patch.sizeIdx;
        if (next.type === 'text') {
          next = makeText(next.id, next.x, next.y, next.text, TEXT_SIZES[i], next.color);
        } else if (next.type === 'stroke') {
          next = { ...next, size: next.kind === 'highlight' ? highlightSize(i) : SIZES[i] };
        } else {
          next = { ...next, size: SIZES[i] };
        }
      }
      if (patch.fill !== undefined && (next.type === 'rect' || next.type === 'ellipse' || next.type === 'diamond' || next.type === 'figure')) {
        next = { ...next, fill: patch.fill };
      }
      return next;
    }));
  };

  // --- keyboard -------------------------------------------------------------

  keyRef.current = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();

    if (e.code === 'Space') {
      e.preventDefault();
      if (!spaceRef.current) {
        spaceRef.current = true;
        setSpace(true);
      }
      return;
    }
    if (mod) {
      if (k === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (k === 'y') {
        e.preventDefault();
        redo();
      } else if (k === 'a') {
        e.preventDefault();
        setTool('select');
        setSel(board.elements.map((el) => el.id));
      } else if (k === 'd') {
        e.preventDefault();
        duplicate();
      } else if (k === 'c') {
        copySelection();
      } else if (k === 'x') {
        cutSelection();
      } else if (k === 'v') {
        paste();
      } else if (k === '0') {
        e.preventDefault();
        resetZoom();
      } else if (k === '=' || k === '+') {
        e.preventDefault();
        zoomStep(1.25);
      } else if (k === '-') {
        e.preventDefault();
        zoomStep(0.8);
      }
      return;
    }
    if (e.altKey) return;

    if ((e.key === 'Delete' || e.key === 'Backspace') && instSelRef.current) {
      e.preventDefault();
      removeInst(instSelRef.current);
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelection();
    } else if (e.key === 'Escape') {
      if (drag.current) cancelDrag();
      setSel([]);
      setSimPanelId(null);
      selectInst(null);
    } else if (e.code === 'Digit1' && e.shiftKey) {
      fitContent();
    } else if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const s = e.shiftKey ? 10 : 1;
      nudge(e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0, e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0);
    } else if (k === 'r' && e.shiftKey) {
      rotate90();
    } else if (k === 'h' && e.shiftKey) {
      flipSel('x');
    } else if (k === 'v' && e.shiftKey) {
      flipSel('y');
    } else if (k === 's' && e.shiftKey) {
      toggleSolution();
    } else if (k === 'n' && !e.shiftKey) {
      openStudy('notes');
    } else if (k === 'i' && !e.shiftKey) {
      openImages(null);
    } else if (k === 'w' && !e.shiftKey) {
      toggleWork();
    } else if (k === 'k' && !e.shiftKey) {
      const only = selectedNow();
      const d = only.length === 1 && only[0].type === 'diagram' ? only[0] : null;
      setStudio({ tab: 'describe', at: null, editId: d?.id ?? null });
    } else if (e.key === ']') {
      reorder(true);
    } else if (e.key === '[') {
      reorder(false);
    } else if (TOOL_KEYS[k] && !e.shiftKey) {
      setTool(TOOL_KEYS[k]);
    }
  };

  useEffect(() => {
    const down = (e: KeyboardEvent) => keyRef.current(e);
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        setSpace(false);
      }
    };
    const blur = () => {
      spaceRef.current = false;
      setSpace(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // --- derived UI state -----------------------------------------------------

  const selIdSet = new Set(selIds);
  const selected = board.elements.filter((e) => selIdSet.has(e.id));
  const workEl = workId
    ? board.elements.find((e): e is AiEl => e.id === workId && e.type === 'ai')
    : undefined;
  const shownWork = workId ? liveWork[workId] ?? workEl?.work : undefined;
  const solving = Object.keys(liveWork).length > 0;
  const typesetEls = board.elements.filter(
    (e): e is AiEl => e.type === 'ai' && e.typeset && e.status === 'done' && !!e.response && e.w > 0,
  );
  const chipWork = workId ? liveWork[workId] ?? workEl?.work : undefined;
  const chipRead = chipWork?.read;
  // The correction controls live in the Work window. A floating chip only appears when that
  // window is hidden, so it never covers the board while the controls are already on screen.
  const workShown = prefs.workOpen && !prefs.workCollapsed;
  const showChip = !workShown && !!workEl && !!chipRead && !!chipRead.latex;

  const styleTarget = tool === 'select' ? selected.find((e) => e.type !== 'ai') : undefined;
  const showStyle =
    DRAWING_TOOLS.includes(tool) || (tool === 'select' && selected.some((e) => e.type !== 'ai'));
  const showFill =
    tool === 'rect' || tool === 'ellipse' || tool === 'diamond' || tool === 'figure' ||
    (tool === 'select' && selected.some((e) => e.type === 'rect' || e.type === 'ellipse' || e.type === 'diamond' || e.type === 'figure'));

  let shownColor = color;
  let shownSize = sizeIdx;
  let shownFill = fill;
  if (styleTarget) {
    shownColor = styleTarget.color;
    if (styleTarget.type === 'text') shownSize = nearestIdx(styleTarget.fontSize, TEXT_SIZES);
    else if (styleTarget.type === 'stroke') {
      shownSize = styleTarget.kind === 'highlight'
        ? nearestIdx(styleTarget.size, SIZES.map((_, i) => highlightSize(i)))
        : nearestIdx(styleTarget.size, SIZES);
    } else shownSize = nearestIdx(styleTarget.size, SIZES);
    const shape = selected.find((e) => e.type === 'rect' || e.type === 'ellipse' || e.type === 'diamond' || e.type === 'figure');
    if (shape && (shape.type === 'rect' || shape.type === 'ellipse' || shape.type === 'diamond' || shape.type === 'figure')) shownFill = shape.fill;
  }

  const activeTool: Tool = space ? 'hand' : tool;
  const cursor = useMemo(() => {
    if (activeTool === 'hand') return panning ? 'grabbing' : 'grab';
    if (activeTool === 'text') return 'text';
    if (activeTool === 'select') return 'default';
    if (activeTool === 'eraser') return 'cell';
    return 'crosshair';
  }, [activeTool, panning]);
  cursorRef.current = cursor;

  const cam = camRef.current;
  void camTick;
  const chipStyle = (() => {
    if (!workEl) return {};
    // Screen rectangles for the writing and its answer; the chip is placed clear of both.
    const toScreen = (b: Bounds) => ({ x: b.x * cam.z + cam.x, y: b.y * cam.z + cam.y, w: b.w * cam.z, h: b.h * cam.z });
    const answerBox = workEl.w > 0 ? toScreen({ x: workEl.x, y: workEl.y - workEl.ascent, w: workEl.w, h: workEl.h }) : null;
    const otherAnswers = board.elements
      .filter((e): e is AiEl => e.type === 'ai' && e.id !== workEl.id && e.w > 0)
      .map((e) => toScreen({ x: e.x, y: e.y - e.ascent, w: e.w, h: e.h }));
    // Where the writing is now: it may have been moved since it was solved.
    const srcIds = new Set(workEl.sourceIds);
    const writing = selectionBox(board.elements.filter((e) => srcIds.has(e.id))) ?? workEl.sourceBox;
    const spot = chipSpot(toScreen(writing), answerBox, viewport, undefined, undefined, undefined, otherAnswers);
    return { left: spot.left, top: spot.top };
  })();

  const narrow = viewport.w < 900;
  const simPanelEl = simPanelId
    ? board.elements.find((e): e is SimEl => e.id === simPanelId && e.type === 'sim')
    : undefined;
  const selOnly = selected.length === 1 ? selected[0] : null;
  const selCopyable = selected.some((e) => e.type !== 'ai');
  // Fingers have no right-click and no hover: the selection gets a small bar of actions.
  const selBar = (() => {
    if (!(COARSE || narrow) || tool !== 'select' || selected.length === 0 || menu || editing || simPanelEl) return null;
    const b = selectionBox(selected);
    if (!b) return null;
    // Clear of the rotate handle, which sits above the selection.
    const top = b.y * cam.z + cam.y - (selected.some(canRotate) ? 104 : 64);
    const below = (b.y + b.h) * cam.z + cam.y + 16;
    const cx = (b.x + b.w / 2) * cam.z + cam.x;
    return {
      left: clamp(cx, 140, viewport.w - 140),
      top: top > 60 ? top : clamp(below, 60, viewport.h - 150),
      wx: b.x + b.w / 2,
      wy: b.y + b.h / 2,
    };
  })();

  return (
    <div
      className="app"
      ref={appRef}
      onDragOver={(e) => {
        if (!Array.from(e.dataTransfer.types).includes('Files')) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        if (!dropping) setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        setDropping(false);
        const file = imageFileIn(e.dataTransfer);
        if (!file) return;
        e.preventDefault();
        void addImageFile(file, toWorld(e));
      }}
    >
      <canvas
        ref={canvasRef}
        className="board"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onLostPointerCapture={(e) => {
          // Capture lost without a pointerup (the browser took over, a dialog opened): end the drag cleanly.
          if (drag.current?.id === e.pointerId) onPointerUp(e);
        }}
        onPointerLeave={() => {
          hover.current = null;
          requestDraw();
        }}
        onDoubleClick={onDoubleClick}
        onContextMenu={(e) => e.preventDefault()}
      />

      <div className="ai-layer" ref={typesetRef}>
        {typesetEls.map((el) => (
          <TypesetNote key={el.id} el={el} color={colors[el.color]} onMeasure={onMeasure} />
        ))}
      </div>

      {showChip && workEl && chipRead && (
        <ReadChip
          read={chipRead.latex}
          alternatives={chipRead.alternatives}
          confidence={chipRead.confidence}
          corrected={chipRead.corrected}
          style={chipStyle}
          onPick={(latex) => retrySolve(workEl, latex)}
        />
      )}

      {editing && (
        <TextEditor
          editing={editing}
          cam={cam}
          color={colors[editing.color]}
          onChange={(value) => setEditing({ ...editing, value })}
          onDone={finishText}
        />
      )}

      <History canUndo={board.canUndo} canRedo={board.canRedo} onUndo={undo} onRedo={redo} />
      <TopRight
        fingers={prefs.fingers}
        onFingers={toggleFingers}
        workOpen={prefs.workOpen}
        working={solving}
        onWork={toggleWork}
        theme={theme}
        onTheme={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))}
        onExport={() => void exportPng()}
        onClear={clearBoard}
        empty={board.elements.length === 0}
        progressOpen={progressOpen}
        onProgress={() => {
          // One panel at a time up here, so they never stack on top of each other.
          setClassroomOpen(false);
          setStudy((st) => (st ? { ...st, collapsed: true } : st));
          setProgressOpen((o) => !o);
        }}
        studyOpen={!!study && !study.collapsed}
        studyBusy={studyBusy}
        onStudy={() => (study && !study.collapsed ? setStudy({ ...study, collapsed: true }) : openStudy(study?.tab ?? 'notes'))}
        classroomOpen={classroomOpen}
        onClassroom={() => {
          setProgressOpen(false);
          setStudy((st) => (st ? { ...st, collapsed: true } : st));
          setClassroomOpen((o) => !o);
        }}
      />
      {tool === 'eraser' && (
        <EraserPanel
          mode={prefs.eraser}
          sizeIdx={prefs.eraserSize}
          onMode={(m) => updatePrefs({ eraser: m })}
          onSize={(i) => updatePrefs({ eraserSize: i })}
        />
      )}
      {showStyle && !(narrow && ((figOpen && tool === 'figure') || simPanelEl)) && (
        <StylePanel
          theme={theme}
          color={shownColor}
          sizeIdx={shownSize}
          fill={shownFill}
          showFill={showFill}
          onColor={(c) => applyStyle({ color: c })}
          onSize={(i) => applyStyle({ sizeIdx: i })}
          onFill={(f) => applyStyle({ fill: f })}
        />
      )}
      <Status
        apiDown={apiDown}
        mock={!!health?.mock}
        model={health?.model ?? null}
        accuracy={accuracy}
        handLetters={handLetters}
      />
      <ZoomControls
        zoom={cam.z}
        onIn={() => zoomStep(1.25)}
        onOut={() => zoomStep(0.8)}
        onReset={resetZoom}
        onFit={fitContent}
      />
      <Dock
        tool={tool}
        onTool={setTool}
        solution={prefs.solution}
        onSolution={toggleSolution}
        onShapes={() => (tool === 'figure' ? setFigOpen((o) => !o) : setTool('figure'))}
        onToolMenu={openToolMenu}
      />
      {figOpen && tool === 'figure' && (
        <FigurePicker
          key={figKey}
          current={figureKind}
          onSim={placeSim}
          onTool={setTool}
          onPick={(k) => {
            setFigureKind(k);
            if (viewport.w < 900) setFigOpen(false);
          }}
          onDiagram={(item) => {
            setFigOpen(false);
            placeDiagram(item.diagram, item.prompt, 'library');
          }}
          onStudio={(text) => {
            setFigOpen(false);
            setStudio({ tab: 'describe', at: null, editId: null, prompt: text });
          }}
          onImage={(img) => {
            setFigOpen(false);
            placeImage(img, uploadAt.current);
            uploadAt.current = null;
          }}
          onUpload={() => {
            setFigOpen(false);
            pickUpload(uploadAt.current);
          }}
          notify={setNotice}
          onClose={() => setFigOpen(false)}
        />
      )}

      {simPanelEl && (
        <SimPanel
          key={simPanelEl.id}
          el={simPanelEl}
          onParams={(patch, liveChange) => setSimParams(simPanelEl.id, patch, liveChange)}
          onCommit={commitSimParams}
          onRun={() => {
            ensureAnimating();
            requestDraw();
          }}
          onClose={() => setSimPanelId(null)}
        />
      )}

      {selBar && (
        <div className="panel selbar" style={{ left: selBar.left, top: selBar.top }} onPointerDown={(e) => e.stopPropagation()}>
          {selOnly?.type === 'sim' && (
            <>
              <button className="tool" aria-label={runOf(selOnly).playing ? 'Pause' : 'Play'} onClick={() => simButton(selOnly, 'play')}>
                <Icon name={runOf(selOnly).playing ? 'pause' : 'play'} size={18} />
              </button>
              <button className="tool" aria-label="Simulator settings" onClick={() => setSimPanelId(selOnly.id)}>
                <Icon name="sliders" size={18} />
              </button>
              <div className="sep" />
            </>
          )}
          {selOnly?.type === 'text' && (
            <button className="tool" aria-label="Edit text" onClick={() => startEdit(selOnly)}>
              <Icon name="edit" size={18} />
            </button>
          )}
          {selOnly?.type === 'ai' && (
            <button
              className="tool"
              aria-label="Show work"
              onClick={() => {
                setWorkId(selOnly.id);
                updatePrefs({ workOpen: true, workCollapsed: false });
              }}
            >
              <Icon name="work" size={18} />
            </button>
          )}
          {selected.some((e) => e.type !== 'sim' && e.type !== 'image') && (
            <button
              className="tool accent"
              aria-label="Explain this"
              data-tip="Explain this"
              disabled={studyBusy}
              onClick={() => void askAbout(selected.filter((e) => e.type !== 'sim' && e.type !== 'image'), 'explain')}
            >
              <Icon name="help" size={18} />
            </button>
          )}
          {selected.some(canRotate) && (
            <button className="tool" aria-label="Rotate 90°" onClick={rotate90}>
              <Icon name="rotate" size={18} />
            </button>
          )}
          <button className="tool" aria-label="Duplicate" disabled={!selCopyable} onClick={duplicate}>
            <Icon name="copy" size={18} />
          </button>
          <button className="tool danger" aria-label="Delete" onClick={deleteSelection}>
            <Icon name="trash" size={18} />
          </button>
          <button
            className="tool"
            aria-label="More"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ x: r.left, y: r.bottom + 8, wx: selBar.wx, wy: selBar.wy });
            }}
          >
            <Icon name="more" size={18} />
          </button>
        </div>
      )}

      {menu && <ContextMenu spec={buildMenu(menu)} theme={theme} onClose={closeMenu} />}
      {toolMenu && <ContextMenu spec={toolMenu} theme={theme} onClose={closeToolMenu} />}
      {instMenu && instruments.some((x) => x.id === instMenu.id) && (
        <ContextMenu spec={buildInstMenu(instMenu)} theme={theme} onClose={() => setInstMenu(null)} />
      )}
      {(() => {
        // The selected instrument's bar, above it (or below when there is no room).
        const it = instruments.find((x) => x.id === instSel);
        if (!it || instBusy || instMenu || menu) return null;
        const pts = instOutline(it);
        const xs = pts.map((p) => p[0] * cam.z + cam.x);
        const ys = pts.map((p) => p[1] * cam.z + cam.y);
        const above = Math.min(...ys) - 60;
        const below = Math.max(...ys) + 16;
        const left = clamp((Math.min(...xs) + Math.max(...xs)) / 2, 140, viewport.w - 140);
        return (
          <div
            className="panel selbar"
            role="toolbar"
            aria-label={`${INST_LABEL[it.kind]} tools`}
            style={{ left, top: above > 60 ? above : clamp(below, 60, viewport.h - 150) }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <button className="tool" aria-label="Duplicate" data-tip="Duplicate" onClick={() => duplicateInst(it.id)}>
              <Icon name="copy" size={18} />
            </button>
            {it.kind !== 'compass' && (
              <button className="tool" aria-label="Turn 90°" data-tip="Turn 90°" onClick={() => updateInst(it.id, (x) => turnInstrument(x, -Math.PI / 2))}>
                <Icon name="rotate" size={18} />
              </button>
            )}
            <button className="tool danger" aria-label="Delete" data-tip="Delete" onClick={() => removeInst(it.id)}>
              <Icon name="trash" size={18} />
            </button>
            <button
              className="tool"
              aria-label="More"
              data-tip="More"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setInstMenu({ x: r.left, y: r.bottom + 8, id: it.id });
              }}
            >
              <Icon name="more" size={18} />
            </button>
          </div>
        );
      })()}

      {overlays.includes('shade') && <ScreenShade onClose={() => toggleOverlay('shade')} />}
      {overlays.includes('spotlight') && <Spotlight onClose={() => toggleOverlay('spotlight')} />}
      {overlays.includes('timer') && <ClassTimer onClose={() => toggleOverlay('timer')} />}
      {overlays.includes('picker') && <RandomPicker onClose={() => toggleOverlay('picker')} />}
      {overlays.includes('scoreboard') && <Scoreboard onClose={() => toggleOverlay('scoreboard')} />}
      {classroomOpen && (
        <ClassroomMenu
          open={overlays}
          onInstrument={placeInstrument}
          onOverlay={toggleOverlay}
          instrumentCount={instruments.length}
          onClearInstruments={() => {
            putInstruments([]);
            setClassroomOpen(false);
          }}
          onClose={closeClassroom}
        />
      )}
      {study && !(study.collapsed && (progressOpen || classroomOpen)) && (
        <StudyPanel
          writer={writer}
          tab={study.tab}
          onTab={(tab) => setStudy((st) => (st ? { ...st, tab } : st))}
          at={study.at}
          collapsed={study.collapsed}
          onCollapse={(collapsed) => setStudy((st) => (st ? { ...st, collapsed } : st))}
          onClose={() => {
            setStudy(null);
            setAskFocus(null);
          }}
          ask={askFocus}
          onClearAsk={() => setAskFocus(null)}
          onSummariseBoard={board.elements.length ? summariseBoard : undefined}
          notify={setNotice}
        />
      )}
      <input
        ref={uploadRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) void addImageFile(file, uploadAt.current);
          uploadAt.current = null;
        }}
      />
      {dropping && <div className="st-drop">Drop the picture to put it on the board</div>}
      {progressOpen && (
        <ProgressPanel
          onClose={closeProgress}
          onPractice={(text) => {
            setProgressOpen(false);
            setStudio({ tab: 'describe', at: null, editId: null, prompt: text });
          }}
        />
      )}

      {studio && (() => {
        const target = board.elements.find((e): e is DiagramEl => e.id === studio.editId && e.type === 'diagram');
        return (
          <DiagramStudio
            key={studio.editId ?? 'new'}
            theme={theme}
            tab={studio.tab}
            initial={target ? { diagram: target.diagram, prompt: target.prompt ?? '' } : undefined}
            editId={target?.id ?? null}
            startPrompt={studio.prompt}
            onPlace={placeDiagram}
            onClose={() => setStudio(null)}
          />
        );
      })()}

      {prefs.workOpen && (
        <WorkWindow
          work={shownWork}
          el={workEl}
          rect={workRect(prefs, viewport.w, viewport.h)}
          collapsed={prefs.workCollapsed}
          onClose={() => updatePrefs({ workOpen: false })}
          onCollapse={() => updatePrefs({ workCollapsed: !prefs.workCollapsed })}
          onReset={() => updatePrefs({ workPos: null, workCollapsed: false })}
          onMove={(pos) => updatePrefs({ workPos: pos })}
          onRetry={workEl ? () => retrySolve(workEl) : undefined}
          onFeedback={workEl ? (correct) => void giveFeedback(workEl, correct) : undefined}
          onPickRead={workEl ? (latex) => retrySolve(workEl, latex) : undefined}
          onExplainStep={workEl && !studyBusy ? (i) => explainStep(workEl, i) : undefined}
          typeset={workEl?.typeset}
          boxed={workEl?.boxed}
          onStyle={workEl && workEl.status === 'done' ? (patch) => restyle(workEl, patch) : undefined}
          onShow={
            workEl && workEl.w > 0
              ? () => frameRegion(unionBounds([workEl.sourceBox, boundsOf(workEl)])!)
              : undefined
          }
        />
      )}

      {board.elements.length === 0 && !editing && !(figOpen && tool === 'figure') && !progressOpen && !classroomOpen && !(study && !study.collapsed) && !studio && (
        <div className="hint">
          <div className="hint-title">Write anything</div>
          <div className="hint-body">
            Then choose <b>{TOOLS.solve.label}</b> and circle it. The answer is written next to it. Turn on
            <b> Solution</b> to have every step written out.
          </div>
        </div>
      )}

      {showContinue && (
        <div className="panel resume-bar" role="status">
          <span>
            {unfinished.length > 0
              ? unfinished.length === 1 ? 'An answer stopped part-way.' : `${unfinished.length} answers stopped part-way.`
              : `Notes stopped part-way: ${writerState.resumable!.title}`}
          </span>
          <button type="button" className="pill-btn primary" onClick={continueAll}>
            Continue
          </button>
          <button type="button" className="resume-x" aria-label="Not now" onClick={() => setContinueHidden(continueKey)}>
            <Icon name="close" size={14} />
          </button>
        </div>
      )}

      {notice && (
        <div className="toast" role="status" onClick={() => setNoticeState(null)}>
          {notice}
        </div>
      )}

      <CopyLayer theme={theme} />
    </div>
  );
}

function TextEditor({
  editing, cam, color, onChange, onDone,
}: {
  editing: Editing;
  cam: Camera;
  color: string;
  onChange: (v: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }, 0);
    return () => clearTimeout(t);
  }, []);

  const m = textSize(editing.value || ' ', editing.fontSize);
  const fs = editing.fontSize * cam.z;
  return (
    <textarea
      ref={ref}
      className="text-editor"
      value={editing.value}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onDone}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
          e.preventDefault();
          onDone();
        }
      }}
      style={{
        left: editing.x * cam.z + cam.x,
        top: editing.y * cam.z + cam.y,
        width: (m.w + editing.fontSize * 0.8) * cam.z,
        height: m.h * cam.z,
        font: `${fs}px/${LINE_HEIGHT} ${FONT}`,
        color,
      }}
    />
  );
}
