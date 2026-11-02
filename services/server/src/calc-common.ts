/** Helpers shared by the calculator ops: splitting, equations, variables, substitution. */
import type { MathNode } from 'mathjs';
import { CalcError, argsOf, bin, fnName, freeSymbols, kind, nameOf, neg, num, parseUser, type Ctx } from './calc-ast.ts';
import { cas } from './calc-cas.ts';
import { absC, evalC, type C } from './calc-num.ts';
import { ratOf } from './calc-print.ts';

export const EQ = /(?<![<>=!])=(?!=)/;
export const hasEq = (text: string): boolean => EQ.test(text);

/** Splits on commas that are not inside brackets. */
export function splitTop(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

export interface Eq {
  lhs: MathNode;
  rhs: MathNode | null;
}

/** 'a = b' becomes {lhs: a, rhs: b}; a bare expression means 'expression = 0'. */
export function equation(text: string, ctx: Ctx): Eq {
  const sides = text.split(new RegExp(EQ.source, 'g'));
  if (sides.length === 1) return { lhs: parseUser(text, ctx), rhs: null };
  if (sides.length !== 2) throw new CalcError("An equation must have exactly one '='.");
  return { lhs: parseUser(sides[0], ctx), rhs: parseUser(sides[1], ctx) };
}

export const difference = (e: Eq): MathNode => (e.rhs ? bin('-', e.lhs, e.rhs) : e.lhs);

/** The variables to work in: those named in var, or the expression's only free symbol. */
export function variables(args: Record<string, unknown>, expr: MathNode, ctx: Ctx, required = true): string[] {
  const names = splitTop(String(args.var ?? ''));
  if (names.length) {
    return names.map((n) => {
      const t = parseUser(n, ctx);
      if (kind(t) !== 'SymbolNode' || !/^zq\d+z$/.test(nameOf(t))) throw new CalcError(`'${n}' is not a variable.`);
      return nameOf(t);
    });
  }
  const free = freeSymbols(expr, ctx);
  if (free.length === 1 || (free.length && !required)) return free.slice(0, 1);
  if (!free.length) {
    if (required) throw new CalcError('The expression has no variable to work with.');
    return [];
  }
  throw new CalcError(`Several variables (${free.map((s) => ctx.toUser.get(s)).join(', ')}): pass var.`);
}

export const isZero = (n: MathNode): boolean => {
  const r = ratOf(n);
  return !!r && r.n === 0;
};

export const isInfinity = (n: MathNode): boolean =>
  (kind(n) === 'SymbolNode' && nameOf(n) === 'Infinity') ||
  (kind(n) === 'OperatorNode' && fnName(n) === 'unaryMinus' && isInfinity(argsOf(n)[0]));

/** A real number for a tree with no symbols (+-Infinity included), or null. */
export function realValue(n: MathNode, ctx: Ctx): number | null {
  if (isInfinity(n)) return kind(n) === 'SymbolNode' ? Infinity : -Infinity;
  if (freeSymbols(n, ctx).length) return null;
  try {
    const c = evalC(n);
    return Math.abs(c.im) <= 1e-12 * (1 + Math.abs(c.re)) ? c.re : null;
  } catch {
    return null;
  }
}

/** F at a point: substitution, or the limit there when substitution fails or the point is infinite. */
export function valueAt(f: MathNode, v: string, point: MathNode): MathNode {
  let out: MathNode | null = null;
  if (!isInfinity(point)) {
    try {
      out = cas.sub(f, v, point);
    } catch {
      out = null;
    }
  }
  if (!out) {
    try {
      out = cas.limit(f, v, point, 'both');
    } catch (e) {
      if (!isInfinity(point)) throw e;
      // nerdamer takes limit(erf(x)) but not limit(c*erf(x)): erf(u) -> +-1 by the sign of u there.
      const far = kind(point) === 'SymbolNode' ? 1e6 : -1e6;
      const swapped = f.transform((n) => {
        if (kind(n) !== 'FunctionNode' || fnName(n) !== 'erf') return n;
        const u = evalC(argsOf(n)[0], { [v]: far });
        return u.re > 0 ? num(1) : neg(num(1));
      });
      // nerdamer's limit leaves an expression without the variable unevaluated.
      out = freeSymbols(swapped, { toInternal: new Map(), toUser: new Map() }).includes(v)
        ? cas.limit(swapped, v, point, 'both')
        : cas.eval(swapped);
    }
  }
  let infinite = false;
  out.traverse((n) => {
    if (kind(n) === 'SymbolNode' && nameOf(n) === 'Infinity') infinite = true;
  });
  if (infinite) throw new CalcError('The value is infinite there.');
  return out;
}

/** The top-level terms of a sum. */
export function terms(n: MathNode): MathNode[] {
  if (kind(n) === 'OperatorNode' && ['add', 'subtract'].includes(fnName(n))) return argsOf(n).flatMap(terms);
  if (kind(n) === 'OperatorNode' && fnName(n) === 'unaryMinus') return terms(argsOf(n)[0]);
  return [n];
}

/**
 * Does the equation hold at these values? Checked relative to the size of its terms, so points
 * where every term merely vanishes (2^x and 3^x as x -> -oo) do not count. null: not evaluable.
 */
export function holds(eq: Eq, values: Record<string, number | C>): boolean | null {
  const ts = [...terms(eq.lhs), ...(eq.rhs ? terms(eq.rhs) : [])];
  try {
    const f = evalC(difference(eq), values);
    let scale = 0;
    for (const t of ts) scale += absC(evalC(t, values));
    if (scale === 0) return true;
    return absC(f) <= 1e-9 * scale;
  } catch {
    return null;
  }
}
