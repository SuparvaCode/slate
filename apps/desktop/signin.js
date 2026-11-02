// Google sign-in for the desktop app.
//
// 1. A server starts on 127.0.0.1 at a free port, with a random one-time `state`.
// 2. The system browser opens <site>/desktop-signin.html?port=…&state=…, where the student signs
//    in with Google as on the web.
// 3. That page goes to http://127.0.0.1:<port>/done#state=…&id=…&at=… . The tokens are in the
//    fragment, which the browser never sends anywhere; the page served here reads it, clears it
//    from the address bar and posts it back to this server.
// 4. The state must match, so no other page can hand this app a sign-in.
const http = require('node:http');
const crypto = require('node:crypto');

const WAIT_MS = 5 * 60 * 1000;
const MAX_BODY = 32 * 1024;

const DONE_PAGE = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Slate</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>html,body{height:100%;margin:0;background:#1c1c1e;color:#f5f5f7;font:16px/1.5 system-ui,sans-serif}
main{height:100%;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}</style>
</head><body><main><p id="m">Finishing sign-in…</p></main>
<script>
  const p = new URLSearchParams(location.hash.slice(1));
  history.replaceState(null, '', '/done');
  const say = (t) => { document.getElementById('m').textContent = t; };
  fetch('/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: p.get('state'), idToken: p.get('id'), accessToken: p.get('at') }),
  })
    .then((r) => say(r.ok ? 'Signed in. You can close this tab and go back to Slate.' : 'This sign-in has expired. Go back to Slate and try again.'))
    .catch(() => say('Slate is no longer waiting. Go back to Slate and try again.'));
</script></body></html>`;

let running = null;

const sameState = (a, b) => {
  if (typeof a !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

/** Resolves with { idToken, accessToken } once signed in, or { cancelled: true }. */
function googleSignIn(site, open, focus) {
  // A second click while waiting reopens the browser on the same sign-in.
  if (running) {
    void open(running.url);
    return running.promise;
  }

  const state = crypto.randomBytes(24).toString('hex');
  let finish;
  const promise = new Promise((resolve) => {
    finish = resolve;
  });
  let timer = null;
  let port = 0;

  const server = http.createServer((req, res) => {
    // Only requests addressed to this server by its loopback address (no DNS rebinding).
    if (req.headers.host !== `127.0.0.1:${port}`) {
      res.writeHead(400).end();
      return;
    }
    if (req.method === 'GET' && req.url === '/done') {
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
      });
      res.end(DONE_PAGE);
      return;
    }
    if (req.method === 'POST' && req.url === '/token') {
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY) req.destroy();
      });
      req.on('end', () => {
        let data = null;
        try {
          data = JSON.parse(body);
        } catch {
          // not JSON
        }
        if (!data || !sameState(data.state, state) || typeof data.idToken !== 'string' || !data.idToken) {
          res.writeHead(403).end();
          return;
        }
        res.writeHead(204, { 'Cache-Control': 'no-store' }).end();
        done({ idToken: data.idToken, accessToken: typeof data.accessToken === 'string' ? data.accessToken : '' });
        focus();
      });
      return;
    }
    res.writeHead(404).end();
  });

  function done(result) {
    if (!running) return;
    running = null;
    clearTimeout(timer);
    // Let the last response go out before the server stops.
    setTimeout(() => server.close(), 500);
    finish(result);
  }

  running = { url: '', promise };
  server.on('error', () => done({ cancelled: true }));
  server.listen(0, '127.0.0.1', () => {
    port = server.address().port;
    const url = new URL('/desktop-signin.html', site);
    url.searchParams.set('port', String(port));
    url.searchParams.set('state', state);
    if (running) running.url = url.href;
    timer = setTimeout(() => done({ cancelled: true }), WAIT_MS);
    Promise.resolve(open(url.href)).catch(() => done({ cancelled: true }));
  });

  return promise;
}

module.exports = { googleSignIn };
