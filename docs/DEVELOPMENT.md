# Development

How to run Slate locally, configure Firebase and AI providers, and work on each shell.

## 0. Prerequisites

- Node.js **22.18+** and npm 10+.
- A Firebase project you control. The free Spark plan is enough for local development.
- An AI provider key: [Groq](https://console.groq.com/) (the default) and/or
  [Anthropic](https://console.anthropic.com/). You can run without either by setting
  `SLATE_MOCK=1`, which returns canned AI output — useful for UI work and tests.

## 1. Install

```bash
npm ci --prefix services/server
npm ci --prefix apps/web
npm ci --prefix apps/desktop
```

The Android project is built with Gradle from your Android SDK; it has no npm dependencies of its
own beyond Capacitor (installed by `apps/web`).

## 2. Firebase setup

1. Create a project in the [Firebase console](https://console.firebase.google.com/).
2. **Authentication → Sign-in method → Google**: enable it, and set a support email.
3. **Authentication → Settings → Authorized domains**: add `localhost` (and later your deployment
   host).
4. **Firestore Database**: create it (production mode is fine; the rules you deploy replace the
   defaults).
5. **Realtime Database**: create it. Collaboration rooms use it.
6. **Project settings → General → Your apps**: add a **web app**, and copy the config values into
   `apps/web/.env` (see below).
7. **Project settings → Service accounts → Generate new private key**. Base64-encode the JSON for
   the server:

   ```bash
   # Linux/macOS
   base64 -w0 serviceAccount.json
   # PowerShell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("serviceAccount.json"))
   ```

   Put the result in `FIREBASE_SERVICE_ACCOUNT` in `services/server/.env`. Never commit this file.
   Alternatively leave it unset and use `GOOGLE_APPLICATION_CREDENTIALS` with a file path, or
   `gcloud auth application-default login` for local work.
8. **Analytics** (optional): enable Google Analytics for the web app and copy the measurement id
   into `VITE_FIREBASE_MEASUREMENT_ID`. Without it, no analytics code loads.
9. **Deploy the rules** (from the repository root, with `firebase-tools`):

   ```bash
   npx firebase-tools login
   npx firebase-tools use <your-project-id>
   npx firebase-tools deploy --only firestore:rules,database --project <your-project-id>
   ```

   Deploying `firestore.indexes.json` is not needed for this edition's queries.

For the **Android** shell, add your Android app in Firebase (package `org.slate.app`, or the id you
chose) and download `google-services.json` into `apps/web/android/app/`. It is gitignored. Native
Google sign-in will not work without it.

## 3. Environment files

### `apps/web/.env`

Copy `apps/web/.env.example` and fill in the web-app config. Every value is public by design; access
is controlled by rules and the API key's referrer restrictions.

| Variable | Required | Meaning |
| --- | --- | --- |
| `VITE_FIREBASE_API_KEY` | yes | Web API key |
| `VITE_FIREBASE_AUTH_DOMAIN` | yes | `<project>.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | yes | Project id |
| `VITE_FIREBASE_STORAGE_BUCKET` | no | Storage bucket |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | no | Sender id |
| `VITE_FIREBASE_APP_ID` | yes | Web app id |
| `VITE_FIREBASE_MEASUREMENT_ID` | no | Analytics measurement id; omit to disable analytics |
| `VITE_FIREBASE_DATABASE_URL` | yes for rooms | Realtime Database URL |

If `VITE_FIREBASE_API_KEY` or `PROJECT_ID` is missing, the app logs a clear console error rather
than silently using someone else's project.

### `services/server/.env`

Copy `services/server/.env.example`. The full list, with defaults:

| Variable | Default | Meaning |
| --- | --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | — | Base64 service-account JSON (or use ADC) |
| `FIREBASE_PROJECT_ID` | from credentials | Expected token audience; set it explicitly |
| `FIREBASE_AUTH_DOMAIN` | — | Adds the Firebase auth domain to the CSP frame/connect lists |
| `SLATE_PROVIDER` | `groq` | `groq` or `anthropic` |
| `GROQ_API_KEYS` | — | One or more Groq keys, comma-separated (rotated) |
| `ANTHROPIC_API_KEY` | — | Anthropic key when the provider is `anthropic` |
| `SLATE_RECOGNIZE_MODEL`, `SLATE_SOLVE_MODEL`, `SLATE_DIAGRAM_MODEL`, `SLATE_NOTES_MODEL`, `SLATE_ASSIST_MODEL` | provider defaults | Per-tool model overrides |
| `SLATE_RECOGNIZE_EFFORT`, `SLATE_NOTES_REASONING` | — | Reasoning-effort overrides |
| `SLATE_ANTHROPIC_BASE_URL` | — | For a compatible gateway |
| `SLATE_MOCK` | `0` | `1` returns canned AI output (development only) |
| `SLATE_AUTH_DISABLED` | `0` | `1` skips token checks **in development only** |
| `SLATE_ALLOWED_ORIGINS` | — | Comma-separated CORS allow-list (needed only when web and API are on different origins) |
| `SLATE_CSP_CONNECT` | — | Extra `connect-src` hosts for the CSP |
| `SLATE_SERVE_WEB` | `0` | `1` serves `apps/web/dist` from the API |
| `SLATE_WEB_DIST` | `../../apps/web/dist` | Where the built web app lives |
| `SLATE_TRUST_PROXY` | `1` in production, else `0` | Reverse-proxy hops for per-IP limits |
| `HOST`, `PORT` | `0.0.0.0`, `8787` | Bind address — set `HOST=127.0.0.1` behind a local reverse proxy; see [DEPLOYMENT](DEPLOYMENT.md) |
| `SLATE_LIMIT_SOLVE_DAY` | `200` | Daily solve requests per account |
| `SLATE_LIMIT_DIAGRAM_DAY` | `60` | Daily diagram requests |
| `SLATE_LIMIT_MOLECULE_DAY` | `300` | Daily molecule lookups |
| `SLATE_LIMIT_ASSIST_DAY` | `80` | Daily titles/practice questions |
| `SLATE_LIMIT_NOTES_DAY` | `120` | Daily notes calls |
| `SLATE_LIMIT_SEARCH_DAY` | `400` | Daily search calls |
| `SLATE_AI_TOKENS_DAY` | `1_400_000` | Daily AI token budget per account |
| `SLATE_QUOTA_STORE` | `firestore`; `memory` in dev | Counter store; `memory` resets on restart |
| `SLATE_SEARCH_KEY`, `SLATE_SEARCH_WEB_URL`, `SLATE_SEARCH_IMAGE_URL` | — | Optional web and image search provider; search routes return 503 without them |
| `TURN_URLS`, `TURN_SECRET`, `CF_TURN_KEY_ID`, `CF_TURN_API_TOKEN` | — | Optional TURN credentials for voice in rooms |

Values are read on first use; real environment variables win over the `.env` file. `SLATE_ENV_FILE`
can point at a different env file.

## 4. Run

```bash
npm run dev --prefix services/server
npm run dev --prefix apps/web
```

- Web: `http://127.0.0.1:5173`, proxying `/api` to `http://127.0.0.1:8787`.
- API: `http://127.0.0.1:8787/api/health`.

To use the app without a Firebase project, set `SLATE_MOCK=1` and `SLATE_AUTH_DISABLED=1`; the
server then accepts requests as the `dev` user. Sign-in still needs Firebase in the browser, so this
is mainly useful for tests and API work.

## 5. Tests

```bash
npm test --prefix services/server     # API: ~220 tests, about 25 seconds
npm test --prefix apps/web            # board/geometry/biology/chemistry: 10 tests
npm run typecheck --prefix services/server
npm run build --prefix apps/web       # typecheck + bundle
```

The server tests use `SLATE_MOCK=1` and in-memory counters; they do not call Firebase or an AI
provider.

## 6. Android

```bash
cd apps/web
npm run build
npx cap sync android
cd android
./gradlew assembleDebug          # output: app/build/outputs/apk/debug/app-debug.apk
```

- The app id defaults to `org.slate.app`. Change `appId` in `capacitor.config.ts` **and** the
  namespace/applicationId in `android/app/build.gradle` before shipping your own build.
- The shell loads the hosted web app when `CAPACITOR_SERVER_URL` is set at sync/build time:

  ```bash
  CAPACITOR_SERVER_URL=https://your.site npx cap sync android
  ```

  Without it the app runs the bundled `dist`, which can sign in to Firebase but cannot reach a Slate
  API (the server must be same-origin or listed in `SLATE_ALLOWED_ORIGINS`; the app itself always
  calls `/api` relative to the page).
- Native Google sign-in needs your own `android/app/google-services.json`.
- App links (shared boards at `/s/<id>`) require replacing `example.com` in
  `android/app/src/main/AndroidManifest.xml` with your host and serving
  `/.well-known/assetlinks.json` there with **your** package id and **your** signing certificate
  fingerprint. This repository ships no fingerprints.
- Release signing: set `SLATE_RELEASE_PROPS` to the absolute path of a `release.properties` file
  containing `storeFile`, `storePassword`, `keyAlias`, `keyPassword`. It stays outside the repository.

## 7. Desktop (Electron)

```bash
cd apps/desktop
SLATE_URL=https://your.site npm start   # development
npm run dist                            # Windows NSIS installer (unsigned)
```

The shell requires `SLATE_URL`; without it, it shows an error and exits. Google sign-in opens the
system browser and hands tokens back through a loopback server (`signin.js`).

## 8. Conventions

- TypeScript everywhere; prefer narrow, strongly typed modules.
- Server modules import with explicit `.ts` extensions (Node runs them directly).
- Tests are `node:test` files under `services/server/tests` and `apps/web/tests`.
- Comments explain *why*, not *what*. Keep the existing style.
- No new dependencies without a reason; the project deliberately uses few.
