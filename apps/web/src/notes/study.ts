/**
 * The student's study habit, kept in this browser: what the AI has learned about them (board,
 * class, subjects), which days they studied, and when each set of notes is due for revision.
 */
import type { Plan, Profile } from './types';

const PROFILE_KEY = 'slate.study.profile.v1';
const DAYS_KEY = 'slate.study.days.v1';
const REVIEW_KEY = 'slate.study.reviews.v1';

const listeners = new Set<() => void>();

/** Calls `fn` whenever the profile, streak or revision plan changes; returns the way to stop. */
export function onStudy(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the habit features are a help, never worth an error.
  }
  for (const fn of listeners) fn();
}

// --- profile -----------------------------------------------------------------------------------

export function loadProfile(): Profile | null {
  const p = read<Profile | null>(PROFILE_KEY, null);
  return p && typeof p.board === 'string' ? { board: p.board, grade: String(p.grade ?? ''), subjects: Array.isArray(p.subjects) ? p.subjects.slice(0, 8) : [] } : null;
}

/** Keeps what was learned; an empty field never wipes a known one. */
export function mergeProfile(next: Profile) {
  const cur = loadProfile();
  const merged: Profile = {
    board: next.board || cur?.board || '',
    grade: next.grade || cur?.grade || '',
    subjects: [...new Set([...(next.subjects ?? []), ...(cur?.subjects ?? [])])].slice(0, 8),
  };
  write(PROFILE_KEY, merged);
}

export function clearProfile() {
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    // ignore
  }
  for (const fn of listeners) fn();
}

export const profileLabel = (p: Profile | null) =>
  p && (p.board || p.grade) ? [p.board, p.grade && `Class ${p.grade}`].filter(Boolean).join(' · ') : '';

// --- streak ------------------------------------------------------------------------------------

/** Today as YYYY-MM-DD in the student's own time zone. */
export function today(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const addDays = (day: string, n: number) => {
  const [y, m, d] = day.split('-').map(Number);
  return today(new Date(y, m - 1, d + n));
};

export function markStudied() {
  const days = read<string[]>(DAYS_KEY, []);
  const t = today();
  if (days.includes(t)) return;
  write(DAYS_KEY, [t, ...days].slice(0, 400));
}

/** Days in a row with some study, ending today (or yesterday, so the streak survives until tonight). */
export function streak(): { days: number; today: boolean } {
  const set = new Set(read<string[]>(DAYS_KEY, []));
  const t = today();
  const studiedToday = set.has(t);
  let day = studiedToday ? t : addDays(t, -1);
  let n = 0;
  while (set.has(day)) {
    n += 1;
    day = addDays(day, -1);
  }
  return { days: n, today: studiedToday };
}

// --- revision plan ---------------------------------------------------------------------------------

/** Spaced revision: a short quiz 1, 3 and 7 days after the notes were written. */
const GAPS = [1, 3, 7];

export interface Review {
  id: string;
  title: string;
  topic: string;
  subject: string;
  profile: Profile;
  /** YYYY-MM-DD of each review, and which are done. */
  due: string[];
  done: boolean[];
}

export function loadReviews(): Review[] {
  const list = read<Review[]>(REVIEW_KEY, []);
  return Array.isArray(list) ? list.filter((r) => r && Array.isArray(r.due) && Array.isArray(r.done)) : [];
}

export function scheduleReviews(plan: Plan) {
  if (plan.kind === 'revision' || plan.kind === 'quiz') return;
  const list = loadReviews().filter((r) => r.topic !== plan.topic);
  const t = today();
  list.unshift({
    id: Math.random().toString(36).slice(2, 10),
    title: plan.title,
    topic: plan.topic,
    subject: plan.subject,
    profile: plan.profile,
    due: GAPS.map((g) => addDays(t, g)),
    done: GAPS.map(() => false),
  });
  write(REVIEW_KEY, list.slice(0, 40));
}

/** Reviews due today or overdue, with which step of the plan each is at. */
export function dueReviews(): { review: Review; step: number }[] {
  const t = today();
  const out: { review: Review; step: number }[] = [];
  for (const r of loadReviews()) {
    const step = r.done.findIndex((d) => !d);
    if (step >= 0 && r.due[step] <= t) out.push({ review: r, step });
  }
  return out;
}

/** The next review that is not yet due, for "next revision: Thursday". */
export function nextReview(): { review: Review; day: string } | null {
  const t = today();
  let best: { review: Review; day: string } | null = null;
  for (const r of loadReviews()) {
    const step = r.done.findIndex((d) => !d);
    if (step < 0 || r.due[step] <= t) continue;
    if (!best || r.due[step] < best.day) best = { review: r, day: r.due[step] };
  }
  return best;
}

export function completeReview(id: string) {
  const list = loadReviews().map((r) => {
    if (r.id !== id) return r;
    const step = r.done.findIndex((d) => !d);
    return step < 0 ? r : { ...r, done: r.done.map((d, i) => (i === step ? true : d)) };
  });
  write(REVIEW_KEY, list);
}

export function dayLabel(day: string): string {
  const t = today();
  if (day === t) return 'today';
  if (day === addDays(t, 1)) return 'tomorrow';
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'long' });
}

/** The last `n` days, oldest first, and whether there was study on each. */
export function recentDays(n = 7): { day: string; studied: boolean; label: string }[] {
  const set = new Set(read<string[]>(DAYS_KEY, []));
  const t = today();
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(t, i - (n - 1));
    const [y, m, d] = day.split('-').map(Number);
    return { day, studied: set.has(day), label: new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'narrow' }) };
  });
}
