/**
 * Logic gates: switches, gates and lamps wired up as real circuits, from a single gate to a
 * 4-bit counter. Tap a switch to flip it; in the single-gate setup, tap the gate to change it.
 * Clocked circuits tick while playing, or tap the clock by hand.
 *
 * The switch positions and the circuit's memory (every gate and flip-flop output) are settings,
 * so a latch remembers its state when the board is saved. Feedback is settled by updating the
 * gates in turn until nothing changes; flip-flops change only on a rising clock edge, and an
 * edge they cause downstream (a ripple counter) is followed through.
 */

import { BH, bool, num, str, text } from './kit.ts';
import type { Formula, Look, Readout, SimDef, SimGrab, SimParams, SimState } from './kit.ts';

export type GateType = 'AND' | 'OR' | 'NOT' | 'NAND' | 'NOR' | 'XOR' | 'XNOR' | 'BUF';
export const GATES: GateType[] = ['AND', 'OR', 'NOT', 'NAND', 'NOR', 'XOR', 'XNOR', 'BUF'];

export function evalGate(t: GateType, ins: boolean[]): boolean {
  const a = ins[0] ?? false;
  const b = ins[1] ?? false;
  switch (t) {
    case 'AND': return a && b;
    case 'OR': return a || b;
    case 'NOT': return !a;
    case 'BUF': return a;
    case 'NAND': return !(a && b);
    case 'NOR': return !(a || b);
    case 'XOR': return a !== b;
    case 'XNOR': return a === b;
  }
}

const INVERTING = new Set<GateType>(['NOT', 'NAND', 'NOR', 'XNOR']);
const ONE_INPUT = new Set<GateType>(['NOT', 'BUF']);

// --- circuits ----------------------------------------------------------------------------------

export interface LNode {
  id: string;
  kind: 'in' | 'clk' | 'gate' | 'ff' | 'out';
  /** Gate type, or the flip-flop type: D (Q takes D on the edge) or T (Q toggles; T is held at 1). */
  type?: GateType | 'D' | 'T';
  /** Signal names feeding it: a node id, or id~ for a flip-flop's Q̄. Flip-flops: [D, CLK] or [CLK]. */
  ins?: string[];
  x: number;
  y: number;
  label: string;
}

export interface Circuit {
  name: string;
  nodes: LNode[];
  /** Combinational: show the full truth table. */
  table: boolean;
}

const I = (id: string, x: number, y: number, label = id): LNode => ({ id, kind: 'in', x, y, label });
const CLK = (x: number, y: number): LNode => ({ id: 'CLK', kind: 'clk', x, y, label: 'CLK' });
const G = (id: string, type: GateType, ins: string[], x: number, y: number): LNode => ({ id, kind: 'gate', type, ins, x, y, label: type });
const F = (id: string, type: 'D' | 'T', ins: string[], x: number, y: number): LNode => ({ id, kind: 'ff', type, ins, x, y, label: `${type} flip-flop` });
const O = (id: string, ref: string, x: number, y: number, label = id): LNode => ({ id, kind: 'out', ins: [ref], x, y, label });

export const CIRCUITS = ['gate', 'half', 'full', 'mux', 'sr', 'dff', 'counter'] as const;
export type CircuitName = (typeof CIRCUITS)[number];

export function build(name: string, gate: GateType = 'AND'): Circuit {
  switch (name) {
    case 'half':
      return {
        name, table: true, nodes: [
          I('A', 60, 120), I('B', 60, 240),
          G('X', 'XOR', ['A', 'B'], 220, 130), G('C', 'AND', ['A', 'B'], 220, 250),
          O('S', 'X', 330, 130, 'Sum'), O('Co', 'C', 330, 250, 'Carry'),
        ],
      };
    case 'full':
      return {
        name, table: true, nodes: [
          I('A', 50, 90), I('B', 50, 150), I('Ci', 50, 300, 'Cin'),
          G('X1', 'XOR', ['A', 'B'], 140, 110), G('A1', 'AND', ['A', 'B'], 140, 210),
          G('X2', 'XOR', ['X1', 'Ci'], 260, 140), G('A2', 'AND', ['X1', 'Ci'], 230, 280),
          G('O', 'OR', ['A1', 'A2'], 300, 240),
          O('S', 'X2', 345, 140, 'Sum'), O('Co', 'O', 360, 240, 'Cout'),
        ],
      };
    case 'mux':
      return {
        name, table: true, nodes: [
          I('D0', 60, 110, 'D₀'), I('D1', 60, 200, 'D₁'), I('S', 60, 300),
          G('N', 'NOT', ['S'], 140, 340),
          G('A0', 'AND', ['D0', 'N'], 220, 120), G('A1', 'AND', ['D1', 'S'], 220, 210),
          G('O', 'OR', ['A0', 'A1'], 290, 165),
          O('Y', 'O', 345, 165),
        ],
      };
    case 'sr':
      return {
        name, table: false, nodes: [
          I('R', 60, 128), I('S', 60, 252),
          G('N1', 'NOR', ['R', 'N2'], 220, 140), G('N2', 'NOR', ['N1', 'S'], 220, 240),
          O('Q', 'N1', 345, 140), O('Qn', 'N2', 345, 240, 'Q̄'),
        ],
      };
    case 'dff':
      return {
        name, table: false, nodes: [
          I('D', 60, 150), CLK(60, 250),
          F('F', 'D', ['D', 'CLK'], 220, 200),
          O('Q', 'F', 345, 140), O('Qn', 'F~', 345, 260, 'Q̄'),
        ],
      };
    case 'counter':
      return {
        name, table: false, nodes: [
          CLK(50, 250),
          F('F0', 'T', ['CLK'], 140, 250), F('F1', 'T', ['F0~'], 240, 250),
          F('F2', 'T', ['F1~'], 340, 250), F('F3', 'T', ['F2~'], 440, 250),
          O('Q0', 'F0', 202, 150, 'Q₀'), O('Q1', 'F1', 302, 150, 'Q₁'),
          O('Q2', 'F2', 402, 150, 'Q₂'), O('Q3', 'F3', 502, 150, 'Q₃'),
        ],
      };
    default: {
      const one = ONE_INPUT.has(gate);
      return {
        name: 'gate', table: true, nodes: one
          ? [I('A', 60, 190), G('G', gate, ['A'], 220, 190), O('Y', 'G', 330, 190)]
          : [I('A', 60, 140), I('B', 60, 240), G('G', gate, ['A', 'B'], 220, 190), O('Y', 'G', 330, 190)],
      };
    }
  }
}

const circuitMemo = new Map<string, Circuit>();
function circuitOf(p: SimParams): Circuit {
  const key = `${str(p, 'circuit', 'gate')}|${str(p, 'gate', 'AND')}`;
  let c = circuitMemo.get(key);
  if (!c) {
    const g = str(p, 'gate', 'AND');
    c = build(str(p, 'circuit', 'gate'), (GATES as string[]).includes(g) ? (g as GateType) : 'AND');
    circuitMemo.set(key, c);
  }
  return c;
}

export const inputsOf = (c: Circuit) => c.nodes.filter((n) => n.kind === 'in' || n.kind === 'clk');
export const memoryOf = (c: Circuit) => c.nodes.filter((n) => n.kind === 'gate' || n.kind === 'ff');
export const outputsOf = (c: Circuit) => c.nodes.filter((n) => n.kind === 'out');

// --- evaluation --------------------------------------------------------------------------------

export type Vals = Record<string, boolean>;
export const sig = (v: Vals, ref: string) => (ref.endsWith('~') ? !v[ref.slice(0, -1)] : !!v[ref]);

export const bits = (s: string, n: number): boolean[] => Array.from({ length: n }, (_, i) => s[i] === '1');
export const unbits = (b: boolean[]) => b.map((x) => (x ? '1' : '0')).join('');

export interface Settled {
  v: Vals;
  mem: boolean[];
  /** False if the gates never settled: the circuit oscillates. */
  stable: boolean;
}

/** Every signal, given the switches and the remembered outputs. Flip-flops hold their state. */
export function settle(c: Circuit, ins: boolean[], mem: boolean[]): Settled {
  const v: Vals = {};
  inputsOf(c).forEach((n, i) => (v[n.id] = ins[i] ?? false));
  const st = memoryOf(c);
  st.forEach((n, i) => (v[n.id] = mem[i] ?? false));
  let stable = false;
  for (let round = 0; round < 32 && !stable; round++) {
    stable = true;
    for (const n of st) {
      if (n.kind !== 'gate') continue;
      const out = evalGate(n.type as GateType, (n.ins ?? []).map((r) => sig(v, r)));
      if (out !== v[n.id]) {
        v[n.id] = out;
        stable = false;
      }
    }
  }
  for (const n of outputsOf(c)) v[n.id] = sig(v, n.ins![0]);
  return { v, mem: st.map((n) => v[n.id]), stable };
}

/**
 * The circuit after the switches change from `before` to `after`. A flip-flop whose clock goes
 * from 0 to 1 takes D (or toggles) using the values from just before the edge; its own change can
 * clock the next one, which is followed for up to 16 stages.
 */
export function apply(c: Circuit, before: boolean[], after: boolean[], mem: boolean[]): Settled {
  let prev = settle(c, before, mem);
  let now = settle(c, after, prev.mem);
  const st = memoryOf(c);
  for (let stage = 0; stage < 16; stage++) {
    const m = [...now.mem];
    let fired = false;
    st.forEach((n, i) => {
      if (n.kind !== 'ff') return;
      const clk = n.ins![n.type === 'D' ? 1 : 0];
      if (!sig(prev.v, clk) && sig(now.v, clk)) {
        m[i] = n.type === 'D' ? sig(prev.v, n.ins![0]) : !m[i];
        fired = true;
      }
    });
    if (!fired) break;
    prev = now;
    now = settle(c, after, m);
  }
  return now;
}

/** Every row of a combinational circuit's truth table, inputs counting up in binary. */
export function truthTable(c: Circuit): { ins: boolean[]; outs: boolean[] }[] {
  const ins = inputsOf(c);
  const outs = outputsOf(c);
  const rows: { ins: boolean[]; outs: boolean[] }[] = [];
  for (let k = 0; k < 1 << ins.length; k++) {
    const b = ins.map((_, i) => ((k >> (ins.length - 1 - i)) & 1) === 1);
    const r = settle(c, b, []);
    rows.push({ ins: b, outs: outs.map((o) => r.v[o.id]) });
  }
  return rows;
}

// --- the running state ---------------------------------------------------------------------------

interface LS extends SimState {
  /** Switch positions, one 0/1 per input. */
  in: string;
  /** Outputs of every gate and flip-flop. */
  mem: string;
}

function current(p: SimParams, s: LS) {
  const c = circuitOf(p);
  const ins = bits(s.in, inputsOf(c).length);
  return { c, ins, r: settle(c, ins, bits(s.mem, memoryOf(c).length)) };
}

// --- drawing ---------------------------------------------------------------------------------------

type Pt = [number, number];

function gateTip(t: GateType) {
  return t === 'AND' || t === 'NAND' || t === 'NOT' || t === 'BUF' ? 22 : 30;
}

function pinOut(n: LNode, ref: string): Pt {
  if (n.kind === 'in' || n.kind === 'clk') return [n.x + 20, n.y];
  if (n.kind === 'ff') return [n.x + 35, ref.endsWith('~') ? n.y + 20 : n.y - 20];
  const t = n.type as GateType;
  return [n.x + gateTip(t) + (INVERTING.has(t) ? 8 : 0), n.y];
}

function pinIn(n: LNode, k: number): Pt {
  if (n.kind === 'out') return [n.x - 13, n.y];
  if (n.kind === 'ff') return [n.x - 35, n.type === 'T' || k === 1 ? n.y + 20 : n.y - 20];
  if (ONE_INPUT.has(n.type as GateType)) return [n.x - 24, n.y];
  return [n.x - 28, n.y + (k ? 12 : -12)];
}

interface Wire { pts: Pt[]; on: boolean; joint: Pt | null }

/**
 * Wires as right-angled paths. Each signal gets its own vertical lane just right of its source,
 * so two signals never share a line; wires that run back to the left (feedback) go round.
 */
function wiresOf(c: Circuit, v: Vals): Wire[] {
  const byId = new Map(c.nodes.map((n) => [n.id, n]));
  const lanes = new Map<string, number>();
  const perColumn = new Map<number, number>();
  const uses = new Map<string, number>();
  for (const n of c.nodes) for (const r of n.ins ?? []) uses.set(r, (uses.get(r) ?? 0) + 1);
  const out: Wire[] = [];
  let back = 0;
  for (const n of c.nodes) {
    (n.ins ?? []).forEach((ref, k) => {
      const src = byId.get(ref.replace('~', ''));
      if (!src) return;
      const [x1, y1] = pinOut(src, ref);
      const [x2, y2] = pinIn(n, k);
      const on = sig(v, ref);
      const shared = (uses.get(ref) ?? 0) > 1;
      if (Math.abs(y1 - y2) < 0.5) {
        out.push({ pts: [[x1, y1], [x2, y2]], on, joint: null });
      } else if (x2 >= x1 + 6) {
        let lane = lanes.get(ref);
        if (lane === undefined) {
          const col = Math.round(x1);
          const i = perColumn.get(col) ?? 0;
          perColumn.set(col, i + 1);
          lane = x1 + 12 + 8 * i;
          lanes.set(ref, lane);
        }
        const mx = Math.min(lane, x2 - 6);
        out.push({ pts: [[x1, y1], [mx, y1], [mx, y2], [x2, y2]], on, joint: shared ? [mx, y1] : null });
      } else {
        const a = x1 + 14 + 8 * back;
        const b = x2 - 14 - 8 * back;
        const ym = (y1 + y2) / 2 + (back ? 12 : 0);
        back++;
        out.push({ pts: [[x1, y1], [a, y1], [a, ym], [b, ym], [b, y2], [x2, y2]], on, joint: shared ? [a, y1] : null });
      }
    });
  }
  return out;
}

function gateBody(ctx: CanvasRenderingContext2D, t: GateType, x: number, y: number) {
  ctx.beginPath();
  if (t === 'AND' || t === 'NAND') {
    ctx.moveTo(x - 28, y - 22);
    ctx.lineTo(x, y - 22);
    ctx.arc(x, y, 22, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(x - 28, y + 22);
    ctx.closePath();
  } else if (t === 'NOT' || t === 'BUF') {
    ctx.moveTo(x - 24, y - 20);
    ctx.lineTo(x + 22, y);
    ctx.lineTo(x - 24, y + 20);
    ctx.closePath();
  } else {
    ctx.moveTo(x - 28, y - 22);
    ctx.quadraticCurveTo(x + 6, y - 22, x + 30, y);
    ctx.quadraticCurveTo(x + 6, y + 22, x - 28, y + 22);
    ctx.quadraticCurveTo(x - 16, y, x - 28, y - 22);
    ctx.closePath();
  }
}

function drawGate(ctx: CanvasRenderingContext2D, n: LNode, on: boolean, look: Look, hot: boolean) {
  const t = n.type as GateType;
  const { x, y } = n;
  // Short leads from the pins to the curved back of OR-type gates.
  if (!ONE_INPUT.has(t) && t !== 'AND' && t !== 'NAND') {
    ctx.strokeStyle = look.ink;
    ctx.lineWidth = 2;
    for (const dy of [-12, 12]) {
      ctx.beginPath();
      ctx.moveTo(x - 28, y + dy);
      ctx.lineTo(x - 23.5, y + dy);
      ctx.stroke();
    }
  }
  gateBody(ctx, t, x, y);
  ctx.fillStyle = hot ? (look.dark ? '#2a3a52' : '#eaf2ff') : look.card;
  ctx.fill();
  ctx.strokeStyle = look.ink;
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  ctx.stroke();
  if (t === 'XOR' || t === 'XNOR') {
    ctx.beginPath();
    ctx.moveTo(x - 35, y - 22);
    ctx.quadraticCurveTo(x - 23, y, x - 35, y + 22);
    ctx.stroke();
  }
  if (INVERTING.has(t)) {
    ctx.beginPath();
    ctx.arc(x + gateTip(t) + 4, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = look.card;
    ctx.fill();
    ctx.stroke();
  }
  text(ctx, t, ONE_INPUT.has(t) ? x - 8 : x - 6, y, { size: 9.5, weight: 650, color: on ? look.green : look.muted, align: 'center' });
}

function drawFlipFlop(ctx: CanvasRenderingContext2D, n: LNode, q: boolean, look: Look) {
  const { x, y } = n;
  ctx.beginPath();
  ctx.roundRect(x - 35, y - 40, 70, 80, 6);
  ctx.fillStyle = look.card;
  ctx.fill();
  ctx.strokeStyle = look.ink;
  ctx.lineWidth = 2.2;
  ctx.stroke();
  // The clock input's triangle.
  ctx.beginPath();
  ctx.moveTo(x - 35, y + 13);
  ctx.lineTo(x - 26, y + 20);
  ctx.lineTo(x - 35, y + 27);
  ctx.stroke();
  const o = { size: 11, weight: 650, color: look.ink } as const;
  if (n.type === 'D') text(ctx, 'D', x - 29, y - 20, o);
  else text(ctx, 'T = 1', x - 29, y - 20, { ...o, size: 9.5, color: look.muted });
  text(ctx, 'Q', x + 29, y - 20, { ...o, align: 'right' });
  text(ctx, 'Q̄', x + 29, y + 20, { ...o, align: 'right' });
  text(ctx, q ? '1' : '0', x + 2, y, { size: 15, weight: 700, color: q ? look.green : look.faint, align: 'center' });
  text(ctx, `${n.type} flip-flop`, x, y + 52, { size: 9.5, color: look.muted, align: 'center' });
}

function drawSwitch(ctx: CanvasRenderingContext2D, n: LNode, on: boolean, look: Look) {
  const { x, y } = n;
  text(ctx, n.label, x - 24, y, { size: 13, weight: 700, color: look.ink, align: 'right' });
  if (n.kind === 'clk') {
    ctx.beginPath();
    ctx.roundRect(x - 18, y - 12, 36, 24, 6);
    ctx.fillStyle = on ? look.green : look.cardEdge;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(x - 12, y + 5);
    ctx.lineTo(x - 6, y + 5);
    ctx.lineTo(x - 6, y - 5);
    ctx.lineTo(x + 2, y - 5);
    ctx.lineTo(x + 2, y + 5);
    ctx.lineTo(x + 8, y + 5);
    ctx.lineTo(x + 8, y - 5);
    ctx.lineTo(x + 12, y - 5);
    ctx.strokeStyle = on ? '#ffffff' : look.ink;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.stroke();
    return;
  }
  ctx.beginPath();
  ctx.roundRect(x - 17, y - 11, 34, 22, 11);
  ctx.fillStyle = on ? look.green : look.cardEdge;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(on ? x + 6 : x - 6, y, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 3;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function drawLamp(ctx: CanvasRenderingContext2D, n: LNode, on: boolean, look: Look) {
  const { x, y } = n;
  if (on) {
    const g = ctx.createRadialGradient(x, y, 2, x, y, 26);
    g.addColorStop(0, 'rgba(255, 204, 0, 0.55)');
    g.addColorStop(1, 'rgba(255, 204, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, 26, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(x, y, 11, 0, Math.PI * 2);
  ctx.fillStyle = on ? '#ffcc00' : look.dark ? '#3a3a3c' : '#e5e5ea';
  ctx.fill();
  ctx.strokeStyle = on ? '#c79a00' : look.faint;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  text(ctx, n.label, x, y - 22, { size: 12, weight: 700, color: look.ink, align: 'center' });
  text(ctx, on ? '1' : '0', x, y + 23, { size: 11, weight: 650, color: on ? look.green : look.muted, align: 'center' });
}

function drawTable(ctx: CanvasRenderingContext2D, head: string[], rows: string[][], hi: number, nIn: number, look: Look) {
  const x0 = 396;
  const w = 154;
  const cw = w / head.length;
  const rh = Math.min(22, (BH - 60) / (rows.length + 1));
  const y0 = BH / 2 - (rh * (rows.length + 1)) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x0 - 6, y0 - 6, w + 12, rh * (rows.length + 1) + 12, 10);
  ctx.fillStyle = look.dark ? '#2c2c2e' : '#f6f6f8';
  ctx.fill();
  head.forEach((h, j) => text(ctx, h, x0 + cw * (j + 0.5), y0 + rh / 2, { size: 11, weight: 700, color: j < nIn ? look.muted : look.ink, align: 'center' }));
  ctx.strokeStyle = look.cardEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y0 + rh);
  ctx.lineTo(x0 + w, y0 + rh);
  ctx.moveTo(x0 + cw * nIn, y0 + 2);
  ctx.lineTo(x0 + cw * nIn, y0 + rh * (rows.length + 1) - 2);
  ctx.stroke();
  rows.forEach((r, i) => {
    const y = y0 + rh * (i + 1);
    if (i === hi) {
      ctx.fillStyle = look.dark ? 'rgba(10,132,255,0.28)' : 'rgba(0,122,255,0.14)';
      ctx.beginPath();
      ctx.roundRect(x0 - 2, y + 1, w + 4, rh - 2, 5);
      ctx.fill();
    }
    r.forEach((cell, j) => text(ctx, cell, x0 + cw * (j + 0.5), y + rh / 2, {
      size: 11.5, weight: i === hi ? 700 : 500, color: cell === '1' && j >= nIn ? look.green : look.ink, align: 'center',
    }));
  });
  ctx.restore();
}

function draw(ctx: CanvasRenderingContext2D, p: SimParams, s: LS, look: Look) {
  const { c, ins, r } = current(p, s);
  const low = look.dark ? '#5a5a5e' : '#c7c7cc';
  for (const w of wiresOf(c, r.v)) {
    ctx.beginPath();
    ctx.moveTo(...w.pts[0]);
    for (const pt of w.pts.slice(1)) ctx.lineTo(...pt);
    ctx.strokeStyle = w.on ? look.green : low;
    ctx.lineWidth = w.on ? 2.8 : 2.2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
    if (w.joint) {
      ctx.beginPath();
      ctx.arc(w.joint[0], w.joint[1], 3.4, 0, Math.PI * 2);
      ctx.fillStyle = w.on ? look.green : low;
      ctx.fill();
    }
  }
  const single = c.name === 'gate';
  for (const n of c.nodes) {
    if (n.kind === 'gate') drawGate(ctx, n, r.v[n.id], look, single);
    else if (n.kind === 'ff') drawFlipFlop(ctx, n, r.v[n.id], look);
    else if (n.kind === 'out') drawLamp(ctx, n, r.v[n.id], look);
    else drawSwitch(ctx, n, r.v[n.id], look);
  }
  if (!r.stable) text(ctx, 'Oscillating: the outputs never settle', 20, BH - 16, { size: 11.5, weight: 650, color: look.red });

  if (!bool(p, 'table')) return;
  const inNodes = inputsOf(c);
  if (c.table) {
    const rows = truthTable(c);
    const hi = ins.reduce((k, b) => k * 2 + (b ? 1 : 0), 0);
    drawTable(ctx, [...inNodes.map((n) => n.label), ...outputsOf(c).map((n) => n.label)],
      rows.map((row) => [...row.ins, ...row.outs].map((b) => (b ? '1' : '0'))), hi, inNodes.length, look);
  } else if (c.name === 'sr') {
    const S = r.v.S;
    const R = r.v.R;
    drawTable(ctx, ['S', 'R', 'Q'], [['0', '0', 'hold'], ['1', '0', '1'], ['0', '1', '0'], ['1', '1', '✕']], S ? (R ? 3 : 1) : R ? 2 : 0, 2, look);
  } else if (c.name === 'dff') {
    drawTable(ctx, ['CLK', 'D', 'Q'], [['↑', '0', '0'], ['↑', '1', '1'], ['0, 1, ↓', '×', 'hold']], r.v.D ? 1 : 0, 2, look);
  }
}

// --- operating it by hand ----------------------------------------------------------------------------

function grab(p: SimParams, s: LS, x: number, y: number): SimGrab | null {
  const { c, ins } = current(p, s);
  const nodes = inputsOf(c);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (Math.abs(x - n.x) > 24 || Math.abs(y - n.y) > 17) continue;
    const next = [...ins];
    next[i] = !next[i];
    const r = apply(c, ins, next, bits(s.mem, memoryOf(c).length));
    return { cursor: 'pointer', tap: { in: unbits(next), mem: unbits(r.mem) }, hint: n.kind === 'clk' ? 'Tap to pulse the clock' : `Flip ${n.label}` };
  }
  if (c.name === 'gate') {
    const g = c.nodes.find((n) => n.kind === 'gate')!;
    if (Math.abs(x - g.x) <= 36 && Math.abs(y - g.y) <= 26) {
      const t = g.type as GateType;
      return { cursor: 'pointer', tap: { gate: GATES[(GATES.indexOf(t) + 1) % GATES.length], mem: '' }, hint: 'Tap to change the gate' };
    }
  }
  return null;
}

// --- working ------------------------------------------------------------------------------------------

const EXPR: Record<GateType, string> = {
  AND: 'Y = A \\cdot B', OR: 'Y = A + B', NOT: 'Y = \\overline{A}', BUF: 'Y = A',
  NAND: 'Y = \\overline{A \\cdot B}', NOR: 'Y = \\overline{A + B}', XOR: 'Y = A \\oplus B', XNOR: 'Y = \\overline{A \\oplus B}',
};

const b01 = (b: boolean) => (b ? '1' : '0');

function readouts(p: SimParams, s: LS): Readout[] {
  const { c, r } = current(p, s);
  const v = r.v;
  const lamp = (label: string, on: boolean): Readout => ({ label, value: b01(on), color: on ? 'green' : undefined });
  const ins = inputsOf(c).map((n) => ({ label: n.label, value: b01(v[n.id]) }));
  switch (c.name) {
    case 'half':
      return [...ins, lamp('Sum', v.S), lamp('Carry', v.Co), { label: 'A + B', value: String(+v.A + +v.B) }];
    case 'full':
      return [...ins, lamp('Sum', v.S), lamp('Cout', v.Co), { label: 'A + B + Cin', value: `${+v.A + +v.B + +v.Ci} = ${b01(v.Co)}${b01(v.S)}₂` }];
    case 'mux':
      return [...ins, lamp('Y', v.Y), { label: 'Selected', value: v.S ? 'D₁' : 'D₀' }];
    case 'sr': {
      const state = v.S && v.R ? 'Not allowed' : v.S ? 'Set' : v.R ? 'Reset' : 'Hold';
      return [...ins, lamp('Q', v.Q), lamp('Q̄', v.Qn), { label: 'State', value: state, color: v.S && v.R ? 'red' : undefined }];
    }
    case 'dff':
      return [...ins, lamp('Q', v.Q), lamp('Q̄', v.Qn)];
    case 'counter': {
      const q = [v.Q3, v.Q2, v.Q1, v.Q0];
      return [ins[0], { label: 'Q₃Q₂Q₁Q₀', value: q.map(b01).join('') }, { label: 'Count', value: String(q.reduce((k, b) => k * 2 + +b, 0)) }];
    }
    default:
      return [...ins, lamp('Y', v.Y), { label: 'Gate', value: str(p, 'gate', 'AND') }];
  }
}

function formulas(p: SimParams): Formula[] {
  switch (str(p, 'circuit', 'gate')) {
    case 'half':
      return [{ label: 'Sum', tex: 'S = A \\oplus B' }, { label: 'Carry', tex: 'C = A \\cdot B' }];
    case 'full':
      return [
        { label: 'Sum', tex: 'S = A \\oplus B \\oplus C_{in}' },
        { label: 'Carry out', tex: 'C_{out} = A B + C_{in}(A \\oplus B)' },
      ];
    case 'mux':
      return [{ label: 'Output', tex: 'Y = \\overline{S}\\,D_0 + S\\,D_1' }];
    case 'sr':
      return [
        { label: 'Each NOR gate', tex: 'Q = \\overline{R + \\overline{Q}}, \\quad \\overline{Q} = \\overline{S + Q}' },
        { label: 'Next state', tex: 'Q_{next} = S + \\overline{R}\\,Q \\quad (S R = 0)' },
      ];
    case 'dff':
      return [{ label: 'On each rising clock edge', tex: 'Q_{next} = D' }];
    case 'counter':
      return [
        { label: 'Value', tex: 'N = 8Q_3 + 4Q_2 + 2Q_1 + Q_0 \\pmod{16}' },
        { label: 'Each stage toggles when the one before falls', tex: 'f_{Q_n} = \\frac{f_{CLK}}{2^{n+1}}' },
      ];
    default: {
      const g = str(p, 'gate', 'AND') as GateType;
      return [{ label: `${g} gate`, tex: EXPR[g] ?? EXPR.AND }];
    }
  }
}

const LABELS: Record<CircuitName, string> = {
  gate: 'Single gate', half: 'Half adder', full: 'Full adder', mux: '2-to-1 multiplexer',
  sr: 'SR latch (NOR)', dff: 'D flip-flop', counter: '4-bit counter',
};

const clocked = (p: SimParams) => ['dff', 'counter'].includes(str(p, 'circuit'));

export const logicSim: SimDef<LS> = {
  label: 'Logic gates',
  subject: 'Computer',
  keywords: 'logic gate and or not nand nor xor xnor boolean truth table half adder full adder multiplexer latch flip-flop counter binary digital electronics',
  blurb: 'Gates, adders, latches and a counter you can switch by hand',
  display: ['table', 'hz'],
  // Only the clocked circuits change with time; the rest change when a switch is tapped.
  still: (p) => !clocked(p),
  defaults: { circuit: 'gate', gate: 'AND', in: '', mem: '', table: true, hz: 1 },
  resetParams: { in: '', mem: '' },
  controls: [
    { key: 'circuit', label: 'Circuit', type: 'choice', options: CIRCUITS.map((c) => ({ value: c, label: LABELS[c] })) },
    { key: 'gate', label: 'Gate', type: 'choice', options: GATES.map((g) => ({ value: g, label: g })), show: (p) => str(p, 'circuit', 'gate') === 'gate' },
    { key: 'hz', label: 'Clock', type: 'range', min: 0.25, max: 4, step: 0.25, unit: 'Hz', show: clocked },
    { key: 'table', label: 'Truth table', type: 'toggle', show: (p) => str(p, 'circuit') !== 'counter' },
  ],
  presets: CIRCUITS.map((c) => ({ label: LABELS[c], params: { circuit: c, in: '', mem: '' } })),
  title: (p) => {
    const c = str(p, 'circuit', 'gate') as CircuitName;
    return c === 'gate' ? `${str(p, 'gate', 'AND')} gate` : LABELS[c] ?? 'Logic gates';
  },
  init: (p) => {
    const c = circuitOf(p);
    const ins = bits(str(p, 'in'), inputsOf(c).length);
    const r = settle(c, ins, bits(str(p, 'mem'), memoryOf(c).length));
    return { t: 0, done: false, in: unbits(ins), mem: unbits(r.mem) };
  },
  step: (p, s, dt) => {
    s.t += dt;
    const c = circuitOf(p);
    const nodes = inputsOf(c);
    const k = nodes.findIndex((n) => n.kind === 'clk');
    if (k < 0) return;
    const high = Math.floor(s.t * num(p, 'hz', 1) * 2) % 2 === 1;
    const ins = bits(s.in, nodes.length);
    if (ins[k] === high) return;
    const next = [...ins];
    next[k] = high;
    s.mem = unbits(apply(c, ins, next, bits(s.mem, memoryOf(c).length)).mem);
    s.in = unbits(next);
  },
  commit: (p, s) => (s.in === str(p, 'in') && s.mem === str(p, 'mem') ? null : { in: s.in, mem: s.mem }),
  draw,
  grab,
  readouts,
  formulas,
};
