/**
 * Ink image -> structured recognition, using a vision model. Port of recognize.py.
 * Providers (SLATE_PROVIDER): "groq" (OpenAI-compatible chat API) or "anthropic".
 */
import Anthropic from '@anthropic-ai/sdk';
import { pyStr } from './answers.ts';
import { env, isMock, provider } from './env.ts';
import { ClientGone, RecognitionError } from './errors.ts';
import { explabsChoice, explabsReady } from './explabs.ts';
import { groqChoice } from './groq.ts';
import { repairLatexJson } from './jsonfix.ts';
import { MOCK_RESULT } from './mock.ts';
import { RESULT_SCHEMA, SYSTEM_PROMPT } from './recognize-prompt.ts';
import { panelAnthropicKey, toolModel, toolProvider } from './runtime.ts';

/** Groq's free tier limits input tokens per minute; one wait is usually enough. */
const MAX_RATE_LIMIT_WAIT_S = 20;

export type Reading = Record<string, any>;

// LaTeX commands that start with \n, which must not be read as an escaped newline.
const N_COMMANDS =
  'abla|atural|e|earrow|eg|eq|exists|ewline|geq|gtr|i|leq|less|mid|ot|otin|' +
  'olimits|onumber|ormalsize|parallel|sim|cong|subseteq|supseteq|u|warrow';
const ESCAPED_NEWLINE = new RegExp(`(?<!\\\\)\\\\n(?!(?:${N_COMMANDS})(?![a-zA-Z]))`, 'g');

/** Models sometimes put a newline (real or as the two characters \n) in LaTeX; KaTeX needs \\. */
export function fixLineBreaks(latex: string): string {
  const text = latex.replaceAll('\r\n', '\n').replaceAll('\n', ' \\\\ ');
  const out = text.replace(ESCAPED_NEWLINE, ' \\\\ ').trim();
  // A line break or lone backslash at the very end separates nothing and is drawn as junk.
  return out.replace(/(?:\s*\\)+\s*$/, '');
}

/** Fills missing fields and fixes types, since JSON mode doesn't enforce the schema. */
export function normalize(data: Record<string, unknown>): Reading {
  const out: Reading = {};
  for (const [key, spec] of Object.entries(RESULT_SCHEMA.properties)) {
    let value: unknown = data[key];
    if (spec.type === 'string') {
      value = typeof value === 'string' ? value : '';
      const choices = 'enum' in spec ? (spec.enum as readonly string[]) : null;
      if (choices && !choices.includes(value as string)) value = choices[choices.length - 1];
    } else if (spec.type === 'array') {
      value = Array.isArray(value) ? value.map(pyStr) : [];
    } else {
      // Python's isinstance(v, (int, float)) is true for booleans too.
      value = typeof value === 'number' || typeof value === 'boolean' ? Math.min(1, Math.max(0, Number(value))) : 0;
    }
    out[key] = value;
  }
  out.latex = fixLineBreaks(out.latex);
  out.answer_latex = fixLineBreaks(out.answer_latex);
  out.steps = (out.steps as string[]).filter((v) => v.trim()).map(fixLineBreaks);
  // Other readings: tidy, drop repeats of the main reading, and keep at most two.
  const seen = new Set([out.latex.replaceAll(' ', '')]);
  const alternatives: string[] = [];
  for (const raw of out.alternatives as string[]) {
    const alt = fixLineBreaks(raw);
    if (alt && !seen.has(alt.replaceAll(' ', ''))) {
      seen.add(alt.replaceAll(' ', ''));
      alternatives.push(alt);
    }
  }
  out.alternatives = alternatives.slice(0, 2);

  // Placement decides where the answer is written, so a bad value must not mean "write nothing".
  const hasAnswer = !!(out.answer_latex || out.answer_text);
  if (!RESULT_SCHEMA.properties.placement.enum.includes(data.placement as 'none')) {
    out.placement = !hasAnswer ? 'none' : out.steps.length ? 'below' : 'inline';
  } else if (!hasAnswer && !out.steps.length) {
    out.placement = 'none';
  } else if (out.steps.length && out.placement === 'inline') {
    // Several lines of working never fit on the user's own line.
    out.placement = 'below';
  }
  if (!RESULT_SCHEMA.properties.kind.enum.includes(data.kind as 'math')) out.kind = out.latex ? 'math' : 'text';
  return out;
}

export function parseJson(raw: string): Reading {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^`+|`+$/g, '');
    if (text.startsWith('json')) text = text.slice(4);
    text = text.trim();
  }
  let data: unknown;
  try {
    data = JSON.parse(repairLatexJson(text));
  } catch {
    throw new RecognitionError('The model returned malformed JSON.', 502);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new RecognitionError('The model returned malformed JSON.', 502);
  return normalize(data as Record<string, unknown>);
}

const fail = (message: string, status = 502) => new RecognitionError(message, status);

async function recognizeGroq(pngB64: string, signal?: AbortSignal): Promise<[Reading, string]> {
  const model = toolModel('recognize') || env('SLATE_RECOGNIZE_MODEL', 'qwen/qwen3.8-27b');
  const body = {
    model,
    max_tokens: 2000,
    // Copying down what is written wants the likeliest reading every time, not a varied one.
    // The AI thought level is deliberately not applied here: reading is copying, not thinking.
    temperature: 0,
    reasoning_effort: 'none',
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\nReturn only a JSON object with these keys: ${RESULT_SCHEMA.required.join(', ')}` },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:image/png;base64,${pngB64}` } },
          { type: 'text', text: 'Read this whiteboard region.' },
        ],
      },
    ],
  };
  // Groq limited or down: Claude Haiku on Experiential Labs reads the image instead of the student
  // waiting (SLATE_RECOGNIZE_BACKUP= to turn it off). If that fails too, Groq is waited for as before.
  const backup = explabsReady() ? (process.env.SLATE_RECOGNIZE_BACKUP ?? 'claude-haiku-5.5').trim() : '';
  let choice: any;
  try {
    choice = await groqChoice(body, { maxWaitS: backup ? 0 : MAX_RATE_LIMIT_WAIT_S, fail, signal });
  } catch (e) {
    const status = e instanceof RecognitionError ? e.status : 0;
    if (!backup || ![429, 502, 504].includes(status)) throw e;
    try {
      const { reasoning_effort: _groqOnly, ...rest } = body;
      const alt = await explabsChoice({ ...rest, model: backup, max_tokens: 4000 }, { fail, signal });
      if (alt.finish_reason !== 'length') {
        console.warn(`[recognize] ${model} unavailable (${status}); read by ${backup}`);
        return [parseJson(String(alt.message?.content ?? '')), backup];
      }
    } catch (e2) {
      if (e2 instanceof ClientGone) throw e2;
      console.error('[recognize] backup failed:', (e2 as Error)?.message);
    }
    choice = await groqChoice(body, { maxWaitS: MAX_RATE_LIMIT_WAIT_S, fail, signal });
  }
  if (choice.finish_reason === 'length') throw fail("The model's answer was cut off.");
  return [parseJson(String(choice.message?.content ?? '')), model];
}

let anthropicClient: Anthropic | null = null;

let anthropicKey = '';

function anthropic(): Anthropic {
  // A key saved in the admin panel wins over ANTHROPIC_API_KEY; a new key gets a new client.
  const key = panelAnthropicKey() || env('ANTHROPIC_API_KEY');
  if (anthropicClient && key === anthropicKey) return anthropicClient;
  anthropicKey = key;
  // Explicit values, so a stray ANTHROPIC_BASE_URL in the shell can't redirect the key.
  anthropicClient = new Anthropic({
    apiKey: key || undefined,
    baseURL: env('SLATE_ANTHROPIC_BASE_URL', 'https://api.anthropic.com'),
  });
  return anthropicClient;
}

const apiMessage = (e: InstanceType<typeof Anthropic.APIError>): string => {
  const inner = (e.error as { error?: { message?: string } } | undefined)?.error?.message;
  return inner ?? e.message;
};

async function recognizeAnthropic(pngB64: string, signal?: AbortSignal): Promise<[Reading, string]> {
  const model = toolModel('recognize') || env('SLATE_RECOGNIZE_MODEL', 'claude-opus-5-5');
  const effort = env('SLATE_RECOGNIZE_EFFORT', 'low') as 'low' | 'medium' | 'high';
  const fallbacks = (process.env.SLATE_FALLBACKS ?? '1') === '1';
  let response;
  try {
    response = await anthropic().beta.messages.create(
      {
        model,
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        output_config: { effort, format: { type: 'json_schema', schema: RESULT_SCHEMA as unknown as Record<string, unknown> } },
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngB64 } },
            { type: 'text', text: 'Read this whiteboard region.' },
          ],
        }],
        ...(fallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { signal },
    );
  } catch (e) {
    if (e instanceof Anthropic.APIUserAbortError || signal?.aborted) throw new ClientGone();
    if (e instanceof Anthropic.AuthenticationError) {
      throw fail('Model API key missing or invalid. Set ANTHROPIC_API_KEY in services/server/.env.', 500);
    }
    if (e instanceof Anthropic.RateLimitError) throw fail('Rate limited by the model API. Try again in a moment.', 429);
    if (e instanceof Anthropic.BadRequestError) throw fail(`Model API rejected the request: ${apiMessage(e)}`);
    if (e instanceof Anthropic.APIConnectionError) throw fail('Could not reach the model API.');
    if (e instanceof Anthropic.APIError) throw fail(`Model API error ${e.status}: ${apiMessage(e)}`);
    // The client throws before any request when no key can be found.
    if (e instanceof Anthropic.AnthropicError) {
      throw fail('Model API key missing or invalid. Set ANTHROPIC_API_KEY in services/server/.env.', 500);
    }
    throw e;
  }
  if (response.stop_reason === 'refusal') throw fail('The model declined to read this region.', 422);
  if (response.stop_reason === 'max_tokens') throw fail("The model's answer was cut off.");
  const text = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return [parseJson(text), response.model];
}

/** Returns [result, model used]. */
export async function recognize(pngB64: string, signal?: AbortSignal): Promise<[Reading, string]> {
  if (isMock()) return [structuredClone(MOCK_RESULT), 'mock'];
  const p = toolProvider('recognize') || provider();
  if (p === 'groq') return recognizeGroq(pngB64, signal);
  if (p === 'anthropic') return recognizeAnthropic(pngB64, signal);
  throw new RecognitionError(`Unknown SLATE_PROVIDER '${p}'. Use groq or anthropic.`, 500);
}
