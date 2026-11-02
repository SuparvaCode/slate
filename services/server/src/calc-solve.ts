/**
 * solve: one equation in one unknown (real roots as a set, every root as a list), or a system
 * (a list of solution dicts). nerdamer's roots are each substituted back before they are used, so
 * a numeric scan point or a wrong root is never reported as a solution.
 */
import type { MathNode } from 'mathjs';
import { CalcError, argsOf, bin, call, fnName, freeSymbols, fromNerd, hasNode, kind, nameOf, parseUser, valueOf, type Ctx } from './calc-ast.ts';
import { cas, pack, show, tidy, type Value } from './calc-cas.ts';
import { difference, equation, holds, realValue, splitTop, type Eq } from './calc-common.ts';
import { evalC } from './calc-num.ts';
import { sstr } from './calc-print.ts';

type Args = Record<string, unknown>;

const NO_CLOSED_FORM = "SymPy found no closed form; try op 'numeric' on a rearranged form.";
const TRIG = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc']);

/** Test values for the symbols other than the unknowns, so symbolic roots can be checked too. */
function params(nodes: MathNode[], unknowns: string[], ctx: Ctx): Record<string, number> {
  const out: Record<string, number> = {};
  const others = [...new Set(nodes.flatMap((n) => freeSymbols(n, ctx)))].filter((s) => !unknowns.includes(s));
  others.forEach((s, i) => (out[s] = 1.37 + 0.29 * i));
  return out;
}

function checks(eq: Eq, v: string, root: MathNode, base: Record<string, number>): boolean {
  try {
    const val = evalC(root, base);
    return holds(eq, { ...base, [v]: val }) === true;
  } catch {
    return false;
  }
}

/** log(a^b) = b*log(a), log(a*b) = log(a) + log(b): turns exponential equations polynomial. */
function logOf(n: MathNode): MathNode {
  if (kind(n) === 'OperatorNode') {
    const [a, b] = argsOf(n);
    if (fnName(n) === 'pow') return bin('*', b, logOf(a));
    if (fnName(n) === 'multiply') return bin('+', logOf(a), logOf(b));
    if (fnName(n) === 'divide') return bin('-', logOf(a), logOf(b));
  }
  return call('log', [n]);
}

const isFloat = (n: MathNode): boolean => {
  let f = false;
  n.traverse((x) => {
    if (kind(x) === 'ConstantNode' && !Number.isInteger(valueOf(x))) f = true;
  });
  return f;
};

function roots(eq: Eq, v: string, ctx: Ctx): MathNode[] {
  const base = params([eq.lhs, ...(eq.rhs ? [eq.rhs] : [])], [v], ctx);
  const attempt = (f: MathNode): MathNode[] => {
    let texts: string[] = [];
    try {
      texts = cas.solve(f, v);
    } catch {
      return [];
    }
    const out: MathNode[] = [];
    for (const t of texts) {
      let r: MathNode;
      try {
        r = fromNerd(t);
      } catch {
        continue;
      }
      if (freeSymbols(r, ctx).includes(v)) continue;
      if (checks(eq, v, r, base) && !out.some((o) => sstr(o, ctx) === sstr(r, ctx))) out.push(r);
    }
    return out;
  };
  let found = attempt(difference(eq));
  const exponential = hasNode(difference(eq), (n) => kind(n) === 'OperatorNode' && fnName(n) === 'pow' && freeSymbols(argsOf(n)[1], ctx).includes(v));
  if (exponential && eq.rhs && (!found.length || found.every(isFloat))) {
    const viaLog = attempt(bin('-', logOf(eq.lhs), logOf(eq.rhs)));
    if (viaLog.length && !viaLog.every(isFloat)) found = viaLog;
  }
  return found.map((r) => {
    try {
      const t = tidy(cas.eval(r), ctx);
      return checks(eq, v, t, base) ? t : r;
    } catch {
      return r;
    }
  });
}

function isReal(r: MathNode, ctx: Ctx): boolean {
  if (freeSymbols(r, ctx).length) return true; // symbolic in a parameter: kept, as SymPy's set would be
  return realValue(r, ctx) !== null;
}

function order(items: MathNode[], ctx: Ctx): MathNode[] {
  const key = (r: MathNode) => {
    try {
      const c = evalC(r, {});
      return [c.re, c.im];
    } catch {
      return [Infinity, 0];
    }
  };
  if (items.some((r) => freeSymbols(r, ctx).length)) return [...items].sort((a, b) => sstr(a, ctx).localeCompare(sstr(b, ctx)));
  return [...items].sort((a, b) => {
    const [ar, ai] = key(a);
    const [br, bi] = key(b);
    return ar - br || ai - bi;
  });
}

function single(eq: Eq, v: string, ctx: Ctx): Record<string, unknown> {
  const every = order(roots(eq, v, ctx), ctx);
  const periodic = hasNode(difference(eq), (n) => kind(n) === 'FunctionNode' && TRIG.has(fnName(n)) && freeSymbols(n, ctx).includes(v));
  if (!every.length) {
    // A polynomial with no roots has the empty set; anything else may just be beyond the CAS.
    const poly = !hasNode(difference(eq), (n) => kind(n) === 'FunctionNode');
    if (!poly || periodic) throw new CalcError(NO_CLOSED_FORM);
  }
  // nerdamer lists only some roots of a periodic equation (pi/6 for sin(x) = 1/2, not 5*pi/6), and
  // an incomplete list would make a correct answer look wrong. Report it as unsupported instead.
  if (periodic) throw new CalcError(NO_CLOSED_FORM);
  const real = every.filter((r) => isReal(r, ctx));
  const list: Value = { t: 'list', items: every };
  const shown = show(list, ctx);
  const extra: Record<string, unknown> = { all_solutions: shown.result.slice(0, 1500), all_latex: shown.latex.slice(0, 1500) };
  if (every.some(isFloat)) extra.note = 'No closed form; the roots are numeric.';
  return pack(real.length ? { t: 'set', items: real } : { t: 'empty' }, ctx, extra);
}

function system(eqs: Eq[], unknowns: string[], ctx: Ctx): Record<string, unknown> {
  const fs = eqs.map(difference);
  const rows = cas.solveSystem(fs, unknowns);
  const base = params(fs, unknowns, ctx);
  const good: [string, MathNode][][] = [];
  for (const row of rows) {
    const parsed: [string, MathNode][] = [];
    for (const [k, t] of row) {
      const n = fromNerd(t);
      if (kind(n) === 'SymbolNode' && nameOf(n) === k) continue; // a free unknown: SymPy leaves it out
      parsed.push([k, n]);
    }
    // Check: give the free unknowns test values, then every equation must hold.
    const free = unknowns.filter((u) => !parsed.some(([k]) => k === u));
    const values: Record<string, number> = { ...base };
    free.forEach((u, i) => (values[u] = 0.61 + 0.17 * i));
    let ok = true;
    try {
      for (const [k, n] of parsed) values[k] = evalC(n, values).re;
      ok = eqs.every((e) => holds(e, values) === true);
    } catch {
      ok = false;
    }
    if (!ok) throw new CalcError(NO_CLOSED_FORM);
    parsed.sort(([a], [b]) => (ctx.toUser.get(a) ?? a).localeCompare(ctx.toUser.get(b) ?? b));
    good.push(parsed);
  }
  return pack({ t: 'dicts', rows: good }, ctx);
}

export function solveOp(text: string, args: Args, ctx: Ctx): Record<string, unknown> {
  const eqs = splitTop(text).map((p) => equation(p, ctx));
  const names = splitTop(String(args.var ?? ''));
  const unknowns = names.length
    ? names.map((n) => nameOf(parseUser(n, ctx)))
    : [...new Set(eqs.flatMap((e) => freeSymbols(difference(e), ctx)))].sort((a, b) => (ctx.toUser.get(a) ?? a).localeCompare(ctx.toUser.get(b) ?? b));
  if (!unknowns.length) throw new CalcError('Nothing to solve for: the equation has no variable.');
  if (eqs.length === 1 && unknowns.length === 1) return single(eqs[0], unknowns[0], ctx);
  return system(eqs, unknowns, ctx);
}
