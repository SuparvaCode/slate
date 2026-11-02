import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { buildDiagram } from '../api';
import { Icon } from '../icons';
import { lookFor } from '../sim';
import { PALETTE } from '../theme';
import type { Theme } from '../theme';
import { endsOf, terminalAt } from './circuit';
import {
  cardBase, diagramButtonAt, diagramFacts, drawDiagramCard, gridScale, gridToWorld, motionOf,
  solved, stepMotion, togglePlay, worldToGrid,
} from './draw';
import type { CardLike } from './draw';
import {
  STARTERS, clearDraft, clearRecent, loadDraft, loadMine, loadRecent, pushRecent, removeMine, removeRecent, saveDraft, saveMine,
} from './library';
import type { LibraryItem } from './library';
import { normalize } from './normalize';
import { memorySummary } from '../memory';
import { TWO_TERMINAL, emptyDiagram } from './types';
import type { Diagram, Part, PartType, XY } from './types';
import './studio.css';
import { useBack } from '../back';

export type StudioTab = 'describe' | 'build' | 'library';
export type DiagramSource = 'ai' | 'builder' | 'library';

interface Version {
  diagram: Diagram;
  prompt: string;
  issues: string[];
  /** Problems the checker found that the AI then fixed. */
  fixed: number;
  model: string;
  ms: number;
  how: string;
  /** Edits with the same key (one drag, one field) merge into one version. */
  key?: string;
}

interface Props {
  theme: Theme;
  tab: StudioTab;
  /** The diagram being changed, when opened from one on the board. */
  initial?: { diagram: Diagram; prompt: string };
  /** The board diagram being changed, so its draft is kept apart from a new one's. */
  editId?: string | null;
  /** Text to start the request with, such as a search from the shapes panel. */
  startPrompt?: string;
  onPlace: (d: Diagram, prompt: string, source: DiagramSource) => void;
  onClose: () => void;
}

const PREVIEW = 'studio-preview';
const BUILD_MS = 1600;
const EXAMPLES = [
  'A 5 kg block on a 30° slope with μ = 0.2, tied over a pulley to a hanging 3 kg mass',
  'A 9 V battery with 3 Ω and 6 Ω in parallel and an ammeter in the main line',
  'Graph of y = x³ − 3x and its turning points',
  'Structure of ethanol, CH₃CH₂OH',
  'Triangle ABC with AB = AC and the altitude from A',
];
const STAGES = ['Reading your description', 'Choosing parts from the library', 'Placing and connecting', 'Checking the physics'];

const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const snap = (v: number) => Math.round(v * 4) / 4;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The card fitted into a w x h box, centred. */
function cardIn(d: Diagram, w: number, h: number, margin = 14, id = PREVIEW): CardLike {
  const [bw, bh] = cardBase(d);
  const s = Math.max(0.05, Math.min((w - margin * 2) / bw, (h - margin * 2) / bh));
  return { id, x: (w - bw * s) / 2, y: (h - bh * s) / 2, w: bw * s, h: bh * s, diagram: d };
}

/** Where a part can be grabbed, in grid units; null for parts that follow their points. */
function centerOf(d: Diagram, p: Part): XY | null {
  const [x, y] = p.at;
  switch (p.type) {
    case 'ceiling':
    case 'floor':
      return [x + (p.w ?? 4) / 2, y];
    case 'wall':
      return [x, y + (p.h ?? 4) / 2];
    case 'table':
      return [x + (p.w ?? 6) / 2, y + 0.4];
    case 'incline': {
      const w = p.w ?? 6;
      return [x + w * 0.66, y - w * Math.tan(((p.angle ?? 30) * Math.PI) / 180) * 0.3];
    }
    case 'graph':
      return [x + (p.w ?? 8) / 2, y + (p.h ?? 6) / 2];
    case 'segment':
    case 'bond':
    case 'polygon':
    case 'path':
      return null;
    default:
      return solved(d).lay?.pos.get(p.id) ?? p.at;
  }
}

function pickPart(d: Diagram, g: XY): Part | null {
  let best: Part | null = null;
  let bd = 0.9;
  for (const p of d.parts) {
    const c = centerOf(d, p);
    if (!c) continue;
    const dist = Math.hypot(c[0] - g[0], c[1] - g[1]);
    if (dist < bd) {
      bd = dist;
      best = p;
    }
  }
  return best;
}

function pickTerminal(d: Diagram, g: XY): string | null {
  let best: string | null = null;
  let bd = 0.6;
  for (const p of d.parts) {
    const ends = p.type === 'junction' ? [p.id] : TWO_TERMINAL.has(p.type) ? endsOf(p) : [];
    for (const t of ends) {
      const q = terminalAt(d, t);
      if (!q) continue;
      const dist = Math.hypot(q[0] - g[0], q[1] - g[1]);
      if (dist < bd) {
        bd = dist;
        best = t;
      }
    }
  }
  return best;
}

// --- the parts palette -------------------------------------------------------------------

const PREFIX: Partial<Record<PartType, string>> = {
  mass: 'm', pulley: 'p', ceiling: 'ceil', floor: 'floor', wall: 'wall', table: 'table', incline: 'slope', effort: 'F',
  battery: 'B', resistor: 'R', bulb: 'L', switch: 'S', ammeter: 'A', voltmeter: 'V', capacitor: 'C', junction: 'J',
  graph: 'g', point: 'P', text: 't', atom: 'a',
};

interface AddSpec {
  label: string;
  type: PartType;
  make: (d: Diagram) => Partial<Part>;
}

const mid = (d: Diagram): XY => [snap(d.size[0] / 2), snap(d.size[1] / 2)];

const PALETTE_GROUPS: { title: string; items: AddSpec[] }[] = [
  {
    title: 'Mechanics',
    items: [
      { label: 'Mass', type: 'mass', make: (d) => ({ at: mid(d), kg: 2 }) },
      { label: 'Pulley', type: 'pulley', make: (d) => ({ at: [mid(d)[0], 2], r: 0.5, fixed: true }) },
      { label: 'Movable pulley', type: 'pulley', make: (d) => ({ at: mid(d), r: 0.5, fixed: false }) },
      { label: 'Ceiling', type: 'ceiling', make: (d) => ({ at: [mid(d)[0] - 2, 0.5], w: 4 }) },
      { label: 'Floor', type: 'floor', make: (d) => ({ at: [1, d.size[1] - 0.4], w: d.size[0] - 2 }) },
      { label: 'Table', type: 'table', make: (d) => ({ at: [1, snap(d.size[1] * 0.45)], w: 6, h: snap(d.size[1] * 0.5), mu: 0 }) },
      { label: 'Slope', type: 'incline', make: (d) => ({ at: [1, d.size[1] - 1], w: 6, angle: 30, mu: 0 }) },
      { label: 'Pull', type: 'effort', make: (d) => ({ at: mid(d), N: 100, dir: 90 }) },
    ],
  },
  {
    title: 'Circuits',
    items: [
      { label: 'Battery', type: 'battery', make: (d) => ({ at: mid(d), V: 12 }) },
      { label: 'Resistor', type: 'resistor', make: (d) => ({ at: mid(d), ohm: 10 }) },
      { label: 'Bulb', type: 'bulb', make: (d) => ({ at: mid(d), ohm: 6 }) },
      { label: 'Switch', type: 'switch', make: (d) => ({ at: mid(d), closed: true }) },
      { label: 'Ammeter', type: 'ammeter', make: (d) => ({ at: mid(d) }) },
      { label: 'Voltmeter', type: 'voltmeter', make: (d) => ({ at: mid(d) }) },
      { label: 'Capacitor', type: 'capacitor', make: (d) => ({ at: mid(d), uF: 100 }) },
      { label: 'Junction', type: 'junction', make: (d) => ({ at: mid(d) }) },
    ],
  },
  {
    title: 'Maths and more',
    items: [
      { label: 'Point', type: 'point', make: (d) => ({ at: mid(d) }) },
      { label: 'Graph', type: 'graph', make: (d) => ({ at: [0.5, 0.4], w: d.size[0] - 1, h: d.size[1] - 0.9, xr: [-5, 5], yr: [-5, 5], fns: [{ expr: 'x^2 - 2' }] }) },
      { label: 'Label', type: 'text', make: (d) => ({ at: mid(d), text: 'Label' }) },
      { label: 'Atom', type: 'atom', make: (d) => ({ at: mid(d), el: 'C' }) },
    ],
  },
];

interface Field {
  key: keyof Part;
  label: string;
  unit?: string;
  step: number;
  min?: number;
}

const FIELDS: Partial<Record<PartType, Field[]>> = {
  mass: [{ key: 'kg', label: 'Mass', unit: 'kg', step: 0.5, min: 0.1 }],
  pulley: [{ key: 'r', label: 'Radius', step: 0.1, min: 0.2 }, { key: 'kg', label: 'Mass', unit: 'kg', step: 0.5, min: 0 }],
  table: [{ key: 'w', label: 'Length', step: 0.5, min: 1 }, { key: 'mu', label: 'Friction μ', step: 0.05, min: 0 }],
  incline: [
    { key: 'w', label: 'Base', step: 0.5, min: 1 }, { key: 'angle', label: 'Angle', unit: '°', step: 1, min: 5 },
    { key: 'mu', label: 'Friction μ', step: 0.05, min: 0 },
  ],
  ceiling: [{ key: 'w', label: 'Length', step: 0.5, min: 0.5 }],
  floor: [{ key: 'w', label: 'Length', step: 0.5, min: 0.5 }],
  wall: [{ key: 'h', label: 'Height', step: 0.5, min: 0.5 }],
  effort: [{ key: 'N', label: 'Pull', unit: 'N', step: 10, min: 0 }, { key: 'dir', label: 'Direction', unit: '°', step: 15 }],
  battery: [{ key: 'V', label: 'EMF', unit: 'V', step: 1, min: 0 }, { key: 'ohm', label: 'Internal r', unit: 'Ω', step: 0.5, min: 0 }],
  resistor: [{ key: 'ohm', label: 'Resistance', unit: 'Ω', step: 1, min: 0.01 }],
  bulb: [{ key: 'ohm', label: 'Resistance', unit: 'Ω', step: 1, min: 0.01 }],
  capacitor: [{ key: 'uF', label: 'Capacitance', unit: 'μF', step: 10, min: 0.01 }],
  circle: [{ key: 'r', label: 'Radius', step: 0.25, min: 0.05 }],
  text: [{ key: 'size', label: 'Size', step: 0.05, min: 0.2 }],
};

const TYPE_NAME: Partial<Record<PartType, string>> = { incline: 'Slope', effort: 'Pull', text: 'Label' };
const typeName = (p: Part) =>
  p.type === 'pulley' ? (p.fixed === false ? 'Movable pulley' : 'Fixed pulley') : TYPE_NAME[p.type] ?? p.type[0].toUpperCase() + p.type.slice(1);

// --- the studio ------------------------------------------------------------------------------

export function DiagramStudio({ theme, tab: tab0, initial, editId = null, startPrompt, onPlace, onClose }: Props) {
  // Work left open last time comes back, so closing the window by mistake loses nothing.
  const [restored] = useState(() => {
    const dr = loadDraft();
    if (!dr || dr.editId !== editId) return null;
    const versions = (dr.versions as Version[])
      .filter((v) => v && typeof v === 'object' && v.diagram)
      .map((v) => ({ ...v, issues: Array.isArray(v.issues) ? v.issues : [], diagram: normalize(v.diagram).diagram }));
    return versions.length ? { ...dr, versions } : null;
  });
  const [tab, setTabState] = useState<StudioTab>(tab0);
  const [prompt, setPrompt] = useState(startPrompt || restored?.prompt || initial?.prompt || '');
  const [feedback, setFeedback] = useState(restored?.feedback ?? '');
  const [hist, setHist] = useState<{ list: Version[]; at: number }>(() => {
    if (restored) return { list: restored.versions, at: Math.min(Math.max(0, restored.at), restored.versions.length - 1) };
    if (initial) return { list: [{ diagram: initial.diagram, prompt: initial.prompt, issues: [], fixed: 0, model: 'board', ms: 0, how: 'On the board' }], at: 0 };
    if (tab0 === 'build') return { list: [blankVersion()], at: 0 };
    return { list: [], at: -1 };
  });
  const [phase, setPhase] = useState<'idle' | 'thinking' | 'fixing' | 'error'>('idle');
  const [fixing, setFixing] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [clock, setClock] = useState(0);
  const [toast, setToast] = useState<string | null>(restored ? 'Your draft is back, just as you left it' : null);
  const [confirmClose, setConfirmClose] = useState(false);
  /** When a rate-limited request will be tried again on its own. */
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const lastRun = useRef<'new' | 'again' | 'change'>('new');
  const [mode, setMode] = useState<'move' | 'rope' | 'wire'>('move');
  const [selId, setSelId] = useState<string | null>(null);
  const [ropeDraft, setRopeDraft] = useState<string[]>([]);
  const [wireFrom, setWireFrom] = useState<string | null>(null);
  const [mine, setMine] = useState<LibraryItem[]>(loadMine);
  const [recent, setRecent] = useState<LibraryItem[]>(loadRecent);
  const [filter, setFilter] = useState<'All' | LibraryItem['subject']>('All');
  const [query, setQuery] = useState('');
  const [, setTick] = useState(0);

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const changeRef = useRef<HTMLTextAreaElement>(null);
  /** "New sketch" was pressed: the prompt box is back, over the current diagram. */
  const [newOpen, setNewOpen] = useState(false);
  /** The prompt as it was before "New sketch" cleared it, for Cancel. */
  const promptBefore = useRef('');
  const abort = useRef<AbortController | null>(null);
  const drag = useRef<{ id: string; start: XY; orig: XY; key: string; moved: boolean } | null>(null);
  const toastTimer = useRef(0);

  const current = hist.at >= 0 ? hist.list[hist.at] : undefined;
  const d = current?.diagram;
  const busy = phase === 'thinking' || phase === 'fixing';
  // The prompt box leads until there is a diagram; after that the change box does.
  const asking = !d || newOpen;
  // Anything worth keeping: a diagram with parts that is not just the one opened from the board.
  const baseline = initial && !restored ? 1 : 0;
  const dirty = hist.list.slice(baseline).some((v) => v.diagram.parts.length > 0);

  // What the drawing loop reads, without restarting it on every change.
  const live = useRef({ d: undefined as Diagram | undefined, t0: 0, theme, sel: null as string | null, rope: [] as string[], wire: null as string | null, build: false });
  useLayoutEffect(() => {
    Object.assign(live.current, { d, theme, sel: selId, rope: ropeDraft, wire: wireFrom, build: tab === 'build' });
  });

  useEffect(() => {
    rootRef.current?.focus();
    if (tab0 === 'describe') promptRef.current?.focus();
    if (restored) toastTimer.current = window.setTimeout(() => setToast(null), 3200);
    return () => abort.current?.abort();
  }, [tab0, restored]);

  // The draft is saved as you work, and once more if the page itself is closed.
  const draftNow = useRef(() => {});
  useLayoutEffect(() => {
    draftNow.current = () => {
      if (dirty) saveDraft({ prompt, feedback, versions: hist.list, at: hist.at, editId, savedAt: Date.now() });
    };
  });
  useEffect(() => {
    const t = window.setTimeout(() => draftNow.current(), 400);
    return () => window.clearTimeout(t);
  }, [hist, prompt, feedback]);
  useEffect(() => {
    if (!dirty) return;
    const away = (e: BeforeUnloadEvent) => {
      draftNow.current();
      e.preventDefault();
    };
    window.addEventListener('beforeunload', away);
    return () => window.removeEventListener('beforeunload', away);
  }, [dirty]);

  // A rate-limited request runs again by itself once the wait is over.
  const runRef = useRef<(how: 'new' | 'again' | 'change') => void>(() => {});
  useEffect(() => {
    if (retryAt === null) return;
    const t = window.setInterval(() => {
      setClock(Date.now());
      if (Date.now() >= retryAt) {
        setRetryAt(null);
        runRef.current(lastRun.current);
      }
    }, 500);
    return () => window.clearInterval(t);
  }, [retryAt]);

  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => setClock(Date.now()), 150);
    return () => window.clearInterval(t);
  }, [busy]);

  // The preview: built up piece by piece after each new sketch, and played when it moves.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const c = canvasRef.current;
      const L = live.current;
      if (!c || !L.d) return;
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(h * dpr);
      }
      const ctx = c.getContext('2d')!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const wasPlaying = motionOf(PREVIEW, L.d).playing;
      stepMotion(PREVIEW, L.d, dt);
      if (wasPlaying && !motionOf(PREVIEW, L.d).playing) setTick((n) => n + 1);
      const el = cardIn(L.d, w, h);
      const colors = PALETTE[L.theme];
      const look = lookFor(colors, colors.ink);
      drawDiagramCard(ctx, el, look, { progress: ease(Math.min(1, (now - L.t0) / BUILD_MS)) });

      if (!L.build) return;
      const accent = colors.blue;
      const k = gridScale(el);
      const ring = (q: XY, r: number, dash = true) => {
        const [x, y] = gridToWorld(el, q);
        ctx.save();
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        if (dash) ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.restore();
      };
      const sel = L.sel ? L.d.parts.find((p) => p.id === L.sel) : undefined;
      const sc = sel && centerOf(L.d, sel);
      if (sc) ring(sc, Math.max(14, k * 0.8));
      L.rope.forEach((id, i) => {
        const p = L.d!.parts.find((q) => q.id === id);
        const c0 = p && centerOf(L.d!, p);
        if (!c0) return;
        const [x, y] = gridToWorld(el, c0);
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + k * 0.5, y - k * 0.5, 9, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '700 10px -apple-system, "Segoe UI", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), x + k * 0.5, y - k * 0.5 + 0.5);
        ctx.restore();
      });
      if (L.wire) {
        const q = terminalAt(L.d, L.wire);
        if (q) ring(q, 7, false);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  };

  const push = (v: Version, animate: boolean) => {
    setHist((h) => ({ list: [...h.list.slice(0, h.at + 1), v], at: h.at + 1 }));
    if (animate) live.current.t0 = performance.now();
  };

  /** Applies a hand edit; edits sharing a key (one drag, one field) become one version. */
  const edit = (fn: (d: Diagram) => void, key = '') => {
    setHist((h) => {
      const cur = h.list[h.at];
      const raw = structuredClone(cur?.diagram ?? emptyDiagram());
      fn(raw);
      // The kind follows the parts: a sketch becomes mechanics or a circuit as parts are added.
      delete (raw as Partial<Diagram>).kind;
      const n = normalize(raw);
      // An empty diagram is where building starts, not a problem.
      n.issues = n.issues.filter((i) => i !== 'The diagram has no parts.');
      const v: Version = { diagram: n.diagram, prompt: cur?.prompt ?? '', issues: n.issues, fixed: 0, model: 'you', ms: 0, how: 'Edited by hand', key: key || undefined };
      if (cur && key && cur.key === key) {
        const list = h.list.slice();
        list[h.at] = v;
        return { ...h, list };
      }
      return { list: [...h.list.slice(0, h.at + 1), v], at: h.at + 1 };
    });
  };

  const go = (at: number) => {
    setHist((h) => ({ ...h, at: Math.max(0, Math.min(h.list.length - 1, at)) }));
    setSelId(null);
    setRopeDraft([]);
    setWireFrom(null);
  };

  const setTab = (t: StudioTab) => {
    setTabState(t);
    setRopeDraft([]);
    setWireFrom(null);
    if (t === 'build' && hist.list.length === 0) push(blankVersion(), false);
  };

  /** Validates the AI's diagram and solves it; anything wrong becomes an issue to send back. */
  const check = (raw: unknown) => {
    const n = normalize(raw);
    const f = diagramFacts(n.diagram);
    if (!f.ok && f.error) n.issues.push(f.error);
    return n;
  };

  const run = async (how: 'new' | 'again' | 'change') => {
    const text = (prompt.trim() || (how !== 'new' ? d?.title ?? '' : '')).trim();
    if (!text || busy) return;
    if (how === 'change' && !feedback.trim()) return;
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    const previous = how === 'new' ? undefined : d;
    lastRun.current = how;
    setRetryAt(null);
    setPhase('thinking');
    setError(null);
    setStartedAt(Date.now());
    setClock(Date.now());
    setFixing(0);
    setTabState('describe');
    try {
      let res = await buildDiagram({ prompt: text, previous, feedback: how === 'change' ? feedback.trim() : '', context: memorySummary() }, ac.signal);
      let n = check(res.diagram);
      let fixed = 0;
      if (n.issues.length) {
        // One repair round: the checker's findings go back to the model with its own diagram.
        setPhase('fixing');
        setFixing(n.issues.length);
        try {
          const again = await buildDiagram({ prompt: text, previous: res.diagram, issues: n.issues, context: memorySummary() }, ac.signal);
          const n2 = check(again.diagram);
          if (n2.issues.length < n.issues.length) {
            fixed = n.issues.length - n2.issues.length;
            res = { ...again, ms: res.ms + again.ms };
            n = n2;
          }
        } catch {
          if (ac.signal.aborted) return;
          // Keep the first diagram and show its issues.
        }
      }
      if (ac.signal.aborted) return;
      push({
        diagram: n.diagram, prompt: text, issues: n.issues, fixed, model: res.model, ms: res.ms,
        how: how === 'change' ? `Changed: ${feedback.trim()}` : how === 'again' ? 'Built again' : 'First sketch',
      }, true);
      // Every sketch is kept in Recent, saved or not.
      setRecent(pushRecent({ title: n.diagram.title, prompt: text, diagram: n.diagram }));
      if (how === 'change') setFeedback('');
      if (how === 'new') {
        setNewOpen(false);
        setFeedback('');
      }
      setPhase('idle');
    } catch (e) {
      if (ac.signal.aborted) return;
      const msg = e instanceof Error ? e.message : String(e);
      const wait = /try again in about (\d+) seconds/i.exec(msg);
      if (wait && Number(wait[1]) <= 900) {
        setRetryAt(Date.now() + Number(wait[1]) * 1000);
        setClock(Date.now());
        setError('The free Groq limit is used up for the moment.');
      } else setError(msg);
      setPhase('error');
    }
  };
  useLayoutEffect(() => {
    runRef.current = (how) => void run(how);
  });

  const startNew = () => {
    promptBefore.current = prompt;
    setPrompt('');
    setNewOpen(true);
    window.setTimeout(() => promptRef.current?.focus(), 0);
  };

  const cancelNew = () => {
    setPrompt(promptBefore.current || current?.prompt || '');
    setNewOpen(false);
  };

  const cancelRetry = () => {
    setRetryAt(null);
    setError(null);
    setPhase('idle');
  };

  const requestClose = () => {
    if (dirty || busy) setConfirmClose(true);
    else onClose();
  };
  useBack(true, () => (confirmClose ? setConfirmClose(false) : requestClose()));

  const startOver = () => {
    abort.current?.abort();
    clearDraft();
    setHist({ list: tab === 'build' ? [blankVersion()] : [], at: tab === 'build' ? 0 : -1 });
    setPrompt('');
    setFeedback('');
    setSelId(null);
    setPhase('idle');
    setError(null);
    setRetryAt(null);
  };

  const cancel = () => {
    abort.current?.abort();
    setPhase('idle');
  };

  const source = (): DiagramSource => (current?.model === 'library' ? 'library' : current?.model === 'you' ? 'builder' : 'ai');
  const place = () => {
    if (!d) return;
    pushRecent({ title: d.title, prompt: current?.prompt || prompt, diagram: d });
    clearDraft();
    onPlace(d, current?.prompt || prompt, source());
  };

  const save = () => {
    if (!d) return;
    setMine(saveMine({ title: d.title, prompt: current?.prompt || prompt, diagram: d }));
    flash('Saved to your library');
  };

  const openItem = (item: LibraryItem) => {
    setPrompt(item.prompt);
    setNewOpen(false);
    push({ diagram: item.diagram, prompt: item.prompt, issues: [], fixed: 0, model: 'library', ms: 0, how: `From the library: ${item.title}` }, true);
    setTabState('describe');
  };

  // --- builder actions -------------------------------------------------------------------

  const addPart = (spec: AddSpec) => {
    const base = d ?? emptyDiagram();
    const prefix = PREFIX[spec.type] ?? spec.type;
    let n = 1;
    while (base.parts.some((p) => p.id === `${prefix}${n}`)) n++;
    const id = `${prefix}${n}`;
    const extra: Partial<Part> = {};
    if (spec.type === 'point') extra.label = String.fromCharCode(65 + base.parts.filter((p) => p.type === 'point').length % 26);
    edit((dd) => {
      const made = { id, type: spec.type, ...spec.make(dd), ...extra } as Part;
      // Never on top of another part: step along until the spot is free, staying in the frame.
      const taken = (q: XY) => dd.parts.some((p) => Math.hypot(p.at[0] - q[0], p.at[1] - q[1]) < 0.8);
      for (let k = 0; k < 24 && taken(made.at); k++) {
        const nx = made.at[0] + 1.5;
        made.at = nx > dd.size[0] - 1 ? [1.5, Math.min(dd.size[1] - 1, made.at[1] + 1.5)] : [nx, made.at[1]];
      }
      dd.parts.push(made);
    });
    setSelId(id);
    setMode('move');
  };

  const removePart = (id: string) => {
    edit((dd) => {
      const refs = (r: unknown) => r === id;
      dd.parts = dd.parts.filter((p) => p.id !== id && !refs(p.from) && !refs(p.to) && !refs(p.on));
      for (const p of dd.parts) if (p.points) p.points = p.points.filter((r) => r !== id);
      dd.ropes = dd.ropes.filter((r) => !r.path.includes(id));
      dd.wires = dd.wires.filter((w) => ![w.from, w.to].some((t) => t === id || t.startsWith(`${id}.`)));
      dd.marks = dd.marks.filter((m) => ![m.at, m.from, m.to, m.on].some(refs));
    });
    setSelId(null);
  };

  const setField = (id: string, key: keyof Part, value: unknown) =>
    edit((dd) => {
      const p = dd.parts.find((q) => q.id === id) as unknown as Record<string, unknown> | undefined;
      if (p) p[key] = value;
    }, `field:${id}:${String(key)}`);

  const addRope = (path: string[]) => {
    edit((dd) => {
      let n = dd.ropes.length + 1;
      while (dd.ropes.some((r) => r.id === `rope${n}`)) n++;
      dd.ropes.push({ id: `rope${n}`, path });
    });
    flash('Rope added: the solver now includes it');
  };

  const local = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  };

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!d) return;
    const { x, y, w, h } = local(e);
    const el = cardIn(d, w, h);
    if (diagramButtonAt(el, x, y)) {
      togglePlay(PREVIEW, d);
      setTick((n) => n + 1);
      return;
    }
    if (tab !== 'build') return;
    const g = worldToGrid(el, x, y);
    if (mode === 'wire') {
      const t = pickTerminal(d, g);
      if (!t) return;
      if (!wireFrom) setWireFrom(t);
      else if (t !== wireFrom) {
        const from = wireFrom;
        edit((dd) => {
          dd.wires.push({ from, to: t });
        });
        setWireFrom(null);
      }
      return;
    }
    const p = pickPart(d, g);
    if (mode === 'rope') {
      if (!p) return;
      const path = [...ropeDraft, p.id];
      if (path.length >= 2 && p.type !== 'pulley') {
        addRope(path);
        setRopeDraft([]);
      } else setRopeDraft(path);
      return;
    }
    setSelId(p?.id ?? null);
    if (p) {
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { id: p.id, start: g, orig: p.at, key: `drag:${p.id}:${Date.now()}`, moved: false };
    }
  };

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const dr = drag.current;
    if (!dr || !d) return;
    const { x, y, w, h } = local(e);
    const g = worldToGrid(cardIn(d, w, h), x, y);
    if (!dr.moved && Math.hypot(g[0] - dr.start[0], g[1] - dr.start[1]) < 0.15) return;
    dr.moved = true;
    const at: XY = [snap(dr.orig[0] + g[0] - dr.start[0]), snap(dr.orig[1] + g[1] - dr.start[1])];
    edit((dd) => {
      const q = dd.parts.find((pp) => pp.id === dr.id);
      if (q) q.at = at;
    }, dr.key);
  };

  const onUp = () => {
    drag.current = null;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Keys typed here never reach the board underneath.
    e.stopPropagation();
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    if (e.key === 'Escape') {
      if (confirmClose) setConfirmClose(false);
      else if (ropeDraft.length || wireFrom) {
        setRopeDraft([]);
        setWireFrom(null);
      } else requestClose();
      return;
    }
    if (confirmClose) return;
    if (typing) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      go(hist.at + (e.shiftKey ? 1 : -1));
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      go(hist.at + 1);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && tab === 'build' && selId) {
      removePart(selId);
    }
  };

  // --- derived ---------------------------------------------------------------------------

  const facts = useMemo(() => (d ? diagramFacts(d) : null), [d]);
  const selPart = d && selId ? d.parts.find((p) => p.id === selId) : undefined;
  const elapsed = clock - startedAt;
  const stage = phase === 'fixing' ? 3 : elapsed < 1300 ? 0 : elapsed < 3200 ? 1 : elapsed < 6500 ? 2 : 3;
  const library = useMemo(() => {
    const all = [...mine, ...STARTERS, ...recent];
    const q = query.trim().toLowerCase();
    return all.filter(
      (i) => (filter === 'All' ? i.subject !== 'Recent' : i.subject === filter) && (!q || `${i.title} ${i.prompt}`.toLowerCase().includes(q)),
    );
  }, [mine, recent, filter, query]);
  const waitLeft = retryAt ? Math.max(0, Math.ceil((retryAt - clock) / 1000)) : 0;
  const waitText = `${Math.floor(waitLeft / 60)}:${String(waitLeft % 60).padStart(2, '0')}`;
  const solvable = !!d && (!!solved(d).mech || !!solved(d).circ);

  // --- views -----------------------------------------------------------------------------

  const previewArea = (
    <div className={`studio-stage${tab === 'build' ? ` building mode-${mode}` : ''}`}>
      {busy ? (
        <SketchLoader stage={stage} fixing={fixing} onCancel={cancel} />
      ) : phase === 'error' && !d ? (
        <div className="studio-empty error">
          <div className="empty-mark"><Icon name="alert" size={26} /></div>
          <h3>{retryAt ? 'Waiting for the AI' : 'That sketch did not come through'}</h3>
          <p>{retryAt ? `${error} Slate will try again by itself in ${waitText}.` : error}</p>
          {retryAt ? (
            <button className="btn" onClick={cancelRetry}>Cancel</button>
          ) : (
            <button className="btn primary" onClick={() => void run(lastRun.current)}><Icon name="retry" size={16} /> Try again</button>
          )}
        </div>
      ) : d ? (
        <>
          <canvas
            ref={canvasRef}
            className="studio-canvas"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
          {tab === 'build' && d.parts.length === 0 && (
            <div className="sd-build-empty">
              <div className="sd-build-icon"><Icon name="blocks" size={22} /></div>
              <h3>Start with a part</h3>
              <p>Pick parts from the panel on the right, then join them with ropes or wires. The solver works out the forces and currents as you build.</p>
              <div className="sd-build-actions">
                <button className="btn" onClick={() => setTab('library')}><Icon name="library" size={15} /> Start from the library</button>
                <button className="btn" onClick={() => setTab('describe')}><Icon name="wand" size={15} /> Describe it instead</button>
              </div>
            </div>
          )}
          {tab === 'build' && d.parts.length > 0 && (
            <div className="stage-hint">
              {mode === 'move' && 'Drag parts to move them. Click one to change it.'}
              {mode === 'rope' && (ropeDraft.length
                ? `Rope: ${ropeDraft.join(' → ')}. Click the pulleys it goes round, then where it ends.`
                : 'Click where the rope starts, each pulley it goes round, then where it ends.')}
              {mode === 'wire' && (wireFrom ? `From ${wireFrom}: click the terminal to join it to.` : 'Click a terminal (an end of a part, or a junction), then another.')}
            </div>
          )}
        </>
      ) : (
        <div className="studio-empty">
          <div className="empty-mark"><Icon name="wand" size={28} /></div>
          <h3>Describe it, and Slate sketches it</h3>
          <p>
            A question, a textbook figure, or something you imagine. The sketch is built from real parts, so pulleys,
            circuits and graphs are solved and checked before you see them.
          </p>
          <div className="empty-kinds">
            <span>Pulleys & forces</span><span>Circuits</span><span>Graphs</span><span>Geometry</span><span>Molecules</span>
          </div>
        </div>
      )}
    </div>
  );

  const result = current && d && (
    <div className="studio-result">
      <input
        className="result-title"
        value={d.title}
        aria-label="Diagram title"
        onChange={(e) => edit((dd) => { dd.title = e.target.value || 'Untitled diagram'; }, 'title')}
      />
      <div className="result-meta">
        {current.how}
        {current.model !== 'you' && current.model !== 'board' && current.model !== 'library' && ` · ${current.model} · ${(current.ms / 1000).toFixed(1)} s`}
      </div>
      <div className="result-chips">
        {current.issues.length === 0 ? (
          d.parts.length > 0 && <span className="sd-pill ok"><Icon name="check" size={12} /> Checked: every part connects</span>
        ) : (
          <span className="sd-pill warn"><Icon name="alert" size={12} /> {plural(current.issues.length, 'thing')} to look at</span>
        )}
        {current.fixed > 0 && <span className="sd-pill fix"><Icon name="sparkle" size={12} /> Fixed {plural(current.fixed, 'problem')}</span>}
      </div>
      {solvable && (
        <div className="sd-show">
          <span>Show</span>
          <div className="sd-seg" role="group" aria-label="What the solver draws">
            {(['forces', 'values', 'motion'] as const)
              .filter((k) => k !== 'motion' || !!solved(d).mech)
              .map((k) => (
                <button
                  key={k}
                  aria-pressed={d.show[k]}
                  className={d.show[k] ? 'on' : ''}
                  onClick={() => edit((dd) => { dd.show[k] = !dd.show[k]; })}
                >
                  {k === 'forces' ? 'Forces' : k === 'values' ? 'Numbers' : 'Motion'}
                </button>
              ))}
          </div>
        </div>
      )}
      {facts && facts.facts.length > 0 && (
        <div className="result-facts">
          <div className="facts-title">The solver worked out</div>
          <ul>{facts.facts.map((f) => <li key={f}>{f}</li>)}</ul>
        </div>
      )}
      {current.issues.length > 0 && (
        <ul className="result-issues">{current.issues.slice(0, 6).map((i) => <li key={i}>{i}</li>)}</ul>
      )}
    </div>
  );

  const describeSide = (
    <div className="studio-side">
      {asking ? (
        <>
          <label className="side-label" htmlFor="studio-prompt">
            {d ? 'Describe the new diagram' : 'Describe the question, diagram or idea'}
          </label>
          <div className="prompt-box">
            <textarea
              id="studio-prompt"
              ref={promptRef}
              value={prompt}
              rows={5}
              placeholder="e.g. Two blocks of 4 kg and 6 kg joined over a pulley at the edge of a smooth table"
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void run('new');
              }}
            />
            <div className="prompt-actions">
              {d && <button className="btn ghost" onClick={cancelNew}>Cancel</button>}
              <button className="btn primary sketch-btn" disabled={!prompt.trim() || busy} onClick={() => void run('new')}>
                <Icon name="wand" size={16} /> Sketch it
                <span className="kbd">Ctrl ↵</span>
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="sd-ask">
            <label className="side-label" htmlFor="studio-change">What should change?</label>
            <div className="sd-ask-box">
              <textarea
                id="studio-change"
                ref={changeRef}
                value={feedback}
                rows={2}
                placeholder="“Start the block at the top”, “make the slope 45°”, “add a voltmeter across R2”"
                onChange={(e) => setFeedback(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void run('change');
                  }
                }}
              />
              <button className="btn primary" disabled={!feedback.trim() || busy} onClick={() => void run('change')}>
                <Icon name="sparkle" size={15} /> Change it
              </button>
            </div>
            <div className="sd-ask-actions">
              <button className="btn" disabled={busy} onClick={() => void run('again')}>
                <Icon name="retry" size={15} /> Build again
              </button>
              <button className="btn" onClick={() => setTab('build')}>
                <Icon name="blocks" size={15} /> Edit by hand
              </button>
              <button className="btn" disabled={busy} onClick={startNew}>
                <Icon name="plus" size={15} /> New sketch
              </button>
            </div>
          </div>
          {prompt.trim() && (
            <div className="sd-request" title={prompt}>
              <span>Built from</span>
              <p>{prompt}</p>
            </div>
          )}
        </>
      )}
      {asking && !d && (
        <div className="examples">
          <div className="side-label">Try one</div>
          {EXAMPLES.map((x) => (
            <button key={x} className="example" onClick={() => { setPrompt(x); promptRef.current?.focus(); }}>{x}</button>
          ))}
        </div>
      )}
      {phase === 'error' && d && (
        <div className="side-error">
          <Icon name="alert" size={14} />
          <div>
            {error}
            {retryAt ? <> Trying again in <b>{waitText}</b>.</> : null}
          </div>
          <button className="btn small ghost" onClick={retryAt ? cancelRetry : () => void run(lastRun.current)}>{retryAt ? 'Cancel' : 'Retry'}</button>
        </div>
      )}
      {result}
    </div>
  );

  const buildSide = (
    <div className="studio-side">
      <div className="mode-switch" role="radiogroup" aria-label="What a click does">
        {(['move', 'rope', 'wire'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} className={mode === m ? 'on' : ''} onClick={() => { setMode(m); setRopeDraft([]); setWireFrom(null); }}>
            {m === 'move' ? 'Move' : m === 'rope' ? 'Rope' : 'Wire'}
          </button>
        ))}
      </div>
      {mode === 'rope' && ropeDraft.length > 0 && (
        <div className="draft-row">
          <span>{ropeDraft.join(' → ')}</span>
          <button className="btn small" disabled={ropeDraft.length < 2} onClick={() => { addRope(ropeDraft); setRopeDraft([]); }}>Finish rope</button>
          <button className="btn small ghost" onClick={() => setRopeDraft([])}>Clear</button>
        </div>
      )}
      {selPart ? (
        <div className="part-panel">
          <div className="part-head">
            <div>
              <div className="part-type">{typeName(selPart)}</div>
              <div className="part-id">{selPart.id}</div>
            </div>
            <button className="btn small danger" onClick={() => removePart(selPart.id)}><Icon name="trash" size={14} /> Remove</button>
          </div>
          {selPart.type === 'text' ? (
            <TextField label="Text" value={selPart.text ?? ''} onChange={(v) => setField(selPart.id, 'text', v)} />
          ) : (
            <TextField label="Label" value={selPart.label ?? ''} onChange={(v) => setField(selPart.id, 'label', v || undefined)} />
          )}
          {(FIELDS[selPart.type] ?? []).map((f) =>
            selPart.type === 'pulley' && f.key === 'kg' && selPart.fixed !== false ? null : (
              <NumField key={String(f.key)} field={f} value={selPart[f.key] as number | undefined} onChange={(v) => setField(selPart.id, f.key, v)} />
            ),
          )}
          {selPart.type === 'pulley' && (
            <Toggle label="Fixed to the ceiling" on={selPart.fixed !== false} onChange={(v) => setField(selPart.id, 'fixed', v)} />
          )}
          {selPart.type === 'switch' && <Toggle label="Closed" on={selPart.closed !== false} onChange={(v) => setField(selPart.id, 'closed', v)} />}
          {TWO_TERMINAL.has(selPart.type) && (
            <button className="btn small" onClick={() => setField(selPart.id, 'rot', ((selPart.rot ?? 0) + 90) % 360)}>
              <Icon name="retry" size={14} /> Turn 90°
            </button>
          )}
          {selPart.type === 'atom' && (
            <>
              <TextField label="Element" value={selPart.el ?? 'C'} onChange={(v) => setField(selPart.id, 'el', v || 'C')} />
              <TextField label="Charge" value={selPart.charge ?? ''} onChange={(v) => setField(selPart.id, 'charge', v || undefined)} />
            </>
          )}
          {selPart.type === 'graph' && (
            <>
              <TextField
                label="Functions (separate with ;)"
                value={(selPart.fns ?? []).map((f) => f.expr).join('; ')}
                onChange={(v) => setField(selPart.id, 'fns', v.split(';').map((s) => s.trim()).filter(Boolean).map((expr) => ({ expr })))}
              />
              <div className="range-row">
                {(['xr', 'yr'] as const).map((k) => (
                  <div key={k} className="range-pair">
                    <span>{k === 'xr' ? 'x from' : 'y from'}</span>
                    {[0, 1].map((i) => (
                      <input
                        key={i}
                        type="number"
                        value={(selPart[k] ?? [-5, 5])[i]}
                        onChange={(e) => {
                          const v = parseFloat(e.target.value);
                          if (!Number.isFinite(v)) return;
                          const r = [...(selPart[k] ?? [-5, 5])] as XY;
                          r[i] = v;
                          setField(selPart.id, k, r);
                        }}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="palette">
          {PALETTE_GROUPS.map((g) => (
            <div key={g.title} className="palette-group">
              <div className="side-label">{g.title}</div>
              <div className="palette-items">
                {g.items.map((it) => (
                  <button key={it.label} className="part-chip" onClick={() => addPart(it)}>
                    <Icon name="plus" size={13} /> {it.label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {selPart && <button className="btn small ghost back-btn" onClick={() => setSelId(null)}>← All parts</button>}
      {result}
    </div>
  );

  const libraryView = (
    <div className="studio-library">
      <div className="lib-bar">
        <div className="lib-filters">
          {(['All', 'Recent', 'Physics', 'Maths', 'Chemistry', 'Mine'] as const).map((f) => (
            <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {f === 'Mine' ? `Saved (${mine.length})` : f === 'Recent' ? `Recent (${recent.length})` : f}
            </button>
          ))}
        </div>
        {filter === 'Recent' && recent.length > 0 && (
          <button className="btn small ghost" onClick={() => setRecent(clearRecent())}>Clear recent</button>
        )}
        <input className="lib-search" placeholder="Search diagrams" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      {library.length === 0 ? (
        <div className="lib-empty">
          {query.trim() ? 'Nothing matches that search.' : filter === 'Mine' ? 'Diagrams you save appear here.' : filter === 'Recent' ? 'Every diagram you sketch or place appears here, saved or not.' : 'Nothing here yet.'}
        </div>
      ) : (
        <div className="lib-grid">
          {library.map((item) => (
            <div key={item.id} className="lib-card" role="button" tabIndex={0} onClick={() => openItem(item)} onKeyDown={(e) => e.key === 'Enter' && openItem(item)}>
              <Thumb d={item.diagram} theme={theme} />
              <div className="lib-info">
                <div className="lib-title">{item.title}</div>
                <div className="lib-sub">
                  {item.subject === 'Mine' ? 'Saved' : item.subject}
                  {item.savedAt ? ` · ${new Date(item.savedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
                </div>
              </div>
              {(item.subject === 'Mine' || item.subject === 'Recent') && (
                <button
                  className="lib-remove"
                  aria-label={`Remove ${item.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (item.subject === 'Mine') setMine(removeMine(item.id));
                    else setRecent(removeRecent(item.id));
                  }}
                >
                  <Icon name="close" size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="studio-scrim" onPointerDown={(e) => e.target === e.currentTarget && requestClose()}>
      <div
        ref={rootRef}
        className="studio"
        role="dialog"
        aria-modal="true"
        aria-label="AI Diagram"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onContextMenu={(e) => e.preventDefault()}
      >
        <header className="studio-head">
          <div className="studio-brand">
            <div className="brand-mark"><Icon name="wand" size={17} /></div>
            <div>
              <div className="brand-title">AI Diagram</div>
              <div className="brand-sub">Sketch, solve and check</div>
            </div>
          </div>
          <div className="studio-tabs" role="tablist">
            {(['describe', 'build', 'library'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
                <Icon name={t === 'describe' ? 'wand' : t === 'build' ? 'blocks' : 'library'} size={15} />
                {t === 'describe' ? 'Describe' : t === 'build' ? 'Build' : 'Library'}
              </button>
            ))}
          </div>
          <button className="studio-close" aria-label="Close" onClick={requestClose}><Icon name="close" size={18} /></button>
        </header>

        {tab === 'library' ? libraryView : (
          <div className="studio-body">
            {previewArea}
            {tab === 'describe' ? describeSide : buildSide}
          </div>
        )}

        <footer className="studio-foot">
          <div className="versions">
            <button className="btn icon-btn" aria-label="Undo" disabled={hist.at <= 0} onClick={() => go(hist.at - 1)}><Icon name="undo" size={16} /></button>
            <button className="btn icon-btn" aria-label="Redo" disabled={hist.at >= hist.list.length - 1} onClick={() => go(hist.at + 1)}><Icon name="redo" size={16} /></button>
            {hist.list.length > 0 && (
              <div className="version-dots" aria-label={`Version ${hist.at + 1} of ${hist.list.length}`}>
                {hist.list.slice(-8).map((v, i) => {
                  const at = hist.list.length - Math.min(8, hist.list.length) + i;
                  return <button key={at} className={at === hist.at ? 'on' : ''} title={v.how} aria-label={`Version ${at + 1}: ${v.how}`} onClick={() => go(at)} />;
                })}
                <span>Version {hist.at + 1} of {hist.list.length}</span>
              </div>
            )}
            {dirty && <button className="btn small ghost" onClick={startOver}>Start over</button>}
          </div>
          <div className="foot-actions">
            <button className="btn" disabled={!d} onClick={save}><Icon name="library" size={15} /> Save to library</button>
            <button className="btn primary" disabled={!d || busy} onClick={place}>
              <Icon name="check" size={16} /> {initial ? 'Update on board' : 'Place on board'}
            </button>
          </div>
        </footer>
        {toast && <div className="studio-toast">{toast}</div>}
        {confirmClose && (
          <div className="sd-confirm-scrim" onPointerDown={(e) => e.target === e.currentTarget && setConfirmClose(false)}>
            <div className="sd-confirm" role="alertdialog" aria-modal="true" aria-labelledby="sd-confirm-title">
              <h3 id="sd-confirm-title">Close without placing it?</h3>
              <p>
                Your diagram stays as a draft and comes back when you open AI Diagram again. Every sketch is
                also kept in <b>Library, Recent</b>.
              </p>
              <div className="sd-confirm-actions">
                <button className="btn ghost sd-discard" onClick={() => { abort.current?.abort(); clearDraft(); onClose(); }}>Discard draft</button>
                <span />
                <button className="btn" autoFocus onClick={() => setConfirmClose(false)}>Keep editing</button>
                <button className="btn primary" onClick={() => { draftNow.current(); abort.current?.abort(); onClose(); }}>Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function blankVersion(): Version {
  return { diagram: { ...emptyDiagram(), title: 'My diagram' }, prompt: '', issues: [], fixed: 0, model: 'you', ms: 0, how: 'New diagram' };
}

// --- small pieces -------------------------------------------------------------------------------

function NumField({ field, value, onChange }: { field: Field; value: number | undefined; onChange: (v: number) => void }) {
  // The text can differ from the value while a number is half typed ("0." or "-").
  const [text, setText] = useState(value === undefined ? '' : String(value));
  const shown = parseFloat(text) === value ? text : value === undefined ? '' : String(value);
  return (
    <label className="field">
      <span>{field.label}</span>
      <div className="field-input">
        <input
          type="number"
          step={field.step}
          min={field.min}
          value={shown}
          onChange={(e) => {
            setText(e.target.value);
            const v = parseFloat(e.target.value);
            if (Number.isFinite(v) && (field.min === undefined || v >= field.min)) onChange(v);
          }}
        />
        {field.unit && <em>{field.unit}</em>}
      </div>
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <div className="field-input">
        <input value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </label>
  );
}

function Toggle({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle-row${on ? ' on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span>{label}</span>
      <i />
    </button>
  );
}

function Thumb({ d, theme }: { d: Diagram; theme: Theme }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = PALETTE[theme];
    drawDiagramCard(ctx, cardIn(d, w, h, 4, 'thumb'), lookFor(colors, colors.ink), { chrome: false });
  }, [d, theme]);
  return <canvas ref={ref} className="thumb-canvas" />;
}

function SketchLoader({ stage, fixing, onCancel }: { stage: number; fixing: number; onCancel: () => void }) {
  const labels = STAGES.map((s, i) => (i === 3 && fixing ? `Fixing ${plural(fixing, 'problem')} the checker found` : s));
  return (
    <div className="sketch-loader" role="status" aria-live="polite">
      <div className="sketch-paper">
        <svg viewBox="0 0 320 210" className="sketch-svg" aria-hidden="true">
          <path className="s s1" pathLength={1} d="M70 26 H250" />
          <path className="s s1h" pathLength={1} d="M80 26 l-8 -9 M100 26 l-8 -9 M120 26 l-8 -9 M140 26 l-8 -9 M160 26 l-8 -9 M180 26 l-8 -9 M200 26 l-8 -9 M220 26 l-8 -9 M240 26 l-8 -9" />
          <path className="s s2" pathLength={1} d="M160 26 V46" />
          <circle className="s s3" pathLength={1} cx="160" cy="66" r="20" />
          <path className="s s4" pathLength={1} d="M140 66 V132" />
          <path className="s s5" pathLength={1} d="M180 66 V112" />
          <rect className="s s6" pathLength={1} x="121" y="132" width="38" height="38" rx="6" />
          <rect className="s s7" pathLength={1} x="160" y="112" width="42" height="42" rx="6" />
          <path className="s s8 red" pathLength={1} d="M140 172 V200 M134 192 L140 200 L146 192" />
          <path className="s s9 blue" pathLength={1} d="M181 112 V88 M175 96 L181 88 L187 96" />
        </svg>
        <div className="sketch-nib" />
        <div className="sketch-shine" />
      </div>
      <ol className="sketch-stages">
        {labels.map((s, i) => (
          <li key={s} className={i < stage ? 'done' : i === stage ? 'now' : ''}>
            <span className="dot">{i < stage ? <Icon name="check" size={11} /> : null}</span>
            {s}
          </li>
        ))}
      </ol>
      <button className="btn small ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}
