/**
 * Checks the logic simulator: every gate's truth table, the adders and multiplexer, the SR latch,
 * the D flip-flop and the ripple counter.
 * Run: node tests/logic.test.ts   (from apps/web)
 */

import { GATES, apply, bits, build, evalGate, inputsOf, memoryOf, settle, truthTable } from '../src/sim/logic.ts';
import type { Circuit } from '../src/sim/logic.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `-> ${detail}`);
}
const eq = (name: string, got: unknown, want: unknown) => check(name, got === want, `got ${String(got)}, want ${String(want)}`);
const col = (rows: { outs: boolean[] }[], k = 0) => rows.map((r) => (r.outs[k] ? '1' : '0')).join('');

// --- gates: outputs for inputs 00, 01, 10, 11 (or 0, 1) ------------------------------------------
const WANT: Record<string, string> = { AND: '0001', OR: '0111', NAND: '1110', NOR: '1000', XOR: '0110', XNOR: '1001', NOT: '10', BUF: '01' };
for (const g of GATES) eq(`${g} truth table`, col(truthTable(build('gate', g))), WANT[g]);
eq('evalGate NAND(1,1)', evalGate('NAND', [true, true]), false);

// --- adders and multiplexer --------------------------------------------------------------------
const half = truthTable(build('half'));
eq('half adder sum', col(half, 0), '0110');
eq('half adder carry', col(half, 1), '0001');
const full = truthTable(build('full'));
let adds = true;
for (const r of full) {
  const n = r.ins.filter(Boolean).length;
  if (+r.outs[0] !== n % 2 || +r.outs[1] !== (n >= 2 ? 1 : 0)) adds = false;
}
check('full adder adds A + B + Cin for all 8 rows', adds);
// Inputs D0, D1, S: Y is D0 when S = 0, D1 when S = 1.
const mux = truthTable(build('mux'));
check('multiplexer picks D0 or D1', mux.every((r) => r.outs[0] === (r.ins[2] ? r.ins[1] : r.ins[0])));

// --- sequential ----------------------------------------------------------------------------------
/** Steps a circuit through a list of switch settings, returning the outputs after each. */
function run(c: Circuit, steps: string[], out: string[]) {
  let ins = bits('', inputsOf(c).length);
  let mem = settle(c, ins, []).mem;
  const seen: string[] = [];
  for (const st of steps) {
    const next = bits(st, ins.length);
    const r = apply(c, ins, next, mem);
    mem = r.mem;
    ins = next;
    seen.push(out.map((id) => (r.v[id] ? '1' : '0')).join(''));
  }
  return seen;
}
// SR latch, inputs R then S.
const sr = build('sr');
eq('SR: set, hold, reset, hold', run(sr, ['01', '00', '10', '00'], ['Q']).join(' '), '1 1 0 0');
eq('SR: Q̄ is the opposite of Q when not both set', run(sr, ['01', '00'], ['Q', 'Qn']).join(' '), '10 10');
eq('SR: settles', settle(sr, [false, false], [false, false]).stable, true);

// D flip-flop, inputs D then CLK: Q only changes on a rising edge.
const dff = build('dff');
eq('D flip-flop', run(dff, ['10', '11', '01', '00', '01', '11', '10'], ['Q']).join(' '), '0 1 1 1 0 0 0');

// Ripple counter: counts clock rising edges, 0 to 15 and round again.
const ctr = build('counter');
const pulses: string[] = [];
for (let i = 0; i < 18; i++) pulses.push('1', '0');
const counts = run(ctr, pulses, ['Q3', 'Q2', 'Q1', 'Q0']).filter((_, i) => i % 2 === 0).map((b) => parseInt(b, 2));
eq('counter counts up on each rising edge', counts.join(','), '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,0,1,2');

// A NOT gate fed back into itself never settles.
const ring: Circuit = { name: 'ring', table: false, nodes: [{ id: 'N', kind: 'gate', type: 'NOT', ins: ['N'], x: 0, y: 0, label: 'NOT' }] };
eq('oscillator is detected', settle(ring, [], [false]).stable, false);
eq('memory has one slot per gate', memoryOf(build('full')).length, 5);

console.log(failures ? `\n${failures} failed` : '\nall passed');
if (failures) process.exit(1);
