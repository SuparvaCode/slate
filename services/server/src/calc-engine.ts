/** The calculator's operations, run inside a worker thread. Port of calc.py's _Engine.run. */
import { CalcError, freeSymbols, newCtx, parseUser } from './calc-ast.ts';
import { integrateOp, limitOp, seriesOp } from './calc-calculus.ts';
import { cas, pack, tidy } from './calc-cas.ts';
import { hasEq, variables } from './calc-common.ts';
import { checkOp, sameOp } from './calc-compare.ts';
import { nStr } from './calc-num.ts';
import { solveOp } from './calc-solve.ts';

export type Args = Record<string, unknown>;
export type Out = Record<string, unknown>;

export function run(op: string, args: Args): Out {
  const ctx = newCtx();
  const text = String(args.expr ?? '');

  if (op === 'solve') return solveOp(text, args, ctx);
  if (op === 'check') return checkOp(text, args, ctx);
  if (op === 'same') return sameOp(args, ctx);

  if (hasEq(text)) throw new CalcError(`Use op 'solve' or 'check' for equations; '${op}' takes an expression.`);
  const expr = parseUser(text, ctx);

  switch (op) {
    case 'evaluate':
    case 'simplify':
      return pack({ t: 'expr', n: tidy(cas.eval(expr), ctx) }, ctx);
    case 'expand':
      return pack({ t: 'expr', n: cas.expand(expr) }, ctx);
    case 'factor':
      return pack({ t: 'expr', n: cas.factor(expr) }, ctx);
    case 'numeric': {
      const digits = Math.max(3, Math.min(50, Math.trunc(Number(args.order)) || 15));
      if (freeSymbols(expr, ctx).length) {
        throw new CalcError('numeric takes an expression with no variables; substitute the values first.');
      }
      const s = nStr(expr, digits);
      if (s === null) throw new CalcError('The expression has no numeric value.');
      return { result: s };
    }
    case 'diff': {
      const [v] = variables(args, expr, ctx);
      const n = Math.max(1, Math.min(10, Math.trunc(Number(args.order)) || 1));
      return pack({ t: 'expr', n: tidy(cas.diff(expr, v, n), ctx) }, ctx);
    }
    case 'integrate':
      return integrateOp(expr, args, ctx);
    case 'limit':
      return limitOp(expr, args, ctx);
    case 'series':
      return seriesOp(expr, args, ctx);
    default:
      throw new CalcError(`Unknown op '${op}'.`);
  }
}
