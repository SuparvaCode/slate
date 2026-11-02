/**
 * Expression trees for the calculator. User text (SymPy syntax) is parsed with mathjs, names are
 * mapped to an internal form, and the tree is printed for nerdamer. nerdamer's results are parsed
 * back into the same tree form, which the printers and the numeric checker share.
 *
 * Internal form: user symbols are renamed zq<n>z (so "i", "e", "E", "S" never clash with CAS
 * constants); constants are pi, e, i, Infinity; functions use nerdamer's names (log, abs, fact...).
 */
import { ConstantNode, FunctionNode, OperatorNode, SymbolNode, parse, type MathNode } from 'mathjs';
import { CONSTANTS, FUNCTIONS, GREEK } from './calc.ts';

export class CalcError extends Error {
  constructor(message: string, name = 'ValueError') {
    super(message);
    this.name = name;
  }
}

export interface Ctx {
  toInternal: Map<string, string>;
  toUser: Map<string, string>;
}

export const newCtx = (): Ctx => ({ toInternal: new Map(), toUser: new Map() });

export function symFor(ctx: Ctx, name: string): string {
  let s = ctx.toInternal.get(name);
  if (!s) {
    s = `zq${ctx.toInternal.size}z`;
    ctx.toInternal.set(name, s);
    ctx.toUser.set(s, name);
  }
  return s;
}

const SYMBOL = /^[A-Za-z](?:[0-9]|_[A-Za-z0-9]{1,4})?$/;
const INTERNAL = /^zq\d+z$/;

// Light node accessors: mathjs node classes are loosely typed.
type Any = MathNode & Record<string, any>;
export const kind = (n: MathNode): string => n.type;
export const argsOf = (n: MathNode): MathNode[] => ((n as Any).args ?? []) as MathNode[];
export const fnName = (n: MathNode): string => {
  const fn = (n as Any).fn;
  return typeof fn === 'string' ? fn : fn?.name ?? '';
};
export const opOf = (n: MathNode): string => (n as Any).op ?? '';
export const nameOf = (n: MathNode): string => (n as Any).name ?? '';
export const valueOf = (n: MathNode): number => Number((n as Any).value);

export const num = (v: number): MathNode => new ConstantNode(v);
export const sym = (name: string): MathNode => new SymbolNode(name);
export const call = (name: string, args: MathNode[]): MathNode => new FunctionNode(name, args);
const OPS: Record<string, string> = { '+': 'add', '-': 'subtract', '*': 'multiply', '/': 'divide', '^': 'pow' };
export const bin = (o: string, a: MathNode, b: MathNode): MathNode => new OperatorNode(o as '+', OPS[o] as 'add', [a, b]);
export const neg = (a: MathNode): MathNode => new OperatorNode('-', 'unaryMinus', [a]);

const RENAME: Record<string, string> = {
  arcsin: 'asin', arccos: 'acos', arctan: 'atan', ln: 'log', Abs: 'abs', ceiling: 'ceil',
  factorial: 'fact', Min: 'min', Max: 'max', re: 'realpart', im: 'imagpart', Mod: 'mod', conjugate: 'conj',
};

function constantFor(name: string): MathNode {
  if (name === 'pi') return sym('pi');
  if (name === 'E' || name === 'e') return sym('e');
  if (name === 'I') return sym('i');
  return sym('Infinity'); // oo, inf, infinity
}

function mapCall(name: string, args: MathNode[]): MathNode {
  const need = (n: number) => {
    if (args.length !== n) throw new CalcError(`${name} takes ${n} argument${n === 1 ? '' : 's'}.`, 'TypeError');
  };
  switch (name) {
    case 'exp':
      need(1);
      return bin('^', sym('e'), args[0]);
    case 'log':
    case 'ln':
      if (args.length === 2) return bin('/', call('log', [args[0]]), call('log', [args[1]]));
      need(1);
      return call('log', args);
    case 'root':
      need(2);
      return bin('^', args[0], bin('/', num(1), args[1]));
    case 'deg':
      need(1);
      return bin('/', bin('*', args[0], sym('pi')), num(180));
    case 'rad':
      need(1);
      return args[0];
    case 'binomial': {
      need(2);
      const [n, k] = args;
      return bin('/', call('fact', [n]), bin('*', call('fact', [k]), call('fact', [bin('-', n, k)])));
    }
    case 'conjugate':
      throw new CalcError('conjugate is not supported by this calculator.', 'NotImplementedError');
    default:
      return call(RENAME[name] ?? name, args);
  }
}

function mapUser(node: MathNode, ctx: Ctx): MathNode {
  switch (kind(node)) {
    case 'ParenthesisNode':
      return mapUser((node as Any).content, ctx);
    case 'ConstantNode': {
      const v = (node as Any).value;
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new CalcError('Only numbers are allowed as constants.');
      return num(v);
    }
    case 'SymbolNode': {
      const name = nameOf(node);
      if (CONSTANTS.has(name)) return constantFor(name);
      if (GREEK.has(name) || SYMBOL.test(name)) return sym(symFor(ctx, name));
      if (FUNCTIONS.has(name)) throw new CalcError(`Write function calls with brackets, e.g. ${name}(x).`);
      throw new CalcError(`Unknown name '${name}'.`, 'NameError');
    }
    case 'OperatorNode': {
      const fn = fnName(node);
      const a = argsOf(node).map((x) => mapUser(x, ctx));
      if (fn === 'unaryPlus') return a[0];
      if (fn === 'unaryMinus') return neg(a[0]);
      if (fn === 'factorial') return call('fact', [a[0]]);
      const o = opOf(node) === ' ' ? '*' : opOf(node);
      if (['add', 'subtract', 'multiply', 'divide', 'pow'].includes(fn) && a.length === 2) {
        return bin({ add: '+', subtract: '-', multiply: '*', divide: '/', pow: '^' }[fn as 'add'] ?? o, a[0], a[1]);
      }
      throw new CalcError("Comparisons are not expressions. Use op 'solve' or 'check' for equations.");
    }
    case 'FunctionNode': {
      const name = fnName(node);
      const a = argsOf(node).map((x) => mapUser(x, ctx));
      if (FUNCTIONS.has(name)) return mapCall(name, a);
      // Implicit multiplication: x(x + 1) is x*(x + 1).
      if ((GREEK.has(name) || SYMBOL.test(name) || CONSTANTS.has(name)) && a.length === 1) {
        const left = CONSTANTS.has(name) ? constantFor(name) : sym(symFor(ctx, name));
        return bin('*', left, a[0]);
      }
      throw new CalcError(`Unknown function '${name}'.`, 'NameError');
    }
    default:
      throw new CalcError('Unsupported syntax. Use plain expressions such as x**2 + sin(x).', 'SyntaxError');
  }
}

/** SymPy-syntax text -> internal tree. */
export function parseUser(text: string, ctx: Ctx): MathNode {
  let node: MathNode;
  try {
    node = parse(text.replace(/\*\*/g, '^'));
  } catch (e) {
    throw new CalcError(`could not parse '${text.trim().slice(0, 80)}': ${(e as Error).message}`, 'SyntaxError');
  }
  return mapUser(node, ctx);
}

const numText = (v: number): string => {
  const s = String(v);
  if (!/e/i.test(s)) return s;
  const [m, e] = s.split(/e/i);
  return `(${m}*10^(${Number(e)}))`;
};

/** Internal tree -> nerdamer input, fully bracketed. */
export function toNerd(node: MathNode): string {
  switch (kind(node)) {
    case 'ConstantNode':
      return numText(valueOf(node));
    case 'SymbolNode':
      return nameOf(node);
    case 'ParenthesisNode':
      return toNerd((node as Any).content);
    case 'OperatorNode': {
      const a = argsOf(node);
      if (fnName(node) === 'unaryMinus') return `(-(${toNerd(a[0])}))`;
      if (fnName(node) === 'unaryPlus') return toNerd(a[0]);
      if (fnName(node) === 'factorial') return `fact(${toNerd(a[0])})`;
      const o = opOf(node) === ' ' ? '*' : opOf(node);
      return `(${toNerd(a[0])})${o}(${toNerd(a[1])})`;
    }
    case 'FunctionNode':
      return `${fnName(node)}(${argsOf(node).map(toNerd).join(',')})`;
    default:
      throw new CalcError('Unsupported expression.');
  }
}

/** True when nerdamer gave the problem back unsolved. */
export const unevaluated = (text: string): boolean => /\b(integrate|limit|defint|diff)\(/.test(text);

function clean(node: MathNode): MathNode {
  switch (kind(node)) {
    case 'ParenthesisNode':
      return clean((node as Any).content);
    case 'OperatorNode': {
      const a = argsOf(node).map(clean);
      const fn = fnName(node);
      if (fn === 'unaryMinus') return neg(a[0]);
      if (fn === 'unaryPlus') return a[0];
      if (fn === 'factorial') return call('fact', a);
      const o = { add: '+', subtract: '-', multiply: '*', divide: '/', pow: '^' }[fn];
      if (!o) throw new CalcError(`Unexpected operator in a result: ${opOf(node)}`);
      return bin(o, a[0], a[1]);
    }
    case 'FunctionNode':
      return call(fnName(node), argsOf(node).map(clean));
    case 'ConstantNode': {
      // mathjs reads "Infinity" as a number; keep it a symbol so it prints as oo / \infty.
      const v = valueOf(node);
      if (v === Infinity) return sym('Infinity');
      if (v === -Infinity) return neg(sym('Infinity'));
      return node;
    }
    case 'SymbolNode':
      return node;
    default:
      throw new CalcError('Unexpected result shape.');
  }
}

/** nerdamer output text -> internal tree. */
export function fromNerd(text: string): MathNode {
  if (unevaluated(text)) throw new CalcError('unevaluated', 'Unevaluated');
  return clean(parse(text.replace(/\bInf\b/g, 'Infinity')));
}

/** The user symbols (internal names) in a tree, sorted by their user names. */
export function freeSymbols(node: MathNode, ctx: Ctx): string[] {
  const out = new Set<string>();
  node.traverse((n) => {
    if (kind(n) === 'SymbolNode' && INTERNAL.test(nameOf(n))) out.add(nameOf(n));
  });
  return [...out].sort((a, b) => (ctx.toUser.get(a) ?? a).localeCompare(ctx.toUser.get(b) ?? b));
}

export const hasNode = (node: MathNode, test: (n: MathNode) => boolean): boolean => {
  let found = false;
  node.traverse((n) => {
    if (!found && test(n)) found = true;
  });
  return found;
};
