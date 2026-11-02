/**
 * Circuit diagrams: where each terminal is, and a solver for any circuit.
 *
 * The solver uses modified nodal analysis: wires join terminals into nodes, resistors and bulbs
 * add conductance between nodes, and batteries, ammeters and closed switches add a branch whose
 * current is an unknown (an ammeter or closed switch is a 0 V source, so its current comes out
 * directly). Voltmeters, capacitors (in the steady state) and open switches carry no current.
 * A tiny leak to ground on every node keeps parts that are not connected from breaking it.
 */

import { solveLinear } from './mech.ts';
import { TWO_TERMINAL } from './types.ts';
import type { Diagram, Part, XY } from './types.ts';

const DEG = Math.PI / 180;
/** Half the length of a two-terminal part, in grid units. */
export const HALF = 0.9;

export function terminals(p: Part): { a: XY; b: XY } {
  const r = (p.rot ?? 0) * DEG;
  const dx = Math.cos(r) * HALF;
  const dy = Math.sin(r) * HALF;
  return { a: [p.at[0] - dx, p.at[1] - dy], b: [p.at[0] + dx, p.at[1] + dy] };
}

/** Grid position of "R1.a", "B1.+", "J1". */
export function terminalAt(d: Diagram, t: string): XY | null {
  const [id, end] = t.split('.');
  const p = d.parts.find((q) => q.id === id);
  if (!p) return null;
  if (p.type === 'junction') return p.at;
  const { a, b } = terminals(p);
  return end === 'a' || end === '+' ? a : b;
}

/** Terminal names of a part: battery + is its a end. */
export const endsOf = (p: Part): [string, string] =>
  p.type === 'battery' ? [`${p.id}.+`, `${p.id}.-`] : [`${p.id}.a`, `${p.id}.b`];

export interface PartReading {
  id: string;
  /** Current from the a (+) end to the b (−) end through the part, in amperes. */
  I: number;
  /** Voltage of a minus voltage of b. */
  V: number;
  P: number;
}

export interface CircuitResult {
  ok: boolean;
  error?: string;
  parts: Map<string, PartReading>;
  facts: string[];
}

const GMIN = 1e-9;

export function solveCircuit(d: Diagram): CircuitResult {
  const parts = d.parts.filter((p) => TWO_TERMINAL.has(p.type) || p.type === 'junction');
  // Union terminals joined by wires into nodes.
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x);
    const p = parent.get(x)!;
    if (p === x) return x;
    const r = find(p);
    parent.set(x, r);
    return r;
  };
  for (const p of parts) {
    if (p.type === 'junction') find(p.id);
    else endsOf(p).forEach(find);
  }
  for (const w of d.wires) parent.set(find(w.from), find(w.to));

  const roots = [...new Set([...parent.keys()].map(find))];
  const battery = parts.find((p) => p.type === 'battery');
  const ground = battery ? find(`${battery.id}.-`) : roots[0];
  const nodeIdx = new Map<string, number>();
  for (const r of roots) if (r !== ground) nodeIdx.set(r, nodeIdx.size);
  const idx = (t: string) => {
    const r = find(t);
    return r === ground ? -1 : nodeIdx.get(r)!;
  };

  const sources = parts.filter((p) => p.type === 'battery' || p.type === 'ammeter' || (p.type === 'switch' && p.closed !== false));
  const N = nodeIdx.size;
  const M = sources.length;
  const size = N + M;
  const A = Array.from({ length: size }, () => new Array(size).fill(0));
  const z = new Array(size).fill(0);
  for (let i = 0; i < N; i++) A[i][i] += GMIN;

  const stamp = (ia: number, ib: number, g: number) => {
    if (ia >= 0) A[ia][ia] += g;
    if (ib >= 0) A[ib][ib] += g;
    if (ia >= 0 && ib >= 0) {
      A[ia][ib] -= g;
      A[ib][ia] -= g;
    }
  };
  for (const p of parts) {
    if (p.type !== 'resistor' && p.type !== 'bulb') continue;
    const [ta, tb] = endsOf(p);
    stamp(idx(ta), idx(tb), 1 / Math.max(1e-6, p.ohm ?? 10));
  }
  sources.forEach((p, k) => {
    const [ta, tb] = endsOf(p);
    const ia = idx(ta);
    const ib = idx(tb);
    const row = N + k;
    // Branch current I flows out of the a (+) end into the circuit, and back in at b.
    // KCL "current leaving a node" sums to zero, so +I leaves at b's side and enters at a's.
    if (ia >= 0) {
      A[ia][row] -= 1;
      A[row][ia] += 1;
    }
    if (ib >= 0) {
      A[ib][row] += 1;
      A[row][ib] -= 1;
    }
    if (p.type === 'battery') {
      // V(+) − V(−) = emf − I r
      A[row][row] += p.ohm ?? 0;
      z[row] = p.V ?? 12;
    }
  });

  const parts_ = new Map<string, PartReading>();
  if (size === 0) return { ok: true, parts: parts_, facts: [] };
  const x = solveLinear(A, z);
  if (!x || x.some((v) => !Number.isFinite(v))) {
    return { ok: false, error: 'Short circuit: a battery is joined straight across itself with nothing to limit the current.', parts: parts_, facts: [] };
  }
  const volt = (t: string) => {
    const i = idx(t);
    return i < 0 ? 0 : x[i];
  };

  for (const p of parts) {
    if (p.type === 'junction') continue;
    const [ta, tb] = endsOf(p);
    const V = volt(ta) - volt(tb);
    let I = 0;
    const k = sources.indexOf(p);
    // A source's branch current flows out of its a end, so through it from b to a: report a→b.
    if (k >= 0) I = p.type === 'battery' ? x[N + k] : -x[N + k];
    else if (p.type === 'resistor' || p.type === 'bulb') I = V / Math.max(1e-6, p.ohm ?? 10);
    const clean = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v);
    parts_.set(p.id, { id: p.id, I: clean(I), V: clean(V), P: clean(Math.abs(V * I)) });
  }

  const facts: string[] = [];
  const name = (p: Part) => p.label || p.id;
  for (const p of parts) {
    const r = parts_.get(p.id);
    if (!r) continue;
    if (p.type === 'battery') facts.push(`${name(p)}: supplies ${fmt(Math.abs(r.I))} A at ${fmt(r.V)} V`);
    else if (p.type === 'ammeter') facts.push(`${name(p)} reads ${fmt(Math.abs(r.I))} A`);
    else if (p.type === 'voltmeter') facts.push(`${name(p)} reads ${fmt(Math.abs(r.V))} V`);
    else if (p.type === 'capacitor') facts.push(`${name(p)}: ${fmt(Math.abs(r.V))} V, Q = ${fmt(Math.abs(r.V) * (p.uF ?? 100))} μC`);
    else if (p.type === 'resistor' || p.type === 'bulb') facts.push(`${name(p)}: I = ${fmt(Math.abs(r.I))} A, V = ${fmt(Math.abs(r.V))} V, P = ${fmt(r.P)} W`);
  }
  if (battery && Math.abs(parts_.get(battery.id)!.I) > 1e3) {
    return { ok: false, error: 'Short circuit: the current is too large to be real. Add some resistance.', parts: parts_, facts };
  }
  return { ok: true, parts: parts_, facts };
}

export function fmt(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  const s = a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : a >= 0.01 ? v.toFixed(3) : v.toPrecision(2);
  if (s.includes('e')) return s;
  return (s.includes('.') ? s.replace(/\.?0+$/, '') : s).replace(/^-/, '−');
}
