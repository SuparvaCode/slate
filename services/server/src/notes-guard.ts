/**
 * The silent guard: checks a section of notes before it reaches the board. The student never sees it.
 *
 * 1. The calculator works every worked example through: each step that is a plain number must
 *    equal the step before it. This costs nothing and catches the arithmetic slips models make.
 * 2. Jev (Experiential Labs systemone) is asked whether the section is supported by what it was
 *    written from (the video's words or the research). It is a second opinion: when it cannot
 *    answer, the section goes through.
 *
 * notes.ts rewrites a section once with the problems found, then drops any example that still fails.
 */
import { evaluate } from 'mathjs';
import { env } from './env.ts';
import { jevChoice } from './explabs.ts';
import type { Block } from './notes.ts';

const EQ_SPLIT = /=|\\approx/;

function plain(latex: string): string {
  return latex
    .replace(/\\(?:text|mathrm|operatorname)\s*\{[^{}]*\}/g, ' ')
    .replace(/\\(?:,|;|:|!|quad|qquad| )|~/g, ' ')
    .replace(/\\left|\\right/g, '');
}

/**
 * The value side of a LaTeX step (after its last "=") as plain arithmetic, or '' when it has
 * letters, so "F \times d" and "\frac12 m v^2" are never read as numbers. A unit is only taken
 * off a bare number: "18 J" is 18, "5 N m" is 5.
 */
export function numericOf(latex: string): string {
  let t = plain(latex).split(EQ_SPLIT).pop() ?? '';
  for (let i = 0; i < 4 && /\\[dt]?frac\s*\{/.test(t); i++) t = t.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))');
  t = t
    .replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)')
    .replace(/\\times|\\cdot|×/g, '*')
    .replace(/\\div|÷/g, '/')
    .replace(/\^\s*\{([^{}]*)\}/g, '^($1)')
    .replace(/[{}]/g, ' ')
    .replace(/(\d),(\d{3})\b/g, '$1$2')
    .trim();
  const unit = /^(-?\d+(?:\.\d+)?)\s+[A-Za-z]{1,4}(?:\s*[/^]?\s*[A-Za-z0-9]{1,4})*$/.exec(t);
  if (unit) return unit[1];
  if (!/\d/.test(t) || !/^(?:sqrt|[0-9+\-*/^().\s])+$/.test(t)) return '';
  return t;
}

function value(latex: string): number | null {
  const expr = numericOf(latex);
  if (!expr) return null;
  try {
    const v = evaluate(expr);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** What a step is about: "KE" for "KE = ...", '' for a step that carries on the one before ("= 9"). */
const lhsOf = (latex: string): string => {
  const parts = plain(latex).split(EQ_SPLIT);
  return parts.length > 1 ? parts[0].replace(/\s+/g, '') : '';
};

const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(1e-6, Math.abs(b) * 0.011);

/**
 * Arithmetic slips in the worked examples. Only steps of one chain are compared: a step that
 * starts with "=" carries on the one before, while "v = 10" after "v^2 = 100" starts a new chain.
 */
export function exampleSlips(blocks: Block[]): { index: number; problem: string }[] {
  const out: { index: number; problem: string }[] = [];
  blocks.forEach((b, index) => {
    if (b.t !== 'ex') return;
    let chain = '';
    let prev: { v: number; step: string } | null = null;
    for (const step of b.steps) {
      const lhs = lhsOf(step);
      if (lhs && lhs !== chain) {
        chain = lhs;
        prev = null;
      }
      const v = value(step);
      if (v === null) continue;
      if (prev && !close(v, prev.v)) {
        out.push({ index, problem: `In the example "${b.q.slice(0, 80)}", "${prev.step}" works out to ${+prev.v.toPrecision(6)}, but the next step says "${step}".` });
        break;
      }
      prev = { v, step };
    }
  });
  return out;
}

/** The section as plain lines, for the reviewer. */
export function sectionText(blocks: Block[]): string {
  return blocks
    .map((b) => {
      switch (b.t) {
        case 'h':
        case 'p':
        case 'key':
          return b.text.replace(/\*/g, '');
        case 'f':
          return `${b.label ? `${b.label}: ` : ''}${b.latex}`;
        case 'list':
        case 'q':
          return b.items.join('; ');
        case 'table':
          return [b.head.join(' | '), ...b.rows.map((r) => r.join(' | '))].join('; ');
        case 'sketch':
          return `diagram: ${b.caption}`;
        case 'ex':
          return `example: ${b.q} ${b.steps.join(' ; ')}`;
      }
    })
    .join('\n')
    .slice(0, 3000);
}

const guardOn = () => env('SLATE_NOTES_GUARD', '1') !== '0';

/**
 * Problems in a section, in words the writer can act on. Empty when it passed (or could not be
 * checked). `source` is what the section was written from.
 */
export async function reviewSection(
  blocks: Block[],
  ctx: { heading: string; goal: string; board: string; grade: string; source: string },
  signal?: AbortSignal,
): Promise<string[]> {
  if (!guardOn()) return [];
  const problems = exampleSlips(blocks).map((s) => s.problem);
  // The calculator already found something certain: Jev's view is not needed to rewrite.
  if (problems.length) return problems;
  const jev = await jevChoice(
    {
      task: `Check a section of handwritten study notes for a ${ctx.board} class ${ctx.grade || '?'} student before they see it.`,
      section: `${ctx.heading}: ${ctx.goal}`,
      notes: sectionText(blocks),
      source: ctx.source.slice(0, 4000) || 'No source: standard textbook knowledge for this class.',
    },
    {
      instructions:
        'Are the notes correct and supported by the source or by standard textbook knowledge for this class? ' +
        'Check every fact, formula, SI unit and number. Treat a claim about what the video says that the source does not contain as unsupported.',
      criteria: {
        pass: 'Every fact, formula, unit and number is correct and supported.',
        fix: 'Something is wrong, made up, or not supported by the source.',
      },
    },
    signal,
  );
  if (jev && jev.choice === 'fix' && (jev.probabilities.fix ?? jev.confidence) >= 0.6) {
    problems.push('A reviewer found something in this section that is wrong or not supported by the source. Check every fact, formula, unit and number against the source, and remove anything you cannot support.');
  }
  return problems;
}
