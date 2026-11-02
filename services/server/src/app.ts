/** The Express app: security headers, CORS, per-IP limit, /api routes, and the built web app. */
import express from 'express';
import { flag, int, isProduction, webDist } from './env.ts';
import { HttpError, corsMiddleware, errorHandler, securityHeaders, serveWeb } from './http.ts';
import { ipLimit } from './limits.ts';
import { thoughtScope } from './thought.ts';
import { aiScope } from './usage.ts';
import { apiRouter, health, publicShareRouter } from './routes.ts';

export function createApp(): express.Express {
  const app = express();
  app.disable('x-powered-by');
  // Hops of reverse proxy in front of the app (Hostinger: 1). Never `true`: a client could then
  // set X-Forwarded-For itself and slip past the per-IP limit.
  app.set('trust proxy', int('SLATE_TRUST_PROXY', isProduction() ? 1 : 0));

  app.use(securityHeaders());
  app.use('/api', corsMiddleware());
  app.use('/api', ipLimit);
  // Every AI call made while answering a request is counted toward the caller's daily allowance,
  // and follows the caller's AI thought level (none, low, medium or high).
  app.use('/api', thoughtScope);
  app.use('/api', aiScope);
  app.get('/api/health', health);
  app.use('/api/share', publicShareRouter());
  app.use('/api', apiRouter());
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not Found')));

  if (isProduction() || flag('SLATE_SERVE_WEB')) {
    if (!serveWeb(app)) console.warn(`[web] no built frontend at ${webDist()}; serving the API only.`);
  }
  app.use(errorHandler);
  return app;
}
