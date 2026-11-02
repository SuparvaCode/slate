/** The solver's tools and prompts, copied from solver.py. */
import { OPS } from './calc.ts';

export const MAX_TURNS = 7;
/** After this many calculator calls the model must finish (free-tier input tokens per minute). */
export const MAX_CALCS = 4;
/** Total time we are willing to wait out rate limits for one solve. */
export const MAX_WAIT_S = 60;
export const TURN_TOKENS = 1200;

export const CALC_TOOL = {
  type: 'function',
  function: {
    name: 'calc',
    description:
      "Exact SymPy algebra. solve takes 'a = b' or a comma-separated system; integrate is " +
      "definite with lower/upper; limit point like '0', 'oo', '0+'; numeric takes ONE " +
      'expression (order = digits); check: is expr equal to other.',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: [...OPS] },
        expr: { type: 'string', description: 'SymPy syntax: x**2, sqrt(x), exp(x), log(x), pi, x*y.' },
        var: { type: 'string', description: 'Variable, or comma-separated unknowns.' },
        lower: { type: 'string' },
        upper: { type: 'string' },
        point: { type: 'string' },
        order: { type: 'integer' },
        other: { type: 'string', description: 'For check: the expression to compare with.' },
      },
      required: ['op', 'expr'],
    },
  },
};

export const FINISH_TOOL = {
  type: 'function',
  function: {
    name: 'finish',
    description: 'Give the final answer that will be written on the board.',
    parameters: {
      type: 'object',
      properties: {
        answer_latex: { type: 'string', description: "Only what is written after the user's last mark. Never repeat their writing." },
        answer_expr: {
          type: 'string',
          description:
            'The same answer in SymPy syntax with no constant of integration, e.g. ' +
            'x + tan(x)**3/3 - tan(x). Several results: separate with commas (2, 3). ' +
            "Copy the calculator's form; never rewrite it by hand.",
        },
        steps: { type: 'array', items: { type: 'string' }, description: 'LaTeX lines of working, ending with the answer. Empty unless asked.' },
        columns: {
          type: 'array',
          description: 'Solution mode only: side-by-side working. Up to 3 columns.',
          items: {
            type: 'object',
            properties: {
              heading: { type: 'string', description: 'Two or three words.' },
              lines: { type: 'array', items: { type: 'string' }, description: 'LaTeX, at most 6.' },
            },
            required: ['heading', 'lines'],
          },
        },
        placement: { type: 'string', enum: ['inline', 'below', 'none'] },
        note: { type: 'string', description: 'One short sentence for the user, e.g. how you read ambiguous writing.' },
      },
      required: ['answer_latex', 'answer_expr', 'steps', 'placement', 'note'],
    },
  },
};

export const SYSTEM = `You solve what a user wrote on a handwriting whiteboard. Your answer is written in handwriting where they are writing.

Rules:
- Never compute in your head: every value in your answer comes from a calc result. You have at most 4 calc calls.
- Before each tool call, write one short sentence saying what you will do. The user reads these.
- calc uses SymPy syntax: x**2, sqrt(x), exp(x), log(x) is ln, pi, E. Write products as 2*x.
- An expression with a free variable and nothing to find (like "tan^x =") is not a numeric question. Pick its most likely meaning, simplify it once, give that form, and say how you read it in note. Never evaluate it at sample values.
- answer_latex continues the user's writing: "7 + 8 =" gets "15", never "7+8=15" or "x = 15". "x^2 - 5x + 6 = 0" gets "x = 2, 3".
- Keep exact forms (\\frac{\\ln 2}{\\ln 3 - \\ln 2}, \\sqrt{2}); add \\approx and a short decimal when it helps.
- A question ending in "?" ("z = ?") is answered "z = 780" on its own line below it, not after the "?".
- placement: "inline" continues the user's line, "below" for several lines or a sentence, "none" for notes and drawings.
- finish also takes answer_expr: your answer again in SymPy syntax (no constant of integration). The server checks it against the calculator's result; copy the calculator's form instead of simplifying it by hand, because a mismatch is rejected.
- When done, call finish.`;

export const MODE_ANSWER = 'Mode: ANSWER. The user wants the result only. steps must be empty.';
export const MODE_SOLUTION =
  'Mode: SOLUTION. Exception first: when the user\'s writing ends with "=", they left room ' +
  'for the answer on that line. Then leave steps and columns empty, set placement to ' +
  '"inline", and make answer_latex only what follows the "=" (the final answer, or the ' +
  'next step when the problem needs several). Otherwise the user wants the full working. ' +
  'steps must hold every line of working as ' +
  'LaTeX, one idea per line, ending with the final answer, even for one-step problems. ' +
  'placement must be "below". answer_latex is the final answer alone. ' +
  'When the working has two or three clearly separate parts (two methods, a check, one part per ' +
  'unknown), put it in columns instead of steps: each column a two-or-three-word heading and at ' +
  'most 6 lines, the last line of the last column being the final answer. Otherwise leave columns empty. ' +
  'Keep every line short: at most one = per line, and continue a chain on a new line that ' +
  'starts with =. Do not use sizing commands such as \\left, \\right or \\big.';

/** Calculator ops whose result is itself an answer. */
export const COMPUTING = new Set(['evaluate', 'solve', 'diff', 'integrate', 'limit', 'series', 'factor', 'expand']);
/** Results the written answer can be compared with. */
export const TARGET_OPS = new Set([...COMPUTING, 'simplify']);
