/**
 * AI diagrams: the model writes a diagram in Slate's JSON format, using only library parts.
 * Port of diagram.py. The web app validates the result and solves it.
 */
import { performance } from 'node:perf_hooks';
import { env, isMock } from './env.ts';
import { DiagramError } from './errors.ts';
import { groqChoice } from './groq.ts';
import { sleep } from './keys.ts';
import { lookup as lookupMolecule } from './molecule.ts';
import { EXAMPLE, SYSTEM, mockDiagram, pyCompact } from './diagram-prompt.ts';
import { toolModel } from './runtime.ts';
import { requestThought, thoughtRoom } from './thought.ts';

const MAX_RATE_LIMIT_WAIT_S = 20;

type Json = Record<string, unknown>;

export function userMessage(prompt: string, previous: Json | null, feedback: string, issues: string[], context: string): string {
  let out = `Draw this: ${prompt.trim()}`;
  if (context) out += `\nEarlier work on this board, for continuity only: ${context.trim()}`;
  if (previous && Object.keys(previous).length) out += `\n\nYour previous diagram:\n${pyCompact(previous)}`;
  if (issues.length) out += `\n\nThe app found these problems. Fix all of them:\n- ${issues.slice(0, 12).join('\n- ')}`;
  if (feedback) out += `\n\nThe student wants this changed: ${feedback.trim()}`;
  if (previous && Object.keys(previous).length && !issues.length && !feedback) out += '\n\nDraw it again with a different, cleaner layout.';
  return out;
}

export function parseDiagram(raw: string): Json {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^`+|`+$/g, '');
    if (text.startsWith('json')) text = text.slice(4);
    text = text.trim();
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new DiagramError('The model returned malformed JSON.');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new DiagramError('The model returned malformed JSON.');
  const inner = (data as Json).diagram;
  return typeof inner === 'object' && inner !== null && !Array.isArray(inner) ? (inner as Json) : (data as Json);
}

/** Returns [diagram JSON, model, ms]. The JSON is unvalidated; the app checks it. */
export async function build(
  prompt: string, previous: Json | null = null, feedback = '', issues: string[] = [], context = '', signal?: AbortSignal,
): Promise<[Json, string, number]> {
  const started = performance.now();
  const ms = () => Math.round(performance.now() - started);
  if (isMock()) {
    await sleep(1.2, signal);
    return [mockDiagram(prompt), 'mock', ms()];
  }

  // A named compound comes from PubChem's real 2D layout; changes to it still go to the model.
  if (previous === null && !feedback && !issues.length) {
    const found = await lookupMolecule(prompt, signal);
    if (found) return [found, 'pubchem', ms()];
  }

  const model = toolModel('diagram') || env('SLATE_DIAGRAM_MODEL') || env('SLATE_RECOGNIZE_MODEL', 'qwen/qwen3.8-27b');
  const hasPrevious = !!previous && Object.keys(previous).length > 0;
  // Drawing a diagram is planned work, so it follows the student's AI thought level.
  const reasoning = requestThought() ?? 'none';
  const body = {
    model,
    max_tokens: 3000 + thoughtRoom(reasoning),
    temperature: hasPrevious && !issues.length ? 0.4 : 0.2,
    reasoning_effort: reasoning,
    ...(reasoning === 'none' ? {} : { reasoning_format: 'hidden' }),
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: 'Draw this: an Atwood machine with 2 kg and 3 kg masses' },
      { role: 'assistant', content: pyCompact(EXAMPLE) },
      { role: 'user', content: userMessage(prompt, previous, feedback, issues, context) },
    ],
  };
  const choice = await groqChoice(body, {
    maxWaitS: MAX_RATE_LIMIT_WAIT_S,
    fail: (message, status) => new DiagramError(message, status),
    signal,
    retryNextKey: true,
  });
  if (choice.finish_reason === 'length') throw new DiagramError('The diagram was too large and got cut off. Try asking for something simpler.');
  return [parseDiagram(String(choice.message?.content ?? '')), model, ms()];
}
