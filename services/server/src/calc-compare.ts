/** check (is expr equal to other?) and same (does an answer match the calculator's result?). */
import type { MathNode } from 'mathjs';
import { CalcError, bin, freeSymbols, num, parseUser, type Ctx } from './calc-ast.ts';
import { cas } from './calc-cas.ts';
import { isZero, splitTop } from './calc-common.ts';
import { absC, evalC, numEq } from './calc-num.ts';
import { sstr } from './calc-print.ts';
import { MAX_OUTPUT } from './calc-cas.ts';

type Args = Record<string, unknown>;

export function checkOp(text: string, args: Args, ctx: Ctx): Record<string, unknown> {
  const other = args.other;
  if (!other) throw new CalcError("check needs 'other', the expression to compare against.");
  const a = parseUser(text, ctx);
  const b = parseUser(String(other), ctx);
  const d = bin('-', a, b);
  let diff: MathNode = d;
  try {
    diff = cas.simplify(d);
  } catch {
    // compare numerically below
  }
  if (isZero(diff)) return { equal: true };
  // Not provably equal: compare at a few points, which catches most real mismatches.
  const syms = freeSymbols(d, ctx);
  for (const pt of [0.37, 1.21, -0.83, 2.6]) {
    const sub: Record<string, number> = {};
    syms.forEach((s, i) => (sub[s] = pt + i * 0.11));
    let val;
    try {
      val = evalC(d, sub);
    } catch {
      continue;
    }
    if (absC(val) > 1e-9) return { equal: false, difference: sstr(diff, ctx).slice(0, MAX_OUTPUT) };
  }
  return { equal: true, note: 'Equal at every point tested; not proven symbolically.' };
}

/** The separate results in an answer: "2, 3" or "x = 2, x = 3" both give ["2", "3"]. */
const parts = (text: string): string[] => splitTop(text.trim()).map((p) => p.trim().replace(/^[A-Za-z]\w*\s*=\s*(?!=)/, ''));

function pairEq(a: MathNode, b: MathNode, constant: boolean, names: string[], ctx: Ctx): boolean | null {
  if (sstr(a, ctx) === sstr(b, ctx)) return true;
  if (constant) {
    // Same up to an added constant: the difference does not change with the variable.
    let d: MathNode = bin('-', a, b);
    const vs = names.length ? names.map((n) => sstr(parseUser(n, ctx), ctx) && parseUser(n, ctx)) : freeSymbols(b, ctx).map((s) => parseUser(ctx.toUser.get(s) ?? s, ctx));
    try {
      for (const v of vs) d = cas.diff(d, String((v as { name?: string }).name));
    } catch {
      return null;
    }
    return numEq(d, num(0), ctx);
  }
  return numEq(a, b, ctx);
}

export function sameOp(args: Args, ctx: Ctx): Record<string, unknown> {
  const mine = parts(String(args.expr ?? '')).map((p) => parseUser(p, ctx));
  const theirs = parts(String(args.other ?? '')).map((p) => parseUser(p, ctx));
  if (mine.length !== theirs.length) return { equal: false, note: 'The number of results differs.' };
  const constant = !!args.constant;
  const names = splitTop(String(args.var ?? ''));
  const left = [...theirs];
  for (const a of mine) {
    let found = -1;
    let unsure = false;
    for (let i = 0; i < left.length; i++) {
      const verdict = pairEq(a, left[i], constant, names, ctx);
      if (verdict === true) {
        found = i;
        break;
      }
      if (verdict === null) unsure = true;
    }
    if (found < 0) return { equal: unsure ? null : false };
    left.splice(found, 1);
  }
  return { equal: true };
}
