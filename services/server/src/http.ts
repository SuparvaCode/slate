/** HTTP plumbing: the {detail} error shape, security headers, CORS, body limits, static SPA. */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import cors from 'cors';
import express, { type ErrorRequestHandler, type Express, type RequestHandler } from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { env, isProduction, webDist } from './env.ts';

/** An error whose message is safe to show the user. Anything else becomes a generic 500. */
export class HttpError extends Error {
  status: number;
  headers: Record<string, string>;
  constructor(status: number, detail: string, headers: Record<string, string> = {}) {
    super(detail);
    this.status = status;
    this.headers = headers;
  }
}

export const IMAGE_BODY_LIMIT = '8mb';
export const SMALL_BODY_LIMIT = '64kb';
/** The diagram route carries a previous diagram of up to 40,000 characters plus text fields. */
export const DIAGRAM_BODY_LIMIT = '128kb';

export const jsonBody = (limit: string): RequestHandler => express.json({ limit, strict: true, type: 'application/json' });

/** The first zod problem as one readable sentence, e.g. "image: Image is too long." */
export function zodDetail(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return 'The request is not valid.';
  const where = issue.path.length ? `${issue.path.join('.')}: ` : '';
  return `${where}${issue.message}`.slice(0, 300);
}

/** Parses req.body (or query) with a schema, throwing a 422 {detail} on failure. */
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const r = schema.safeParse(value);
  if (!r.success) throw new HttpError(422, zodDetail(r.error));
  return r.data;
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (res.headersSent) {
    res.end();
    return;
  }
  let status = 500;
  let detail = 'Something went wrong on the server.';
  let headers: Record<string, string> = {};
  if (err instanceof HttpError) {
    status = err.status;
    detail = err.message;
    headers = err.headers;
  } else if (err instanceof z.ZodError) {
    status = 422;
    detail = zodDetail(err);
  } else if (err && typeof err === 'object' && !('type' in err) && [404, 405, 416].includes(Number((err as { status?: number }).status))) {
    // express.static / send: a missing file is a plain 404, not a server error.
    status = Number((err as { status: number }).status);
    detail = status === 404 ? 'Not Found' : 'The request could not be served.';
  } else if (err && typeof err === 'object' && 'type' in err) {
    // body-parser errors carry a type and a status.
    const type = String((err as { type: unknown }).type);
    if (type === 'entity.too.large') {
      status = 413;
      detail = 'The request is too large.';
    } else if (type === 'entity.parse.failed') {
      status = 400;
      detail = 'The request body is not valid JSON.';
    } else if (type === 'encoding.unsupported' || type === 'charset.unsupported') {
      status = 415;
      detail = 'Unsupported request encoding.';
    } else {
      status = typeof (err as { status?: number }).status === 'number' ? (err as { status: number }).status : 400;
      detail = 'The request could not be read.';
    }
  }
  if (status >= 500 && !(err instanceof HttpError)) {
    // Log the kind and message only; no stack traces or request bodies in production logs.
    const e = err as Error;
    console.error('[error]', e?.name ?? 'Error', String(e?.message ?? '').slice(0, 300), isProduction() ? '' : e?.stack ?? '');
  }
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.status(status).json({ detail });
};

export function allowedOrigins(): string[] {
  return env('SLATE_ALLOWED_ORIGINS')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/**
 * CORS: same-origin requests (the SPA served by this process, or through the Vite proxy) need
 * no CORS at all. Only origins listed in SLATE_ALLOWED_ORIGINS get CORS headers.
 */
export function corsMiddleware(): RequestHandler {
  const allowed = new Set(allowedOrigins());
  return cors({
    origin: (origin, cb) => cb(null, origin ? allowed.has(origin) : false),
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Slate-Device'],
    exposedHeaders: ['X-Quota-Limit', 'X-Quota-Remaining', 'X-Quota-Reset', 'Retry-After', 'X-Slate-Reason'],
    maxAge: 600,
  });
}

export function securityHeaders(): RequestHandler {
  const firebaseAuthDomain = env('FIREBASE_AUTH_DOMAIN');
  const extraConnect = env('SLATE_CSP_CONNECT').split(/[\s,]+/).filter(Boolean);
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        scriptSrc: ["'self'", 'https://apis.google.com', 'https://www.googletagmanager.com', 'https://*.google-analytics.com'],
        scriptSrcAttr: ["'none'"],
        // KaTeX writes inline style attributes into its HTML, so inline styles must be allowed.
        styleSrc: ["'self'", "'unsafe-inline'"],
        fontSrc: ["'self'", 'data:'],
        imgSrc: [
          "'self'", 'data:', 'blob:', 'https://*.google-analytics.com', 'https://www.googletagmanager.com', 'https://*.googleusercontent.com',
          // Image search thumbnails and YouTube video thumbnails, shown in the study panel before import.
          'https://*.mm.bing.net', 'https://i.ytimg.com',
        ],
        connectSrc: [
          "'self'",
          'https://*.googleapis.com',
          ...(firebaseAuthDomain ? [`https://${firebaseAuthDomain}`] : []),
          'https://*.google-analytics.com',
          'https://*.analytics.google.com',
          'https://www.googletagmanager.com',
          // Collaborate rooms: Realtime Database over WebSocket, with HTTPS long-polling as fallback.
          'https://*.firebasedatabase.app',
          'wss://*.firebasedatabase.app',
          // Voice chat setup uses STUN through the browser, which CSP does not cover.
          ...extraConnect,
        ],
        frameSrc: [...(firebaseAuthDomain ? [`https://${firebaseAuthDomain}`] : []), 'https://apis.google.com', 'https://accounts.google.com'],
        workerSrc: ["'self'", 'blob:'],
        manifestSrc: ["'self'"],
        ...(isProduction() ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    // The Firebase sign-in popup talks back to the opener window.
    crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    strictTransportSecurity: isProduction() ? { maxAge: 31536000, includeSubDomains: true } : false,
  });
}

/** Serves the built frontend with an SPA fallback. Hashed assets are cached for a year. */
export function serveWeb(app: Express): boolean {
  const dist = webDist();
  const index = join(dist, 'index.html');
  if (!existsSync(index)) return false;
  app.use(
    '/assets',
    express.static(join(dist, 'assets'), {
      immutable: true,
      maxAge: '365d',
      index: false,
      fallthrough: false,
    }),
  );
  app.use(
    express.static(dist, {
      index: false,
      maxAge: '1h',
      // /.well-known/assetlinks.json (Android App Links) lives in a dot folder, which static
      // skips by default; it must be served as the file itself, not the app's HTML.
      dotfiles: 'allow',
      setHeaders: (res, path) => {
        if (path.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        if (path.endsWith('assetlinks.json')) res.setHeader('Content-Type', 'application/json');
      },
    }),
  );
  // Anything that is not an API call or a file gets the app, which routes on the client.
  app.get(/^(?!\/api(?:\/|$)).*/, (req, res, next) => {
    if (!req.accepts('html')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(index);
  });
  return true;
}
