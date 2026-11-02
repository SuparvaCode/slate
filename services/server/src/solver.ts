/**
 * Solves what the user wrote, using the calculator, and reports each step as it happens. Port of
 * solver.py. The model may not finish a computed answer without having used the calculator.
 */
import { performance } from 'node:perf_hooks';
import {
  cleanColumns, endsWithEquals, endsWithQuestion, exprFromLatex, nameUnknown, pyStr, questionUnknown, splitChains, trimChain,
} from './answers.ts';
import { calculator } from './calc.ts';
import { env } from './env.ts';
import { SolveError, type Event } from './errors.ts';
import { NO_KEY } from './groq.ts';
import { repairLatexJson } from './jsonfix.ts';
import { POOL } from './keys.ts';
import { CALC_TOOL, COMPUTING, FINISH_TOOL, MAX_CALCS, MAX_TURNS, MODE_ANSWER, MODE_SOLUTION, SYSTEM, TARGET_OPS, TURN_TOKENS } from './solver-prompt.ts';
import { explabsReady } from './explabs.ts';
import { requestThought, thoughtRoom } from './thought.ts';
import { Limited, streamTurn, Unreachable, type Turn, type TurnStream } from './solver-stream.ts';
import { calcAnswer, compact, continuation, dropRestated, numericMatches, sameText, verifyAnswer, withConstant, type Target } from './solver-verify.ts';
import { toolModel } from './runtime.ts';

export { calcAnswer, continuation, dropRestated, numericMatches, verifyAnswer, withConstant } from './solver-verify.ts';

/** The model turn; tests replace it with a scripted one. */
export const hooks: { turn: TurnStream } = { turn: streamTurn };

const json = (v: unknown) => JSON.stringify(v);

export async function* solve(read: Record<string, any>, mode: string, context = '', signal?: AbortSignal): AsyncGenerator<Event> {
  const model = toolModel('solve') || env('SLATE_SOLVE_MODEL') || env('SLATE_RECOGNIZE_MODEL', 'qwen/qwen3.8-27b');
  const key = POOL.take(model);
  if (!key) throw new SolveError(NO_KEY);
  // Takes over when Groq is limited or down: Claude Haiku on Experiential Labs, which reasons and
  // reads images (SLATE_SOLVE_BACKUP= to turn it off).
  const backup = explabsReady() ? (process.env.SLATE_SOLVE_BACKUP ?? 'claude-haiku-5.5').trim() : '';
  let onBackup = false;

  const written: string = read.latex || read.text || '';
  let user = `The user wrote (transcribed from handwriting):\n${written}`;
  if (read.sketch_description) user += `\nDrawing: ${read.sketch_description}`;
  if (read.uncertain?.length) user += `\nThe reader was unsure about: ${read.uncertain.join('; ')}`;
  if (context) user += `\nEarlier work on this board, for continuity only (do not answer it again): ${context}`;

  const messages: Record<string, unknown>[] = [
    { role: 'system', content: `${SYSTEM}\n\n${mode === 'solution' ? MODE_SOLUTION : MODE_ANSWER}` },
    { role: 'user', content: user },
  ];
  const refuse = (id: string, text: string) => messages.push({ role: 'tool', tool_call_id: id, content: json({ error: text }) });

  let usedCalc = 0;
  let checked = false; // a 'check' call confirmed something
  let target: Target | null = null; // the latest result the written answer is compared with
  let nudged = false;
  let fixed = false;
  const numerics: string[] = []; // numeric results, which can confirm a matching answer
  const unknown = questionUnknown(written);
  let calcCalls = 0;
  const waited = [0];

  // The model stopped early but the calculator already has the result: that result is the answer.
  const calcFallback = (): Event | null => {
    if (!target || !COMPUTING.has(target.op)) return null;
    const latex = calcAnswer(target);
    if (!latex) return null;
    let answerLatex = continuation(written, latex);
    if (endsWithQuestion(written)) answerLatex = nameUnknown(written, answerLatex);
    return {
      type: 'answer', answer_latex: answerLatex, columns: [], steps: [],
      placement: endsWithQuestion(written) || (mode === 'solution' && !endsWithEquals(written)) ? 'below' : 'inline',
      note: "The model stopped before writing its answer, so this is the calculator's result.",
      verified: true, verification: 'computed', trace: { fallback: 'calculator', target_op: target.op },
    };
  };

  // Solving is the work the AI thought level is really for: an explanation that takes more thought
  // gets room for its reasoning, and "No thoughts" turns the model's own trace off.
  const thought = requestThought() ?? 'none';
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const forceFinish = turn === MAX_TURNS - 1 || calcCalls >= MAX_CALCS;
    const body = {
      model, messages, tools: [CALC_TOOL, FINISH_TOOL],
      // Every turn must be a tool call, so the loop always moves toward finish.
      tool_choice: forceFinish ? { type: 'function', function: { name: 'finish' } } : 'required',
      max_tokens: TURN_TOKENS + thoughtRoom(thought), stream: true,
      reasoning_effort: thought,
      ...(thought === 'none' ? {} : { reasoning_format: 'hidden' }),
    };
    let result: Turn | null = null;
    for (;;) {
      // Set once the student has seen something from this turn: from then on it cannot change model.
      let started = false;
      try {
        // reasoning_format is Groq-only; the backup model gets the level without it.
        const forBackup = { ...body } as Record<string, unknown>;
        delete forBackup.reasoning_format;
        const turnBody = onBackup
          ? { ...forBackup, model: backup, max_tokens: TURN_TOKENS + 1500 + thoughtRoom(thought) }
          : body;
        const opts = onBackup ? { explabs: true } : { noWait: !!backup };
        for await (const ev of hooks.turn(onBackup ? '' : POOL.take(model) ?? key, turnBody, waited, signal, opts)) {
          if (ev.type === 'turn') result = ev as Turn;
          else {
            started = true;
            yield ev as Event;
          }
        }
        break;
      } catch (e) {
        // Groq limited or down before anything was shown: the backup model takes this turn and the
        // rest of the solve. Its answer goes through the same calculator checks.
        if (!onBackup && backup && !started && (e instanceof Limited || e instanceof Unreachable)) {
          onBackup = true;
          console.warn(`[solve] ${model} unavailable (${(e as Error).message}); using ${backup}`);
          continue;
        }
        // A rate limit or dropped connection after the calculator already has the result.
        const fb = e instanceof SolveError ? calcFallback() : null;
        if (fb) {
          yield fb;
          return;
        }
        throw e;
      }
    }
    if (!result || !result.calls.length) {
      const fb = calcFallback();
      if (fb) {
        yield fb;
        return;
      }
      throw new SolveError('The model stopped without an answer.');
    }

    messages.push({
      role: 'assistant',
      content: result.content || null,
      tool_calls: result.calls.map((c, i) => ({ id: c.id || `call_${turn}_${i}`, type: 'function', function: { name: c.name, arguments: c.args || '{}' } })),
    });

    for (const [i, call] of result.calls.entries()) {
      const callId = call.id || `call_${turn}_${i}`;
      let args: Record<string, any>;
      try {
        args = JSON.parse(repairLatexJson(call.args || '{}'));
        if (typeof args !== 'object' || args === null || Array.isArray(args)) throw new Error('not an object');
      } catch {
        messages.push({ role: 'tool', tool_call_id: callId, content: json({ error: 'Arguments were not valid JSON.' }) });
        continue;
      }

      if (call.name === 'finish') {
        const computes = read.kind !== 'text' && read.intent !== 'note';
        const rawLatex = pyStr(args.answer_latex || '');
        let answerLatex = continuation(written, rawLatex);
        let columns = mode === 'solution' ? cleanColumns(args.columns) : [];
        let steps = splitChains(dropRestated(written, (Array.isArray(args.steps) ? args.steps : []).map(pyStr).filter((s: string) => s.trim())));
        let note = pyStr(args.note || '');
        answerLatex = trimChain(written, answerLatex);
        const answerExpr = pyStr(args.answer_expr || '').trim() || exprFromLatex(answerLatex);
        let verification = 'none';
        let traceVerdict: boolean | null = null;

        if (computes) {
          if (usedCalc === 0 && !forceFinish) {
            refuse(callId, 'Not accepted: compute the answer with calc first, then call finish.');
            continue;
          }
          let [verdict, shown] = await verifyAnswer(target, answerExpr, unknown);
          traceVerdict = verdict;
          const writtenValue = exprFromLatex(answerLatex);
          if (verdict === null && numerics.some((n) => [answerExpr, writtenValue].some((c) => c && numericMatches(n, c)))) verdict = true;
          // Each of these asks once only: every extra turn spends the free-tier tokens.
          if (verdict === null && target && !answerExpr && !nudged && !forceFinish) {
            nudged = true;
            refuse(callId, 'Not accepted yet: add answer_expr, your answer in SymPy syntax (no constant of integration), so it can be checked against the calculator.');
            continue;
          }
          if (verdict === false && !fixed && !forceFinish) {
            fixed = true;
            refuse(callId, `Not accepted: answer_expr does not match the calculator's result (${shown}). Use the calculator's result as it is, then call finish.`);
            continue;
          }
          if (verdict === true) verification = 'checked';
          else if (verdict === false) {
            // Still wrong after a second try: write what the calculator produced.
            const replaced = target ? calcAnswer(target) : null;
            if (replaced) {
              answerLatex = continuation(written, replaced);
              steps = [];
              verification = 'computed';
              note = "I replaced my written answer with the calculator's result, because the two did not match.";
            }
          } else if (checked) verification = 'checked';
        }

        if (computes && target && target.op === 'integrate' && !target.args.lower) {
          answerLatex = withConstant(answerLatex);
          if (steps.length) steps = [...steps.slice(0, -1), withConstant(steps[steps.length - 1])];
          // A note saying the constant was left out would now contradict the answer.
          if (/\+\s*C|constant of integration|without/i.test(note)) note = '';
        }

        let placement = ['inline', 'below', 'none'].includes(args.placement) ? args.placement : 'inline';
        // The user left a slot after "=": write into it, not a block of working below.
        const inSlot = mode === 'solution' && endsWithEquals(written) && !endsWithQuestion(written);
        if (inSlot) {
          if (!answerLatex.trim() && (steps.length || columns.length)) {
            const final = steps.length ? steps[steps.length - 1] : columns[columns.length - 1].lines.at(-1)!;
            answerLatex = continuation(written, final.replace(/^[= ]+/, '').trim());
          }
          steps = [];
          columns = [];
          if (answerLatex.trim()) placement = 'inline';
        }
        // Working never fits on the user's own line, and nothing can be written after a "?".
        if ((mode === 'solution' && (steps.length || columns.length)) || (endsWithQuestion(written) && answerLatex)) placement = 'below';
        if (endsWithQuestion(written)) answerLatex = nameUnknown(written, answerLatex);
        yield {
          type: 'answer', answer_latex: answerLatex, columns,
          steps: mode === 'solution' && !columns.length ? steps : [],
          placement, note, verified: verification !== 'none', verification,
          trace: {
            raw_answer: rawLatex, answer_expr: answerExpr, unknown, written_ends_with_question: endsWithQuestion(written),
            verdict: traceVerdict, numerics: numerics.slice(-3), target_op: target ? target.op : null,
          },
        };
        return;
      }

      if (call.name !== 'calc') {
        messages.push({ role: 'tool', tool_call_id: callId, content: json({ error: `Unknown tool ${call.name}.` }) });
        continue;
      }
      if (calcCalls >= MAX_CALCS) {
        messages.push({ role: 'tool', tool_call_id: callId, content: json({ error: 'Calculator budget used up. Call finish with what you have.' }) });
        continue;
      }
      calcCalls += 1;
      const op = pyStr(args.op || '');
      const { op: _op, ...rest } = args;
      yield { type: 'tool', id: callId, op, args: rest };
      const t0 = performance.now();
      const out = await calculator.run(op, args);
      const ms = Math.round(performance.now() - t0);
      if (!('error' in out)) {
        usedCalc += 1;
        if (op === 'check' && out.equal === true && !sameText(args.expr, args.other)) checked = true;
        if (TARGET_OPS.has(op)) target = { op, args, out };
        else if (op === 'numeric' && out.result) numerics.push(pyStr(out.result));
      }
      yield { type: 'tool_result', id: callId, result: out, ms };
      messages.push({ role: 'tool', tool_call_id: callId, content: json(compact(out)) });
    }
  }

  const fb = calcFallback();
  if (fb) {
    yield fb;
    return;
  }
  throw new SolveError('The solver ran out of steps before finishing.');
}
