/** Checking and shaping the solver's answer. Port of the helpers in solver.py. */
import { pyStr, topSplit } from './answers.ts';
import { calculator } from './calc.ts';

export interface Target {
  op: string;
  args: Record<string, unknown>;
  out: Record<string, unknown>;
}

/** When the user ended with "=", the answer is only what follows it. */
export function continuation(written: string, answer: string): string {
  if (!written.trimEnd().endsWith('=')) return answer;
  const text = answer.trim();
  if (topSplit(text, ',').length > 1 || text.includes('\\quad') || text.includes('\\text{or}')) return answer;
  // An "=" inside \begin{...} ... \end{...} (cases, aligned) is part of the answer.
  if (text.includes('\\begin')) return answer;
  const parts = topSplit(text, '=');
  if (parts.length > 1 && parts[parts.length - 1].trim()) return parts[parts.length - 1].trim();
  return answer;
}

/** True when a check compares an expression with itself, which proves nothing. */
export function sameText(a: unknown, b: unknown): boolean {
  const norm = (v: unknown) => pyStr(v || '').replace(/\s+/g, '').replaceAll('^', '**');
  return norm(a) === norm(b);
}

/** A result without its set or list brackets, so "{2, 3}" becomes "2, 3". */
export function bare(text: string): string {
  const t = text.trim();
  return '{['.includes(t.slice(0, 1)) && t && '}]'.includes(t.slice(-1)) ? t.slice(1, -1).trim() : t;
}

/** Compares the written answer with the calculator's result: [verdict, the calculator's result]. */
export async function verifyAnswer(target: Target | null, answerExpr: string, unknown: string | null = null): Promise<[boolean | null, string]> {
  if (!target || !answerExpr.trim()) return [null, ''];
  const { out, op, args } = target;
  const text = pyStr(out.without_order || out.result || '');
  if (!text || text === 'no closed form') return [null, text];
  if (text.includes(':')) return [await verifyNamed(text, answerExpr, unknown), text];
  const candidates = [bare(text)];
  if (op === 'solve' && out.all_solutions) candidates.push(bare(pyStr(out.all_solutions)));
  const indefinite = op === 'integrate' && !args.lower;
  let verdict: boolean | null = null;
  for (const cand of candidates) {
    const r = await calculator.run('same', { expr: answerExpr, other: cand, var: args.var, constant: indefinite });
    const equal = 'error' in r ? null : (r.equal as boolean | null);
    if (equal === true) return [true, text];
    if (equal === false) verdict = false;
  }
  return [verdict, text];
}

/** Does a decimal answer agree with a numeric result to the digits it was written with? */
export function numericMatches(result: string, answerExpr: string): boolean {
  const want = result.trim() === '' ? NaN : Number(result);
  if (Number.isNaN(want)) return false;
  const m = /^\s*(?:[A-Za-z]\w*\s*=\s*)?(-?\d+(?:\.(\d+))?)\s*$/.exec(answerExpr);
  if (!m) return false;
  const decimals = (m[2] ?? '').length;
  return Math.abs(Number(m[1]) - want) <= 0.5 * 10 ** -decimals + 1e-12;
}

/** Checks "x = 3, y = 2" against a result such as [{x: 3, y: 2}]. */
async function verifyNamed(result: string, answerExpr: string, unknown: string | null): Promise<boolean | null> {
  const values = new Map<string, string>();
  for (const m of result.matchAll(/(\w+)\s*:\s*([^,}\]]+)/g)) values.set(m[1], m[2].trim());
  if (!values.size) return null;
  const parts = topSplit(answerExpr, ',').map((p) => p.trim()).filter(Boolean);
  const verdicts: (boolean | null)[] = [];
  for (const part of parts) {
    const m = /^([A-Za-z]\w*)\s*=\s*(.+)$/s.exec(part);
    let name: string;
    let expr: string;
    if (m) [name, expr] = [m[1], m[2]];
    else if (unknown && parts.length === 1) [name, expr] = [unknown, part];
    else return null;
    if (!values.has(name)) return null;
    const r = await calculator.run('same', { expr, other: values.get(name) });
    verdicts.push('error' in r ? null : (r.equal as boolean | null));
  }
  if (!verdicts.length || verdicts.some((v) => v === null)) return null;
  return verdicts.every(Boolean);
}

/** The calculator's own result as LaTeX, for when the written answer was wrong. */
export function calcAnswer(target: Target): string | null {
  const { out, op, args } = target;
  const latex = pyStr(out.latex || '');
  if (!latex) return null;
  if (op === 'solve' && latex.startsWith('\\left\\{') && latex.endsWith('\\right\\}')) {
    const inner = latex.slice('\\left\\{'.length, -'\\right\\}'.length);
    const v = pyStr(args.var || '').trim();
    return v && !v.includes(',') ? `${v} = ${inner}` : inner;
  }
  if (op === 'integrate' && !args.lower) return `${latex} + C`;
  return latex;
}

/** An indefinite integral is only complete with its constant of integration. */
export function withConstant(latex: string): string {
  if (!latex.trim() || /\+\s*C\b/.test(latex)) return latex;
  return `${latex.trimEnd()} + C`;
}

const plain = (latex: string): string => latex.replace(/\\(left|right|,|;|:|!|quad|qquad)/g, '').replace(/[\s{}]+/g, '');

/** Working starts from what the user wrote, so a first step that only repeats it is cut. */
export function dropRestated(written: string, steps: string[]): string[] {
  return steps.length && plain(steps[0]) === plain(written) ? steps.slice(1) : steps;
}

/** What the model sees of a calculator result: enough to use, small enough to be cheap. */
export function compact(result: Record<string, unknown>): Record<string, unknown> {
  const keep: Record<string, unknown> = {};
  for (const k of ['result', 'latex', 'approx', 'equal', 'note', 'error', 'difference']) if (k in result) keep[k] = result[k];
  if (typeof keep.latex === 'string' && keep.latex.length > 600) delete keep.latex;
  return keep;
}
