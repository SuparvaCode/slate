/**
 * Study notes the AI writes on the board by hand, a section at a time.
 *
 * plan:    understand the request (board, class, subject, topic), look up the current syllabus
 *          on the web, and plan the sections. Streamed, so the app can show each stage.
 * section: one section as blocks (headings, sentences, formulas, tables, checklists, sketches,
 *          worked examples, margin notes, questions) that the app writes in handwriting.
 * ask:     a question asked part-way through, answered as a few blocks beside the notes.
 *
 * The app keeps the plan and a short research digest and sends them back with each request, so
 * nothing is lost when the server restarts mid-way through a set of notes.
 */
import { env, isMock } from './env.ts';
import { ClientGone } from './errors.ts';
import { explabsChoice, explabsKey, explabsReady } from './explabs.ts';
import { exampleSlips, reviewSection } from './notes-guard.ts';
import { groqChoice } from './groq.ts';
import { HttpError } from './http.ts';
import { repairLatexJson } from './jsonfix.ts';
import { readPage, videoInfo, webSearch } from './research.ts';
import type { VideoInfo, WebSource } from './research.ts';
import { requestThought, thoughtRoom } from './thought.ts';
import type { Thought } from './thought.ts';
import { toolModel } from './runtime.ts';

const MAX_WAIT_S = 25;
const fail = (message: string, status = 502) => new HttpError(status, message);

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[ \t]+/g, ' ').trim().slice(0, max) : '');
const strs = (v: unknown, n: number, max: number) =>
  (Array.isArray(v) ? v : []).map((x) => str(x, max)).filter(Boolean).slice(0, n);

/**
 * How much the model reasons before it writes, from the student's AI thought level in Settings
 * ("No thoughts" none, "Think" low, "Think more" medium, "Think most" high). Every prompt also asks
 * for a short "think" field before the answer, which is independent of the model's own trace.
 * SLATE_NOTES_REASONING is the fallback for callers that send no level (an older app).
 */
const REASONING = (): Thought => requestThought() ?? (env('SLATE_NOTES_REASONING', 'none') as Thought);

/** Asked of every notes prompt, so the model plans before it writes. */
const THINK = `Put "think" first in the JSON: your private plan in under 70 words (what to cover, in what order, what to leave out). The student never sees it.`;

/** A comma-separated list of model ids from the environment; set to empty to turn the list off. */
const list = (name: string, fallback: string) => (process.env[name] ?? fallback).split(',').map((s) => s.trim()).filter(Boolean);

interface Step { provider: 'explabs' | 'groq'; model: string }

/**
 * The models a notes request tries, in order; the next one runs only when the one before failed,
 * was rate limited, or gave an empty or cut-off answer, so a normal request is still one call.
 * Plans and sections go to models that reason, on Experiential Labs (SLATE_NOTES_THINKERS):
 * DeepSeek, then Claude Haiku, which also reads images. Groq's qwen comes last, and is first for
 * quick steps, like reading the request, which cost less there.
 */
function chain(think: boolean): Step[] {
  const groq = toolModel('notes') || env('SLATE_NOTES_MODEL') || env('SLATE_ASSIST_MODEL') || env('SLATE_RECOGNIZE_MODEL', 'qwen/qwen3.8-27b');
  const steps: Step[] = [];
  if (think && explabsKey()) for (const model of list('SLATE_NOTES_THINKERS', 'deepseek-v4.1-flash,claude-haiku-5.5')) steps.push({ provider: 'explabs', model });
  steps.push({ provider: 'groq', model: groq });
  return steps;
}

/** The JSON object in a model's answer, or null when it is empty, cut off or not JSON. */
function parseJson(choice: any): Record<string, unknown> | null {
  let text = String(choice?.message?.content ?? '').trim();
  if (text.startsWith('```')) text = text.replace(/^`+(json)?|`+$/g, '').trim();
  try {
    const data = JSON.parse(repairLatexJson(text));
    if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch {
    // fall through
  }
  // The model's own text is not logged: it can quote a heading or a formula from the student's notes.
  console.error(`[notes] malformed JSON: finish=${choice?.finish_reason} chars=${text.length}`);
  return null;
}

async function askJson(
  system: string, user: string, maxTokens: number, signal?: AbortSignal, temperature = 0.4, think = true,
): Promise<Record<string, unknown>> {
  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const steps = chain(think);
  const reasoning = REASONING();
  let last: unknown = null;
  for (const [i, step] of steps.entries()) {
    const final = i === steps.length - 1;
    // Experiential Labs cooling off after a network failure: skip it at once, no request.
    if (step.provider === 'explabs' && !explabsReady()) continue;
    try {
      let choice: any;
      if (step.provider === 'explabs') {
        // Reasoning tokens count against max_tokens, so it gets room for them. Never retried on
        // the same model: a timed-out request may still be charged. Both models there accept
        // reasoning_effort; "none" turns DeepSeek's trace off.
        choice = await explabsChoice(
          {
            model: step.model,
            max_tokens: maxTokens + 4000 + thoughtRoom(reasoning),
            temperature,
            response_format: { type: 'json_object' },
            reasoning_effort: reasoning,
            messages,
          },
          { fail, signal },
        );
      } else {
        choice = await groqChoice(
          {
            model: step.model,
            // Room for the "think" field, longer plans and any reasoning: a cut-off answer is broken JSON.
            max_tokens: maxTokens + 1200 + thoughtRoom(reasoning),
            temperature,
            reasoning_effort: reasoning,
            ...(reasoning === 'none' ? {} : { reasoning_format: 'hidden' }),
            response_format: { type: 'json_object' },
            messages,
          },
          // Only the last model waits out a rate limit; the others hand over to the next one at once.
          { maxWaitS: final ? MAX_WAIT_S : 0, fail, signal },
        );
      }
      const data = parseJson(choice);
      if (data) {
        if (i > 0) console.warn(`[notes] answered by backup ${step.provider}:${step.model}`);
        return data;
      }
      last = fail('The AI’s answer came back incomplete. Please try again.');
    } catch (e) {
      if (e instanceof ClientGone) throw e;
      last = e;
    }
    if (!final) console.error(`[notes] ${step.provider}:${step.model} failed, trying the next model:`, (last as Error)?.message);
  }
  throw last instanceof HttpError ? last : fail('The AI could not answer just now. Please try again.');
}

// --- shapes ---------------------------------------------------------------------------------------

export interface Profile {
  board: string;
  grade: string;
  subjects: string[];
  name?: string;
}

export interface PlanSection {
  heading: string;
  goal: string;
  /** For a video: what the teacher says in this section's part of it, so the section is written from that. */
  source?: string;
}

export interface Plan {
  kind: 'notes' | 'summary' | 'quiz' | 'revision';
  title: string;
  subject: string;
  topic: string;
  profile: Profile;
  sections: PlanSection[];
  /** What the research found, kept short: it travels with every section request. */
  digest: string;
  sources: WebSource[];
  /** One line the app shows to keep the study habit going. */
  habit: string;
  video?: { id: string; title: string; channel: string; thumb: string; captions: boolean };
  /** Sample notes from a server in demo mode (SLATE_MOCK=1), not written by a model. */
  demo?: boolean;
}

/** A sketch is drawn in a 100 x 60 box; the app scales it and draws it by hand. */
export type Shape =
  | { s: 'line' | 'arrow' | 'dash'; x1: number; y1: number; x2: number; y2: number }
  | { s: 'circle'; x: number; y: number; r: number }
  | { s: 'rect'; x: number; y: number; w: number; h: number }
  | { s: 'arc'; x: number; y: number; r: number; a0: number; a1: number; arrow?: boolean }
  | { s: 'dot'; x: number; y: number }
  | { s: 'label'; x: number; y: number; text: string };

export type Block =
  | { t: 'h'; text: string }
  | { t: 'p'; text: string }
  | { t: 'f'; latex: string; label?: string }
  | { t: 'list'; items: string[]; check?: boolean }
  | { t: 'table'; head: string[]; rows: string[][] }
  | { t: 'sketch'; caption: string; shapes: Shape[] }
  | { t: 'ex'; q: string; steps: string[] }
  | { t: 'key'; text: string }
  | { t: 'q'; items: string[] };

export interface SectionOut {
  blocks: Block[];
  /** Short margin notes written beside the section: examples, memory hooks, exam tips. */
  side: Block[];
}

// --- understanding the request ------------------------------------------------------------------

const UNDERSTAND_SYSTEM = `You help a school student study. Read their request and what is already known about them.
Work out:
- kind: "notes" (complete notes on a topic), "summary" (summarise given material), "quiz" (practice questions), "revision" (a quick recap)
- board: exam board if stated or implied (ICSE, ISC, CBSE, IGCSE, IB, State board, JEE, NEET...), else the known one, else ""
- grade: class or year, like "10", else the known one, else ""
- subject and topic, in the board's own words (ICSE says "Force, Work, Power and Energy"; CBSE says "Light - Reflection and Refraction")
- queries: 2 short web searches that find the CURRENT official syllabus and the key points for this topic and board, e.g. "ICSE class 10 physics syllabus 2026-27 rotational motion"
Return JSON: {"kind": string, "board": string, "grade": string, "subject": string, "topic": string, "queries": [string]}`;

interface Understood {
  kind: Plan['kind'];
  board: string;
  grade: string;
  subject: string;
  topic: string;
  queries: string[];
}

const KINDS = new Set(['notes', 'summary', 'quiz', 'revision']);

async function understand(prompt: string, known: Profile | null, signal?: AbortSignal): Promise<Understood> {
  const knownLine = known && (known.board || known.grade)
    ? `Known about the student: board ${known.board || 'unknown'}, class ${known.grade || 'unknown'}${known.subjects.length ? `, studies ${known.subjects.join(', ')}` : ''}.`
    : 'Nothing is known about the student yet.';
  const data = await askJson(UNDERSTAND_SYSTEM, `${knownLine}\nRequest: ${prompt}`, 300, signal, 0.2, false);
  const kind = str(data.kind, 12);
  return {
    kind: (KINDS.has(kind) ? kind : 'notes') as Plan['kind'],
    board: str(data.board, 30),
    grade: str(data.grade, 12).replace(/^(class|grade|std\.?)\s*/i, ''),
    subject: str(data.subject, 60),
    topic: str(data.topic, 120) || prompt.slice(0, 120),
    queries: strs(data.queries, 2, 140),
  };
}

// --- planning -----------------------------------------------------------------------------------

const PLAN_SYSTEM = `You plan handwritten study notes that an AI teacher will write on a student's whiteboard.
Use the research given (current syllabus pages and search results) so the notes match what THIS board and class
are examined on this year. Leave out what the syllabus does not include for this class.
Plan complete notes, not a sketch: 5 to 9 sections in teaching order (what it is, key ideas, each formula, worked examples,
diagrams, common mistakes, practice). Cover every sub-topic the syllabus lists for this chapter.
For a video, the sections follow the video from start to end, one section for each part of it (the count is given), so that
together they cover everything the teacher says, and the last section is practice questions.
Also write "digest": the facts the sections need from the research, in under 1200 characters (syllabus scope, definitions,
formulas with SI units, what examiners ask). And "habit": one short friendly line that encourages a daily study habit
for this student, mentioning their board or class if known.
${THINK}
Return JSON: {"think": string, "title": string, "sections": [{"heading": string, "goal": string}], "digest": string, "habit": string}
Headings are short (2 to 5 words). Goals say in one sentence what the section must cover.`;

export type PlanEvent =
  | { type: 'stage'; stage: 'understand' | 'search' | 'read' | 'video' | 'plan'; label: string }
  | { type: 'profile'; profile: Profile; subject: string; topic: string; kind: Plan['kind'] }
  | { type: 'sources'; sources: WebSource[] }
  | { type: 'video'; video: NonNullable<Plan['video']> }
  | { type: 'plan'; plan: Plan }
  | { type: 'error'; message: string };

export interface PlanInput {
  prompt: string;
  profile: Profile | null;
  /** What is already on the board, from its memory, so notes build on it. */
  context: string;
  videoId: string | null;
  /** A transcript the student pasted, used when YouTube will not give its captions. */
  transcript: string;
}

const MAX_PAGE = 2400;
/** Input tokens for one plan request, under the model's per-minute limit with room for the answer. */
const PLAN_TOKENS = 4800;
const TRANSCRIPT_TOKENS = 2600;
/** The part of a video one section is written from: what the teacher says there, kept under budget. */
const SECTION_SOURCE_TOKENS = 1700;

/** A video's words in about three minutes a part, 4 to 8 parts, so each section is written from its own part. */
function videoParts(text: string, seconds: number): string[] {
  const n = Math.min(8, Math.max(4, Math.round((seconds || 900) / 180)));
  const size = Math.ceil(text.length / n);
  return Array.from({ length: n }, (_, i) => text.slice(i * size, (i + 1) * size).trim()).filter(Boolean);
}

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

/** A rough token count: English runs about 4 characters a token, Devanagari and other scripts about 1. */
function tokens(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i) < 128 ? 0.27 : 0.9;
  return Math.ceil(n);
}

/** Cuts `text` to about `max` tokens, taking `parts` evenly spaced pieces so a long video is covered start to end. */
function spread(text: string, max: number, parts = 6): string {
  const have = tokens(text);
  if (have <= max) return text;
  const piece = Math.floor((text.length * max) / have / parts);
  const step = (text.length - piece) / Math.max(1, parts - 1);
  const out: string[] = [];
  for (let i = 0; i < parts; i++) out.push(text.slice(Math.round(i * step), Math.round(i * step) + piece).trim());
  return out.join(' … ');
}

export async function* planNotes(input: PlanInput, signal?: AbortSignal): AsyncGenerator<PlanEvent> {
  if (isMock()) {
    yield* mockPlan(input);
    return;
  }
  const known = input.profile;

  let video: VideoInfo | null = null;
  if (input.videoId) {
    yield { type: 'stage', stage: 'video', label: 'Reading the video' };
    video = await videoInfo(input.videoId, signal);
    if (!video.transcript && input.transcript.trim()) {
      video = { ...video, transcript: input.transcript.replace(/\s+/g, ' ').trim().slice(0, 24_000), captionLang: 'pasted' };
    }
    yield {
      type: 'video',
      video: { id: video.id, title: video.title, channel: video.channel, thumb: video.thumb, captions: !!video.transcript },
    };
  }

  yield { type: 'stage', stage: 'understand', label: 'Understanding what you need' };
  const ask = video ? `Summarise this video as study notes: "${video.title}". ${input.prompt}`.trim() : input.prompt;
  const u = await understand(ask, known, signal);
  const profile: Profile = {
    board: u.board || known?.board || '',
    grade: u.grade || known?.grade || '',
    subjects: [...new Set([...(known?.subjects ?? []), ...(u.subject ? [u.subject] : [])])].slice(0, 8),
  };
  const kind: Plan['kind'] = video ? 'summary' : u.kind;
  yield { type: 'profile', profile, subject: u.subject, topic: u.topic, kind };

  // Look up the current syllabus. A failed search is not fatal: the notes are still written.
  const queries = u.queries.length ? u.queries : [`${profile.board} class ${profile.grade} ${u.subject} ${u.topic} syllabus`.trim()];
  // Without the spoken words, what others wrote about the same video's topic fills the gap.
  if (video && !video.transcript) queries.unshift(video.title.slice(0, 120));
  yield { type: 'stage', stage: 'search', label: `Searching: ${queries[0]}` };
  const results = await Promise.all(queries.map((q) => webSearch(q, signal).catch(() => null)));
  const seen = new Set<string>();
  const sources: WebSource[] = [];
  for (const r of results) {
    for (const s of r?.sources ?? []) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
      sources.push(s);
    }
  }
  yield { type: 'sources', sources: sources.slice(0, 8) };

  // Read the top two pages that are web pages (not PDFs or videos).
  const readable = sources.filter((s) => !/\.pdf($|\?)/i.test(s.url) && !/youtube\.com|youtu\.be/.test(s.url)).slice(0, 2);
  let pages: { title: string; url: string; text: string }[] = [];
  if (readable.length) {
    yield { type: 'stage', stage: 'read', label: `Reading ${readable.map((s) => new URL(s.url).hostname.replace(/^www\./, '')).join(' and ')}` };
    pages = (await Promise.all(readable.map((s) => readPage(s.url, signal).then((text) => ({ title: s.title, url: s.url, text })).catch(() => null))))
      .filter((p): p is { title: string; url: string; text: string } => !!p && p.text.length > 200);
  }

  yield { type: 'stage', stage: 'plan', label: 'Planning the notes' };
  let user = `Student: board ${profile.board || 'unknown'}, class ${profile.grade || 'unknown'}.\n`;
  user += `Request: ${ask}\nSubject: ${u.subject}\nTopic: ${u.topic}\nKind: ${kind}\n`;
  if (input.context) user += `Already on their board: ${input.context.slice(0, 400)}\n`;
  // A long video is cut into parts; the plan gives each part a section, and the section is later
  // written from that part's own words, so a 25 minute class becomes notes on all 25 minutes.
  const parts = video?.transcript ? videoParts(video.transcript, video.length) : [];
  const span = (i: number) => {
    const len = video?.length || 0;
    return len ? `${clock((len * i) / parts.length)}-${clock((len * (i + 1)) / parts.length)}` : `part ${i + 1}`;
  };
  if (video) {
    user += `\nVideo: "${video.title}" by ${video.channel}${video.length ? `, ${Math.round(video.length / 60)} minutes` : ''}.\n`;
    if (parts.length) {
      const lang = video.captionLang && !video.captionLang.startsWith('en') && video.captionLang !== 'pasted' ? ` Captions are in ${video.captionLang}; write the notes in English.` : '';
      user += `The video has ${parts.length} parts. Plan exactly ${parts.length} sections, one for each part in order, each with "part": its number,`;
      user += ` then one last section "Practice questions" with "part": 0.${lang}\n`;
      const each = TRANSCRIPT_TOKENS / parts.length;
      user += parts.map((p, i) => `Part ${i + 1} (${span(i)}): ${spread(p, each, 2)}`).join('\n') + '\n';
    }
    else user += `No captions could be read. Description:\n${video.description.slice(0, 1500)}\nBase the notes on the title, the description and the research.\n`;
  }
  if (sources.length) user += `\nSearch results:\n${sources.slice(0, 8).map((s) => `- ${s.title}`).join('\n')}\n`;
  // The model takes about 7,000 input tokens a minute, so the pages get what the transcript left.
  const pageBudget = Math.max(300, (PLAN_TOKENS - tokens(PLAN_SYSTEM) - tokens(user)) / Math.max(1, pages.length));
  for (const p of pages) user += `\nPage "${p.title}" (${p.url}):\n${spread(p.text.slice(0, MAX_PAGE), pageBudget, 1)}\n`;

  const data = await askJson(PLAN_SYSTEM, user, 1500, signal, 0.3);
  const raw = (Array.isArray(data.sections) ? data.sections : []).map((s) => (s ?? {}) as Record<string, unknown>);
  const numbered = raw.some((s) => Number.isInteger(Number(s.part)) && Number(s.part) >= 1);
  const sections: PlanSection[] = raw
    .map((s, i) => {
      const sec: PlanSection = { heading: str(s.heading, 60), goal: str(s.goal, 240) };
      // The section's own part of the video; when the model left the numbers out, sections go in order.
      const p = numbered ? Number(s.part) - 1 : i;
      if (parts.length && Number.isInteger(p) && p >= 0 && p < parts.length) {
        sec.source = `${span(p)}: ${spread(parts[p], SECTION_SOURCE_TOKENS, 3)}`;
      }
      return sec;
    })
    .filter((s) => s.heading)
    .slice(0, 10);
  if (!sections.length) throw fail('The model did not plan any sections.');
  const plan: Plan = {
    kind,
    title: str(data.title, 80) || u.topic,
    subject: u.subject,
    topic: u.topic,
    profile,
    sections,
    digest: str(data.digest, 1600),
    sources: sources.slice(0, 6),
    habit: str(data.habit, 160),
    ...(video ? { video: { id: video.id, title: video.title, channel: video.channel, thumb: video.thumb, captions: !!video.transcript } } : {}),
  };
  yield { type: 'plan', plan };
}

// --- writing one section ------------------------------------------------------------------------

const BLOCKS_HELP = `Blocks (JSON objects, field "t"):
{"t":"h","text":"..."} a sub-heading
{"t":"p","text":"..."} one or two short sentences. Put maths inline as $...$ LaTeX. Wrap the 1-3 most important words in *stars* to underline them.
{"t":"f","latex":"\\\\tau = F \\\\times d","label":"Moment of force"} a formula on its own line, boxed. LaTeX without $.
{"t":"list","items":["..."],"check":false} bullet points; "check":true makes a checklist (things to learn or do)
{"t":"table","head":["Quantity","SI unit"],"rows":[["Torque","N m"]]} a small table, at most 4 columns and 6 rows, short cells
{"t":"sketch","caption":"...","shapes":[...]} a simple labelled diagram in a 100 wide x 60 tall box (y down). Shapes:
  {"s":"line"|"arrow"|"dash","x1":0,"y1":0,"x2":0,"y2":0}, {"s":"circle","x":0,"y":0,"r":0}, {"s":"rect","x":0,"y":0,"w":0,"h":0},
  {"s":"arc","x":0,"y":0,"r":0,"a0":0,"a1":90,"arrow":true} (degrees, clockwise from +x), {"s":"dot","x":0,"y":0},
  {"s":"label","x":0,"y":0,"text":"F"} (labels are 1-3 words or a symbol). Use 4 to 14 shapes. Keep everything inside the box.
{"t":"ex","q":"...","steps":["latex step", "..."]} a worked example: question in words with $...$ maths, steps in LaTeX, last step is the answer
{"t":"key","text":"..."} an important point or common mistake, drawn in a box with a star
{"t":"q","items":["..."]} practice questions for the student`;

const SECTION_SYSTEM = `You are a friendly teacher writing notes by hand on a student's whiteboard, one section at a time.
Write like a good teacher's board work: short lines, not paragraphs; definitions, formulas with units, a diagram where it helps,
and underline what matters. Match the student's board and class exactly; never go beyond their syllabus.
Text is handwritten, so keep it plain: ASCII letters, digits and common symbols. Greek letters only inside $...$ maths.
${BLOCKS_HELP}
"blocks" are the section itself (4 to 9 blocks). "side" are 0 to 2 short margin notes written beside it: a real-life example,
a memory trick, or an exam tip, each a "p", "key" or "list" block.
Accuracy comes first. Use only what the video's words, the research, or the standard textbook for this class say. Never invent
a number, a name, a date or a claim about what the video says. Check every formula and its SI unit, and work every example out
fully: the last step must follow from the ones before. If the video's words are given, write the notes from them, in English,
and keep the teacher's own examples and tricks.
${THINK}
Return JSON: {"think": string, "blocks": [...], "side": [...]}`;

export interface SectionInput {
  plan: Pick<Plan, 'title' | 'subject' | 'topic' | 'profile' | 'sections' | 'digest' | 'kind'>;
  index: number;
  /** About how many characters fit on a line of the notes column, so lines are kept short. */
  lineChars: number;
  /** What was already written, briefly, so the section does not repeat it. */
  written: string;
  /** Extra guidance: "more examples", "simpler", or what the student asked for. */
  extra: string;
  /** A section that is not in the plan, such as "more examples" asked for at the end. */
  custom: PlanSection | null;
}

export async function writeSection(input: SectionInput, signal?: AbortSignal): Promise<SectionOut> {
  if (isMock()) return input.custom ? mockExtra(input.custom.heading) : mockSection(input.index);
  const { plan, index } = input;
  const sec = input.custom ?? plan.sections[index];
  if (!sec) throw new HttpError(400, 'There is no such section in the plan.');
  let user = `Notes: "${plan.title}" (${plan.kind}) for a ${plan.profile.board || ''} class ${plan.profile.grade || '?'} student. Subject: ${plan.subject}. Topic: ${plan.topic}.\n`;
  user += `Sections: ${plan.sections.map((s, i) => `${i + 1}. ${s.heading}`).join('; ')}\n`;
  user += input.custom
    ? `All planned sections are written. Write one extra section: "${sec.heading}". It must cover: ${sec.goal}\n`
    : `Write section ${index + 1}: "${sec.heading}". It must cover: ${sec.goal}\n`;
  user += `Lines fit about ${Math.max(24, Math.min(70, input.lineChars))} characters.\n`;
  if (plan.digest) user += `Research:\n${plan.digest}\n`;
  if (sec.source) user += `What the teacher says in this part of the video (captions, may have errors; write the notes in English):\n${sec.source.slice(0, 7000)}\n`;
  if (input.written) user += `Already written (do not repeat): ${input.written.slice(0, 700)}\n`;
  if (input.extra) user += `Also: ${input.extra.slice(0, 300)}\n`;
  const data = await askJson(SECTION_SYSTEM, user, 1800, signal, 0.45);
  let out: SectionOut = { blocks: cleanBlocks(data.blocks, 10), side: cleanBlocks(data.side, 2) };
  if (!out.blocks.length) throw fail('The model did not write this section.');

  // The silent guard: the calculator checks the worked examples and Jev checks the section against
  // what it was written from. A section with problems is rewritten once, which is the only extra call.
  const ctx = { heading: sec.heading, goal: sec.goal, board: plan.profile.board, grade: plan.profile.grade, source: sec.source || plan.digest };
  const problems = await reviewSection(out.blocks, ctx, signal);
  if (problems.length) {
    try {
      const again = await askJson(
        SECTION_SYSTEM,
        `${user}\nYour first version had these problems. Write the section again with them fixed:\n- ${problems.join('\n- ')}\n`,
        1800, signal, 0.3,
      );
      const fixed: SectionOut = { blocks: cleanBlocks(again.blocks, 10), side: cleanBlocks(again.side, 2) };
      if (fixed.blocks.length) out = fixed;
    } catch (e) {
      if (e instanceof ClientGone) throw e;
      // The first version stays, without the examples the calculator could not confirm.
    }
  }
  // An example whose arithmetic is still wrong is left out rather than taught.
  const wrong = new Set(exampleSlips(out.blocks).map((s) => s.index));
  if (wrong.size) {
    console.warn(`[notes] guard dropped ${wrong.size} example(s) in "${sec.heading}"`);
    out = { ...out, blocks: out.blocks.filter((_, i) => !wrong.has(i)) };
  }
  if (!out.blocks.length) throw fail('The model did not write this section.');
  return out;
}

// --- a question asked part-way through ------------------------------------------------------------

const ASK_SYSTEM = `You are a friendly teacher. The student stopped you while notes were being written, or marked part of their board, and asked about it.
Answer it briefly as 1 to 4 blocks written beside what they marked, at the student's level. If it needs a diagram, use a sketch.
${BLOCKS_HELP}
Answer only what you are sure of for this class; if the question goes beyond the syllabus, say so briefly.
${THINK}
Return JSON: {"think": string, "blocks": [...], "reply": "one short spoken sentence before you write"}`;

export async function answerAsk(
  input: { question: string; title: string; heading: string; written: string; profile: Profile | null },
  signal?: AbortSignal,
): Promise<{ blocks: Block[]; reply: string }> {
  if (isMock()) {
    return { reply: 'Good question!', blocks: [{ t: 'p', text: 'Torque is *bigger* when you push *farther* from the hinge.' }, { t: 'f', latex: '\\tau = F \\times d' }] };
  }
  let user = `Notes: "${input.title}". Writing section: "${input.heading}".`;
  if (input.profile?.board || input.profile?.grade) user += ` Student: ${input.profile.board} class ${input.profile.grade}.`;
  if (input.written) user += `\nWhat is on the board around it: ${input.written.slice(0, 1200)}`;
  user += `\nQuestion: ${input.question}`;
  const data = await askJson(ASK_SYSTEM, user, 900, signal, 0.4);
  const blocks = cleanBlocks(data.blocks, 4);
  if (!blocks.length) throw fail('The model did not answer.');
  return { blocks, reply: str(data.reply, 160) };
}

// --- checking what the model wrote ----------------------------------------------------------------

const n = (v: unknown, lo: number, hi: number) => {
  const x = typeof v === 'number' && Number.isFinite(v) ? v : Number(v);
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : lo;
};

function cleanShape(v: unknown): Shape | null {
  const s = (v ?? {}) as Record<string, unknown>;
  const X = (k: string) => n(s[k], 0, 100);
  const Y = (k: string) => n(s[k], 0, 60);
  switch (s.s) {
    case 'line':
    case 'arrow':
    case 'dash':
      return { s: s.s, x1: X('x1'), y1: Y('y1'), x2: X('x2'), y2: Y('y2') };
    case 'circle':
      return { s: 'circle', x: X('x'), y: Y('y'), r: n(s.r, 0.5, 30) };
    case 'rect':
      return { s: 'rect', x: X('x'), y: Y('y'), w: n(s.w, 0.5, 100), h: n(s.h, 0.5, 60) };
    case 'arc':
      return { s: 'arc', x: X('x'), y: Y('y'), r: n(s.r, 0.5, 30), a0: n(s.a0, -720, 720), a1: n(s.a1, -720, 720), arrow: s.arrow === true };
    case 'dot':
      return { s: 'dot', x: X('x'), y: Y('y') };
    case 'label': {
      const text = str(s.text, 24);
      return text ? { s: 'label', x: X('x'), y: Y('y'), text } : null;
    }
    default:
      return null;
  }
}

export function cleanBlocks(v: unknown, max: number): Block[] {
  const out: Block[] = [];
  for (const raw of Array.isArray(v) ? v : []) {
    const b = (raw ?? {}) as Record<string, unknown>;
    let block: Block | null = null;
    switch (b.t) {
      case 'h':
      case 'p':
      case 'key': {
        const text = str(b.text, b.t === 'h' ? 60 : 320);
        if (text) block = { t: b.t, text };
        break;
      }
      case 'f': {
        const latex = str(b.latex, 200);
        if (latex) block = { t: 'f', latex, ...(str(b.label, 50) ? { label: str(b.label, 50) } : {}) };
        break;
      }
      case 'list': {
        const items = strs(b.items, 7, 140);
        if (items.length) block = { t: 'list', items, check: b.check === true };
        break;
      }
      case 'q': {
        const items = strs(b.items, 5, 200);
        if (items.length) block = { t: 'q', items };
        break;
      }
      case 'table': {
        const head = strs(b.head, 4, 24);
        const rows = (Array.isArray(b.rows) ? b.rows : [])
          .map((r) => (Array.isArray(r) ? r.slice(0, head.length || 4).map((c) => str(c, 30)) : []))
          .filter((r) => r.some(Boolean))
          .slice(0, 6);
        if (head.length && rows.length) block = { t: 'table', head, rows: rows.map((r) => [...r, ...Array(Math.max(0, head.length - r.length)).fill('')]) };
        break;
      }
      case 'sketch': {
        const shapes = (Array.isArray(b.shapes) ? b.shapes : []).map(cleanShape).filter((x): x is Shape => !!x).slice(0, 20);
        if (shapes.length >= 2) block = { t: 'sketch', caption: str(b.caption, 80), shapes };
        break;
      }
      case 'ex': {
        const q = str(b.q, 300);
        const steps = strs(b.steps, 6, 160);
        if (q && steps.length) block = { t: 'ex', q, steps };
        break;
      }
    }
    if (block) out.push(block);
    if (out.length >= max) break;
  }
  return out;
}

// --- mock (SLATE_MOCK=1): the whole flow without a model ----------------------------------------

async function* mockPlan(input: PlanInput): AsyncGenerator<PlanEvent> {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  if (input.videoId) {
    yield { type: 'stage', stage: 'video', label: 'Reading the video' };
    await wait(300);
    yield { type: 'video', video: { id: input.videoId, title: 'Rotational motion explained', channel: 'Physics Wallah', thumb: `https://i.ytimg.com/vi/${input.videoId}/hqdefault.jpg`, captions: true } };
  }
  yield { type: 'stage', stage: 'understand', label: 'Understanding what you need' };
  await wait(300);
  const profile: Profile = { board: input.profile?.board || 'ICSE', grade: input.profile?.grade || '10', subjects: ['Physics'] };
  yield { type: 'profile', profile, subject: 'Physics', topic: 'Rotational motion', kind: input.videoId ? 'summary' : 'notes' };
  yield { type: 'stage', stage: 'search', label: 'Searching: ICSE class 10 physics syllabus 2026-27' };
  await wait(400);
  const sources = [
    { title: 'ICSE Class 10 Physics Syllabus 2026-27', url: 'https://cisce.org/wp-content/uploads/2026/01/10.-Physics.pdf', snippet: '' },
    { title: 'ICSE Class 10 Physics Syllabus 2026-27 | Vedantu', url: 'https://www.vedantu.com/syllabus/icse-class-10-physics-syllabus', snippet: '' },
  ];
  yield { type: 'sources', sources };
  yield { type: 'stage', stage: 'plan', label: 'Planning the notes' };
  await wait(300);
  yield {
    type: 'plan',
    plan: {
      kind: input.videoId ? 'summary' : 'notes',
      title: 'Rotational motion: Moment of force',
      subject: 'Physics',
      topic: 'Rotational motion',
      profile,
      sections: [
        { heading: 'Turning effect of force', goal: 'What a moment is and where we see it.' },
        { heading: 'Moment of force', goal: 'Formula, unit and direction.' },
        { heading: 'Worked example', goal: 'One numerical.' },
        { heading: 'Practice', goal: 'Questions to try.' },
      ],
      digest: 'ICSE 2026-27 Unit 1: Force. Turning effect, moment of a force, couple, equilibrium, centre of gravity.',
      sources,
      habit: 'Ten minutes of ICSE Physics a day keeps the boards calm. See you tomorrow!',
      demo: true,
    },
  };
}

function mockSection(index: number): SectionOut {
  const sections: SectionOut[] = [
    {
      blocks: [
        { t: 'h', text: 'Turning effect of force' },
        { t: 'p', text: 'A force can *turn* a body about a fixed point called the *pivot*.' },
        { t: 'sketch', caption: 'Opening a door', shapes: [
          { s: 'rect', x: 10, y: 10, w: 60, h: 6 }, { s: 'dot', x: 10, y: 13 }, { s: 'label', x: 4, y: 26, text: 'hinge' },
          { s: 'arrow', x1: 66, y1: 40, x2: 66, y2: 18 }, { s: 'label', x: 70, y: 40, text: 'F' },
          { s: 'arc', x: 10, y: 13, r: 22, a0: 10, a1: 70, arrow: true },
        ] },
        { t: 'list', check: true, items: ['Know what a pivot is', 'Give 3 examples'] },
      ],
      side: [{ t: 'p', text: 'Example: a see-saw, a spanner, a door.' }],
    },
    {
      blocks: [
        { t: 'h', text: 'Moment of force' },
        { t: 'f', latex: '\\tau = F \\times d', label: 'Moment' },
        { t: 'table', head: ['Quantity', 'SI unit'], rows: [['Force F', 'N'], ['Distance d', 'm'], ['Moment', 'N m']] },
        { t: 'key', text: 'd is the *perpendicular* distance from the pivot.' },
      ],
      side: [{ t: 'key', text: 'Anticlockwise is positive.' }],
    },
    {
      blocks: [{ t: 'ex', q: 'A force of $10 N$ acts $0.5 m$ from the hinge. Find the moment.', steps: ['\\tau = F \\times d', '= 10 \\times 0.5', '= 5 \\text{ N m}'] }],
      side: [],
    },
    { blocks: [{ t: 'q', items: ['Why is a door handle far from the hinge?', 'Find the moment of $20 N$ at $0.3 m$.'] }], side: [] },
  ];
  return sections[Math.min(index, sections.length - 1)];
}

/** "More examples", "Practice questions"... in demo mode: each asks for something different. */
function mockExtra(heading: string): SectionOut {
  const h = heading.toLowerCase();
  if (h.includes('example')) {
    return {
      blocks: [
        { t: 'h', text: heading },
        { t: 'ex', q: 'A spanner 0.25 m long is turned with a force of 40 N. Find the moment.', steps: ['\\tau = F \\times d', '= 40 \\times 0.25', '= 10 \\text{ N m}'] },
        { t: 'ex', q: 'A moment of 12 N m needs a force applied 0.4 m from the pivot. Find the force.', steps: ['F = \\frac{\\tau}{d}', '= \\frac{12}{0.4}', '= 30 \\text{ N}'] },
      ],
      side: [{ t: 'key', text: 'Demo notes: connect a real AI server for notes on your topic.' }],
    };
  }
  if (h.includes('recap')) {
    return {
      blocks: [
        { t: 'h', text: heading },
        { t: 'list', check: true, items: ['Moment = force x perpendicular distance', 'SI unit: N m', 'Anticlockwise moments are positive'] },
      ],
      side: [],
    };
  }
  if (h.includes('simpl')) {
    return {
      blocks: [
        { t: 'h', text: heading },
        { t: 'p', text: 'Push a door near the hinge and it hardly moves. Push at the handle and it swings *easily*.' },
        { t: 'key', text: 'The *farther* from the pivot you push, the bigger the turning effect.' },
      ],
      side: [],
    };
  }
  return {
    blocks: [
      { t: 'h', text: heading },
      { t: 'q', items: ['Define moment of force and give its SI unit.', 'Why is it easier to open a door from the handle?', 'Find the moment of 15 N at 0.2 m.', 'A force of 8 N gives a moment of 4 N m. Find d.', 'State the principle of moments.'] },
    ],
    side: [],
  };
}
