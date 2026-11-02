/**
 * Molecule builder: an editable 2D structure, drawn skeletal, displayed (every atom and every
 * hydrogen) or as balls and sticks.
 *
 * The structure lives in two string settings, so it saves and undoes with the board:
 *
 *   atoms  "C,0,-1;O,0.87,-0.5,-1;..."   element, x, y in bond lengths (y down), charge if any
 *   bonds  "0-1-2;1-2-1;..."             atom index, atom index, order (1 to 3)
 *
 * Hydrogens are worked out from each atom's valence, so a structure only stores the ones the
 * student drew on purpose. Editing happens on the card: pick an element, a bond order or a tool
 * in the strip at the top, then tap or drag on the drawing.
 */

import { BH, BW, SIM_FONT, bool, fmt, label, line, num, str, text } from './kit.ts';
import type { Formula, Look, Readout, SimDef, SimGrab, SimParams, SimState } from './kit.ts';
import { ELEMENTS } from './periodic-data.ts';

export interface Atom {
  el: string;
  x: number;
  y: number;
  /** Formal charge. */
  q: number;
}
export interface Bond {
  a: number;
  b: number;
  /** 1 single, 2 double, 3 triple. */
  o: number;
}
export interface Mol {
  atoms: Atom[];
  bonds: Bond[];
}

const TAU = Math.PI * 2;
const r2 = (v: number) => Math.round(v * 100) / 100 || 0;
const norm = (a: number) => ((a % TAU) + TAU) % TAU;
const bkey = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

// --- the structure as settings ----------------------------------------------------------------

export function parseMol(atoms: string, bonds: string): Mol {
  const as: Atom[] = [];
  for (const part of atoms.split(';')) {
    const f = part.split(',');
    if (f.length < 3 || !f[0].trim()) continue;
    const x = Number(f[1]);
    const y = Number(f[2]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    as.push({ el: f[0].trim(), x, y, q: Math.round(Number(f[3])) || 0 });
  }
  const bs: Bond[] = [];
  const seen = new Set<string>();
  for (const part of bonds.split(';')) {
    const [a, b, o] = part.split('-').map(Number);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a === b || a < 0 || b < 0 || a >= as.length || b >= as.length) continue;
    if (seen.has(bkey(a, b))) continue;
    seen.add(bkey(a, b));
    bs.push({ a, b, o: Math.min(3, Math.max(1, Math.round(o) || 1)) });
  }
  return { atoms: as, bonds: bs };
}

export function encodeMol(m: Mol): { atoms: string; bonds: string } {
  return {
    atoms: m.atoms.map((a) => `${a.el},${r2(a.x)},${r2(a.y)}${a.q ? `,${a.q}` : ''}`).join(';'),
    bonds: m.bonds.map((b) => `${b.a}-${b.b}-${b.o}`).join(';'),
  };
}

/**
 * A structure from PubChem (through /api/molecule) or the AI, as settings. Hydrogens hanging off
 * another atom are dropped, since the valence rules put them back, and the drawing is centred.
 */
export function molFromStructure(s: {
  atoms: { el: string; x: number; y: number; charge?: number }[];
  bonds: { a: number; b: number; order: number }[];
}): { atoms: string; bonds: string } {
  const partners = s.atoms.map(() => [] as number[]);
  for (const b of s.bonds) {
    if (!s.atoms[b.a] || !s.atoms[b.b]) continue;
    partners[b.a].push(b.b);
    partners[b.b].push(b.a);
  }
  const drop = new Set<number>();
  s.atoms.forEach((a, i) => {
    if (a.el === 'H' && !a.charge && partners[i].length === 1 && s.atoms[partners[i][0]].el !== 'H') drop.add(i);
  });
  const keep = s.atoms.map((_, i) => i).filter((i) => !drop.has(i));
  const index = new Map(keep.map((i, j) => [i, j]));
  const cx = keep.reduce((t, i) => t + s.atoms[i].x, 0) / (keep.length || 1);
  const cy = keep.reduce((t, i) => t + s.atoms[i].y, 0) / (keep.length || 1);
  return encodeMol({
    atoms: keep.map((i) => ({ el: s.atoms[i].el, x: s.atoms[i].x - cx, y: s.atoms[i].y - cy, q: s.atoms[i].charge ?? 0 })),
    bonds: s.bonds
      .filter((b) => index.has(b.a) && index.has(b.b))
      .map((b) => ({ a: index.get(b.a)!, b: index.get(b.b)!, o: b.order })),
  });
}

/**
 * A chemistry diagram (atom and bond parts, from the AI or the library) as molecule-builder
 * settings, or null if it has anything else in it. Coordinates are rescaled so the typical bond
 * is one unit long; the name is the title without its formula.
 */
export function molFromDiagram(d: {
  title: string;
  parts: { id: string; type: string; at?: unknown; el?: string; charge?: string; from?: unknown; to?: unknown; order?: number }[];
}): SimParams | null {
  const atoms = d.parts.filter((p) => p.type === 'atom');
  const bonds = d.parts.filter((p) => p.type === 'bond');
  if (!atoms.length || d.parts.some((p) => p.type !== 'atom' && p.type !== 'bond' && p.type !== 'text')) return null;
  const index = new Map<string, number>();
  const pts: { el: string; x: number; y: number; charge?: number }[] = [];
  for (const a of atoms) {
    if (!Array.isArray(a.at) || typeof a.at[0] !== 'number' || typeof a.at[1] !== 'number' || !a.el) return null;
    index.set(a.id, pts.length);
    const c = a.charge ?? '';
    const k = Number(c.replace(/[+-]/g, '')) || 1;
    pts.push({ el: a.el, x: a.at[0], y: a.at[1], charge: c.includes('+') ? k : c.includes('-') || c.includes('−') ? -k : 0 });
  }
  const bs: { a: number; b: number; order: number }[] = [];
  for (const b of bonds) {
    const i = typeof b.from === 'string' ? index.get(b.from) : undefined;
    const j = typeof b.to === 'string' ? index.get(b.to) : undefined;
    if (i === undefined || j === undefined) return null;
    bs.push({ a: i, b: j, order: b.order ?? 1 });
  }
  const lengths = bs.map((b) => Math.hypot(pts[b.a].x - pts[b.b].x, pts[b.a].y - pts[b.b].y)).sort((x, y) => x - y);
  const k = lengths.length ? lengths[lengths.length >> 1] || 1 : 1;
  for (const pt of pts) {
    pt.x /= k;
    pt.y /= k;
  }
  const name = d.title.split(/[,(]/)[0].trim();
  return { ...molFromStructure({ atoms: pts, bonds: bs }), name };
}

// --- chemistry ------------------------------------------------------------------------------

/** Outer-shell electrons of the main-group elements whose hydrogens can be worked out. */
const OUTER: Record<string, number> = { H: 1, B: 3, C: 4, N: 5, O: 6, F: 7, Si: 4, P: 5, S: 6, Cl: 7, Se: 6, Br: 7, I: 7 };
/** No d orbitals to expand into: these never go past their usual valence. */
const PERIOD2 = new Set(['H', 'B', 'C', 'N', 'O', 'F']);
const HALOGEN = new Set(['F', 'Cl', 'Br', 'I']);

export interface AtomInfo {
  /** Hydrogens the valence calls for. */
  h: number;
  /** More bonds than the element can make. */
  error: boolean;
  lone: number;
}

/**
 * Hydrogens and lone pairs for an atom with these bonds. A charge makes it behave like its
 * neighbour in the table (N⁺ like C, O⁻ like F); S, P and the heavier halogens can expand to
 * higher valences (2, 4, 6 for sulfur) when they have the bonds for it.
 */
export function atomInfo(el: string, q: number, bondSum: number): AtomInfo {
  const ve = OUTER[el];
  if (ve === undefined) return { h: 0, error: false, lone: 0 };
  if (el === 'H') {
    const v = q === 0 ? 1 : 0;
    return { h: Math.max(0, v - bondSum), error: bondSum > v, lone: q < 0 ? 1 : 0 };
  }
  const e = ve - q;
  const base = e <= 4 ? e : 8 - e;
  const options = [base];
  if (!PERIOD2.has(el) && e > 4) for (let v = base + 2; v <= e; v += 2) options.push(v);
  const v = options.find((o) => o >= bondSum);
  if (v === undefined || base < 0) return { h: 0, error: true, lone: Math.max(0, Math.floor((e - bondSum) / 2)) };
  const h = v - bondSum;
  return { h, error: false, lone: Math.max(0, Math.floor((e - bondSum - h) / 2)) };
}

const MASS = new Map(ELEMENTS.map((e) => [e.symbol, e]));
const SUB = '₀₁₂₃₄₅₆₇₈₉';
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sub = (n: number) => String(n).replace(/\d/g, (d) => SUB[Number(d)]);
const chargeText = (q: number) => (Math.abs(q) > 1 ? String(Math.abs(q)) : '') + (q > 0 ? '+' : '−');

export interface Analysis {
  info: AtomInfo[];
  /** Every atom, hydrogens included. */
  counts: Record<string, number>;
  /** Hill order: carbon, hydrogen, then the rest alphabetically. */
  order: string[];
  formula: string;
  mass: number;
  massTex: string;
  /** Rings and double bonds; null when the molecule has elements the formula does not cover. */
  dou: number | null;
  errors: number;
  charge: number;
  rings: number[][];
  /** Index into rings of the smallest ring through each bond. */
  ringOfBond: Map<string, number>;
  /** Benzene-like rings, which can be drawn with a circle. */
  aromatic: number[][];
}

/** The shortest way from a to b that does not use the bond a–b itself, or null. */
function detour(adj: number[][], a: number, b: number): number[] | null {
  const prev = new Map<number, number>([[a, -1]]);
  const queue = [a];
  while (queue.length) {
    const u = queue.shift()!;
    for (const v of adj[u]) {
      if (u === a && v === b) continue;
      if (prev.has(v)) continue;
      prev.set(v, u);
      if (v === b) {
        const path = [b];
        for (let w = u; w !== -1; w = prev.get(w)!) path.push(w);
        return path;
      }
      queue.push(v);
    }
  }
  return null;
}

export function analyse(m: Mol): Analysis {
  const n = m.atoms.length;
  const sum = new Array<number>(n).fill(0);
  const doubles = new Array<number>(n).fill(0);
  const adj: number[][] = m.atoms.map(() => []);
  for (const b of m.bonds) {
    sum[b.a] += b.o;
    sum[b.b] += b.o;
    if (b.o === 2) {
      doubles[b.a]++;
      doubles[b.b]++;
    }
    adj[b.a].push(b.b);
    adj[b.b].push(b.a);
  }
  const info = m.atoms.map((a, i) => atomInfo(a.el, a.q, sum[i]));
  const counts: Record<string, number> = {};
  let charge = 0;
  m.atoms.forEach((a, i) => {
    counts[a.el] = (counts[a.el] ?? 0) + 1;
    if (info[i].h) counts.H = (counts.H ?? 0) + info[i].h;
    charge += a.q;
  });
  const order = 'C' in counts
    ? ['C', ...('H' in counts ? ['H'] : []), ...Object.keys(counts).filter((e) => e !== 'C' && e !== 'H').sort()]
    : Object.keys(counts).sort();
  let formula = order.map((e) => e + (counts[e] > 1 ? sub(counts[e]) : '')).join('');
  if (charge) formula += (Math.abs(charge) > 1 ? String(Math.abs(charge)).replace(/\d/g, (d) => SUP[Number(d)]) : '') + (charge > 0 ? '⁺' : '⁻');

  let mass = 0;
  const terms: string[] = [];
  for (const e of order) {
    const data = MASS.get(e);
    const k = counts[e];
    if (!data) continue;
    mass += data.massValue * k;
    terms.push(k > 1 ? `${k}(${data.massValue})` : String(data.massValue));
  }

  const known = order.every((e) => ['C', 'H', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I'].includes(e));
  const c = counts.C ?? 0;
  const dou = known && c > 0
    ? (2 * c + 2 + (counts.N ?? 0) + (counts.P ?? 0) - (counts.H ?? 0) - [...HALOGEN].reduce((t, x) => t + (counts[x] ?? 0), 0)) / 2
    : null;

  // Rings: the shortest detour round each bond, kept once each.
  const rings: number[][] = [];
  const ringIndex = new Map<string, number>();
  const ringOfBond = new Map<string, number>();
  for (const b of m.bonds) {
    const path = detour(adj, b.a, b.b);
    if (!path || path.length > 8) continue;
    const key = [...path].sort((x, y) => x - y).join(',');
    let r = ringIndex.get(key);
    if (r === undefined) {
      r = rings.length;
      rings.push(path);
      ringIndex.set(key, r);
    }
    for (let k = 0; k < path.length; k++) {
      const bk = bkey(path[k], path[(k + 1) % path.length]);
      const had = ringOfBond.get(bk);
      if (had === undefined || rings[had].length > path.length) ringOfBond.set(bk, r);
    }
  }
  // Six-membered rings of C and N where every atom has exactly one double bond.
  const aromatic = rings.filter((ring) => ring.length === 6 && ring.every((i) => (m.atoms[i].el === 'C' || m.atoms[i].el === 'N') && doubles[i] === 1
    && m.bonds.every((b) => b.o !== 3 || (b.a !== i && b.b !== i))));

  return {
    info, counts, order, formula, mass, massTex: terms.join(' + '), dou,
    errors: info.filter((x) => x.error).length, charge, rings, ringOfBond, aromatic,
  };
}

const memo = new Map<string, { mol: Mol; an: Analysis }>();
function analysed(p: SimParams) {
  const key = `${str(p, 'atoms')}|${str(p, 'bonds')}`;
  let got = memo.get(key);
  if (!got) {
    const mol = parseMol(str(p, 'atoms'), str(p, 'bonds'));
    got = { mol, an: analyse(mol) };
    memo.set(key, got);
    if (memo.size > 12) memo.delete(memo.keys().next().value!);
  }
  return got;
}

// --- geometry and editing ------------------------------------------------------------------------

/** Directions from atom i to each atom bonded to it. */
function neighbourAngles(m: Mol): number[][] {
  const out: number[][] = m.atoms.map(() => []);
  for (const b of m.bonds) {
    const A = m.atoms[b.a];
    const B = m.atoms[b.b];
    out[b.a].push(Math.atan2(B.y - A.y, B.x - A.x));
    out[b.b].push(Math.atan2(A.y - B.y, A.x - B.x));
  }
  return out;
}

/**
 * Directions for n hydrogens or lone pairs round an atom, shared out among the gaps between its
 * bonds (wider gaps take more), and spread evenly inside each gap.
 */
export function freeAngles(taken: number[], n: number): number[] {
  if (n <= 0) return [];
  if (!taken.length) {
    if (n === 1) return [0];
    if (n === 2) return [0.66, Math.PI - 0.66]; // bent, like water
    return Array.from({ length: n }, (_, k) => norm(Math.PI / 2 + (k * TAU) / n));
  }
  const s = taken.map(norm).sort((a, b) => a - b);
  const gaps = s.map((a, i) => ({ from: a, size: (i + 1 < s.length ? s[i + 1] : s[0] + TAU) - a, k: 0 }));
  for (let j = 0; j < n; j++) {
    let best = gaps[0];
    for (const g of gaps) if (g.size / (g.k + 1) > best.size / (best.k + 1) + 1e-9) best = g;
    best.k++;
  }
  const out: number[] = [];
  for (const g of gaps) for (let j = 1; j <= g.k; j++) out.push(norm(g.from + (g.size * j) / (g.k + 1)));
  return out;
}

export function atomAt(m: Mol, x: number, y: number, r = 0.34, skip = -1): number {
  let best = -1;
  let bd = r;
  m.atoms.forEach((a, i) => {
    const d = Math.hypot(a.x - x, a.y - y);
    if (i !== skip && d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

export function bondAt(m: Mol, x: number, y: number, r = 0.2): number {
  let best = -1;
  let bd = r;
  m.bonds.forEach((b, i) => {
    const A = m.atoms[b.a];
    const B = m.atoms[b.b];
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const t = Math.max(0, Math.min(1, ((x - A.x) * dx + (y - A.y) * dy) / (dx * dx + dy * dy || 1)));
    const d = Math.hypot(A.x + dx * t - x, A.y + dy * t - y);
    if (d < bd) {
      bd = d;
      best = i;
    }
  });
  return best;
}

export function addAtom(m: Mol, el: string, x: number, y: number): Mol {
  return { atoms: [...m.atoms, { el, x, y, q: 0 }], bonds: m.bonds };
}

/** Bonds atom i to whatever is at (x, y): an existing atom, or a new one of element el. */
export function bondTo(m: Mol, i: number, x: number, y: number, el: string, order: number): Mol {
  const j = atomAt(m, x, y, 0.34, i);
  if (j >= 0) {
    const k = m.bonds.findIndex((b) => bkey(b.a, b.b) === bkey(i, j));
    if (k >= 0) return { atoms: m.atoms, bonds: m.bonds.map((b, n) => (n === k ? { ...b, o: order } : b)) };
    return { atoms: m.atoms, bonds: [...m.bonds, { a: i, b: j, o: order }] };
  }
  const n = m.atoms.length;
  return { atoms: [...m.atoms, { el, x, y, q: 0 }], bonds: [...m.bonds, { a: i, b: n, o: order }] };
}

/**
 * Adds an atom bonded to atom i in the most open direction, one bond length away. Chains come
 * out as the usual zig-zag: with one neighbour the new bond is at 120°, on the side with more
 * room, rightwards when both sides are clear.
 */
export function growFrom(m: Mol, i: number, el: string, order: number): Mol {
  const a = m.atoms[i];
  const nb = neighbourAngles(m)[i];
  let ang: number;
  if (!nb.length) ang = -Math.PI / 6;
  else if (nb.length === 1) {
    const room = (t: number) => {
      const x = a.x + Math.cos(t);
      const y = a.y + Math.sin(t);
      return Math.min(9, ...m.atoms.filter((_, j) => j !== i).map((b) => Math.hypot(b.x - x, b.y - y)));
    };
    const [p, q] = [nb[0] + (TAU / 3), nb[0] - (TAU / 3)];
    const rp = room(p);
    const rq = room(q);
    ang = Math.abs(rp - rq) > 1e-6 ? (rp > rq ? p : q) : Math.cos(p) >= Math.cos(q) ? p : q;
  } else ang = freeAngles(nb, 1)[0];
  return bondTo(m, i, a.x + Math.cos(ang), a.y + Math.sin(ang), el, order);
}

export function cycleBond(m: Mol, k: number): Mol {
  return { atoms: m.atoms, bonds: m.bonds.map((b, n) => (n === k ? { ...b, o: (b.o % 3) + 1 } : b)) };
}

export function removeAtom(m: Mol, i: number): Mol {
  return {
    atoms: m.atoms.filter((_, j) => j !== i),
    bonds: m.bonds
      .filter((b) => b.a !== i && b.b !== i)
      .map((b) => ({ a: b.a > i ? b.a - 1 : b.a, b: b.b > i ? b.b - 1 : b.b, o: b.o })),
  };
}

export function removeBond(m: Mol, k: number): Mol {
  return { atoms: m.atoms, bonds: m.bonds.filter((_, n) => n !== k) };
}

// --- layout on the card ---------------------------------------------------------------------------

/** The tool strip across the top of the drawing. */
const TOP = 44;
const BTN_Y = 8;
const BTN_H = 28;
const ELEMS = ['C', 'H', 'N', 'O', 'S', 'P', 'F', 'Cl', 'Br', 'I'];

interface Btn { id: string; x: number; w: number }
const BUTTONS: Btn[] = (() => {
  const out: Btn[] = [];
  let x = 10;
  for (const el of ELEMS) {
    out.push({ id: el, x, w: 26 });
    x += 29;
  }
  x += 6;
  for (const o of [1, 2, 3]) {
    out.push({ id: `order${o}`, x, w: 26 });
    x += 29;
  }
  x += 6;
  for (const t of ['charge', 'move', 'erase']) {
    out.push({ id: t, x, w: 26 });
    x += 29;
  }
  out.push({ id: 'clear', x: x + 4, w: BW - 10 - x - 4 });
  return out;
})();

/** Bond-length units to drawing-box pixels: centred, as large as fits, at most 64 px a bond. */
function layout(m: Mol) {
  let mx = 0.5;
  let my = 0.5;
  for (const a of m.atoms) {
    mx = Math.max(mx, Math.abs(a.x));
    my = Math.max(my, Math.abs(a.y));
  }
  const s = Math.min(64, (BW / 2 - 30) / (mx + 0.6), ((BH - TOP) / 2 - 24) / (my + 0.6));
  return { s, cx: BW / 2, cy: TOP + (BH - TOP) / 2 - 6 };
}

// --- drawing -----------------------------------------------------------------------------------------

function elColor(el: string, look: Look): string {
  switch (el) {
    case 'O': return look.red;
    case 'N': return look.blue;
    case 'S': return look.dark ? '#e3c100' : '#9a7d00';
    case 'P': return look.orange;
    case 'F': case 'Cl': return look.green;
    case 'Br': return look.dark ? '#e07070' : '#a12d2d';
    case 'I': return look.violet;
    default: return look.ink;
  }
}

/** Ball colours (CPK). */
function cpk(el: string, look: Look): string {
  const c: Record<string, string> = {
    H: '#f2f2f2', N: '#3a5cf5', O: '#f03232', F: '#86d860', Cl: '#2fbf3a', Br: '#a62929', I: '#940094',
    S: '#e6c619', P: '#ff8000', B: '#ffb5b5', Si: '#d8b88c',
  };
  return el === 'C' ? (look.dark ? '#8e8e93' : '#3a3a3c') : c[el] ?? '#c88cff';
}

function mix(a: string, b: string, t: number): string {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const A = p(a);
  const B = p(b);
  return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',')})`;
}

function sphere(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, base: string) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.08, x, y, r);
  g.addColorStop(0, mix(base, '#ffffff', 0.75));
  g.addColorStop(0.5, mix(base, '#000000', 0.05));
  g.addColorStop(1, mix(base, '#000000', 0.5));
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = g;
  ctx.fill();
}

function drawPalette(ctx: CanvasRenderingContext2D, p: SimParams, look: Look) {
  const tool = str(p, 'tool', 'C');
  const order = num(p, 'order', 1);
  ctx.save();
  ctx.fillStyle = look.dark ? '#2c2c2e' : '#f2f2f5';
  ctx.beginPath();
  ctx.roundRect(5, 4, BW - 10, 36, 10);
  ctx.fill();
  for (const b of BUTTONS) {
    const on = b.id === tool || b.id === `order${order}`;
    const cx = b.x + b.w / 2;
    const cy = BTN_Y + BTN_H / 2;
    if (on) {
      ctx.fillStyle = look.blue;
      ctx.beginPath();
      ctx.roundRect(b.x, BTN_Y, b.w, BTN_H, 7);
      ctx.fill();
    }
    const fg = on ? '#ffffff' : look.ink;
    ctx.strokeStyle = fg;
    ctx.fillStyle = fg;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (ELEMS.includes(b.id)) {
      text(ctx, b.id, cx, cy + 0.5, { size: b.id.length > 1 ? 12 : 13.5, weight: 650, color: on ? '#ffffff' : elColor(b.id, look), align: 'center' });
    } else if (b.id.startsWith('order')) {
      const k = Number(b.id.slice(5));
      for (let i = 0; i < k; i++) line(ctx, cx - 8, cy + (i - (k - 1) / 2) * 4.5, cx + 8, cy + (i - (k - 1) / 2) * 4.5, fg, 2);
    } else if (b.id === 'charge') {
      text(ctx, '±', cx, cy, { size: 17, weight: 600, color: fg, align: 'center' });
    } else if (b.id === 'move') {
      ctx.beginPath();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + dx * 8, cy + dy * 8);
        ctx.moveTo(cx + dx * 8 - dy * 3 - dx * 3, cy + dy * 8 - dx * 3 - dy * 3);
        ctx.lineTo(cx + dx * 8, cy + dy * 8);
        ctx.lineTo(cx + dx * 8 + dy * 3 - dx * 3, cy + dy * 8 + dx * 3 - dy * 3);
      }
      ctx.stroke();
    } else if (b.id === 'erase') {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-0.65);
      ctx.strokeRect(-8, -4.5, 16, 9);
      ctx.fillRect(-8, -4.5, 6, 9);
      ctx.restore();
    } else {
      text(ctx, 'Clear', cx, cy, { size: 11.5, weight: 600, color: on ? '#ffffff' : look.muted, align: 'center' });
    }
  }
  ctx.restore();
}

const HINTS: Record<string, string> = {
  move: 'Drag an atom to move it',
  erase: 'Tap an atom or a bond to delete it',
  charge: 'Tap an atom to change its charge: 0, +, −',
};

function drawBond(
  ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, t1: number, t2: number,
  order: number, centre: [number, number] | null, s: number, lw: number, color: string,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const seg = (o: number, in1 = 0, in2 = 0) =>
    line(ctx, x1 + ux * (t1 + in1) + nx * o, y1 + uy * (t1 + in1) + ny * o, x2 - ux * (t2 + in2) + nx * o, y2 - uy * (t2 + in2) + ny * o, color, lw);
  if (order === 1) seg(0);
  else if (order === 2) {
    if (centre) {
      // In a ring the second line sits inside it, a little shorter.
      const side = Math.sign((centre[0] - (x1 + x2) / 2) * nx + (centre[1] - (y1 + y2) / 2) * ny) || 1;
      seg(0);
      seg(side * s * 0.17, t1 ? 0 : len * 0.13, t2 ? 0 : len * 0.13);
    } else {
      seg(s * 0.075);
      seg(-s * 0.075);
    }
  } else {
    seg(0);
    seg(s * 0.13);
    seg(-s * 0.13);
  }
}

function draw(ctx: CanvasRenderingContext2D, p: SimParams, look: Look) {
  drawPalette(ctx, p, look);
  const tool = str(p, 'tool', 'C');
  text(ctx, HINTS[tool] ?? 'Tap: add or change an atom · drag from an atom: bond · tap a bond: change it', 12, BH - 11, { size: 10.5, color: look.faint });

  const { mol: m, an } = analysed(p);
  if (!m.atoms.length) {
    text(ctx, 'Tap anywhere to place an atom, then drag from it to bond the next one', BW / 2, TOP + (BH - TOP) / 2,
      { color: look.muted, align: 'center', size: 13 });
    return;
  }
  const view = str(p, 'view', 'skeletal');
  const ball = view === 'ball';
  const full = view === 'full';
  const L = layout(m);
  const P = m.atoms.map((a) => [L.cx + a.x * L.s, L.cy + a.y * L.s] as [number, number]);
  const nbr = neighbourAngles(m);
  const hAng = m.atoms.map((_, i) => (ball || full ? freeAngles(nbr[i], an.info[i].h) : []));
  const lw = Math.max(1.4, L.s * 0.045);
  const fs = Math.min(17, Math.max(10.5, L.s * 0.36));
  const centres = an.rings.map((r) => [
    r.reduce((t, i) => t + P[i][0], 0) / r.length,
    r.reduce((t, i) => t + P[i][1], 0) / r.length,
  ] as [number, number]);
  const aro = bool(p, 'aromatic') ? an.aromatic : [];
  const aroBond = new Set<string>();
  for (const r of aro) for (let k = 0; k < r.length; k++) aroBond.add(bkey(r[k], r[(k + 1) % r.length]));

  ctx.save();
  ctx.lineCap = 'round';

  if (ball) {
    const stick = look.dark ? '#7c7c80' : '#a1a1a6';
    const R = (el: string) => (el === 'H' ? 0.2 : el === 'Br' || el === 'I' ? 0.38 : el === 'C' ? 0.29 : 0.31) * L.s;
    for (const b of m.bonds) {
      const [x1, y1] = P[b.a];
      const [x2, y2] = P[b.b];
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const nx = -(y2 - y1) / len;
      const ny = (x2 - x1) / len;
      const offs = b.o === 1 ? [0] : b.o === 2 ? [-0.075, 0.075] : [-0.12, 0, 0.12];
      for (const o of offs) line(ctx, x1 + nx * o * L.s, y1 + ny * o * L.s, x2 + nx * o * L.s, y2 + ny * o * L.s, stick, (b.o === 1 ? 0.11 : 0.065) * L.s);
    }
    const hs: [number, number][] = [];
    hAng.forEach((angs, i) => {
      for (const t of angs) {
        const hx = P[i][0] + Math.cos(t) * 0.72 * L.s;
        const hy = P[i][1] + Math.sin(t) * 0.72 * L.s;
        line(ctx, P[i][0], P[i][1], hx, hy, stick, 0.09 * L.s);
        hs.push([hx, hy]);
      }
    });
    for (const [x, y] of hs) sphere(ctx, x, y, R('H'), cpk('H', look));
    m.atoms.forEach((a, i) => {
      sphere(ctx, P[i][0], P[i][1], R(a.el), cpk(a.el, look));
      if (a.el !== 'C' && a.el !== 'H') text(ctx, a.el, P[i][0], P[i][1] + 0.5, { size: fs * 0.72, weight: 700, color: '#ffffff', align: 'center' });
      if (a.q) label(ctx, chargeText(a.q), P[i][0] + R(a.el) * 0.95, P[i][1] - R(a.el) * 0.95, look, { size: fs * 0.75 });
    });
  } else {
    const shown = (i: number) => full || m.atoms[i].el !== 'C' || nbr[i].length === 0 || m.atoms[i].q !== 0;
    const trim = (i: number) => (shown(i) ? fs * 0.62 : 0);
    for (const b of m.bonds) {
      const k = bkey(b.a, b.b);
      const r = an.ringOfBond.get(k);
      drawBond(ctx, P[b.a][0], P[b.a][1], P[b.b][0], P[b.b][1], trim(b.a), trim(b.b), aroBond.has(k) ? 1 : b.o,
        r === undefined ? null : centres[r], L.s, lw, look.line);
    }
    for (const r of aro) {
      const c = centres[an.rings.indexOf(r)];
      const rad = r.reduce((t, i) => t + Math.hypot(P[i][0] - c[0], P[i][1] - c[1]), 0) / r.length;
      ctx.beginPath();
      ctx.arc(c[0], c[1], rad * 0.58, 0, TAU);
      ctx.strokeStyle = look.line;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
    // Displayed formula: every hydrogen as its own atom.
    if (full) {
      hAng.forEach((angs, i) => {
        for (const t of angs) {
          const c = Math.cos(t);
          const s = Math.sin(t);
          const hx = P[i][0] + c * 0.8 * L.s;
          const hy = P[i][1] + s * 0.8 * L.s;
          line(ctx, P[i][0] + c * trim(i), P[i][1] + s * trim(i), hx - c * fs * 0.5, hy - s * fs * 0.5, look.line, lw);
          label(ctx, 'H', hx, hy, look, { size: fs * 0.92, weight: 600 });
        }
      });
    }
    const hLeft: boolean[] = [];
    m.atoms.forEach((a, i) => {
      if (!shown(i)) return;
      const [x, y] = P[i];
      const col = elColor(a.el, look);
      const h = full ? 0 : an.info[i].h;
      ctx.font = `600 ${fs}px ${SIM_FONT}`;
      const ew = ctx.measureText(a.el).width;
      // Hydrogens go on the side away from the bonds: HO–, –OH; H₂O and CH₄ when alone.
      const mean = nbr[i].reduce((t, ang) => t + Math.cos(ang), 0) / (nbr[i].length || 1);
      const left = nbr[i].length ? mean > 0.15 : ['O', 'S', 'Se', 'F', 'Cl', 'Br', 'I'].includes(a.el);
      hLeft[i] = left;
      label(ctx, a.el, x, y, look, { size: fs, color: col, weight: 600 });
      let right = x + ew / 2;
      if (h) {
        const hs = h > 1 ? `H${sub(h)}` : 'H';
        label(ctx, hs, left ? x - ew / 2 : x + ew / 2, y, look, { size: fs, color: col, weight: 600, align: left ? 'right' : 'left' });
        if (!left) right += ctx.measureText(hs).width;
      }
      if (a.q) label(ctx, chargeText(a.q), right + 1, y - fs * 0.5, look, { size: fs * 0.7, color: col, align: 'left' });
    });
    if (bool(p, 'lonepairs')) {
      m.atoms.forEach((a, i) => {
        const lone = an.info[i].lone;
        if (!lone || !shown(i)) return;
        const taken = [...nbr[i], ...hAng[i]];
        if (!full && an.info[i].h) taken.push(hLeft[i] ? Math.PI : 0);
        ctx.fillStyle = elColor(a.el, look);
        for (const t of freeAngles(taken, lone)) {
          const cx = P[i][0] + Math.cos(t) * fs * 0.85;
          const cy = P[i][1] + Math.sin(t) * fs * 0.85;
          for (const side of [-1, 1]) {
            ctx.beginPath();
            ctx.arc(cx - Math.sin(t) * side * 2.7, cy + Math.cos(t) * side * 2.7, 1.7, 0, TAU);
            ctx.fill();
          }
        }
      });
    }
  }
  // Atoms with too many bonds get a red ring.
  m.atoms.forEach((_, i) => {
    if (!an.info[i].error) return;
    ctx.beginPath();
    ctx.arc(P[i][0], P[i][1], fs * 0.85, 0, TAU);
    ctx.strokeStyle = look.red;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  });
  ctx.restore();
}

// --- editing on the card ----------------------------------------------------------------------------

function grab(p: SimParams, x: number, y: number): SimGrab | null {
  if (y < TOP) {
    const b = BUTTONS.find((b) => x >= b.x - 1 && x <= b.x + b.w + 1 && y >= BTN_Y - 2 && y <= BTN_Y + BTN_H + 2);
    if (!b) return null;
    if (b.id === 'clear') return { tap: { atoms: '', bonds: '', name: '' }, hint: 'Clear the structure' };
    if (b.id.startsWith('order')) return { tap: { order: Number(b.id.slice(5)) }, hint: 'Bond order for new bonds' };
    return { tap: { tool: b.id }, hint: ELEMS.includes(b.id) ? `Draw with ${b.id}` : HINTS[b.id] };
  }
  const { mol: m } = analysed(p);
  const L = layout(m);
  const toMol = (bx: number, by: number): [number, number] => [(bx - L.cx) / L.s, (by - L.cy) / L.s];
  const [mx, my] = toMol(x, y);
  const ai = atomAt(m, mx, my);
  const bi = ai < 0 ? bondAt(m, mx, my) : -1;
  const tool = str(p, 'tool', 'C');
  const order = num(p, 'order', 1);
  const edit = (next: Mol): SimParams => ({ ...encodeMol(next), name: '' });

  if (tool === 'move') {
    if (ai < 0) return null;
    return {
      cursor: 'grab',
      hint: 'Drag the atom',
      drag: (bx, by) => {
        const [nx, ny] = toMol(bx, by);
        return edit({ atoms: m.atoms.map((a, i) => (i === ai ? { ...a, x: nx, y: ny } : a)), bonds: m.bonds });
      },
    };
  }
  if (tool === 'erase') {
    if (ai >= 0) return { cursor: 'pointer', tap: edit(removeAtom(m, ai)), hint: 'Delete the atom' };
    if (bi >= 0) return { cursor: 'pointer', tap: edit(removeBond(m, bi)), hint: 'Delete the bond' };
    return null;
  }
  if (tool === 'charge') {
    if (ai < 0) return null;
    const q = m.atoms[ai].q;
    const next = q === 0 ? 1 : q > 0 ? -1 : 0;
    return { cursor: 'pointer', tap: edit({ atoms: m.atoms.map((a, i) => (i === ai ? { ...a, q: next } : a)), bonds: m.bonds }), hint: 'Change the charge' };
  }
  if (!ELEMS.includes(tool)) return null;

  // Drawing with an element: a drag from an atom bonds a new atom (or an existing one) to it,
  // at a whole multiple of 30°; a tap changes the atom, or grows the chain if it is already that element.
  const reach = (from: number, bx: number, by: number) => {
    const [px, py] = toMol(bx, by);
    const A = m.atoms[from];
    if (Math.hypot(px - A.x, py - A.y) < 0.4) return null;
    const j = atomAt(m, px, py, 0.34, from);
    if (j >= 0) return bondTo(m, from, m.atoms[j].x, m.atoms[j].y, tool, order);
    const t = Math.round(Math.atan2(py - A.y, px - A.x) / (Math.PI / 6)) * (Math.PI / 6);
    return bondTo(m, from, A.x + Math.cos(t), A.y + Math.sin(t), tool, order);
  };
  if (ai >= 0) {
    return {
      cursor: 'crosshair',
      hint: m.atoms[ai].el === tool ? 'Tap to add a bonded atom, or drag to place it' : `Tap to make it ${tool}, or drag to bond`,
      drag: (bx, by) => {
        const next = reach(ai, bx, by);
        return next ? edit(next) : encodeMol(m);
      },
      drop: (bx, by) => {
        if (reach(ai, bx, by)) return null;
        const a = m.atoms[ai];
        if (a.el !== tool) return edit({ atoms: m.atoms.map((x, i) => (i === ai ? { ...x, el: tool, q: 0 } : x)), bonds: m.bonds });
        return edit(growFrom(m, ai, tool, order));
      },
    };
  }
  if (bi >= 0) {
    const b = m.bonds[bi];
    const o = b.o === order ? (b.o % 3) + 1 : order;
    return { cursor: 'pointer', tap: edit({ atoms: m.atoms, bonds: m.bonds.map((x, n) => (n === bi ? { ...x, o } : x)) }), hint: 'Change the bond' };
  }
  // Empty space: a tap places an atom, a drag draws a bond with an atom at each end.
  const started = addAtom(m, tool, mx, my);
  const first = m.atoms.length;
  const pull = (bx: number, by: number) => {
    const [px, py] = toMol(bx, by);
    if (Math.hypot(px - mx, py - my) < 0.4) return null;
    const t = Math.round(Math.atan2(py - my, px - mx) / (Math.PI / 6)) * (Math.PI / 6);
    const j = atomAt(m, px, py);
    return j >= 0 ? bondTo(started, first, m.atoms[j].x, m.atoms[j].y, tool, order) : bondTo(started, first, mx + Math.cos(t), my + Math.sin(t), tool, order);
  };
  return {
    cursor: 'crosshair',
    hint: `Tap to place ${tool}, drag to draw a bond`,
    drag: (bx, by) => edit(pull(bx, by) ?? started),
    drop: (bx, by) => (pull(bx, by) ? null : edit(started)),
  };
}

// --- presets -------------------------------------------------------------------------------------------

/** Name, atoms, bonds: 2D layouts from PubChem, hydrogens left to the valence rules. */
const PRESETS: [string, string, string][] = [
  ['Benzene', 'C,-0,-1;C,0.87,-0.50;C,-0.87,-0.50;C,0.87,0.50;C,-0.87,0.50;C,-0,1', '0-1-2;0-2-1;1-3-1;2-4-2;3-5-2;4-5-1'],
  ['Methane', 'C,0,0', ''],
  ['Ethane', 'C,-0.50,0;C,0.50,0', '0-1-1'],
  ['Ethene', 'C,-0.50,0;C,0.50,0', '0-1-2'],
  ['Ethyne', 'C,-0.43,0.25;C,0.43,-0.25', '0-1-3'],
  ['Ethanol', 'O,0.52,-0.20;C,-0.35,0.30;C,-1.22,-0.20', '0-1-1;1-2-1'],
  ['Ethanoic acid', 'O,0.58,-0.46;O,-0.28,1.04;C,-1.15,-0.46;C,-0.28,0.04', '0-3-1;1-3-2;2-3-1'],
  ['Water', 'O,-0,0.33', ''],
  ['Ammonia', 'N,-0,0', ''],
  ['Carbon dioxide', 'O,0.87,-0.50;O,-0.87,0.50;C,-0,0', '0-2-2;1-2-2'],
  ['Cyclohexane', 'C,-0.87,0.50;C,-0,1;C,-0.87,-0.50;C,0.87,0.50;C,-0,-1;C,0.87,-0.50', '0-1-1;0-2-1;1-3-1;2-4-1;3-5-1;4-5-1'],
  ['Phenol', 'O,-0.07,-1.46;C,-0.07,-0.46;C,0.80,0.04;C,-0.93,0.04;C,0.80,1.04;C,-0.93,1.04;C,-0.07,1.54', '0-1-1;1-2-2;1-3-1;2-4-1;3-5-2;4-6-2;5-6-1'],
  ['Toluene', 'C,-0,-0.71;C,0.87,-0.21;C,-0.87,-0.21;C,-0,-1.71;C,0.87,0.79;C,-0.87,0.79;C,-0,1.29', '0-1-2;0-2-1;0-3-1;1-4-1;2-5-2;4-6-2;5-6-1'],
  ['Glucose', 'O,0.10,-0.99;O,-1.63,1.01;O,0.10,2.01;O,1.83,1.01;O,1.83,-0.99;O,-1.63,-1.99;C,-0.76,0.51;C,0.10,1.01;C,-0.76,-0.49;C,0.97,0.51;C,0.97,-0.49;C,-1.63,-0.99', '0-8-1;0-10-1;1-6-1;2-7-1;3-9-1;4-10-1;5-11-1;6-7-1;6-8-1;7-9-1;8-11-1;9-10-1'],
  ['Aspirin', 'O,-1.05,-0.13;O,1.55,-1.63;O,-0.19,-1.63;O,-1.92,1.37;C,-0.19,0.37;C,0.68,-0.13;C,-0.19,1.37;C,1.55,0.37;C,0.68,1.87;C,1.55,1.37;C,0.68,-1.13;C,-1.92,0.37;C,-2.78,-0.13', '0-4-1;0-11-1;1-10-1;2-10-2;3-11-2;4-5-1;4-6-2;5-7-2;5-10-1;6-8-1;7-9-1;8-9-2;11-12-1'],
  ['Caffeine', 'O,-0.33,-1.88;O,-2.07,1.12;N,-0.33,1.12;N,1.48,-0.68;N,-1.20,-0.38;N,1.48,0.93;C,0.53,-0.38;C,0.53,0.62;C,-0.33,-0.88;C,-1.20,0.62;C,2.06,0.12;C,-0.33,2.12;C,1.79,-1.63;C,-2.07,-0.88', '0-8-2;1-9-2;2-7-1;2-9-1;2-11-1;3-6-1;3-10-1;3-12-1;4-8-1;4-9-1;4-13-1;5-7-1;5-10-2;6-7-2;6-8-1'],
  ['Acetone', 'O,0.87,-0.50;C,-0,0;C,-0.87,-0.50;C,-0,1', '0-1-2;1-2-1;1-3-1'],
  ['Propane', 'C,-0,0.33;C,0.87,-0.17;C,-0.87,-0.17', '0-1-1;0-2-1'],
  ['Butane', 'C,-0.43,0.25;C,0.43,-0.25;C,-1.30,-0.25;C,1.30,0.25', '0-1-1;0-2-1;1-3-1'],
  ['Methanol', 'O,-0.11,0.27;C,0.76,-0.23', '0-1-1'],
  ['Formaldehyde', 'O,-0.43,0.25;C,0.43,-0.25', '0-1-2'],
  ['Urea', 'O,1.85,-1.07;N,-0.94,-1.07;N,0.46,1.35;C,0.46,-0.26', '0-3-2;1-3-1;2-3-1'],
  ['Naphthalene', 'C,-0.02,-0.50;C,-0.02,0.50;C,0.88,-1.03;C,0.88,1.03;C,-0.89,-1;C,-0.89,1;C,1.78,-0.52;C,1.78,0.52;C,-1.75,-0.50;C,-1.75,0.50', '0-1-1;0-2-2;0-4-1;1-3-2;1-5-1;2-6-1;3-7-1;4-8-2;5-9-2;6-7-2;8-9-1'],
  ['Ethyl ethanoate', 'O,0.14,-0.42;O,-0.72,1.08;C,1.01,0.08;C,1.88,-0.42;C,-0.72,0.08;C,-1.59,-0.42', '0-2-1;0-4-1;1-4-2;2-3-1;4-5-1'],
  ['Pyridine', 'N,-0,1;C,-0,-1;C,0.87,-0.50;C,-0.87,-0.50;C,0.87,0.50;C,-0.87,0.50', '0-4-2;0-5-1;1-2-2;1-3-1;2-4-1;3-5-2'],
  ['Chloroform', 'Cl,0.87,-0.50;Cl,-0.87,-0.50;Cl,-0,1;C,-0,0', '0-3-1;1-3-1;2-3-1'],
  ['Glycine', 'O,-1.41,-0.52;O,-0.54,0.98;N,1.19,-0.01;C,0.33,-0.52;C,-0.54,-0.01', '0-4-1;1-4-2;2-3-1;3-4-1'],
  ['Benzoic acid', 'O,0.78,-1.49;O,-0.95,-1.49;C,-0.09,0.01;C,0.78,0.51;C,-0.95,0.51;C,0.78,1.51;C,-0.95,1.51;C,-0.09,2.01;C,-0.09,-0.99', '0-8-1;1-8-2;2-3-2;2-4-1;2-8-1;3-5-1;4-6-2;5-7-2;6-7-1'],
  ['Nitrobenzene', 'O,0.87,-1.72,-1;O,-0.87,-1.72;N,-0,-1.22,1;C,-0,-0.22;C,0.87,0.28;C,-0.87,0.28;C,0.87,1.28;C,-0.87,1.28;C,-0,1.78', '0-2-1;1-2-2;2-3-1;3-4-2;3-5-1;4-6-1;5-7-2;6-8-2;7-8-1'],
  ['Aniline', 'N,-0,-1.26;C,-0,-0.26;C,0.87,0.24;C,-0.87,0.24;C,0.87,1.24;C,-0.87,1.24;C,-0,1.74', '0-1-1;1-2-2;1-3-1;2-4-1;3-5-2;4-6-2;5-6-1'],
];

export const MOLECULE_PRESETS = PRESETS.map(([name, atoms, bonds]) => ({ label: name, params: { atoms, bonds, name } as SimParams }));

// --- the simulator ---------------------------------------------------------------------------------------

export const moleculeSim: SimDef<SimState> = {
  label: 'Molecule builder',
  subject: 'Chemistry',
  keywords: 'molecule structure organic benzene bond atom lewis skeletal displayed formula isomer functional group ball stick valence molar mass',
  blurb: 'Draw and edit structures, or start from benzene, glucose, aspirin…',
  still: () => true,
  display: ['view', 'aromatic', 'lonepairs', 'tool', 'order', 'atoms', 'bonds', 'name'],
  defaults: {
    atoms: PRESETS[0][1],
    bonds: PRESETS[0][2],
    name: PRESETS[0][0],
    tool: 'C',
    order: 1,
    view: 'skeletal',
    aromatic: false,
    lonepairs: false,
  },
  controls: [
    {
      key: 'view', label: 'Drawn as', type: 'choice', options: [
        { value: 'skeletal', label: 'Skeletal' },
        { value: 'full', label: 'Displayed' },
        { value: 'ball', label: 'Ball and stick' },
      ],
    },
    { key: 'aromatic', label: 'Benzene rings as circles', type: 'toggle', show: (p) => str(p, 'view') !== 'ball' },
    { key: 'lonepairs', label: 'Lone pairs', type: 'toggle', show: (p) => str(p, 'view') !== 'ball' },
  ],
  presets: MOLECULE_PRESETS,
  title: (p) => {
    const { mol, an } = analysed(p);
    if (!mol.atoms.length) return 'Molecule builder';
    return `${str(p, 'name') || 'Molecule'} · ${an.formula}`;
  },
  init: () => ({ t: 0, done: false }),
  step: (_p, s, dt) => {
    s.t += dt;
  },
  draw: (ctx, p, _s, look) => draw(ctx, p, look),
  grab: (p, _s, x, y) => grab(p, x, y),
  readouts: (p) => {
    const { mol: m, an } = analysed(p);
    if (!m.atoms.length) return [{ label: 'Formula', value: '—' }];
    const hs = an.info.reduce((t, x) => t + x.h, 0);
    const out: Readout[] = [
      { label: 'Formula', value: an.formula },
      { label: 'Molar mass', value: `${an.mass.toFixed(2)} g/mol` },
      { label: 'Atoms', value: String(m.atoms.length + hs) },
      { label: 'Bonds', value: String(m.bonds.length + hs) },
    ];
    if (an.dou !== null) out.push({ label: 'Unsaturation', value: fmt(an.dou) });
    out.push(an.errors
      ? { label: 'Valence', value: `${an.errors} atom${an.errors > 1 ? 's' : ''} over`, color: 'red' }
      : { label: 'Valence', value: 'All OK', color: 'green' });
    return out;
  },
  formulas: (p) => {
    const { mol: m, an } = analysed(p);
    if (!m.atoms.length) return [];
    const f: Formula[] = [{ label: 'Molar mass', tex: `M = ${an.massTex} = ${an.mass.toFixed(2)}\\ \\text{g mol}^{-1}` }];
    if (an.dou !== null) {
      const c = an.counts;
      const x = (c.F ?? 0) + (c.Cl ?? 0) + (c.Br ?? 0) + (c.I ?? 0);
      f.push({
        label: 'Degree of unsaturation (rings + π bonds)',
        tex: `\\frac{2C + 2 + N - H - X}{2} = \\frac{2(${c.C}) + 2 + ${(c.N ?? 0) + (c.P ?? 0)} - ${c.H ?? 0} - ${x}}{2} = ${fmt(an.dou)}`,
      });
    }
    return f;
  },
};
