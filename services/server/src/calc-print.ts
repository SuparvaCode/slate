/**
 * Prints internal trees the way SymPy does: sstr ("x + tan(x)**3/3 - tan(x)", "3*x/8") and LaTeX.
 * Sums are ordered like SymPy's as_ordered_terms: lex order over the generators, symbols first.
 */
import type { MathNode } from 'mathjs';
import { argsOf, fnName, kind, nameOf, valueOf, type Ctx } from './calc-ast.ts';

export interface Coef { n: number; d: number; float?: boolean }
interface Factor { base: MathNode; key: string; e: Coef | MathNode }
interface Term { c: Coef; f: Factor[] }

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : Math.abs(a));
const mk = (n: number, d = 1, float = false): Coef => {
  if (float || !Number.isInteger(n) || !Number.isInteger(d)) return { n: n / d, d: 1, float: true };
  if (d < 0) [n, d] = [-n, -d];
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
};
const isCoef = (e: Coef | MathNode): e is Coef => typeof (e as Coef).n === 'number' && !('type' in e);
const mul = (a: Coef, b: Coef) => mk(a.n * b.n, a.d * b.d, a.float || b.float);
const add = (a: Coef, b: Coef) => mk(a.n * b.d + b.n * a.d, a.d * b.d, a.float || b.float);
const inv = (a: Coef) => mk(a.d, a.n, a.float);
const negc = (a: Coef) => mk(-a.n, a.d, a.float);
const ONE = mk(1);

/** A tree that is a plain number (integer, fraction, decimal), as a coefficient. */
export function ratOf(node: MathNode): Coef | null {
  const k = kind(node);
  if (k === 'ConstantNode') return mk(valueOf(node));
  if (k !== 'OperatorNode') return null;
  const a = argsOf(node).map(ratOf);
  if (a.some((x) => !x)) return null;
  const [x, y] = a as Coef[];
  switch (fnName(node)) {
    case 'unaryMinus': return negc(x);
    case 'add': return add(x, y);
    case 'subtract': return add(x, negc(y));
    case 'multiply': return mul(x, y);
    case 'divide': return y.n === 0 ? null : mul(x, inv(y));
    case 'pow':
      if (!y.float && y.d === 1 && Math.abs(y.n) <= 64 && !(x.n === 0 && y.n < 0)) {
        const p = mk(x.n ** Math.abs(y.n), x.d ** Math.abs(y.n), x.float);
        return y.n < 0 ? inv(p) : p;
      }
      return null;
    default: return null;
  }
}

const isSum = (n: MathNode) => kind(n) === 'OperatorNode' && ['add', 'subtract'].includes(fnName(n));

function merge(t: Term, f: Factor): void {
  const same = t.f.find((g) => g.key === f.key && isCoef(g.e) && isCoef(f.e));
  if (same) same.e = add(same.e as Coef, f.e as Coef);
  else t.f.push({ ...f });
  t.f = t.f.filter((g) => !(isCoef(g.e) && g.e.n === 0));
}

function factorize(node: MathNode, ctx: Ctx): Term {
  const r = ratOf(node);
  if (r) return { c: r, f: [] };
  const a = argsOf(node);
  if (kind(node) === 'OperatorNode') {
    const fn = fnName(node);
    if (fn === 'unaryMinus') {
      const t = factorize(a[0], ctx);
      return { c: negc(t.c), f: t.f };
    }
    if (fn === 'multiply' || fn === 'divide') {
      const l = factorize(a[0], ctx);
      const rt = factorize(a[1], ctx);
      const out: Term = { c: fn === 'multiply' ? mul(l.c, rt.c) : mul(l.c, inv(rt.c)), f: [] };
      for (const f of l.f) merge(out, f);
      for (const f of rt.f) merge(out, fn === 'multiply' ? f : { ...f, e: isCoef(f.e) ? negc(f.e) : f.e });
      return out;
    }
    if (fn === 'pow') {
      const e = ratOf(a[1]);
      return { c: ONE, f: [{ base: a[0], key: sstr(a[0], ctx), e: e ?? a[1] }] };
    }
  }
  return { c: ONE, f: [{ base: node, key: sstr(node, ctx), e: ONE }] };
}

function sumTerms(node: MathNode, sign: number, out: { s: number; n: MathNode }[]): void {
  const a = argsOf(node);
  if (kind(node) === 'OperatorNode' && fnName(node) === 'add') {
    sumTerms(a[0], sign, out);
    sumTerms(a[1], sign, out);
  } else if (kind(node) === 'OperatorNode' && fnName(node) === 'subtract') {
    sumTerms(a[0], sign, out);
    sumTerms(a[1], -sign, out);
  } else if (kind(node) === 'OperatorNode' && fnName(node) === 'unaryMinus' && isSum(a[0])) {
    sumTerms(a[0], -sign, out);
  } else out.push({ s: sign, n: node });
}

/** Terms of a sum in SymPy's print order, each with its sign folded into the coefficient. */
function ordered(node: MathNode, ctx: Ctx): Term[] {
  const raw: { s: number; n: MathNode }[] = [];
  sumTerms(node, 1, raw);
  const terms = raw.map(({ s, n }) => {
    const t = factorize(n, ctx);
    return s < 0 ? { c: negc(t.c), f: t.f } : t;
  });
  const isSym = (f: Factor) => kind(f.base) === 'SymbolNode' && /^zq\d+z$/.test(nameOf(f.base));
  const gens = [...new Map(terms.flatMap((t) => t.f).map((f) => [f.key, f])).values()].sort((x, y) =>
    isSym(x) !== isSym(y) ? (isSym(x) ? -1 : 1) : x.key < y.key ? -1 : x.key > y.key ? 1 : 0);
  const vec = (t: Term) => gens.map((g) => {
    const f = t.f.find((h) => h.key === g.key);
    return !f ? 0 : isCoef(f.e) ? f.e.n / f.e.d : 1;
  });
  return terms
    .map((t, i) => ({ t, i, v: vec(t) }))
    .sort((x, y) => {
      for (let k = 0; k < gens.length; k++) if (x.v[k] !== y.v[k]) return y.v[k] - x.v[k];
      return x.i - y.i;
    })
    .map((x) => x.t);
}

// --- sstr ------------------------------------------------------------------------------------

const FN_STR: Record<string, string> = {
  abs: 'Abs', fact: 'factorial', ceil: 'ceiling', min: 'Min', max: 'Max', realpart: 're', imagpart: 'im', mod: 'Mod', conj: 'conjugate',
};

const numStr = (c: Coef): string => (c.float ? fmtFloat(c.n) : c.d === 1 ? String(c.n) : `${c.n}/${c.d}`);
/** SymPy prints a Float with 15 significant digits: 19.6 -> "19.6000000000000". */
export const fmtFloat = (v: number): string => {
  if (!Number.isFinite(v)) return String(v);
  const s = v.toPrecision(15);
  return s.includes('e') ? s.replace(/e\+?/, 'e') : s;
};

function atomStr(node: MathNode, ctx: Ctx): string {
  const k = kind(node);
  if (k === 'SymbolNode') {
    const n = nameOf(node);
    return n === 'pi' ? 'pi' : n === 'e' ? 'E' : n === 'i' ? 'I' : n === 'Infinity' ? 'oo' : ctx.toUser.get(n) ?? n;
  }
  if (k === 'FunctionNode') return `${FN_STR[fnName(node)] ?? fnName(node)}(${argsOf(node).map((a) => sstr(a, ctx)).join(', ')})`;
  return sstr(node, ctx);
}

function wrapStr(node: MathNode, ctx: Ctx): string {
  const r = ratOf(node);
  const simple = kind(node) === 'SymbolNode' || kind(node) === 'FunctionNode' || (r && !r.float && r.d === 1 && r.n >= 0);
  return simple ? atomStr(node, ctx) : `(${sstr(node, ctx)})`;
}

function factorStr(f: Factor, ctx: Ctx, flip = false): string {
  const e = isCoef(f.e) && flip ? negc(f.e) : f.e;
  if (kind(f.base) === 'SymbolNode' && nameOf(f.base) === 'e') return `exp(${isCoef(e) ? numStr(e) : sstr(e, ctx)})`;
  if (!isCoef(e)) return `${wrapStr(f.base, ctx)}**${kind(e) === 'SymbolNode' || ratOf(e) ? sstr(e, ctx) : `(${sstr(e, ctx)})`}`;
  if (e.n === 1 && e.d === 1) return wrapStr(f.base, ctx);
  if (e.n === 1 && e.d === 2) return `sqrt(${sstr(f.base, ctx)})`;
  return `${wrapStr(f.base, ctx)}**${e.d === 1 && !e.float ? e.n : `(${numStr(e)})`}`;
}

const symFirst = (ctx: Ctx) => (x: Factor, y: Factor) => {
  const sx = kind(x.base) === 'SymbolNode' ? 0 : 1;
  const sy = kind(y.base) === 'SymbolNode' ? 0 : 1;
  return sx - sy || (atomStr(x.base, ctx) < atomStr(y.base, ctx) ? -1 : 1);
};

function termStr(t: Term, ctx: Ctx): { neg: boolean; body: string } {
  const neg = t.c.n < 0;
  const c = neg ? negc(t.c) : t.c;
  const isE = (f: Factor) => kind(f.base) === 'SymbolNode' && nameOf(f.base) === 'e';
  const up = t.f.filter((f) => isE(f) || !isCoef(f.e) || f.e.n > 0).sort(symFirst(ctx));
  const down = t.f.filter((f) => !isE(f) && isCoef(f.e) && f.e.n < 0).sort(symFirst(ctx));
  const top = [...(c.n !== 1 || c.float || !up.length ? [c.float ? fmtFloat(c.n) : String(c.n)] : []), ...up.map((f) => factorStr(f, ctx))];
  const bottom = [...(c.d !== 1 ? [String(c.d)] : []), ...down.map((f) => factorStr(f, ctx, true))];
  let body = top.join('*');
  if (bottom.length) body += `/${bottom.length === 1 && !/[*/]/.test(bottom[0]) ? bottom[0] : `(${bottom.join('*')})`}`;
  return { neg, body };
}

export function sstr(node: MathNode, ctx: Ctx): string {
  if (kind(node) === 'SymbolNode' || kind(node) === 'FunctionNode') return atomStr(node, ctx);
  const terms = ordered(node, ctx);
  return terms.map((t, i) => {
    const { neg, body } = termStr(t, ctx);
    return i === 0 ? (neg ? `-${body}` : body) : `${neg ? ' - ' : ' + '}${body}`;
  }).join('') || '0';
}

// --- LaTeX -----------------------------------------------------------------------------------

const GREEK_TEX = /^(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lamda|mu|nu|xi|omicron|rho|sigma|tau|upsilon|phi|chi|psi|omega|Delta|Theta|Phi|Omega)$/;
const TRIG = new Set(['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'sinh', 'cosh', 'tanh', 'coth', 'log']);

export function texName(name: string): string {
  const m = /^([A-Za-z]+?)(?:_?([0-9]+)|_([A-Za-z0-9]+))?$/.exec(name);
  const base = m?.[1] ?? name;
  const sub = m?.[2] ?? m?.[3];
  const b = GREEK_TEX.test(base) ? `\\${base === 'lamda' ? 'lambda' : base}` : base;
  return sub ? `${b}_{${sub}}` : b;
}

function atomTex(node: MathNode, ctx: Ctx, power = ''): string {
  if (kind(node) === 'SymbolNode') {
    const n = nameOf(node);
    const s = n === 'pi' ? '\\pi' : n === 'e' ? 'e' : n === 'i' ? 'i' : n === 'Infinity' ? '\\infty' : texName(ctx.toUser.get(n) ?? n);
    return power ? `${s}^{${power}}` : s;
  }
  if (kind(node) === 'FunctionNode') {
    const name = fnName(node);
    const a = argsOf(node).map((x) => tex(x, ctx));
    let s: string;
    if (TRIG.has(name)) return `\\${name}${power ? `^{${power}}` : ''}{\\left(${a.join(', ')} \\right)}`;
    if (name === 'abs') s = `\\left|{${a[0]}}\\right|`;
    else if (name === 'fact') s = `${a[0]}!`;
    else if (name === 'floor') s = `\\left\\lfloor{${a[0]}}\\right\\rfloor`;
    else if (name === 'ceil') s = `\\left\\lceil{${a[0]}}\\right\\rceil`;
    else s = `\\operatorname{${FN_STR[name] ?? name}}{\\left(${a.join(', ')} \\right)}`;
    return power ? `\\left(${s}\\right)^{${power}}` : s;
  }
  const s = tex(node, ctx);
  return power ? `\\left(${s}\\right)^{${power}}` : s;
}

function factorTex(f: Factor, ctx: Ctx, flip = false): string {
  const e = isCoef(f.e) && flip ? negc(f.e) : f.e;
  const eTex = isCoef(e) ? numStr(e).replace(/^(-?\d+)\/(\d+)$/, '\\frac{$1}{$2}') : tex(e, ctx);
  if (kind(f.base) === 'SymbolNode' && nameOf(f.base) === 'e') return `e^{${eTex}}`;
  if (isCoef(e) && e.n === 1 && e.d === 1) {
    return kind(f.base) === 'SymbolNode' || kind(f.base) === 'FunctionNode' || ratOf(f.base) ? atomTex(f.base, ctx) : `\\left(${tex(f.base, ctx)}\\right)`;
  }
  if (isCoef(e) && e.n === 1 && e.d === 2) return `\\sqrt{${tex(f.base, ctx)}}`;
  return atomTex(f.base, ctx, eTex);
}

function termTex(t: Term, ctx: Ctx): { neg: boolean; body: string } {
  const neg = t.c.n < 0;
  const c = neg ? negc(t.c) : t.c;
  const isE = (f: Factor) => kind(f.base) === 'SymbolNode' && nameOf(f.base) === 'e';
  const up = t.f.filter((f) => isE(f) || !isCoef(f.e) || f.e.n > 0).sort(symFirst(ctx));
  const down = t.f.filter((f) => !isE(f) && isCoef(f.e) && f.e.n < 0).sort(symFirst(ctx));
  const top = [...(c.n !== 1 || c.float || !up.length ? [c.float ? fmtFloat(c.n) : String(c.n)] : []), ...up.map((f) => factorTex(f, ctx))];
  const bottom = [...(c.d !== 1 ? [String(c.d)] : []), ...down.map((f) => factorTex(f, ctx, true))];
  const body = bottom.length ? `\\frac{${top.join(' ')}}{${bottom.join(' ')}}` : top.join(' ');
  return { neg, body };
}

export function tex(node: MathNode, ctx: Ctx): string {
  if (kind(node) === 'SymbolNode' || kind(node) === 'FunctionNode') return atomTex(node, ctx);
  return ordered(node, ctx).map((t, i) => {
    const { neg, body } = termTex(t, ctx);
    return i === 0 ? (neg ? `- ${body}` : body) : `${neg ? ' - ' : ' + '}${body}`;
  }).join('') || '0';
}
