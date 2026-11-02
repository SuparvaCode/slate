/** nerdamer behind a small interface, plus result values and their packing (SymPy shapes). */
import nerdamerLib from 'nerdamer';
import type { MathNode } from 'mathjs';
import { CalcError, freeSymbols, fromNerd, toNerd, type Ctx } from './calc-ast.ts';
import { nStr, numEq } from './calc-num.ts';
import { ratOf, sstr, tex } from './calc-print.ts';

// nerdamer's typings do not cover the 2.0 call shapes used here.
const N: any = nerdamerLib;

export const MAX_OUTPUT = 1500;

function run(fn: () => any): string {
  let out: any;
  try {
    out = fn();
  } catch (e) {
    throw new CalcError(String((e as Error)?.message ?? e).slice(0, 200));
  }
  return String(out?.toString?.() ?? out);
}

export const cas = {
  eval: (n: MathNode): MathNode => fromNerd(run(() => N(toNerd(n)))),
  simplify: (n: MathNode): MathNode => fromNerd(run(() => N.simplify(toNerd(n)))),
  expand: (n: MathNode): MathNode => fromNerd(run(() => N(toNerd(n)).expand())),
  factor: (n: MathNode): MathNode => fromNerd(run(() => N.factor(toNerd(n)))),
  diff: (n: MathNode, v: string, k = 1): MathNode => fromNerd(run(() => N.diff(toNerd(n), v, k))),
  integrate: (n: MathNode, v: string): MathNode => fromNerd(run(() => N.integrate(toNerd(n), v))),
  limit: (n: MathNode, v: string, point: MathNode, dir: 'both' | 'left' | 'right'): MathNode =>
    fromNerd(run(() => N.limit(toNerd(n), v, toNerd(point), dir))),
  sub: (n: MathNode, v: string, value: MathNode): MathNode => fromNerd(run(() => N(toNerd(n), { [v]: toNerd(value) }))),
  /** Roots as nerdamer text, exactly as it lists them. */
  solve: (f: MathNode, v: string): string[] => {
    let s: any;
    try {
      s = N.solve(toNerd(f), v);
    } catch (e) {
      throw new CalcError(String((e as Error)?.message ?? e).slice(0, 200));
    }
    return (s?.toArray?.() ?? []).map(String);
  },
  /** Solutions of a system as [name, value] rows (nerdamer text). */
  solveSystem: (fs: MathNode[], vs: string[]): [string, string][][] => {
    let s: any;
    try {
      s = N.solveSystem(fs.map((f) => `${toNerd(f)}=0`), vs);
    } catch (e) {
      throw new CalcError(String((e as Error)?.message ?? e).slice(0, 200));
    }
    const rows: [string, string][][] = [];
    for (const d of s?.elements ?? []) {
      const row: [string, string][] = [];
      for (const [k, v] of d.entries()) row.push([String(k), String(v)]);
      rows.push(row);
    }
    return rows;
  },
};

/** Node count, standing in for SymPy's count_ops when choosing the shorter form. */
export function size(n: MathNode): number {
  let k = 0;
  n.traverse(() => {
    k += 1;
  });
  return k;
}

/** The shortest equal form: nerdamer's simplify when it is shorter and checks out numerically. */
export function tidy(n: MathNode, ctx: Ctx): MathNode {
  let best = n;
  try {
    const c = cas.simplify(n);
    if (size(c) < size(best) && numEq(c, n, ctx) !== false) best = c;
  } catch {
    // keep the original form
  }
  return best;
}

export type Value =
  | { t: 'expr'; n: MathNode }
  | { t: 'set'; items: MathNode[] }
  | { t: 'empty' }
  | { t: 'list'; items: MathNode[] }
  | { t: 'dicts'; rows: [string, MathNode][][] };

export function show(v: Value, ctx: Ctx): { result: string; latex: string } {
  const s = (n: MathNode) => sstr(n, ctx);
  const l = (n: MathNode) => tex(n, ctx);
  switch (v.t) {
    case 'expr':
      return { result: s(v.n), latex: l(v.n) };
    case 'empty':
      return { result: 'EmptySet', latex: '\\emptyset' };
    case 'set':
      return { result: `{${v.items.map(s).join(', ')}}`, latex: `\\left\\{${v.items.map(l).join(', ')}\\right\\}` };
    case 'list':
      return { result: `[${v.items.map(s).join(', ')}]`, latex: `\\left[ ${v.items.map(l).join(', \\  ')}\\right]` };
    case 'dicts': {
      const name = (k: string) => ctx.toUser.get(k) ?? k;
      const rows = v.rows.map((r) => `{${r.map(([k, n]) => `${name(k)}: ${s(n)}`).join(', ')}}`);
      const texRows = v.rows.map((r) => `\\left\\{ ${r.map(([k, n]) => `${name(k)} : ${l(n)}`).join(', \\  ')}\\right\\}`);
      return { result: `[${rows.join(', ')}]`, latex: `\\left[ ${texRows.join(', \\  ')}\\right]` };
    }
  }
}

const isInteger = (n: MathNode): boolean => {
  const r = ratOf(n);
  return !!r && !r.float && r.d === 1;
};

/** str(N(value, 12)) for a number that is not an integer; null otherwise. Sets need every item. */
export function approx(v: Value, ctx: Ctx, digits = 12): string | null {
  const one = (n: MathNode): string | null => (freeSymbols(n, ctx).length || isInteger(n) ? null : nStr(n, digits));
  if (v.t === 'expr') return one(v.n);
  if (v.t === 'set' || v.t === 'list') {
    const vals = v.items.map(one);
    if (vals.some((x) => x === null)) return null;
    return v.t === 'set' ? `{${vals.join(', ')}}` : `[${vals.join(', ')}]`;
  }
  return null;
}

export function pack(v: Value, ctx: Ctx, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const { result, latex } = show(v, ctx);
  const out: Record<string, unknown> = { result: result.slice(0, MAX_OUTPUT), latex: latex.slice(0, MAX_OUTPUT) };
  const a = approx(v, ctx);
  if (a && a !== out.result) out.approx = a;
  return { ...out, ...extra };
}
