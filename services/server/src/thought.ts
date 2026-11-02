/**
 * The student's AI thought level, from Settings: none, low, medium or high. The app sends it with
 * every API request as `X-Slate-Thought`; each AI call made while answering that request reads it
 * here, so one setting reaches every model without threading a new argument through each function.
 *
 * Reading handwriting and naming a slate never take it: those copy what is there, and a reasoning
 * trace only makes them slower and less exact.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

export type Thought = 'none' | 'low' | 'medium' | 'high';

const LEVELS: readonly Thought[] = ['none', 'low', 'medium', 'high'];
const isThought = (v: unknown): v is Thought => typeof v === 'string' && (LEVELS as readonly string[]).includes(v);

const scope = new AsyncLocalStorage<Thought>();

/** Express middleware: the thought level this request asked for, for every AI call it makes. */
export function thoughtScope(req: Request, _res: Response, next: NextFunction): void {
  const raw = String(req.headers['x-slate-thought'] ?? '').trim().toLowerCase();
  scope.run(isThought(raw) ? raw : 'none', next);
}

/** The level for this request, or null when the caller sent none (an older app, or a webhook). */
export function requestThought(): Thought | null {
  return scope.getStore() ?? null;
}

/** Tokens a reasoning trace may add at `level`; models count their thinking against max_tokens. */
export function thoughtRoom(level: Thought): number {
  switch (level) {
    case 'low':
      return 1500;
    case 'medium':
      return 3000;
    case 'high':
      return 5000;
    default:
      return 0;
  }
}
