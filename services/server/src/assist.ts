/**
 * Small helpers for the workspace: a short title for a slate from what is on it, and a practice
 * question like one the student got wrong. Both are one Groq JSON call with no tools.
 */
import { env, isMock } from './env.ts';
import { groqChoice } from './groq.ts';
import { HttpError } from './http.ts';
import { repairLatexJson } from './jsonfix.ts';
import { toolModel } from './runtime.ts';
import { requestThought, thoughtRoom } from './thought.ts';

const MAX_WAIT_S = 15;
const fail = (message: string, status = 502) => new HttpError(status, message);

async function askJson(
  system: string, content: unknown, signal?: AbortSignal, maxTokens = 400, thinking = false,
): Promise<Record<string, unknown>> {
  const model = toolModel('assist') || env('SLATE_ASSIST_MODEL') || env('SLATE_RECOGNIZE_MODEL', 'qwen/qwen3.8-27b');
  // Naming a board copies what is there and stays quick; a practice question is written work and
  // follows the student's AI thought level.
  const reasoning = thinking ? (requestThought() ?? 'none') : 'none';
  const choice = await groqChoice(
    {
      model,
      max_tokens: maxTokens + thoughtRoom(reasoning),
      temperature: 0.4,
      reasoning_effort: reasoning,
      ...(reasoning === 'none' ? {} : { reasoning_format: 'hidden' }),
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content },
      ],
    },
    { maxWaitS: MAX_WAIT_S, fail, signal },
  );
  let text = String(choice.message?.content ?? '').trim();
  if (text.startsWith('```')) text = text.replace(/^`+(json)?|`+$/g, '').trim();
  try {
    const data = JSON.parse(repairLatexJson(text));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw fail('The model returned malformed JSON.');
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

const TITLE_SYSTEM = `You name a student's whiteboard, like the title of a chat.
Give a short, specific title (2 to 6 words) for what the student is working on, using school-topic words,
for example "Quadratic equations practice", "Ohm's law circuits", "Sketch of a castle".
No quotes, no emoji, no trailing full stop. If the board is empty or unreadable, use "Untitled slate".
Return JSON: {"title": string}`;

/** A 2-6 word title from a picture of the board and any text already read from it. */
export async function slateTitle(pngB64: string | null, hints: string[], signal?: AbortSignal): Promise<string> {
  if (isMock()) return 'Practice slate';
  const text = hints.length ? `Already read from the board: ${hints.join(' | ')}` : 'Name this board.';
  const content = pngB64
    ? [{ type: 'image_url', image_url: { url: `data:image/png;base64,${pngB64}` } }, { type: 'text', text }]
    : text;
  const data = await askJson(TITLE_SYSTEM, content, signal, 60);
  const title = str(data.title, 60).replace(/^["'“]|["'”.]$/g, '');
  return title || 'Untitled slate';
}

const PRACTICE_SYSTEM = `You write one practice question for a school student who got a question wrong.
Make a NEW question that practises the same skill with different numbers or a different setting, at the same level.
Give its final answer and one short hint that points at the idea, not the method.
Write maths in LaTeX without $ signs. Keep the question under 200 characters.
Return JSON: {"question_latex": string, "question_text": string, "answer_latex": string, "hint": string}
Use question_latex for pure maths and question_text for word problems (leave the other empty).`;

export interface Practice {
  question_latex: string;
  question_text: string;
  answer_latex: string;
  hint: string;
}

export async function practiceLike(question: string, answer: string, note: string, signal?: AbortSignal): Promise<Practice> {
  if (isMock()) return { question_latex: '3x + 4 = 19', question_text: '', answer_latex: 'x = 5', hint: 'Undo the + 4 first.' };
  let user = `The question: ${question}`;
  if (answer) user += `\nIts correct answer: ${answer}`;
  if (note) user += `\nWhat the student did wrong: ${note}`;
  const data = await askJson(PRACTICE_SYSTEM, user, signal, 500, true);
  const out: Practice = {
    question_latex: str(data.question_latex, 400),
    question_text: str(data.question_text, 400),
    answer_latex: str(data.answer_latex, 300),
    hint: str(data.hint, 200),
  };
  if (!out.question_latex && !out.question_text) throw fail('The model did not write a question.');
  return out;
}
