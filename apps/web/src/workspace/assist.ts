/** Calls to the Slate API for the workspace. Each one is charged to the student's own daily "assist" credits. */
import { ApiError, authFetch } from '../auth/authFetch';

export interface Practice {
  question_latex: string;
  question_text: string;
  answer_latex: string;
  hint: string;
}

async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await authFetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err instanceof ApiError || (err instanceof DOMException && err.name === 'AbortError')) throw err;
    throw new Error('Cannot reach the Slate API.');
  }
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const b = await res.json();
      if (typeof b.detail === 'string') message = b.detail;
    } catch {
      // keep the status
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

/** A short title for a board, from a picture of it (PNG data URL) and/or text already read from it. */
export const askTitle = (image: string | null, hints: string[], signal?: AbortSignal) =>
  post<{ title: string }>('/api/slate-title', { image, hints }, signal).then((r) => r.title);

/** A new question practising the same skill as one the student got wrong. */
export const askPractice = (question: string, answer: string, note: string, signal?: AbortSignal) =>
  post<Practice>('/api/practice', { question, answer, note }, signal);
