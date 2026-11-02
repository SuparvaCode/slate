/**
 * AI usage, counted in tokens, for the daily allowance. Every /api request runs in a scope; once
 * meter() knows who is asking, each AI provider response fetched during that request (Groq,
 * Experiential Labs, Anthropic, or any later one) is read for the token counts it reports, and
 * they are added to that student's day. The provider code itself never has to know.
 *
 * Only JSON and event-stream responses that carry a `usage` object count; web pages, images and
 * search results have none. The response the caller reads is never touched: a copy is read.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { NextFunction, Request, Response } from 'express';

interface Scope {
  uid: string | null;
  day: string;
}

const scope = new AsyncLocalStorage<Scope>();

/** Express middleware: one usage scope per request. */
export function aiScope(_req: Request, _res: Response, next: NextFunction): void {
  scope.run({ uid: null, day: '' }, next);
}

/** Charges AI calls made from here on in this request to `uid`'s `day`. */
export function attribute(uid: string, day: string): void {
  const s = scope.getStore();
  if (s) {
    s.uid = uid;
    s.day = day;
  }
}

type Sink = (uid: string, day: string, tokens: number) => void;
let sink: Sink | null = null;

/** Where counted tokens go (limits.ts adds them to the day's usage). */
export function onTokens(fn: Sink): void {
  sink = fn;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * Tokens in a provider response: OpenAI-style `usage` (total, or prompt + completion), Groq's
 * `x_groq.usage` on the last stream chunk, or Anthropic's input + output, which a stream reports
 * in two events. The largest value of each field wins, so repeated running totals are not summed.
 */
export function countTokens(text: string, contentType: string): number {
  if (!text.includes('_tokens')) return 0;
  const objects: unknown[] = [];
  if (contentType.includes('event-stream')) {
    for (const line of text.split('\n')) {
      const t = line.startsWith('data:') ? line.slice(5).trim() : '';
      if (!t || t === '[DONE]' || !t.includes('_tokens')) continue;
      try {
        objects.push(JSON.parse(t));
      } catch {
        // a partial or non-JSON event
      }
    }
  } else {
    try {
      objects.push(JSON.parse(text));
    } catch {
      return 0;
    }
  }
  let total = 0;
  let input = 0;
  let output = 0;
  for (const o of objects as any[]) {
    for (const u of [o?.usage, o?.x_groq?.usage, o?.message?.usage]) {
      if (!u || typeof u !== 'object') continue;
      total = Math.max(total, num(u.total_tokens));
      input = Math.max(input, num(u.prompt_tokens) || num(u.input_tokens));
      output = Math.max(output, num(u.completion_tokens) || num(u.output_tokens));
    }
  }
  return Math.round(total || input + output);
}

// Wrap fetch once, at startup, before any provider client is created.
const realFetch = globalThis.fetch;
globalThis.fetch = async function countingFetch(input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) {
  const res = await realFetch(input, init);
  const s = scope.getStore();
  if (!s?.uid || !sink || !res.body) return res;
  const type = res.headers.get('content-type') ?? '';
  if (!/json|event-stream/i.test(type)) return res;
  let copy: globalThis.Response;
  try {
    copy = res.clone();
  } catch {
    return res;
  }
  const { uid, day } = s;
  const add = sink;
  void copy
    .text()
    .then((text) => {
      const n = countTokens(text, type);
      if (n > 0) add(uid, day, n);
    })
    .catch(() => {
      // The caller aborted the stream; nothing complete to count.
    });
  return res;
} as typeof fetch;
