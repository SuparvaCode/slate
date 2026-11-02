/** Slate API server entry point: `node dist/index.js` (or `node src/index.ts` in development). */
import { createApp } from './app.ts';
import { warnIfAuthDisabled } from './auth.ts';
import { calculator } from './calc.ts';
import { env, int, isProduction } from './env.ts';

warnIfAuthDisabled();
calculator.warm();

const port = int('PORT', 8787);
const host = env('HOST', '0.0.0.0');
const server = createApp().listen(port, host, () => {
  console.log(`[slate] listening on http://${host}:${port} (${isProduction() ? 'production' : 'development'})`);
});
// Solve streams can be quiet while a model thinks; don't cut them off.
server.requestTimeout = 0;
server.headersTimeout = 65_000;
server.keepAliveTimeout = 61_000;

const stop = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
