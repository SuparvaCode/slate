/** Numbers for the calculator: complex evaluation, SymPy-style N(), the equality test, quadrature. */
import { all, create, type MathNode } from 'mathjs';
import { CalcError, freeSymbols, type Ctx } from './calc-ast.ts';

const m = create(all, { predictable: false });
const big = create(all, { number: 'BigNumber', precision: 96, predictable: false });

export interface C { re: number; im: number }

const fns = {
  fact: (x: any) => m.gamma(m.add(x, 1) as any),
  realpart: (x: any) => m.re(x),
  imagpart: (x: any) => m.im(x),
  conj: (x: any) => m.conj(x),
};

function toC(v: unknown): C {
  if (typeof v === 'number') return { re: v, im: 0 };
  if (typeof v === 'boolean') return { re: v ? 1 : 0, im: 0 };
  if (v && typeof v === 'object' && 're' in v && 'im' in v) return { re: Number((v as C).re), im: Number((v as C).im) };
  if (v && typeof v === 'object' && 'toNumber' in v) return { re: (v as { toNumber(): number }).toNumber(), im: 0 };
  throw new CalcError('not a number');
}

const compiled = new WeakMap<MathNode, { evaluate(scope: object): unknown }>();

/** Evaluates a tree at numeric values for its symbols. Throws when it is not a finite number. */
export function evalC(node: MathNode, values: Record<string, number | C> = {}): C {
  let code = compiled.get(node);
  if (!code) {
    code = m.parse(node.toString()).compile();
    compiled.set(node, code);
  }
  const scope: Record<string, unknown> = { ...fns };
  for (const [k, x] of Object.entries(values)) scope[k] = typeof x === 'number' ? x : m.complex(x.re, x.im);
  const v = toC(code.evaluate(scope));
  if (!Number.isFinite(v.re) || !Number.isFinite(v.im)) throw new CalcError('not finite');
  return v;
}

export const isFiniteC = (v: C) => Number.isFinite(v.re) && Number.isFinite(v.im);
export const absC = (v: C) => Math.hypot(v.re, v.im);

/** Python's str(N(value, digits)) for a value with no symbols, or null when it is not a number. */
export function nStr(node: MathNode, digits: number): string | null {
  try {
    const v = big.evaluate(node.toString(), { ...fns });
    if (v && typeof v === 'object' && 'toPrecision' in v && !('im' in v)) {
      const s = (v as { toPrecision(d: number): string }).toPrecision(digits);
      return s.includes('e') ? s.replace(/e\+?/, 'e') : s;
    }
  } catch {
    // fall back to doubles below
  }
  try {
    const c = evalC(node);
    const p = (x: number) => x.toPrecision(Math.min(digits, 17)).replace(/e\+?/, 'e');
    if (Math.abs(c.im) <= 1e-14 * Math.max(1, Math.abs(c.re))) return p(c.re);
    if (Math.abs(c.re) <= 1e-14 * Math.abs(c.im)) return `${p(c.im)}*I`;
    return `${p(c.re)} ${c.im < 0 ? '-' : '+'} ${p(Math.abs(c.im))}*I`;
  } catch {
    return null;
  }
}

/** Do a and b agree at several test points? true, false, or null when too few points could be evaluated. */
export function numEq(a: MathNode, b: MathNode, ctx: Ctx): boolean | null {
  const syms = [...new Set([...freeSymbols(a, ctx), ...freeSymbols(b, ctx)])].sort((x, y) =>
    (ctx.toUser.get(x) ?? x).localeCompare(ctx.toUser.get(y) ?? y));
  let good = 0;
  for (const pt of [0.37, 1.21, -0.83, 2.6, 0.9]) {
    const sub: Record<string, number> = {};
    syms.forEach((s, i) => (sub[s] = pt + i * 0.113));
    let va: C;
    let vb: C;
    try {
      va = evalC(a, sub);
      vb = evalC(b, sub);
    } catch {
      continue;
    }
    if (absC({ re: va.re - vb.re, im: va.im - vb.im }) > 1e-8 * (1 + absC(va) + absC(vb))) return false;
    good += 1;
  }
  return good >= 2 ? true : null;
}

/** Real value of f at x, or throws when it is not real and finite. */
function realAt(f: MathNode, v: string, x: number): number {
  const c = evalC(f, { [v]: x });
  if (Math.abs(c.im) > 1e-9 * (1 + Math.abs(c.re))) throw new CalcError('complex integrand');
  return c.re;
}

function simpson(g: (t: number) => number, a: number, b: number, eps: number, whole: number, fa: number, fm: number, fb: number, depth: number): number {
  const mid = (a + b) / 2;
  const lm = (a + mid) / 2;
  const rm = (mid + b) / 2;
  const flm = g(lm);
  const frm = g(rm);
  const left = ((mid - a) / 6) * (fa + 4 * flm + fm);
  const right = ((b - mid) / 6) * (fm + 4 * frm + fb);
  if (depth <= 0 || Math.abs(left + right - whole) <= 15 * eps) return left + right + (left + right - whole) / 15;
  return simpson(g, a, mid, eps / 2, left, fa, flm, fm, depth - 1) + simpson(g, mid, b, eps / 2, right, fm, frm, fb, depth - 1);
}

/**
 * Numeric definite integral of f in v over [lo, hi] (either may be +-Infinity). Infinite ranges use
 * x = tan(t). Throws when the integrand is not finite somewhere it is sampled.
 */
export function quad(f: MathNode, v: string, lo: number, hi: number): number {
  if (lo === hi) return 0;
  if (lo > hi) return -quad(f, v, hi, lo);
  const infinite = !Number.isFinite(lo) || !Number.isFinite(hi);
  const a = infinite ? (Number.isFinite(lo) ? Math.atan(lo) : -Math.PI / 2) : lo;
  const b = infinite ? (Number.isFinite(hi) ? Math.atan(hi) : Math.PI / 2) : hi;
  const g = infinite
    ? (t: number) => {
        const c = Math.cos(t);
        if (Math.abs(c) < 1e-12) return 0;
        const y = realAt(f, v, Math.tan(t)) / (c * c);
        if (!Number.isFinite(y)) throw new CalcError('not finite');
        return y;
      }
    : (x: number) => {
        const y = realAt(f, v, x);
        if (!Number.isFinite(y)) throw new CalcError('not finite');
        return y;
      };
  // Endpoints of an infinite range are approached, not sampled.
  const shrink = infinite ? 1e-9 : 0;
  const A = a + shrink;
  const B = b - shrink;
  const parts = 16;
  let total = 0;
  for (let k = 0; k < parts; k++) {
    const x0 = A + ((B - A) * k) / parts;
    const x1 = A + ((B - A) * (k + 1)) / parts;
    const f0 = g(x0);
    const f1 = g(x1);
    const fm = g((x0 + x1) / 2);
    total += simpson(g, x0, x1, 1e-13, ((x1 - x0) / 6) * (f0 + 4 * fm + f1), f0, fm, f1, 40);
  }
  if (!Number.isFinite(total)) throw new CalcError('not finite');
  return total;
}
