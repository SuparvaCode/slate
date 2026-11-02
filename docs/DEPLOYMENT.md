# Deployment

How to run the open-source edition as a real deployment. You are the operator: you supply the
Firebase project, AI keys, domain, TLS, legal documents and support.

> The hosted product this edition came from has its own infrastructure. Nothing here points at it,
> and you should not reuse anyone else's Firebase project or provider keys.

## 1. What you need

- A Linux host (or container platform) with Node.js **22.18+**.
- A domain and TLS (a reverse proxy such as nginx/Caddy, or the platform's own TLS).
- A Firebase project configured as described in [DEVELOPMENT.md](DEVELOPMENT.md#firebase-setup),
  with `google-services`/web config of your own.
- AI provider keys (Groq and/or Anthropic).
- Your completed legal documents — the in-app ones are **DRAFT templates**.

## 2. Build

From the repository root:

```bash
npm ci --prefix services/server
npm ci --prefix apps/web
npm run build --prefix services/server
npm run build --prefix apps/web
```

Produce:

- `services/server/dist/` — the API.
- `apps/web/dist/` — the web app the server serves.

## 3. Configure

Put production values in the process environment (not in a committed file). At minimum:

```bash
NODE_ENV=production
HOST=127.0.0.1
PORT=8787
FIREBASE_SERVICE_ACCOUNT=<base64 service-account JSON>
FIREBASE_PROJECT_ID=<your project id>
SLATE_PROVIDER=groq
GROQ_API_KEYS=<one or more keys, comma-separated>
# ANTHROPIC_API_KEY=<key>        # if SLATE_PROVIDER=anthropic
SLATE_ALLOWED_ORIGINS=https://your.domain   # only needed if web and API are different origins
```

`NODE_ENV=production` makes the server:

- serve `apps/web/dist` itself (same origin, so the app's relative `/api` calls work);
- ignore `SLATE_AUTH_DISABLED` even if it is set;
- default `SLATE_TRUST_PROXY` to 1 — set it to the real number of proxy hops, never `true`;
- enable HSTS.

## 4. Firebase

1. Deploy the rules from the root of this repository:

   ```bash
   npx firebase-tools deploy --only firestore:rules,database --project <your-project-id>
   ```

2. Add your deployment host to **Authentication → Settings → Authorized domains**.
3. Restrict the web API key by HTTP referrer to your domain (Google Cloud console →
   APIs & Services → Credentials).
4. If you enable Analytics, put your measurement id in `VITE_FIREBASE_MEASUREMENT_ID` **before**
   building the web app.
5. For native apps, add your Android app id and `google-services.json`, and serve
   `/.well-known/assetlinks.json` with your package id and signing fingerprint.

## 5. Run under a process manager

Example systemd unit (`/etc/systemd/system/slate.service`):

```ini
[Unit]
Description=Slate API
After=network.target

[Service]
Type=simple
User=slate
WorkingDirectory=/srv/slate
EnvironmentFile=/etc/slate/slate.env
ExecStart=/usr/bin/node services/server/dist/index.js
Restart=on-failure
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now slate
```

Logs go to the journal. The server does not write files at runtime; only Firebase is stateful.

### Container

A `Dockerfile` is included at the repository root:

```bash
docker build -t slate .
docker run --rm -p 8787:8787 --env-file /etc/slate/slate.env slate
```

Mount nothing; pass secrets as environment variables. Put a TLS-terminating reverse proxy in front
and set `SLATE_TRUST_PROXY` to the number of hops.

## 6. Reverse proxy

Example nginx server block (TLS handled by certbot or your platform):

```nginx
server {
  server_name your.domain;

  client_max_body_size 10m;   # handwriting images are up to 8 MB

  location / {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 120s;  # AI streams can be quiet while a model thinks
    proxy_buffering off;      # keep answer streams streaming
  }
}
```

## 7. Separate static hosting (optional)

You can serve `apps/web/dist` from a CDN and the API elsewhere:

- build the web app with the API on another origin;
- set `SLATE_ALLOWED_ORIGINS` to the web origin;
- ensure CORS allows `Authorization` (the shipped middleware does).

The client calls `/api` relative to the page, so a split deployment needs a proxy rule for `/api`
on the static host, or a code change to prefix API calls with the API origin. Serving both from the
API process (the default) avoids this.

## 8. Android and desktop

- **Android**: build with `CAPACITOR_SERVER_URL=https://your.domain` so the shell loads your
  deployment; see [DEVELOPMENT.md](DEVELOPMENT.md#6-android).
- **Desktop**: `SLATE_URL=https://your.domain npm run dist`; the installer is unsigned unless you
  configure signing.

## 9. Operating checklist

Before opening the deployment to users:

- [ ] `NODE_ENV=production` and `SLATE_AUTH_DISABLED` unset.
- [ ] `FIREBASE_SERVICE_ACCOUNT` set through the environment, not a file in the repo.
- [ ] Firestore and RTDB rules deployed from this repository.
- [ ] Web API key restricted to your domain; Google sign-in authorised domains set.
- [ ] TLS on, HSTS reached end-to-end, reverse proxy passes `X-Forwarded-For`.
- [ ] `SLATE_TRUST_PROXY` matches the real hop count.
- [ ] Daily limits and `SLATE_AI_TOKENS_DAY` chosen for your budget and abuse tolerance.
- [ ] Provider keys have their own quotas and alerts.
- [ ] Terms and Privacy Policy completed, reviewed by a lawyer, and DRAFT notices removed.
- [ ] If you modified the code, you offer the corresponding source to users (AGPL §13) — for
      example a visible link in the app footer to the exact repository revision you run.
- [ ] Backups: enable Firestore backups/export; decide how long `shares` snapshots may live.
- [ ] Monitoring: watch `/api/health`, error rate, 429 rate, and provider spend.

## 10. Upgrades

1. Stop or drain traffic.
2. Deploy the new build; the API has no migrations.
3. Re-deploy rules when they change.
4. Rebuild the web app whenever `VITE_*` values change.
5. Keep `services/server/dist` and `apps/web/dist` from the same revision; the app and API are
   versioned together.
