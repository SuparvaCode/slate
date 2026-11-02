/** SLATE_MOCK=1: canned model output that still uses the real calculator, for UI testing. */
import { performance } from 'node:perf_hooks';
import { calculator } from './calc.ts';
import type { Event } from './errors.ts';

export const MOCK_RESULT = {
  kind: 'math',
  latex: '2x + 5 = 13',
  text: '',
  sketch_description: '',
  intent: 'solve',
  answer_latex: 'x = 4',
  answer_text: '',
  placement: 'inline',
  steps: [] as string[],
  uncertain: [] as string[],
  alternatives: ['2x + 5 = 18'],
  confidence: 0.95,
};

/** Same events as main.py's _mock_solve. */
export async function* mockSolve(_read: Record<string, unknown>, mode: string): AsyncGenerator<Event> {
  yield { type: 'think', delta: "This is a linear equation in x. I'll solve it exactly.\n" };
  yield { type: 'tool', id: 'mock1', op: 'solve', args: { expr: '2*x + 5 = 13', var: 'x' } };
  const t0 = performance.now();
  const out = await calculator.run('solve', { expr: '2*x + 5 = 13', var: 'x' });
  yield { type: 'tool_result', id: 'mock1', result: out, ms: Math.round(performance.now() - t0) };
  yield { type: 'think', delta: 'The calculator gives x = 4.\n' };
  const steps = mode === 'solution' ? ['2x + 5 = 13', '2x = 13 - 5', '2x = 8', 'x = 4'] : [];
  yield {
    type: 'answer',
    answer_latex: 'x = 4',
    steps,
    placement: steps.length ? 'below' : 'inline',
    note: '',
    verified: true,
    columns: [],
    verification: 'computed',
  };
}
