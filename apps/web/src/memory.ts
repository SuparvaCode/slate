/**
 * Board memory: what has been worked on this board (solved questions, diagrams, simulators),
 * filed under school topics. It fills the Progress panel, and a short summary goes with AI
 * requests so new answers can build on earlier ones. It is kept in this browser only.
 */

export type MemoryKind = 'solve' | 'diagram' | 'sim';
export type Subject = 'Physics' | 'Maths' | 'Chemistry' | 'General';

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  /** The question, or the diagram or simulator name. */
  title: string;
  /** The title is LaTeX (a solved question), not plain text. */
  tex?: boolean;
  /** The answer, as LaTeX, for solved questions. */
  result?: string;
  topic: string;
  subject: Subject;
  at: number;
  /** How many times the same thing was done. */
  times: number;
}

const KEY = 'slate.memory.v1';
const MAX = 200;
/** The summary sent with AI requests is kept short: Groq's free tier counts every input token. */
const SUMMARY_MAX = 420;

// Order matters: the first match wins, so specific topics come before broad ones.
const TOPICS: { topic: string; subject: Subject; words: RegExp }[] = [
  { topic: 'Current electricity', subject: 'Physics', words: /circuit|resistor|battery|\bcurrent\b|voltage|\bohm|ammeter|voltmeter|kirchhoff|wheatstone|capacitor|\bemf\b/i },
  { topic: 'Ray optics', subject: 'Physics', words: /\blens|mirror|refract|\bray\b|\brays\b|focal|optic/i },
  { topic: 'Oscillations', subject: 'Physics', words: /pendulum|spring|oscillat|\bshm\b|simple harmonic/i },
  { topic: 'Motion in a plane', subject: 'Physics', words: /projectile|trajectory|thrown/i },
  { topic: 'Coordinate geometry', subject: 'Maths', words: /slope of (the )?(line|curve|tangent)|gradient/i },
  { topic: 'Laws of motion', subject: 'Physics', words: /pulley|tension|friction|incline|atwood|newton|\bblocks?\b|tackle|\bslope\b|\bforces?\b/i },
  { topic: 'Organic chemistry', subject: 'Chemistry', words: /benzene|ethanol|methan|ethan|propan|alk[aey]ne|ch_?3|organic|isomer|functional group/i },
  { topic: 'Chemical bonding', subject: 'Chemistry', words: /molecule|bond angle|lone pair|h_?2o|\bwater\b|vsepr|hybridi/i },
  { topic: 'Calculus', subject: 'Maths', words: /\\int|integra|deriv|differentia|\\frac\{d|\\lim|\blimit|d\/dx|dy\/dx/i },
  { topic: 'Trigonometry', subject: 'Maths', words: /\\sin|\\cos|\\tan|\bsin\b|\bcos\b|\btan\b|trigono/i },
  { topic: 'Coordinate geometry', subject: 'Maths', words: /parabola|ellipse|hyperbola|\bgraph|y\s*=|coordinate/i },
  { topic: 'Geometry', subject: 'Maths', words: /triangle|polygon|\bangle|perpendicular|circle|chord|tangent|congruent/i },
  { topic: 'Algebra', subject: 'Maths', words: /equation|quadratic|polynomial|\broots?\b|factor|x\^2|=/i },
];

/** What a diagram or simulator kind says about its topic. Strong hints win over the words. */
const STRONG: Record<string, { topic: string; subject: Subject }> = {
  mechanics: { topic: 'Laws of motion', subject: 'Physics' },
  circuit: { topic: 'Current electricity', subject: 'Physics' },
  pulley: { topic: 'Laws of motion', subject: 'Physics' },
  incline: { topic: 'Laws of motion', subject: 'Physics' },
  spring: { topic: 'Oscillations', subject: 'Physics' },
  pendulum: { topic: 'Oscillations', subject: 'Physics' },
  projectile: { topic: 'Motion in a plane', subject: 'Physics' },
  optics: { topic: 'Ray optics', subject: 'Physics' },
};
const WEAK: Record<string, { topic: string; subject: Subject }> = {
  graph: { topic: 'Coordinate geometry', subject: 'Maths' },
  geometry: { topic: 'Geometry', subject: 'Maths' },
  chemistry: { topic: 'Chemical bonding', subject: 'Chemistry' },
};

/** The school topic for some work, from its kind and its words. */
export function topicOf(text: string, hint?: string): { topic: string; subject: Subject } {
  if (hint && STRONG[hint]) return STRONG[hint];
  const found = TOPICS.find((t) => t.words.test(text));
  if (found) return { topic: found.topic, subject: found.subject };
  if (hint && WEAK[hint]) return WEAK[hint];
  return { topic: 'Other', subject: 'General' };
}

// --- storage --------------------------------------------------------------------------------

const listeners = new Set<() => void>();

/** Calls `fn` whenever the memory changes; returns the way to stop. */
export function onMemory(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function loadMemory(): MemoryEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((e) => e && typeof e.title === 'string' && typeof e.topic === 'string') : [];
  } catch {
    return [];
  }
}

function save(list: MemoryEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // Storage full: memory is a help, never worth an error.
  }
  for (const fn of listeners) fn();
}

/** Records one piece of work. Doing the same thing again moves it to the top instead of repeating it. */
export function remember(e: { kind: MemoryKind; title: string; tex?: boolean; result?: string; hint?: string; words?: string }) {
  const title = e.title.replace(/\s+/g, ' ').trim().slice(0, 140);
  if (!title) return;
  const list = loadMemory();
  const i = list.slice(0, 12).findIndex((m) => m.kind === e.kind && m.title === title);
  if (i >= 0) {
    const m = list.splice(i, 1)[0];
    list.unshift({ ...m, at: Date.now(), times: m.times + 1, result: e.result ?? m.result });
  } else {
    const t = topicOf(`${title} ${e.result ?? ''} ${e.words ?? ''}`, e.hint);
    list.unshift({
      id: Math.random().toString(36).slice(2, 10), kind: e.kind, title, tex: e.tex,
      result: e.result?.slice(0, 140), topic: t.topic, subject: t.subject, at: Date.now(), times: 1,
    });
  }
  save(list);
}

export function clearMemory() {
  save([]);
}

export interface TopicCount {
  topic: string;
  subject: Subject;
  count: number;
  last: number;
}

/** Topics worked on, most worked on first. */
export function topicCounts(list: MemoryEntry[] = loadMemory()): TopicCount[] {
  const by = new Map<string, TopicCount>();
  for (const m of list) {
    const t = by.get(m.topic) ?? { topic: m.topic, subject: m.subject, count: 0, last: 0 };
    t.count += m.times;
    t.last = Math.max(t.last, m.at);
    by.set(m.topic, t);
  }
  return [...by.values()].sort((a, b) => b.count - a.count || b.last - a.last);
}

const plain = (latex: string) =>
  latex
    .replace(/\\(?:left|right|displaystyle)/g, '')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
    .replace(/\\(?:cdot|times)/g, '·')
    .replace(/\\([a-zA-Z]+)/g, '$1')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** An entry's title as plain text. */
export const entryText = (m: MemoryEntry) => (m.tex ? plain(m.title) : m.title);

/**
 * What the AI is told about this board, in one short paragraph: the topics so far and the last
 * few things done. Empty when nothing has been done yet.
 */
export function memorySummary(list: MemoryEntry[] = loadMemory()): string {
  if (list.length === 0) return '';
  const topics = topicCounts(list)
    .slice(0, 4)
    .map((t) => `${t.topic} (${t.count})`)
    .join(', ');
  const recent = list.slice(0, 4).map((m) => {
    const title = entryText(m).slice(0, 60);
    if (m.kind === 'solve') return `solved ${title}${m.result ? ` → ${plain(m.result).slice(0, 30)}` : ''}`;
    return `${m.kind === 'sim' ? 'ran simulator' : 'drew'} “${title}”`;
  });
  const out = `Topics on this board: ${topics}. Recent: ${recent.join('; ')}.`;
  return out.length > SUMMARY_MAX ? `${out.slice(0, SUMMARY_MAX - 1)}…` : out;
}
