/**
 * Abuse protection: per-user daily quotas (Firestore), burst limits (memory), and a cap on
 * concurrent solve streams.
 *
 * Daily counters live in usage/{uid}/days/{YYYY-MM-DD} (UTC day) with one field per class:
 * solve (solve + recognize), diagram, molecule, assist (slate titles, practice questions),
 * notes (planning and writing study notes), search (web, image and video lookups, image imports). users/{uid}.limits may override the defaults and
 * users/{uid}.blocked stops the account; both are written only with the Admin SDK.
 */
import type { NextFunction, Request, Response } from 'express';
import { FieldValue, getFirestore, type Firestore } from 'firebase-admin/firestore';
import { authDisabled, firebaseApp } from './auth.ts';
import { env, flag, int } from './env.ts';
import { HttpError } from './http.ts';
import { attribute, onTokens } from './usage.ts';
import { CLASSES, defaultLimits, entitlementFor, type Counts, type QuotaClass } from './entitlements.ts';

export { CLASSES, defaultLimits } from './entitlements.ts';
export type { Counts, QuotaClass } from './entitlements.ts';

/** Percent of today's AI allowance left, 0 to 100. */
export const aiLeft = (tokens: number, allowance: number): number =>
  allowance >= Number.MAX_SAFE_INTEGER ? 100 : Math.max(0, Math.min(100, Math.round(100 - (tokens / Math.max(1, allowance)) * 100)));

// Tokens counted from provider responses go to the student's day.
onTokens((uid, day, n) => {
  // SLATE_LOG_TOKENS=1 prints each counted AI call, to size the allowance from real costs.
  if (flag('SLATE_LOG_TOKENS')) console.log(`[tokens] ${uid.slice(0, 6)} +${n}`);
  quotaStore()
    .addTokens(uid, day, n)
    .catch((e) => console.error('[quota] token count failed:', (e as Error).name, String((e as Error).message).slice(0, 200)));
});


/** Requests per minute per user, per class. */
export function burstLimits(): Counts {
  return {
    solve: int('SLATE_BURST_SOLVE_MIN', 10),
    diagram: int('SLATE_BURST_DIAGRAM_MIN', 6),
    molecule: int('SLATE_BURST_MOLECULE_MIN', 30),
    assist: int('SLATE_BURST_ASSIST_MIN', 10),
    notes: int('SLATE_BURST_NOTES_MIN', 20),
    search: int('SLATE_BURST_SEARCH_MIN', 40),
  };
}

export const dayKey = (now = new Date()): string => now.toISOString().slice(0, 10);

/** The start of the next UTC day, when daily counters reset. */
export function nextReset(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}

const secondsUntil = (when: Date, now = new Date()): number => Math.max(1, Math.ceil((when.getTime() - now.getTime()) / 1000));

// --- user overrides --------------------------------------------------------------------------

/** Merges users/{uid}.limits over the defaults. Only whole numbers >= 0 are accepted. */
export function mergeLimits(base: Counts, override: unknown): Counts {
  const out = { ...base };
  if (override && typeof override === 'object') {
    for (const k of CLASSES) {
      const v = (override as Record<string, unknown>)[k];
      if (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 1_000_000) out[k] = v;
    }
  }
  return out;
}

// --- stores ----------------------------------------------------------------------------------

export interface ChargeResult {
  allowed: boolean;
  blocked: boolean;
  limit: number;
  used: number;
  /** AI tokens used today, and the plan's daily allowance. */
  tokens: number;
  allowance: number;
  /** True when the request was refused because the AI allowance is used up. */
  outOfAi?: boolean;
}

export interface Usage {
  used: Counts;
  limits: Counts;
  blocked: boolean;
  tokens: number;
}

export interface QuotaStore {
  /** Counts one request when the user is under the limit. */
  /** `base` is the plan's limits; users/{uid}.limits may override them. */
  charge(uid: string, klass: QuotaClass, day: string, base?: Counts, allowance?: number): Promise<ChargeResult>;
  usage(uid: string, day: string, base?: Counts): Promise<Usage>;
  /** Adds AI tokens to the day, after the provider has answered. */
  addTokens(uid: string, day: string, n: number): Promise<void>;
}

/** No allowance passed: tokens are counted but never refuse a request. */
const NO_ALLOWANCE = Number.MAX_SAFE_INTEGER;

const zero = (): Counts => ({ solve: 0, diagram: 0, molecule: 0, assist: 0, notes: 0, search: 0 });

export class MemoryQuotaStore implements QuotaStore {
  private days = new Map<string, Counts>();
  private tokenDays = new Map<string, number>();
  users = new Map<string, { limits?: Partial<Counts>; blocked?: boolean }>();

  private row(uid: string, day: string): Counts {
    const key = `${uid}/${day}`;
    let r = this.days.get(key);
    if (!r) {
      // Keep the map small: forget other days.
      for (const k of this.days.keys()) if (!k.endsWith(`/${day}`)) this.days.delete(k);
      for (const k of this.tokenDays.keys()) if (!k.endsWith(`/${day}`)) this.tokenDays.delete(k);
      r = zero();
      this.days.set(key, r);
    }
    return r;
  }

  async charge(uid: string, klass: QuotaClass, day: string, base = defaultLimits(), allowance = NO_ALLOWANCE): Promise<ChargeResult> {
    const user = this.users.get(uid) ?? {};
    const limits = mergeLimits(base, user.limits);
    const row = this.row(uid, day);
    const tokens = this.tokenDays.get(`${uid}/${day}`) ?? 0;
    const r = { limit: limits[klass], used: row[klass], tokens, allowance };
    if (user.blocked) return { ...r, allowed: false, blocked: true };
    if (tokens >= allowance) return { ...r, allowed: false, blocked: false, outOfAi: true };
    if (row[klass] >= limits[klass]) return { ...r, allowed: false, blocked: false };
    row[klass] += 1;
    return { ...r, used: row[klass], allowed: true, blocked: false };
  }

  async usage(uid: string, day: string, base = defaultLimits()): Promise<Usage> {
    const user = this.users.get(uid) ?? {};
    return {
      used: { ...this.row(uid, day) },
      limits: mergeLimits(base, user.limits),
      blocked: !!user.blocked,
      tokens: this.tokenDays.get(`${uid}/${day}`) ?? 0,
    };
  }

  async addTokens(uid: string, day: string, n: number): Promise<void> {
    this.row(uid, day);
    const key = `${uid}/${day}`;
    this.tokenDays.set(key, (this.tokenDays.get(key) ?? 0) + n);
  }
}

const UID = /^[A-Za-z0-9_-]{1,128}$/;

export class FirestoreQuotaStore implements QuotaStore {
  private dbInstance: Firestore | null = null;
  private get db(): Firestore {
    return (this.dbInstance ??= getFirestore(firebaseApp()));
  }

  private refs(uid: string, day: string) {
    if (!UID.test(uid)) throw new HttpError(401, 'Your sign-in token is not valid. Sign in again.');
    return { user: this.db.doc(`users/${uid}`), day: this.db.doc(`usage/${uid}/days/${day}`) };
  }

  async charge(uid: string, klass: QuotaClass, day: string, base = defaultLimits(), allowance = NO_ALLOWANCE): Promise<ChargeResult> {
    const refs = this.refs(uid, day);
    return this.db.runTransaction(async (tx) => {
      const [u, d] = await tx.getAll(refs.user, refs.day);
      const user = u.exists ? u.data() ?? {} : {};
      const limits = mergeLimits(base, user.limits);
      const used = Number(d.exists ? d.get(klass) ?? 0 : 0) || 0;
      const tokens = Number(d.exists ? d.get('tokens') ?? 0 : 0) || 0;
      const r = { limit: limits[klass], used, tokens, allowance };
      if (user.blocked === true) return { ...r, allowed: false, blocked: true };
      if (tokens >= allowance) return { ...r, allowed: false, blocked: false, outOfAi: true };
      if (used >= limits[klass]) return { ...r, allowed: false, blocked: false };
      tx.set(refs.day, { [klass]: FieldValue.increment(1), day, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { ...r, used: used + 1, allowed: true, blocked: false };
    });
  }

  async addTokens(uid: string, day: string, n: number): Promise<void> {
    const refs = this.refs(uid, day);
    await refs.day.set({ tokens: FieldValue.increment(n), day, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  }

  async usage(uid: string, day: string, base = defaultLimits()) {
    const refs = this.refs(uid, day);
    const [u, d] = await this.db.getAll(refs.user, refs.day);
    const user = u.exists ? u.data() ?? {} : {};
    const used = zero();
    if (d.exists) for (const k of CLASSES) used[k] = Number(d.get(k) ?? 0) || 0;
    const tokens = d.exists ? Number(d.get('tokens') ?? 0) || 0 : 0;
    return { used, limits: mergeLimits(base, user.limits), blocked: user.blocked === true, tokens };
  }
}

let store: QuotaStore | null = null;

/** Memory when auth is bypassed (dev) or SLATE_QUOTA_STORE=memory; Firestore otherwise. */
export function quotaStore(): QuotaStore {
  if (store) return store;
  store = authDisabled() || env('SLATE_QUOTA_STORE') === 'memory' ? new MemoryQuotaStore() : new FirestoreQuotaStore();
  return store;
}

export function setQuotaStore(s: QuotaStore | null): void {
  store = s;
}

// --- burst limits ----------------------------------------------------------------------------

/** Token buckets: `perMin` requests a minute, refilled continuously, bursting up to `perMin`. */
export class Buckets {
  private state = new Map<string, { tokens: number; at: number }>();
  private lastSweep = Date.now();

  /** 0 when allowed (and a token is taken); otherwise seconds to wait. */
  take(key: string, perMin: number, now = Date.now()): number {
    if (perMin <= 0) return 0; // 0 turns the limit off
    this.sweep(now);
    const rate = perMin / 60_000;
    const s = this.state.get(key) ?? { tokens: perMin, at: now };
    s.tokens = Math.min(perMin, s.tokens + (now - s.at) * rate);
    s.at = now;
    if (s.tokens >= 1) {
      s.tokens -= 1;
      this.state.set(key, s);
      return 0;
    }
    this.state.set(key, s);
    return Math.max(1, Math.ceil((1 - s.tokens) / rate / 1000));
  }

  private sweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    // A bucket untouched for 10 minutes is full again; forgetting it changes nothing.
    for (const [k, s] of this.state) if (now - s.at > 600_000) this.state.delete(k);
  }

  clear(): void {
    this.state.clear();
  }
}

export const userBuckets = new Buckets();
export const ipBuckets = new Buckets();

/** Per-IP limit on all /api traffic, applied before the token is checked. */
export function ipLimit(req: Request, res: Response, next: NextFunction): void {
  const perMin = int('SLATE_IP_PER_MIN', 120);
  const wait = ipBuckets.take(`ip:${req.ip ?? 'unknown'}`, perMin);
  if (wait) return next(new HttpError(429, 'Too many requests from this network. Slow down a little.', { 'Retry-After': String(wait) }));
  next();
}

// --- concurrent solve streams ----------------------------------------------------------------

const streams = new Map<string, number>();

export const maxStreams = (): number => int('SLATE_MAX_STREAMS', 2);

/** Takes a stream slot for the user, released once when the response ends or the client goes. */
export function takeStream(uid: string, res: Response): void {
  const n = streams.get(uid) ?? 0;
  if (n >= maxStreams()) {
    throw new HttpError(429, `You already have ${n} answers being worked out. Wait for one to finish.`, { 'Retry-After': '5' });
  }
  streams.set(uid, n + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    const left = (streams.get(uid) ?? 1) - 1;
    if (left <= 0) streams.delete(uid);
    else streams.set(uid, left);
  };
  res.on('close', release);
  res.on('finish', release);
}

export const activeStreams = (uid: string): number => streams.get(uid) ?? 0;

// --- metering --------------------------------------------------------------------------------

function quotaHeaders(res: Response, limit: number, remaining: number, reset: Date): void {
  res.setHeader('X-Quota-Limit', String(limit));
  res.setHeader('X-Quota-Remaining', String(Math.max(0, remaining)));
  res.setHeader('X-Quota-Reset', reset.toISOString());
}

const LABEL: Record<QuotaClass, string> = { solve: 'answers', diagram: 'diagrams', molecule: 'molecule lookups', assist: 'titles and practice questions', notes: 'study notes', search: 'searches and image imports' };

/**
 * Checks the burst limit, then counts the request against today's quota. Throws a 429 (with
 * Retry-After) or 403 {detail}; sets the X-Quota-* headers either way.
 */
export async function meter(uid: string, klass: QuotaClass, res: Response): Promise<void> {
  const wait = userBuckets.take(`${uid}:${klass}`, burstLimits()[klass]);
  if (wait) {
    throw new HttpError(429, `That's a lot of ${LABEL[klass]} in a minute. Take a short break.`, { 'Retry-After': String(wait) });
  }
  const now = new Date();
  const reset = nextReset(now);
  let r: ChargeResult;
  try {
    const ent = entitlementFor(uid);
    const day = dayKey(now);
    r = await quotaStore().charge(uid, klass, day, ent.limits, ent.aiTokensPerDay);
    // AI calls made for the rest of this request count toward this student's day.
    attribute(uid, day);
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // Fail closed: without the counter there is no limit.
    console.error('[quota] store unavailable:', (err as Error).name, String((err as Error).message).slice(0, 200));
    throw new HttpError(503, 'Usage limits could not be checked right now. Try again in a moment.', { 'Retry-After': '10' });
  }
  if (r.blocked) throw new HttpError(403, 'This account has been blocked from Slate AI.');
  // The headers carry the share of today's AI allowance left, never a count of requests.
  quotaHeaders(res, 100, aiLeft(r.tokens, r.allowance), reset);
  if (r.outOfAi) {
    throw new HttpError(429, "You've used today's AI energy. It refills at midnight (UTC).", {
      'Retry-After': String(secondsUntil(reset, now)),
      'X-Quota-Limit': '100',
      'X-Quota-Remaining': '0',
      'X-Quota-Reset': reset.toISOString(),
    });
  }
  if (!r.allowed) {
    // A cap on one feature, far above normal use: it only stops scripted abuse.
    throw new HttpError(429, `That's a lot of ${LABEL[klass]} for one day. Try again tomorrow.`, {
      'Retry-After': String(secondsUntil(reset, now)),
      'X-Quota-Limit': '100',
      'X-Quota-Remaining': String(aiLeft(r.tokens, r.allowance)),
      'X-Quota-Reset': reset.toISOString(),
    });
  }
}

export async function usageFor(uid: string): Promise<{ day: string; used: Counts; limits: Counts; reset: string; blocked: boolean; tokens: number; allowance: number; left: number }> {
  const now = new Date();
  const day = dayKey(now);
  try {
    const ent = entitlementFor(uid);
    const allowance = ent.aiTokensPerDay;
    const u = await quotaStore().usage(uid, day, ent.limits);
    return {
      day, used: u.used, limits: u.limits, reset: nextReset(now).toISOString(), blocked: u.blocked,
      tokens: u.tokens, allowance, left: aiLeft(u.tokens, allowance),
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('[quota] usage read failed:', (err as Error).name, String((err as Error).message).slice(0, 200));
    throw new HttpError(503, 'Usage could not be read right now. Try again in a moment.');
  }
}
