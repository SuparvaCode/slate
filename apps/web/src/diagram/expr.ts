/**
 * A small maths expression parser for graph diagrams: + - * / ^, brackets, implicit
 * multiplication (2x, 3sin(x), x(x+1)), the usual functions, pi and e. It compiles to a plain
 * function of x, so plotting never evaluates text as code.
 */

type F = (x: number) => number;

const FUNCS: Record<string, (v: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log10, floor: Math.floor,
  sec: (v) => 1 / Math.cos(v), csc: (v) => 1 / Math.sin(v), cot: (v) => 1 / Math.tan(v),
};

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function lex(src: string): Tok[] {
  const s = src.replace(/\*\*/g, '^').replace(/[−–]/g, '-').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/π/g, 'pi');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^\d*\.?\d+(?:e[+-]?\d+)?|^\d+\.?/i.exec(s.slice(i))!;
      out.push({ t: 'num', v: parseFloat(m[0]) });
      i += m[0].length;
    } else if (/[a-z]/i.test(c)) {
      const m = /^[a-z]+/i.exec(s.slice(i))!;
      // "xsin" or "2pix": split known names off the front.
      let word = m[0].toLowerCase();
      while (word) {
        const name = ['asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'sqrt', 'floor', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'abs', 'exp', 'log', 'ln', 'pi']
          .find((n) => word.startsWith(n)) ?? word[0];
        out.push({ t: 'id', v: name });
        word = word.slice(name.length);
      }
      i += m[0].length;
    } else if ('+-*/^(),'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
    } else {
      throw new Error(`Unexpected "${c}"`);
    }
  }
  return out;
}

/** Compiles "x^2 - 4" (an optional "y =" in front is ignored) into a function of x. */
export function compile(src: string): F {
  const body = src.replace(/^\s*(?:y|f\s*\(\s*x\s*\))\s*=/i, '');
  const toks = lex(body);
  let i = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const startsFactor = () => {
    const k = peek();
    return !!k && (k.t === 'num' || k.t === 'id' || (k.t === 'op' && k.v === '('));
  };

  const expr = (): F => {
    let left = term();
    while (isOp('+') || isOp('-')) {
      const op = toks[i++].v;
      const l = left;
      const r = term();
      left = op === '+' ? (x) => l(x) + r(x) : (x) => l(x) - r(x);
    }
    return left;
  };
  const term = (): F => {
    let left = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = toks[i++].v;
        const l = left;
        const r = unary();
        left = op === '*' ? (x) => l(x) * r(x) : (x) => l(x) / r(x);
      } else if (startsFactor()) {
        const l = left;
        const r = power();
        left = (x) => l(x) * r(x);
      } else return left;
    }
  };
  const unary = (): F => {
    if (isOp('-')) {
      i++;
      const f = unary();
      return (x) => -f(x);
    }
    if (isOp('+')) {
      i++;
      return unary();
    }
    return power();
  };
  const power = (): F => {
    const base = atom();
    if (isOp('^')) {
      i++;
      const ex = unary();
      return (x) => Math.pow(base(x), ex(x));
    }
    return base;
  };
  const atom = (): F => {
    const k = toks[i++];
    if (!k) throw new Error('The expression ends too early');
    if (k.t === 'num') return () => k.v;
    if (k.t === 'op' && k.v === '(') {
      const f = expr();
      if (!isOp(')')) throw new Error('Missing ")"');
      i++;
      return f;
    }
    if (k.t === 'id') {
      if (k.v === 'x') return (x) => x;
      if (k.v === 'pi') return () => Math.PI;
      if (k.v === 'e') return () => Math.E;
      const fn = FUNCS[k.v];
      if (fn) {
        // sin x and sin(x) both work; "sin^2 x" is sin(x)^2.
        let exp: F | null = null;
        if (isOp('^')) {
          i++;
          exp = atom();
        }
        const arg = isOp('(') ? atom() : power();
        return exp ? (x) => Math.pow(fn(arg(x)), exp!(x)) : (x) => fn(arg(x));
      }
      throw new Error(`Unknown name "${k.v}"`);
    }
    throw new Error(`Unexpected "${k.v}"`);
  };

  const f = expr();
  if (i < toks.length) throw new Error(`Unexpected "${toks[i].v}"`);
  return f;
}

/** Null when the expression does not parse. */
export function tryCompile(src: string): F | null {
  try {
    return compile(src);
  } catch {
    return null;
  }
}
