/**
 * Firebase ID token verification. Every /api route except /api/health needs
 * `Authorization: Bearer <ID token>`; the token is checked for revocation as well.
 */
import type { NextFunction, Request, Response } from 'express';
import { applicationDefault, cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { env, flag, isProduction } from './env.ts';
import { HttpError } from './http.ts';

export const PROJECT_ID = env('FIREBASE_PROJECT_ID');

let app: App | null = null;

/** The Admin SDK app, created on first use from FIREBASE_SERVICE_ACCOUNT or GOOGLE_APPLICATION_CREDENTIALS. */
export function firebaseApp(): App {
  if (app) return app;
  const existing = getApps()[0];
  if (existing) return (app = existing);
  const b64 = env('FIREBASE_SERVICE_ACCOUNT');
  let credential;
  if (b64) {
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    } catch {
      // Never echo the value: it is a private key.
      throw new Error('FIREBASE_SERVICE_ACCOUNT is not base64-encoded service-account JSON.');
    }
    credential = cert(parsed);
  } else {
    credential = applicationDefault();
  }
  app = initializeApp({ credential, ...(PROJECT_ID ? { projectId: PROJECT_ID } : {}) });
  return app;
}

/** Dev bypass: only when explicitly asked for and never in production. */
export const authDisabled = (): boolean => flag('SLATE_AUTH_DISABLED') && !isProduction();

export function warnIfAuthDisabled(): void {
  if (flag('SLATE_AUTH_DISABLED') && isProduction()) {
    console.error('[auth] SLATE_AUTH_DISABLED=1 is IGNORED because NODE_ENV=production. Tokens are required.');
  } else if (authDisabled()) {
    const bar = '!'.repeat(72);
    console.warn(`${bar}\n[auth] SLATE_AUTH_DISABLED=1: Firebase token checks are OFF. Every request runs as uid "dev".\n` +
      `[auth] Quotas use in-memory counters. Never deploy with this setting.\n${bar}`);
  }
}

export const DEV_UID = 'dev';

export interface Caller {
  uid: string;
  email?: string;
}

/** The caller set by requireAuth. */
export const caller = (res: Response): Caller => res.locals.caller as Caller;

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h);
  return m ? m[1] : null;
}

/** Firebase ID tokens are JWTs: three base64url segments. Reject anything else before calling the SDK. */
function looksLikeJwt(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0 && /^[A-Za-z0-9_-]+$/.test(p));
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (authDisabled()) {
    res.locals.caller = { uid: DEV_UID } satisfies Caller;
    return next();
  }
  const token = bearer(req);
  if (!token) return next(new HttpError(401, 'Sign in to use Slate AI.'));
  if (token.length > 4096 || !looksLikeJwt(token)) {
    return next(new HttpError(401, 'Your sign-in token is not valid. Sign in again.'));
  }
  try {
    const decoded = await getAuth(firebaseApp()).verifyIdToken(token, true);
    if (PROJECT_ID && decoded.aud !== PROJECT_ID) throw Object.assign(new Error('aud'), { code: 'auth/invalid-audience' });
    res.locals.caller = { uid: decoded.uid, email: decoded.email } satisfies Caller;
    next();
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code === 'auth/user-disabled') return next(new HttpError(403, 'This account has been disabled.'));
    if (code === 'auth/id-token-revoked') return next(new HttpError(401, 'Your session was revoked. Sign in again.'));
    if (code === 'auth/id-token-expired') return next(new HttpError(401, 'Your sign-in expired. Sign in again.'));
    if (code.startsWith('auth/') || code === '') {
      if (!code.startsWith('auth/')) {
        // Not a token problem (credentials missing, network): log the kind, never the token.
        console.error('[auth] token check failed:', (err as Error).name, (err as Error).message?.slice(0, 200));
        return next(new HttpError(503, 'Sign-in could not be checked right now. Try again in a moment.'));
      }
      return next(new HttpError(401, 'Your sign-in token is not valid. Sign in again.'));
    }
    return next(new HttpError(401, 'Your sign-in token is not valid. Sign in again.'));
  }
}
