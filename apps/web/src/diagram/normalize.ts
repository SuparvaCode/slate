/**
 * Turns untrusted JSON (from the AI, a saved board or the builder) into a valid Diagram.
 * Unknown fields are dropped, numbers are clamped to sensible ranges, and every problem that
 * could not be repaired silently is reported, so the AI can be asked to fix it.
 */

import { CIRCUIT_TYPES, PART_TYPES, TINTS, TWO_TERMINAL, emptyDiagram } from './types.ts';
import type { Diagram, DiagramKind, Dot, Fn, Mark, MarkType, Part, PartType, Ref, Tint, Wire, XY } from './types.ts';
import { tryCompile } from './expr.ts';

const KINDS: DiagramKind[] = ['mechanics', 'circuit', 'graph', 'geometry', 'chemistry', 'sketch'];
const MARKS: MarkType[] = ['label', 'arrow', 'dim', 'angle', 'right', 'ticks', 'force'];
const ELEMENTS = new Set(
  ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr Rb Sr Y Zr ' +
    'Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt ' +
    'Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am R X').split(' '),
);

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const n = (v: unknown, lo: number, hi: number, fallback?: number): number | undefined => {
  const x = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof x !== 'number' || !Number.isFinite(x)) return fallback;
  return Math.min(hi, Math.max(lo, x));
};
const s = (v: unknown, max = 80): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : typeof v === 'number' ? String(v) : undefined;
const b = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const xy = (v: unknown, lim = 200): XY | undefined => {
  if (!Array.isArray(v) || v.length < 2) return undefined;
  const x = n(v[0], -lim, lim);
  const y = n(v[1], -lim, lim);
  return x === undefined || y === undefined ? undefined : [x, y];
};
const ref = (v: unknown): Ref | undefined => xy(v) ?? s(v, 40);
const tint = (v: unknown): Tint | undefined => {
  const t = typeof v === 'string' ? v.toLowerCase() : '';
  if ((TINTS as readonly string[]).includes(t)) return t as Tint;
  return ({ black: 'ink', grey: 'gray', purple: 'violet' } as Record<string, Tint>)[t];
};

/** Drops undefined fields, so saved diagrams stay small. */
function clean<T extends object>(o: T): T {
  for (const k of Object.keys(o) as (keyof T)[]) if (o[k] === undefined) delete o[k];
  return o;
}

export interface Normalized {
  diagram: Diagram;
  issues: string[];
}

export function normalize(input: unknown): Normalized {
  const issues: string[] = [];
  const d = emptyDiagram();
  const raw: Raw = isObj(input) && isObj(input.diagram) ? input.diagram : isObj(input) ? input : {};
  if (!isObj(input)) issues.push('The diagram is not a JSON object.');

  d.title = s(raw.title, 80) ?? d.title;
  d.kind = KINDS.includes(raw.kind as DiagramKind) ? (raw.kind as DiagramKind) : 'sketch';
  const size = xy(raw.size, 60);
  d.size = size ? [Math.max(3, size[0]), Math.max(3, size[1])] : d.size;
  d.g = n(raw.g, 0.1, 50, 9.8)!;
  d.notes = s(raw.notes, 400) ?? '';
  if (isObj(raw.show)) d.show = { forces: b(raw.show.forces) ?? true, values: b(raw.show.values) ?? true, motion: b(raw.show.motion) ?? true };

  const ids = new Set<string>();
  /** Moves applied to repair the layout (a slope shrunk to fit), for the points that belonged to it. */
  const remaps: ((q: XY) => XY)[] = [];
  const rawParts = Array.isArray(raw.parts) ? raw.parts.slice(0, 120) : [];
  rawParts.forEach((rp, i) => {
    if (!isObj(rp)) return;
    const type = String(rp.type ?? '').toLowerCase() as PartType;
    if (!(PART_TYPES as readonly string[]).includes(type)) {
      issues.push(`Part ${i + 1} has unknown type "${String(rp.type)}".`);
      return;
    }
    let id = s(rp.id, 40)?.replace(/[^\w-]/g, '') || `${type}${i + 1}`;
    if (ids.has(id)) {
      issues.push(`Two parts share the id "${id}".`);
      id = `${id}_${i + 1}`;
    }
    ids.add(id);
    const p = part(type, id, rp, d, issues, remaps);
    if (p) d.parts.push(p);
  });

  // Pulleys and points placed against a slope that was shrunk move with it.
  const remap = (q: XY) => remaps.reduce((acc, f) => f(acc), q);
  for (const p of d.parts) {
    if (remaps.length && (p.type === 'pulley' || p.type === 'point' || p.type === 'anchor' || p.type === 'effort')) p.at = remap(p.at);
  }
  const remapRef = (r: Ref | undefined) => (Array.isArray(r) ? remap(r) : r);
  const byId = new Map(d.parts.map((p) => [p.id, p]));
  const known = (r: Ref | undefined, what: string) => {
    if (typeof r === 'string' && !byId.has(r)) {
      issues.push(`${what} refers to "${r}", which is not a part.`);
      return false;
    }
    return true;
  };

  // References between parts.
  for (const p of d.parts) {
    if (p.type === 'mass' && p.on && !byId.has(p.on)) {
      issues.push(`Mass "${p.id}" sits on "${p.on}", which is not a part.`);
      delete p.on;
    }
    if ((p.type === 'segment' || p.type === 'bond') && (!known(p.from, `"${p.id}"`) || !known(p.to, `"${p.id}"`))) {
      d.parts = d.parts.filter((q) => q !== p);
    }
    if (p.type === 'bond' && (typeof p.from !== 'string' || typeof p.to !== 'string')) {
      issues.push(`Bond "${p.id}" must join two atom ids.`);
    }
    if (p.points) p.points = p.points.filter((r) => known(r, `"${p.id}"`));
  }

  // Ropes: an end, the pulleys it passes round, an end.
  const rawRopes = Array.isArray(raw.ropes) ? raw.ropes.slice(0, 20) : [];
  rawRopes.forEach((rr, i) => {
    const pathRaw = isObj(rr) ? rr.path : rr;
    if (!Array.isArray(pathRaw)) return;
    const path = pathRaw.map((v) => s(v, 40)).filter((v): v is string => !!v);
    const missing = path.filter((id) => !byId.has(id));
    if (missing.length) {
      issues.push(`Rope ${i + 1} goes to ${missing.map((m) => `"${m}"`).join(', ')}, which ${missing.length > 1 ? 'are not parts' : 'is not a part'}.`);
      return;
    }
    if (path.length < 2) {
      issues.push(`Rope ${i + 1} needs at least two ends.`);
      return;
    }
    const inner = path.slice(1, -1).filter((id) => byId.get(id)!.type !== 'pulley');
    if (inner.length) {
      issues.push(`Rope ${i + 1} passes round ${inner.join(', ')}; only pulleys can be in the middle of a rope.`);
      return;
    }
    d.ropes.push(clean({ id: (isObj(rr) && s(rr.id, 40)) || `rope${i + 1}`, path, color: isObj(rr) ? tint(rr.color) : undefined }));
  });

  // Wires join terminals: part.a / part.b (battery.+ / battery.-), or a junction.
  const rawWires = Array.isArray(raw.wires) ? raw.wires.slice(0, 80) : [];
  rawWires.forEach((rw, i) => {
    const pair = Array.isArray(rw) ? rw : isObj(rw) ? [rw.from, rw.to] : [];
    const ends = pair.map((e) => terminal(s(e, 50), byId));
    if (ends.length !== 2 || ends.some((e) => !e)) {
      issues.push(`Wire ${i + 1} must join two terminals such as "R1.a" and "B1.+".`);
      return;
    }
    d.wires.push({ from: ends[0]!, to: ends[1]! } satisfies Wire);
  });

  const rawMarks = Array.isArray(raw.marks) ? raw.marks.slice(0, 60) : [];
  for (const rm of rawMarks) {
    if (!isObj(rm)) continue;
    const type = String(rm.type ?? '').toLowerCase() as MarkType;
    if (!MARKS.includes(type)) {
      issues.push(`Unknown marking "${String(rm.type)}".`);
      continue;
    }
    const m: Mark = clean({
      type, at: remapRef(ref(rm.at)), from: remapRef(ref(rm.from)), to: remapRef(ref(rm.to)), on: s(rm.on, 40), dir: n(rm.dir, -360, 360),
      text: s(rm.text, 40), n: n(rm.n, 1, 3), color: tint(rm.color),
    });
    if (![m.at, m.from, m.to].every((r) => r === undefined || known(r, `A ${type} marking`))) continue;
    if (m.on && !byId.has(m.on)) {
      issues.push(`A ${type} marking is on "${m.on}", which is not a part.`);
      continue;
    }
    if ((type === 'angle' || type === 'right') && (!m.at || !m.from || !m.to)) {
      issues.push(`An ${type} marking needs at (the vertex), from and to.`);
      continue;
    }
    if ((type === 'dim' || type === 'arrow') && (!m.from || !m.to)) {
      issues.push(`A ${type} marking needs from and to.`);
      continue;
    }
    if (type === 'label' && (!m.at || !m.text)) continue;
    if ((type === 'ticks' || type === 'force') && !m.on) continue;
    d.marks.push(m);
  }

  // Infer the kind when the model left it out, so the right solver runs.
  if (raw.kind === undefined) {
    if (d.ropes.length || d.parts.some((p) => p.type === 'pulley' || p.type === 'mass')) d.kind = 'mechanics';
    else if (d.parts.some((p) => (CIRCUIT_TYPES as readonly string[]).includes(p.type))) d.kind = 'circuit';
    else if (d.parts.some((p) => p.type === 'graph')) d.kind = 'graph';
    else if (d.parts.some((p) => p.type === 'atom')) d.kind = 'chemistry';
    else if (d.parts.some((p) => p.type === 'point' || p.type === 'segment' || p.type === 'polygon' || p.type === 'circle')) d.kind = 'geometry';
  }
  if (d.parts.length === 0) issues.push('The diagram has no parts.');
  return { diagram: d, issues };
}

/** "R1.a", "B1.+", "J1" -> the canonical terminal, or null. */
function terminal(v: string | undefined, byId: Map<string, Part>): string | null {
  if (!v) return null;
  const [id, end = ''] = v.split('.');
  const p = byId.get(id);
  if (!p) return null;
  if (p.type === 'junction') return id;
  if (!TWO_TERMINAL.has(p.type)) return null;
  const e = end.toLowerCase();
  if (p.type === 'battery') {
    if (e === '+' || e === 'p' || e === 'pos' || e === 'a') return `${id}.+`;
    if (e === '-' || e === 'n' || e === 'neg' || e === 'b') return `${id}.-`;
    return null;
  }
  if (e === 'a' || e === '1' || e === 'left' || e === 'top') return `${id}.a`;
  if (e === 'b' || e === '2' || e === 'right' || e === 'bottom') return `${id}.b`;
  return null;
}

function part(type: PartType, id: string, r: Raw, d: Diagram, issues: string[], remaps: ((q: XY) => XY)[]): Part | null {
  // A block resting on a table or slope is placed by that surface, so it needs no position of its own.
  const rests = type === 'mass' && !!s(r.on, 40);
  const lineLike = type === 'bond' || type === 'segment' || type === 'polygon' || type === 'path';
  const at = xy(r.at) ?? xy(r.pos) ?? (lineLike || rests ? [0, 0] : undefined);
  if (!at) {
    issues.push(`Part "${id}" has no position (at: [x, y]).`);
    return null;
  }
  const [W, H] = d.size;
  if (!rests && (at[0] < -0.5 || at[1] < -0.5 || at[0] > W + 0.5 || at[1] > H + 0.5)) {
    issues.push(`Part "${id}" at [${at.join(', ')}] is outside the ${W} x ${H} frame.`);
  }
  const p: Part = { id, type, at, color: tint(r.color), label: s(r.label, 30) };
  switch (type) {
    case 'ceiling':
    case 'floor':
      p.w = n(r.w, 0.5, 60, 4);
      break;
    case 'wall':
      p.h = n(r.h, 0.5, 60, 4);
      break;
    case 'anchor':
      break;
    case 'pulley':
      p.r = n(r.r, 0.2, 2, 0.5);
      p.fixed = b(r.fixed) ?? true;
      p.kg = n(r.kg, 0, 100);
      break;
    case 'mass':
      p.kg = n(r.kg, 0.01, 10000, 1);
      p.w = n(r.w, 0.3, 6);
      p.h = n(r.h, 0.3, 6);
      p.on = s(r.on, 40);
      p.along = n(r.along, 0, 1);
      break;
    case 'table':
      p.w = n(r.w, 1, 40, 6);
      p.h = n(r.h, 0.3, 20, 2);
      p.mu = n(r.mu, 0, 2, 0);
      if (at[0] + p.w! > W + 0.5 || at[1] + p.h! > H + 0.5) {
        issues.push(`Table "${id}" reaches past the ${W} x ${H} frame. Make it smaller or move it.`);
      }
      break;
    case 'incline': {
      p.w = n(r.w, 1, 40, 6);
      p.angle = n(r.angle, 5, 80, 30);
      p.mu = n(r.mu, 0, 2, 0);
      // The slope rises w tan(angle) from its corner; a steep one can leave the frame at the top.
      // It is shrunk to fit at the same angle, and the marks on its corners move with it.
      const tan = Math.tan((p.angle! * Math.PI) / 180);
      const w0 = p.w!;
      const fit = Math.min(W - at[0] - 0.3, (at[1] - 0.3) / tan);
      if (fit < w0 - 1e-6) {
        if (fit < 1) {
          issues.push(`Slope "${id}" at [${at.join(', ')}] has no room in the ${W} x ${H} frame. Move its corner down or left.`);
          break;
        }
        const k = fit / w0;
        const [ox, oy] = at;
        const near = (a: number, b2: number) => Math.abs(a - b2) < 0.35;
        remaps.push(([x, y]) => {
          // The right-hand side: its foot stays on the ground, anything above it goes to the new top.
          if (near(x, ox + w0)) return near(y, oy) ? [ox + fit, oy] : [ox + fit, oy - fit * tan];
          if (near(y, oy)) return [ox + (x - ox) * k, oy];
          return [ox + (x - ox) * k, oy + (y - oy) * k];
        });
        p.w = Math.round(fit * 100) / 100;
      }
      break;
    }
    case 'effort':
      p.N = n(r.N ?? r.force, 0, 1e6, 100);
      p.dir = n(r.dir, -360, 360, 90);
      break;
    case 'battery':
      p.V = n(r.V, 0, 1e5, 12);
      p.ohm = n(r.ohm, 0, 1e6, 0);
      p.rot = n(r.rot, 0, 270, 0);
      break;
    case 'resistor':
      p.ohm = n(r.ohm, 1e-3, 1e9, 10);
      p.rot = n(r.rot, 0, 270, 0);
      break;
    case 'bulb':
      p.ohm = n(r.ohm, 1e-3, 1e9, 10);
      p.rot = n(r.rot, 0, 270, 0);
      break;
    case 'switch':
      p.closed = b(r.closed) ?? true;
      p.rot = n(r.rot, 0, 270, 0);
      break;
    case 'capacitor':
      p.uF = n(r.uF, 1e-6, 1e9, 100);
      p.rot = n(r.rot, 0, 270, 0);
      break;
    case 'ammeter':
    case 'voltmeter':
      p.rot = n(r.rot, 0, 270, 0);
      break;
    case 'junction':
      break;
    case 'graph': {
      p.w = n(r.w, 2, 60, Math.max(2, W - at[0] - 0.5));
      p.h = n(r.h, 2, 60, Math.max(2, H - at[1] - 0.5));
      const xr = xy(r.xr, 1e6) ?? [-5, 5];
      const yr = xy(r.yr, 1e6) ?? [-5, 5];
      p.xr = xr[1] > xr[0] ? xr : [-5, 5];
      p.yr = yr[1] > yr[0] ? yr : [-5, 5];
      p.grid = b(r.grid) ?? true;
      const fns: Fn[] = [];
      for (const f of Array.isArray(r.fns) ? r.fns.slice(0, 6) : []) {
        const expr = isObj(f) ? s(f.expr, 120) : s(f, 120);
        if (!expr) continue;
        if (!tryCompile(expr)) {
          issues.push(`Graph "${id}" cannot plot "${expr}". Use x, + - * / ^, brackets and sin, cos, sqrt, ln...`);
          continue;
        }
        fns.push(clean({ expr, label: isObj(f) ? s(f.label, 30) : undefined }));
      }
      p.fns = fns;
      const dots: Dot[] = [];
      for (const dt of Array.isArray(r.dots) ? r.dots.slice(0, 20) : []) {
        const q = isObj(dt) ? xy([dt.x, dt.y], 1e6) : xy(dt, 1e6);
        if (q) dots.push(clean({ x: q[0], y: q[1], label: isObj(dt) ? s(dt.label, 30) : undefined }));
      }
      p.dots = dots;
      break;
    }
    case 'point':
      break;
    case 'segment':
      p.from = ref(r.from);
      p.to = ref(r.to);
      p.dash = b(r.dash);
      p.arrow = b(r.arrow);
      if (p.from === undefined || p.to === undefined) {
        issues.push(`Segment "${id}" needs from and to.`);
        return null;
      }
      break;
    case 'polygon':
    case 'path': {
      const pts = (Array.isArray(r.points) ? r.points.slice(0, 200) : []).map(ref).filter((q): q is Ref => q !== undefined);
      if (pts.length < 2) {
        issues.push(`${type === 'path' ? 'Path' : 'Polygon'} "${id}" needs at least two points.`);
        return null;
      }
      p.points = pts;
      p.fill = b(r.fill);
      p.dash = b(r.dash);
      if (type === 'path') {
        p.smooth = b(r.smooth);
        p.arrow = b(r.arrow);
        p.closed = b(r.closed);
      }
      break;
    }
    case 'circle':
      p.r = n(r.r, 0.05, 60, 1);
      p.fill = b(r.fill);
      p.dash = b(r.dash);
      break;
    case 'atom': {
      const el = s(r.el, 3) ?? 'C';
      const sym = el[0].toUpperCase() + el.slice(1).toLowerCase();
      if (!ELEMENTS.has(sym)) issues.push(`Atom "${id}" has unknown element "${el}".`);
      p.el = sym;
      p.charge = s(r.charge, 3);
      break;
    }
    case 'bond':
      p.from = s(r.from, 40);
      p.to = s(r.to, 40);
      p.order = n(r.order, 1, 3, 1);
      p.dash = b(r.dash);
      if (!p.from || !p.to) {
        issues.push(`Bond "${id}" needs from and to atom ids.`);
        return null;
      }
      break;
    case 'shape':
      p.shape = r.shape === 'ellipse' || r.shape === 'circle' ? 'ellipse' : 'rect';
      p.w = n(r.w, 0.1, 60, 2);
      p.h = n(r.h, 0.1, 60, 1);
      p.fill = b(r.fill);
      p.dash = b(r.dash);
      break;
    case 'text':
      p.text = s(r.text, 120) ?? s(r.label, 120);
      p.size = n(r.size, 0.2, 3, 0.45);
      delete p.label;
      if (!p.text) return null;
      break;
    case 'figure':
      p.kind = s(r.kind, 30);
      p.w = n(r.w, 0.3, 60, 3);
      p.h = n(r.h, 0.3, 60, 3);
      break;
  }
  return clean(p);
}
