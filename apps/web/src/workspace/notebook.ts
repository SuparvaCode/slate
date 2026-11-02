/**
 * Mistake notebook: questions the student got wrong, saved from the board or typed in, each with
 * practice questions like it. Kept in this browser only.
 */
import { topicOf, type Subject } from '../memory';
import type { Practice } from './assist';

export interface Mistake {
  id: string;
  /** The question, as LaTeX when `tex`, otherwise words. */
  question: string;
  tex: boolean;
  /** The correct answer, as LaTeX. */
  answer: string;
  /** What went wrong, in the student's words. */
  note: string;
  topic: string;
  subject: Subject;
  at: number;
  /** The latest practice question written for it. */
  practice?: Practice;
  tries: number;
  right: number;
  /** When the student last practised it. */
  practisedAt?: number;
}

const KEY = 'slate.notebook.v1';
const MAX = 300;

function load(): Mistake[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((m) => m && typeof m.id === 'string' && typeof m.question === 'string') : [];
  } catch {
    return [];
  }
}

let list = load();
let version = 0;
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // storage full; changes last for this visit
  }
  version++;
  listeners.forEach((fn) => fn());
}

export const notebookVersion = () => version;
export function onNotebook(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Newest first. */
export const mistakes = (): Mistake[] => list;

export function addMistake(question: string, tex: boolean, answer = '', note = ''): Mistake | null {
  const q = question.trim().slice(0, 600);
  if (!q) return null;
  const existing = list.find((m) => m.question === q);
  if (existing) return existing;
  const { topic, subject } = topicOf(`${q} ${answer}`);
  const m: Mistake = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    question: q, tex, answer: answer.trim().slice(0, 400), note: note.trim().slice(0, 400),
    topic, subject, at: Date.now(), tries: 0, right: 0,
  };
  list = [m, ...list].slice(0, MAX);
  persist();
  return m;
}

export function updateMistake(id: string, patch: Partial<Mistake>): void {
  list = list.map((m) => (m.id === id ? { ...m, ...patch } : m));
  persist();
}

export function removeMistake(id: string): void {
  list = list.filter((m) => m.id !== id);
  persist();
}

export function recordTry(id: string, gotIt: boolean): void {
  const m = list.find((x) => x.id === id);
  if (!m) return;
  updateMistake(id, { tries: m.tries + 1, right: m.right + (gotIt ? 1 : 0), practisedAt: Date.now() });
}
