/**
 * fetch for the Slate API with the user's Firebase ID token attached.
 *
 * - Every /api request except /api/health sends `Authorization: Bearer <idToken>`.
 * - On 401 the token is force-refreshed and the request retried once. A second 401 signs the
 *   user out, which returns the app to the sign-in screen.
 * - On 429 the server's `detail` and `Retry-After` become a friendly error, and a `limit`
 *   event is emitted so the UI can show a toast.
 * - X-Quota-Limit / X-Quota-Remaining / X-Quota-Reset are reported as a `quota` event.
 */
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { apiEvents } from './events';
import { deviceId, forgetClaim, pendingClaim } from './device';
import { thoughtLevel } from '../settings/store';

/** An error from the API that already has a message fit to show the user. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const PUBLIC = new Set(['/api/health']);

/** The request's path, or null when it goes to another origin (which must never get the token). */
const pathOf = (input: string): string | null => {
  try {
    const url = new URL(input, location.origin);
    return url.origin === location.origin ? url.pathname : null;
  } catch {
    return null;
  }
};

async function bearer(force: boolean): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(force);
  } catch {
    return null;
  }
}

function withToken(init: RequestInit, token: string | null): RequestInit {
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  headers.set('X-Slate-Device', deviceId());
  // The Settings choice for how much the AI thinks before it answers.
  headers.set('X-Slate-Thought', thoughtLevel());
  return { ...init, headers };
}

/** Seconds from a Retry-After header, which may be a number of seconds or an HTTP date. */
export function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const secs = Number(value);
  if (Number.isFinite(secs)) return Math.max(0, Math.round(secs));
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : Math.max(0, Math.round((at - Date.now()) / 1000));
}

/** "in 40 seconds", "in 12 minutes", "in about 3 hours", or "tomorrow". */
export function friendlyWait(secs: number): string {
  if (secs < 60) return `in ${Math.max(1, secs)} second${secs === 1 ? '' : 's'}`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `in ${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 20) return `in about ${hours} hour${hours === 1 ? '' : 's'}`;
  return 'tomorrow';
}

function reportQuota(res: Response, path: string) {
  const limit = res.headers.get('X-Quota-Limit');
  const remaining = res.headers.get('X-Quota-Remaining');
  const reset = res.headers.get('X-Quota-Reset');
  if (limit === null && remaining === null && reset === null) return;
  const num = (v: string | null) => (v !== null && Number.isFinite(Number(v)) ? Number(v) : null);
  apiEvents.emit('quota', { limit: num(limit), remaining: num(remaining), reset, path });
}

async function detailOf(res: Response): Promise<string | null> {
  try {
    const body = await res.clone().json();
    if (typeof body?.detail === 'string') return body.detail;
  } catch {
    // not JSON
  }
  return null;
}

export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const path = pathOf(input);
  if (path === null || PUBLIC.has(path) || !path.startsWith('/api/')) return fetch(input, init);

  // A sign-in that is still claiming this device goes first, or the server would refuse us.
  await pendingClaim();
  let res = await fetch(input, withToken(init, await bearer(false)));

  // The account was signed in on another device: this one signs out, without retrying.
  if (res.status === 401 && res.headers.get('X-Slate-Reason') === 'other-device') {
    forgetClaim();
    apiEvents.emit('other-device', { path });
    try {
      await signOut(auth);
    } catch {
      // already signed out
    }
    throw new ApiError(401, 'Your account was signed in on another device, so it was signed out here.');
  }

  if (res.status === 401 && auth.currentUser) {
    const fresh = await bearer(true);
    if (fresh) res = await fetch(input, withToken(init, fresh));
  }

  if (res.status === 401) {
    apiEvents.emit('session-expired', { path });
    try {
      await signOut(auth);
    } catch {
      // already signed out
    }
    throw new ApiError(401, 'Your session has ended. Sign in again to keep going.');
  }

  reportQuota(res, path);

  if (res.status === 429) {
    const detail = await detailOf(res);
    const retryAfter = parseRetryAfter(res.headers.get('Retry-After'));
    const base = detail ?? "You've reached today's limit.";
    const message = retryAfter !== null ? `${base} You can try again ${friendlyWait(retryAfter)}.` : base;
    apiEvents.emit('limit', { message, detail, retryAfter, path });
    throw new ApiError(429, message);
  }

  return res;
}
