import type { SolveEvent, SolveMode, Work } from './types';
import { ApiError, authFetch } from './auth/authFetch';
import { track } from './firebase';

export const newWork = (mode: SolveMode): Work => ({
  mode,
  phase: 'reading',
  startedAt: Date.now(),
  items: [],
});

/** Applies one stream event to the Work shown for a solve. */
export function reduceWork(w: Work, ev: SolveEvent): Work {
  switch (ev.type) {
    case 'read':
      return {
        ...w,
        phase: 'thinking',
        read: {
          latex: ev.result.latex,
          text: ev.result.text,
          sketch: ev.result.sketch_description,
          uncertain: ev.result.uncertain ?? [],
          alternatives: ev.result.alternatives ?? [],
          confidence: ev.result.confidence ?? 0,
          corrected: !!ev.corrected,
          model: ev.model,
          ms: ev.ms,
        },
      };
    case 'think': {
      const items = w.items.slice();
      const last = items[items.length - 1];
      if (last && last.kind === 'think') items[items.length - 1] = { kind: 'think', text: last.text + ev.delta };
      else items.push({ kind: 'think', text: ev.delta });
      return { ...w, phase: 'thinking', items };
    }
    case 'tool':
      return { ...w, phase: 'calculating', items: [...w.items, { kind: 'calc', id: ev.id, op: ev.op, args: ev.args }] };
    case 'tool_result':
      return {
        ...w,
        phase: 'thinking',
        items: w.items.map((it) =>
          it.kind === 'calc' && it.id === ev.id && !it.result ? { ...it, result: ev.result, ms: ev.ms } : it,
        ),
      };
    case 'wait':
      return { ...w, phase: 'waiting', items: [...w.items, { kind: 'wait', seconds: ev.seconds, reason: ev.reason }] };
    case 'answer':
      return {
        ...w,
        phase: 'writing',
        answer: {
          latex: ev.answer_latex,
          steps: ev.steps,
          columns: ev.columns ?? [],
          note: ev.note,
          verified: ev.verified,
          verification: ev.verification ?? (ev.verified ? 'computed' : 'none'),
          ms: ev.ms,
          sampleId: ev.id,
          saved: ev.saved,
        },
      };
    case 'error':
      return { ...w, phase: 'error', error: ev.message };
  }
}

/**
 * Starts a solve and reports each event as it arrives. Always ends with an answer or an error
 * event, including when the connection drops part-way, so the caller never waits forever.
 */
export async function solveStream(
  image: string,
  mode: SolveMode,
  onEvent: (ev: SolveEvent) => void,
  signal: AbortSignal,
  /** The user's own reading of their writing; skips reading the image. */
  readLatex?: string,
  /** A short summary of earlier work on this board, so the answer can build on it. */
  context?: string,
): Promise<void> {
  track('solve_request', { mode, reread: readLatex ? 1 : 0 });
  let res: Response;
  try {
    res = await authFetch('/api/solve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image, mode, read_latex: readLatex ?? null, context: context ?? '' }),
      signal,
    });
  } catch (err) {
    if (signal.aborted || err instanceof ApiError) throw err;
    throw new Error('Cannot reach the Slate AI server. Is it running on port 8787?');
  }
  if (!res.ok || !res.body) {
    let message = `The AI server answered with HTTP ${res.status}.`;
    try {
      const body = await res.json();
      if (typeof body.detail === 'string') message = body.detail;
    } catch {
      // keep the status message
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let ended = false;
  const handle = (line: string) => {
    const text = line.trim();
    if (!text) return;
    let ev: SolveEvent;
    try {
      ev = JSON.parse(text) as SolveEvent;
    } catch {
      return;
    }
    if (ev.type === 'answer' || ev.type === 'error') ended = true;
    onEvent(ev);
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        handle(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
      }
    }
    handle(buffer);
  } catch (err) {
    if (signal.aborted) throw err;
    if (!ended) onEvent({ type: 'error', message: 'The connection to the AI server dropped.' });
    return;
  }
  if (!ended) onEvent({ type: 'error', message: 'The AI server stopped before giving an answer.' });
}
