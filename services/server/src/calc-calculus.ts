/** integrate, limit and series. Every symbolic result is checked numerically before it is returned. */
import type { MathNode } from 'mathjs';
import { CalcError, argsOf, bin, call, fnName, freeSymbols, kind, nameOf, neg, num, parseUser, sym, type Ctx } from './calc-ast.ts';
import { MAX_OUTPUT, cas, pack, tidy } from './calc-cas.ts';
import { isInfinity, isZero, realValue, valueAt, variables } from './calc-common.ts';
import { numEq, quad } from './calc-num.ts';
import { ratOf, sstr, tex } from './calc-print.ts';

type Args = Record<string, unknown>;

const NO_CLOSED_FORM = 'SymPy found no closed form for this integral.';

/** e^(k*v^2) with k < 0 integrates to sqrt(pi)/(2*sqrt(-k)) * erf(sqrt(-k)*v); nerdamer has no rule for it. */
function gaussian(f: MathNode, v: string, ctx: Ctx): MathNode | null {
  if (kind(f) !== 'OperatorNode' || fnName(f) !== 'pow') return null;
  const [base, power] = argsOf(f);
  if (kind(base) !== 'SymbolNode' || nameOf(base) !== 'e') return null;
  let k: MathNode;
  try {
    k = cas.eval(bin('/', power, bin('^', sym(v), num(2))));
  } catch {
    return null;
  }
  const r = ratOf(k);
  if (!r || freeSymbols(k, ctx).length || r.n / r.d >= 0) return null;
  const root = bin('^', neg(k), bin('/', num(1), num(2)));
  const half = bin('/', bin('^', sym('pi'), bin('/', num(1), num(2))), bin('*', num(2), root));
  return cas.eval(bin('*', half, call('erf', [bin('*', root, sym(v))])));
}

/** An antiderivative whose derivative really is the integrand, or null. */
function antiderivative(f: MathNode, v: string, ctx: Ctx): MathNode | null {
  let F: MathNode | null = null;
  try {
    F = cas.integrate(f, v);
  } catch {
    F = null;
  }
  if (!F) {
    try {
      F = gaussian(f, v, ctx);
    } catch {
      F = null;
    }
  }
  if (!F) return null;
  try {
    if (numEq(cas.diff(F, v), f, ctx) === false) return null;
  } catch {
    return null;
  }
  return F;
}

export function integrateOp(expr: MathNode, args: Args, ctx: Ctx): Record<string, unknown> {
  const [v] = variables(args, expr, ctx);
  const lo = args.lower;
  const hi = args.upper;
  if ((lo === undefined) !== (hi === undefined)) throw new CalcError('A definite integral needs both lower and upper.');

  if (lo === undefined) {
    const F = antiderivative(expr, v, ctx);
    if (!F) throw new CalcError(NO_CLOSED_FORM);
    return pack({ t: 'expr', n: tidy(F, ctx) }, ctx, { note: 'Add the constant of integration.' });
  }

  const a = parseUser(String(lo), ctx);
  const b = parseUser(String(hi), ctx);
  const ra = realValue(a, ctx);
  const rb = realValue(b, ctx);
  const symbolic = freeSymbols(expr, ctx).some((s) => s !== v) || ra === null || rb === null;

  let numeric: number | null = null;
  if (!symbolic) {
    try {
      numeric = quad(expr, v, ra, rb);
    } catch {
      throw new CalcError('The integral does not converge on this range, or the integrand is undefined inside it.');
    }
  }

  const F = antiderivative(expr, v, ctx);
  if (F) {
    try {
      const exact = tidy(cas.eval(bin('-', valueAt(F, v, b), valueAt(F, v, a))), ctx);
      const value = realValue(exact, ctx);
      const agrees = numeric === null || (value !== null && Math.abs(value - numeric) <= 1e-7 * (1 + Math.abs(numeric)));
      if (agrees) return pack({ t: 'expr', n: exact }, ctx);
    } catch {
      // fall through to the numeric value
    }
  }
  if (numeric === null) throw new CalcError(NO_CLOSED_FORM);
  return { result: 'no closed form', approx: numeric.toPrecision(15) };
}

export function limitOp(expr: MathNode, args: Args, ctx: Ctx): Record<string, unknown> {
  const [v] = variables(args, expr, ctx);
  let point = String(args.point ?? '0').trim() || '0';
  let dir: 'both' | 'left' | 'right' = 'both';
  if (point.endsWith('+') || point.endsWith('-')) {
    dir = point.endsWith('+') ? 'right' : 'left';
    point = point.slice(0, -1);
  }
  const p = parseUser(point, ctx);
  if (isInfinity(p)) dir = 'both';
  let out: MathNode;
  try {
    out = cas.limit(expr, v, p, dir);
  } catch {
    throw new CalcError('No closed form was found for this limit; try a one-sided limit or op numeric.');
  }
  return pack({ t: 'expr', n: out }, ctx);
}

/** Taylor series: sum of f^(k)(a)/k! (x - a)^k for k < order, as SymPy's series(expr, x, a, n). */
export function seriesOp(expr: MathNode, args: Args, ctx: Ctx): Record<string, unknown> {
  const [v] = variables(args, expr, ctx);
  const point = parseUser(String(args.point ?? '0') || '0', ctx);
  if (isInfinity(point)) throw new CalcError('Series at infinity are not supported by this calculator.', 'NotImplementedError');
  const n = Math.max(2, Math.min(12, Math.trunc(Number(args.order)) || 6));
  const shift = isZero(point) ? sym(v) : bin('-', sym(v), point);

  const terms: MathNode[] = [];
  let d = expr;
  let fact = 1;
  for (let k = 0; k < n; k++) {
    if (k > 0) {
      d = cas.diff(d, v);
      fact *= k;
    }
    let c: MathNode;
    try {
      c = cas.eval(bin('/', valueAt(d, v, point), num(fact)));
    } catch {
      throw new CalcError('Only Taylor series are supported here; the expression is not smooth at that point.', 'NotImplementedError');
    }
    if (isZero(c)) continue;
    const power = k === 0 ? null : k === 1 ? shift : bin('^', shift, num(k));
    terms.push(cas.eval(power ? bin('*', c, power) : c));
  }

  const join = (parts: string[]) =>
    parts.map((s, i) => (i === 0 ? s : s.startsWith('-') ? ` - ${s.replace(/^-\s*/, '')}` : ` + ${s}`)).join('');
  const order = isZero(point) ? `O(${sstr(bin('^', sym(v), num(n)), ctx)})` : `O(${sstr(bin('^', shift, num(n)), ctx)}, (${ctx.toUser.get(v)}, ${sstr(point, ctx)}))`;
  const orderTex = `O\\left(${tex(bin('^', shift, num(n)), ctx)}\\right)`;
  const poly = terms.length ? cas.eval(terms.reduce((acc, t) => bin('+', acc, t))) : num(0);
  const result = join([...terms.map((t) => sstr(t, ctx)), order]);
  const latex = join([...terms.map((t) => tex(t, ctx)), orderTex]);
  return {
    result: result.slice(0, MAX_OUTPUT),
    latex: latex.slice(0, MAX_OUTPUT),
    without_order: sstr(poly, ctx).slice(0, MAX_OUTPUT),
  };
}

export const _test = { antiderivative, call };
