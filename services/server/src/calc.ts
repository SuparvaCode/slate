/**
 * The calculator, run in worker threads. Port of calc.py's server side.
 *
 * Every name in an expression must be a known function, constant or short variable, checked here
 * before anything is parsed. Each calculation runs in a worker with a time limit; a stuck worker is
 * terminated and replaced, so a hung expression cannot block the server.
 */
import { Worker } from 'node:worker_threads';

export const TIMEOUT_S = 8;
export const MAX_INPUT = 400;

export const OPS = ['evaluate', 'simplify', 'expand', 'factor', 'solve', 'diff', 'integrate', 'limit', 'series', 'numeric', 'check'];
/** Ops the server uses itself, not offered to the model. */
export const INTERNAL_OPS = ['same'];

export const FUNCTIONS = new Set([
  'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'asin', 'acos', 'atan', 'acot', 'asec', 'acsc',
  'arcsin', 'arccos', 'arctan', 'atan2', 'sinh', 'cosh', 'tanh', 'coth', 'asinh', 'acosh',
  'atanh', 'exp', 'log', 'ln', 'sqrt', 'cbrt', 'root', 'Abs', 'abs', 'sign', 'floor',
  'ceiling', 'factorial', 'binomial', 'gamma', 'Min', 'Max', 're', 'im', 'arg',
  'conjugate', 'gcd', 'lcm', 'mod', 'Mod', 'deg', 'rad',
]);
export const CONSTANTS = new Set(['pi', 'E', 'e', 'I', 'oo', 'inf', 'infinity']);
export const GREEK = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa',
  'lamda', 'mu', 'nu', 'xi', 'omicron', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi',
  'psi', 'omega', 'Delta', 'Theta', 'Phi', 'Omega',
]);
const SYMBOL = /^[A-Za-z](?:[0-9]|_[A-Za-z0-9]{1,4})?$/;
const CHARS = /^[A-Za-z0-9_\s+\-*/^().,=<>!]*$/;
const NAME = /[A-Za-z_][A-Za-z0-9_]*/g;

/** An error message the model can act on, or null when the input is safe. */
export function validate(text: string): string | null {
  if (text.length > MAX_INPUT) return `Expression is longer than ${MAX_INPUT} characters; split the problem up.`;
  if (!CHARS.test(text)) {
    const bad = [...new Set([...text].filter((c) => !CHARS.test(c)))].sort();
    return `Characters not allowed: ${bad.join(' ')}. Use SymPy syntax such as x**2, sqrt(x).`;
  }
  if (text.includes('__') || /\.\s*[A-Za-z_]/.test(text)) return 'Attribute access is not allowed. Use plain function calls such as sin(x).';
  for (const name of text.match(NAME) ?? []) {
    if (FUNCTIONS.has(name) || CONSTANTS.has(name) || GREEK.has(name) || SYMBOL.test(name)) continue;
    return `Unknown name '${name}'. Use one-letter variables (x, y, t2, v_0) and standard functions; write products explicitly, e.g. x*y instead of xy.`;
  }
  return null;
}

export type CalcOut = Record<string, unknown>;
export type CalcArgs = Record<string, unknown>;

const WORKER_URL = new URL(import.meta.url.endsWith('.ts') ? './calc-worker.ts' : './calc-worker.js', import.meta.url);

class CalcWorker {
  worker: Worker;
  ready: Promise<void>;
  private seq = 0;
  private pending = new Map<number, (out: CalcOut) => void>();

  constructor() {
    this.worker = new Worker(WORKER_URL);
    this.worker.unref();
    this.ready = new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('worker start timeout')), 60_000);
      this.worker.once('message', () => {
        clearTimeout(t);
        resolve();
        this.worker.on('message', (m: { id: number; out: CalcOut }) => {
          this.pending.get(m.id)?.(m.out);
          this.pending.delete(m.id);
        });
      });
    });
    this.ready.catch(() => {});
    this.worker.on('error', () => this.failAll());
    this.worker.on('exit', () => this.failAll());
  }

  private failAll(): void {
    for (const done of this.pending.values()) done({ error: 'WorkerError: the calculator stopped.' });
    this.pending.clear();
  }

  call(req: { op: string; args: CalcArgs }, timeoutS: number): Promise<CalcOut | 'timeout'> {
    return new Promise((resolve) => {
      const id = ++this.seq;
      const t = setTimeout(() => {
        this.pending.delete(id);
        resolve('timeout');
      }, timeoutS * 1000);
      this.pending.set(id, (out) => {
        clearTimeout(t);
        resolve(out);
      });
      this.worker.postMessage({ id, ...req });
    });
  }

  kill(): void {
    this.worker.terminate().catch(() => {});
  }
}

/** Python's "%g" for the timeout in the error text: 8.0 -> "8", 2.5 -> "2.5". */
const g = (n: number): string => String(Number(n.toPrecision(6)));

export class Calculator {
  private idle: CalcWorker[] = [];
  private waiters: ((w: CalcWorker) => void)[] = [];
  private started = false;
  private size: number;

  constructor(size = 2) {
    this.size = size;
  }

  private ensure(): void {
    if (this.started) return;
    this.started = true;
    for (let i = 0; i < this.size; i++) this.idle.push(new CalcWorker());
  }

  private acquire(): Promise<CalcWorker> {
    this.ensure();
    const w = this.idle.pop();
    if (w) return Promise.resolve(w);
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private release(w: CalcWorker): void {
    const next = this.waiters.shift();
    if (next) next(w);
    else this.idle.push(w);
  }

  /** Starts the workers and loads the CAS, so the first solve is quick. */
  warm(): void {
    this.ensure();
    for (let i = 0; i < this.size; i++) void this.run('evaluate', { expr: '1' });
  }

  async run(op: string, args: CalcArgs, timeoutS: number = TIMEOUT_S): Promise<CalcOut> {
    if (!OPS.includes(op) && !INTERNAL_OPS.includes(op)) return { error: `Unknown op '${op}'. Use one of: ${OPS.join(', ')}.` };
    const clean: CalcArgs = {};
    for (const key of ['expr', 'var', 'lower', 'upper', 'point', 'other']) {
      const val = args[key];
      if (val === null || val === undefined || val === '') continue;
      const s = typeof val === 'string' ? val : String(val);
      const problem = validate(s);
      if (problem) return { error: `${key}: ${problem}` };
      clean[key] = s;
    }
    if (args.order !== undefined && args.order !== null) {
      const n = typeof args.order === 'number' ? Math.trunc(args.order) : Number.parseInt(String(args.order).trim(), 10);
      if (!Number.isFinite(n) || (typeof args.order === 'string' && !/^\s*[+-]?\d+\s*$/.test(args.order))) return { error: 'order must be a whole number.' };
      clean.order = n;
    }
    if (args.constant) clean.constant = true;
    if (!('expr' in clean)) return { error: 'expr is required.' };

    let worker = await this.acquire();
    try {
      try {
        await worker.ready; // the first use pays for loading the CAS; that is not timed
      } catch {
        worker.kill();
        worker = new CalcWorker();
        return { error: 'WorkerError: the calculator could not start.' };
      }
      const out = await worker.call({ op, args: clean }, timeoutS);
      if (out === 'timeout') {
        worker.kill();
        worker = new CalcWorker();
        return { error: `Stopped after ${g(timeoutS)}s without finishing. Try a simpler form, a substitution, or op 'numeric'.` };
      }
      return out;
    } finally {
      this.release(worker);
    }
  }

  /** Stops every worker (tests and shutdown). */
  close(): void {
    for (const w of this.idle) w.kill();
    this.idle = [];
    this.started = false;
  }
}

export const calculator = new Calculator();
