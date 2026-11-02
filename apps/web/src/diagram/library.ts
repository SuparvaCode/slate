/**
 * The diagram library: built-in starters (each checked by tests/diagram.test.ts or by eye), and
 * the user's own saved diagrams, kept in the browser.
 */

import { normalize } from './normalize';
import type { Diagram } from './types';

export interface LibraryItem {
  id: string;
  title: string;
  subject: 'Physics' | 'Maths' | 'Chemistry' | 'Mine' | 'Recent';
  prompt: string;
  diagram: Diagram;
  savedAt?: number;
}

const benzene = () => {
  const c = [7, 4.5];
  const r = 1.45;
  const parts: unknown[] = [];
  for (let k = 0; k < 6; k++) {
    const a = ((90 + 60 * k) * Math.PI) / 180;
    parts.push({ id: `c${k}`, type: 'atom', el: 'C', at: [c[0] + r * Math.cos(a), c[1] - r * Math.sin(a)] });
  }
  for (let k = 0; k < 6; k++) parts.push({ id: `b${k}`, type: 'bond', from: `c${k}`, to: `c${(k + 1) % 6}`, order: k % 2 ? 1 : 2 });
  return {
    title: 'Benzene, C₆H₆', kind: 'chemistry', size: [14, 9], parts,
    marks: [{ type: 'label', at: [7, 8], text: 'Kekulé structure: alternating single and double bonds' }],
  };
};

const BUILT_IN: { title: string; subject: LibraryItem['subject']; prompt: string; raw: unknown }[] = [
  {
    title: 'Atwood machine', subject: 'Physics', prompt: 'Atwood machine with 2 kg and 3 kg masses',
    raw: {
      title: 'Atwood machine', kind: 'mechanics', size: [12, 9],
      parts: [
        { id: 'c', type: 'ceiling', at: [4, 0.5], w: 4 },
        { id: 'p', type: 'pulley', at: [6, 1.8], r: 0.6 },
        { id: 'm1', type: 'mass', at: [5.4, 6], kg: 2, label: 'A' },
        { id: 'm2', type: 'mass', at: [6.6, 5], kg: 3, label: 'B', color: 'orange' },
        { id: 'f', type: 'floor', at: [3, 8.6], w: 6 },
      ],
      ropes: [{ id: 'rope', path: ['m1', 'p', 'm2'] }],
    },
  },
  {
    title: 'Block on a table', subject: 'Physics', prompt: '4 kg block on a rough table (μ = 0.3) pulled by a hanging 2 kg mass',
    raw: {
      title: 'Block on a rough table', kind: 'mechanics', size: [13, 9],
      parts: [
        { id: 't', type: 'table', at: [1, 4], w: 7, h: 4.6, mu: 0.3 },
        { id: 'm1', type: 'mass', at: [4, 3], kg: 4, on: 't', label: 'A' },
        { id: 'p', type: 'pulley', at: [8.4, 3.6], r: 0.45 },
        { id: 'm2', type: 'mass', at: [8.85, 6.5], kg: 2, label: 'B', color: 'orange' },
        { id: 'f', type: 'floor', at: [0.5, 8.6], w: 11 },
      ],
      ropes: [{ id: 'rope', path: ['m1', 'p', 'm2'] }],
    },
  },
  {
    title: 'Incline held by friction', subject: 'Physics', prompt: '5 kg block on a 30° slope, μ = 0.25, tied over a pulley to 2 kg',
    raw: {
      title: 'Block on an incline', kind: 'mechanics', size: [13, 9],
      parts: [
        { id: 's', type: 'incline', at: [1, 7.8], w: 7, angle: 30, mu: 0.25 },
        { id: 'm1', type: 'mass', at: [4.5, 5.6], kg: 5, on: 's', label: 'A' },
        { id: 'p', type: 'pulley', at: [8.2, 3.4], r: 0.45 },
        { id: 'm2', type: 'mass', at: [8.6, 6], kg: 2, label: 'B', color: 'orange' },
      ],
      ropes: [{ id: 'rope', path: ['m1', 'p', 'm2'] }],
    },
  },
  {
    title: 'Movable pulley', subject: 'Physics', prompt: 'A 40 kg load lifted with a movable pulley by a 220 N pull',
    raw: {
      title: 'Single movable pulley', kind: 'mechanics', size: [12, 10],
      parts: [
        { id: 'c', type: 'ceiling', at: [3, 0.5], w: 6 },
        { id: 'top', type: 'pulley', at: [6.5, 1.7], r: 0.5 },
        { id: 'low', type: 'pulley', at: [5.5, 5], r: 0.5, fixed: false },
        { id: 'load', type: 'mass', at: [5.5, 7.2], kg: 40, label: 'Load' },
        { id: 'F', type: 'effort', at: [7, 5.2], N: 220, label: 'F' },
        { id: 'f', type: 'floor', at: [2, 9.6], w: 8 },
      ],
      ropes: [
        { id: 'rope', path: ['c', 'low', 'top', 'F'] },
        { id: 'hook', path: ['low', 'load'] },
      ],
    },
  },
  {
    title: 'Series circuit', subject: 'Physics', prompt: '12 V battery with 4 Ω and 2 Ω in series, an ammeter and a voltmeter across 4 Ω',
    raw: {
      title: 'Resistors in series', kind: 'circuit', size: [12, 8],
      parts: [
        { id: 'B', type: 'battery', at: [2, 4], V: 12, rot: 90 },
        { id: 'R1', type: 'resistor', at: [6, 2], ohm: 4 },
        { id: 'R2', type: 'resistor', at: [6, 6.5], ohm: 2 },
        { id: 'A', type: 'ammeter', at: [10, 4], rot: 90 },
        { id: 'V', type: 'voltmeter', at: [6, 0.6] },
        { id: 'j1', type: 'junction', at: [4.5, 2] },
        { id: 'j2', type: 'junction', at: [7.5, 2] },
      ],
      wires: [
        ['B.+', 'j1'], ['j1', 'R1.a'], ['R1.b', 'j2'], ['j2', 'A.a'], ['A.b', 'R2.b'], ['R2.a', 'B.-'],
        ['V.a', 'j1'], ['V.b', 'j2'],
      ],
    },
  },
  {
    title: 'Wheatstone bridge', subject: 'Physics', prompt: 'An unbalanced Wheatstone bridge on 10 V',
    raw: {
      title: 'Unbalanced bridge', kind: 'circuit', size: [13, 9],
      parts: [
        { id: 'B', type: 'battery', at: [6.5, 8.2], V: 10, rot: 180 },
        { id: 'a', type: 'junction', at: [1.5, 4.5] },
        { id: 'b', type: 'junction', at: [11.5, 4.5] },
        { id: 'c', type: 'junction', at: [6.5, 1.5] },
        { id: 'd', type: 'junction', at: [6.5, 6.6] },
        { id: 'R1', type: 'resistor', at: [4, 1.5], ohm: 1 },
        { id: 'R2', type: 'resistor', at: [4, 6.6], ohm: 2 },
        { id: 'R3', type: 'resistor', at: [9, 1.5], ohm: 2 },
        { id: 'R4', type: 'resistor', at: [9, 6.6], ohm: 1 },
        { id: 'R5', type: 'resistor', at: [6.5, 4.05], ohm: 1, rot: 90 },
      ],
      wires: [
        ['B.+', 'b'], ['B.-', 'a'], ['a', 'R1.a'], ['R1.b', 'c'], ['a', 'R2.a'], ['R2.b', 'd'],
        ['c', 'R3.a'], ['R3.b', 'b'], ['d', 'R4.a'], ['R4.b', 'b'], ['c', 'R5.a'], ['R5.b', 'd'],
      ],
    },
  },
  {
    title: 'Parabola and its roots', subject: 'Maths', prompt: 'Graph of y = x² − 4 with its roots and vertex',
    raw: {
      title: 'y = x² − 4', kind: 'graph', size: [12, 9],
      parts: [{
        id: 'g', type: 'graph', at: [0.6, 0.4], w: 10.8, h: 8.2, xr: [-4, 4], yr: [-5, 8],
        fns: [{ expr: 'x^2 - 4' }],
        dots: [{ x: -2, y: 0, label: '(−2, 0)' }, { x: 2, y: 0, label: '(2, 0)' }, { x: 0, y: -4, label: 'vertex (0, −4)' }],
      }],
    },
  },
  {
    title: 'sin x and cos x', subject: 'Maths', prompt: 'Graphs of sin x and cos x from −2π to 2π',
    raw: {
      title: 'sin x and cos x', kind: 'graph', size: [14, 8],
      parts: [{ id: 'g', type: 'graph', at: [0.6, 0.4], w: 12.8, h: 7.2, xr: [-6.5, 6.5], yr: [-1.6, 1.6], fns: [{ expr: 'sin(x)' }, { expr: 'cos(x)' }] }],
    },
  },
  {
    title: 'Right triangle', subject: 'Maths', prompt: 'A 3-4-5 right triangle with its angle θ marked',
    raw: {
      title: 'A 3-4-5 triangle', kind: 'geometry', size: [12, 8],
      parts: [
        { id: 'A', type: 'point', at: [2, 6.8], label: 'A' },
        { id: 'B', type: 'point', at: [10, 6.8], label: 'B' },
        { id: 'C', type: 'point', at: [2, 0.8], label: 'C' },
        { id: 't', type: 'polygon', points: ['A', 'B', 'C'], fill: true, color: 'blue' },
      ],
      marks: [
        { type: 'right', at: 'A', from: 'B', to: 'C' },
        { type: 'angle', at: 'B', from: 'A', to: 'C', text: 'θ' },
        { type: 'label', at: [6, 7.5], text: '4 cm' },
        { type: 'label', at: [1.1, 3.8], text: '3 cm' },
        { type: 'label', at: [6.5, 3.4], text: '5 cm' },
      ],
    },
  },
  { title: 'Benzene', subject: 'Chemistry', prompt: 'Kekulé structure of benzene', raw: benzene() },
  {
    title: 'Water molecule', subject: 'Chemistry', prompt: 'A water molecule with its bond angle',
    raw: {
      title: 'Water, H₂O', kind: 'chemistry', size: [10, 7],
      parts: [
        { id: 'o', type: 'atom', el: 'O', at: [5, 2.6] },
        { id: 'h1', type: 'atom', el: 'H', at: [3.3, 4.6] },
        { id: 'h2', type: 'atom', el: 'H', at: [6.7, 4.6] },
        { id: 'b1', type: 'bond', from: 'o', to: 'h1' },
        { id: 'b2', type: 'bond', from: 'o', to: 'h2' },
      ],
      marks: [
        { type: 'angle', at: 'o', from: 'h1', to: 'h2', text: '104.5°' },
        { type: 'label', at: [5, 1.3], text: '2 lone pairs' },
      ],
    },
  },
];

export const STARTERS: LibraryItem[] = BUILT_IN.map((b, i) => ({
  id: `starter-${i}`, title: b.title, subject: b.subject, prompt: b.prompt, diagram: normalize(b.raw).diagram,
}));

const KEY = 'slate.diagrams.v1';

export function loadMine(): LibraryItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r) => r && typeof r.id === 'string' && typeof r.title === 'string')
      .map((r) => ({ id: r.id, title: r.title, subject: 'Mine' as const, prompt: String(r.prompt ?? ''), savedAt: r.savedAt, diagram: normalize(r.diagram).diagram }));
  } catch {
    return [];
  }
}

export function saveMine(item: { title: string; prompt: string; diagram: Diagram }): LibraryItem[] {
  const list = loadMine();
  const entry: LibraryItem = { id: Math.random().toString(36).slice(2, 10), subject: 'Mine', savedAt: Date.now(), ...item };
  const next = [entry, ...list].slice(0, 60);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export function removeMine(id: string): LibraryItem[] {
  const next = loadMine().filter((i) => i.id !== id);
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

// --- recent diagrams and the open draft ---------------------------------------------------

const RECENT = 'slate.diagrams.recent.v1';
const DRAFT = 'slate.diagrams.draft.v1';

/** Every diagram the AI made or you placed, newest first, kept without being asked. */
export function loadRecent(): LibraryItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r) => r && typeof r.id === 'string')
      .map((r) => ({ id: r.id, title: String(r.title ?? 'Untitled diagram'), subject: 'Recent' as const, prompt: String(r.prompt ?? ''), savedAt: r.savedAt, diagram: normalize(r.diagram).diagram }));
  } catch {
    return [];
  }
}

export function pushRecent(item: { title: string; prompt: string; diagram: Diagram }): LibraryItem[] {
  const key = JSON.stringify(item.diagram);
  const list = loadRecent().filter((r) => JSON.stringify(r.diagram) !== key);
  const entry: LibraryItem = { id: Math.random().toString(36).slice(2, 10), subject: 'Recent', savedAt: Date.now(), ...item };
  const next = [entry, ...list].slice(0, 30);
  try {
    localStorage.setItem(RECENT, JSON.stringify(next));
  } catch {
    // Storage full: the recent list is a convenience, never worth an error.
  }
  return next;
}

export function removeRecent(id: string): LibraryItem[] {
  const next = loadRecent().filter((i) => i.id !== id);
  localStorage.setItem(RECENT, JSON.stringify(next));
  return next;
}

export function clearRecent(): LibraryItem[] {
  localStorage.removeItem(RECENT);
  return [];
}

export interface Draft {
  prompt: string;
  feedback: string;
  /** The versions, as the studio keeps them. */
  versions: unknown[];
  at: number;
  /** The board diagram being changed, if any. */
  editId: string | null;
  savedAt: number;
}

export function loadDraft(): Draft | null {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT) ?? 'null');
    if (!d || !Array.isArray(d.versions) || d.versions.length === 0) return null;
    return d as Draft;
  } catch {
    return null;
  }
}

export function saveDraft(d: Draft) {
  try {
    // Only the last 20 versions are kept; the open one keeps pointing at the same version.
    const drop = Math.max(0, d.versions.length - 20);
    localStorage.setItem(DRAFT, JSON.stringify({ ...d, versions: d.versions.slice(drop), at: Math.max(0, d.at - drop) }));
  } catch {
    // ignore: storage full
  }
}

export function clearDraft() {
  localStorage.removeItem(DRAFT);
}
