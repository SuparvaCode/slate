/**
 * /api/solve's event stream, as in main.py: read, think, tool, tool_result, wait, answer, error.
 * The stream always ends with answer or error, so the client never waits on a dead request.
 */
import { performance } from 'node:perf_hooks';
import { looksLikeMath, plainText } from './answers.ts';
import { isMock } from './env.ts';
import { RecognitionError, SolveError, isAbort, type Event } from './errors.ts';
import { mockSolve } from './mock.ts';
import { recognize } from './recognize.ts';
import { saveSample } from './samples.ts';
import { solve } from './solver.ts';

export interface SolveInput {
  b64: string;
  raw: Buffer;
  mode: 'answer' | 'solution';
  readLatex: string | null;
  context: string;
  owner: string;
}

export async function* solveEvents(req: SolveInput, signal: AbortSignal): AsyncGenerator<Event> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  const corrected = !!(req.readLatex && req.readLatex.trim());
  let read: Record<string, any>;
  let model: string;
  if (corrected) {
    const typed = req.readLatex!.trim();
    const isMath = looksLikeMath(typed);
    read = {
      kind: isMath ? 'math' : 'text', latex: isMath ? typed : '', text: isMath ? '' : plainText(typed),
      sketch_description: '', intent: isMath ? 'solve' : 'note', answer_latex: '', answer_text: '',
      placement: isMath ? 'inline' : 'none', steps: [], alternatives: [], uncertain: [], confidence: 1.0,
    };
    model = 'you';
  } else {
    try {
      [read, model] = await recognize(req.b64, signal);
    } catch (e) {
      if (isAbort(e)) throw e;
      yield { type: 'error', message: e instanceof RecognitionError ? e.message : 'The image could not be read.' };
      return;
    }
  }
  yield { type: 'read', model, result: read, corrected, ms: ms() };

  const record: Record<string, any> = { model, mode: req.mode, result: read, trace: [] };
  if (corrected) record.corrected_latex = read.latex;
  let answer: Record<string, any> | null = null;
  let error: string | null = null;

  // Nothing to work out: a note, a sketch, or writing the reader could not make sense of.
  if (read.placement === 'none' && !read.latex) {
    answer = { type: 'answer', answer_latex: '', steps: [], placement: 'none', note: 'Nothing to solve here.', verified: false, verification: 'none' };
  } else {
    const stream = isMock() ? mockSolve(read, req.mode) : solve(read, req.mode, req.context, signal);
    try {
      for await (const ev of stream) {
        if (ev.type === 'answer') {
          answer = ev;
          break;
        }
        if (ev.type === 'tool' || ev.type === 'tool_result') record.trace.push(ev);
        yield ev;
      }
    } catch (e) {
      if (isAbort(e) || signal.aborted) throw e;
      error = e instanceof SolveError ? e.message : `Solver failed: ${(e as Error)?.name ?? 'Error'}`;
    }
    if (answer === null && (read.answer_latex || read.answer_text)) {
      // The solver could not finish; fall back to the reader's own answer, unchecked.
      answer = {
        type: 'answer', answer_latex: read.answer_latex ?? '', steps: [], placement: read.placement || 'inline',
        note: error ? `Not checked with the calculator (${error}).` : '', verified: false, verification: 'none',
      };
    }
  }

  if (answer === null) {
    yield { type: 'error', message: error || 'No answer was produced.' };
    return;
  }
  answer.ms = ms();
  record.answer = answer;
  const [id, saved] = await saveSample(req.raw, record, req.owner);
  answer.id = id;
  answer.saved = saved;
  yield answer as Event;
}
