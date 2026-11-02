# Slate

**A handwriting-first AI study whiteboard.** You write on an infinite board; Slate reads your
handwriting, solves or explains the problem with a tool loop (a language model plus a real
calculator and computer-algebra engine), and writes the working back in your own handwriting.

This repository is the **open-source edition** of Slate. It is the same web app, API server, Android
shell and desktop shell that power the hosted product, with the commercial parts removed (see
[What this edition leaves out](#what-this-edition-leaves-out)).

## Contents

- [What it does](#what-it-does)
- [What this edition leaves out](#what-this-edition-leaves-out)
- [Repository layout](#repository-layout)
- [Requirements](#requirements)
- [Quick start](#quick-start)
- [Commands](#commands)
- [How it fits together](#how-it-fits-together)
- [Security and privacy](#security-and-privacy)
- [Licence and trademark](#licence-and-trademark)
- [Contributing](#contributing)
- [Status](#status)

## What it does

- **An infinite whiteboard** with pen, highlighter, shapes, diagrams, images and multiple boards
  (each with rough-work sub-boards), stored on the device and synced to the account.
- **Handwriting recognition** that turns written answers into structured text.
- **Solving and explaining** with a tool loop: the model reads the board, calls a calculation
  engine, checks its own result, and writes the answer back in handwriting. Systems of equations,
  calculus, units and significant figures are verified where possible.
- **Study notes** — a set of notes planned section by section, with questions asked along the way.
- **Diagrams and molecules** drawn on the board from a description.
- **Search, videos and images** to look things up without leaving the board.
- **Collaboration rooms** — six-character room codes, live board sharing, cursors, voice, and
  per-person boards, backed by Firebase Realtime Database.
- **Public share links** — a read-only snapshot of a board at `/s/<id>`.
- **Android and Windows shells** that wrap the hosted web app (Capacitor and Electron).

## What this edition leaves out

The hosted commercial product includes paid plans, a trial, Razorpay subscriptions, an admin
panel with encrypted provider keys and model routing, coupon codes, usage billing, and a legacy
Python API. **All of that is removed here**, not merely disabled:

- no pricing, checkout, subscription, invoice or plan-gate code;
- no admin panel, no provider-key store, no runtime model routing (AI configuration is environment
  variables only);
- no billing documents in Firestore (`/billing/**` is denied by the shipped rules);
- no legacy `services/api` Python service.

Quotas remain, but only as **abuse protection**: every signed-in account gets the same daily
per-feature caps and AI token budget, configurable by the operator. They are not a commercial
feature and never return HTTP 402. The seam for building an edition with different entitlements is
[`services/server/src/entitlements.ts`](services/server/src/entitlements.ts).

The Slate **name and logo** are not licensed with the code; see [TRADEMARK.md](TRADEMARK.md).

## Repository layout

```text
apps/
  web/        React 19 + Vite web app, Capacitor Android project, PWA assets
  desktop/    Electron shell for Windows (loads your deployment over HTTPS)
services/
  server/     Node 22 + Express 5 API: auth, limits, AI routes, static web serving
firebase.json, firestore.rules, database.rules.json, firestore.indexes.json
docs/legal/   DRAFT Terms and Privacy Policy templates
```

There is no Python service and no admin client in this tree.

## Requirements

- **Node.js 22.18 or newer** (the server and tests run TypeScript directly).
- A **Firebase project** with:
  - Google sign-in enabled (Firebase Authentication);
  - Cloud Firestore;
  - Realtime Database (for collaboration rooms);
  - optionally Analytics;
  - a service account key for the Admin SDK (the server verifies ID tokens and writes counters).
- An **AI provider**: Groq (default) and/or Anthropic. Only the provider(s) you configure are
  called.
- For the Android build: Android Studio / the Android SDK, and your own `google-services.json`.
- For the desktop build: Windows, or Electron's cross-platform packaging.

## Quick start

1. **Clone and install**

   ```bash
   git clone <your-fork-url> slate
   cd slate
   npm ci --prefix services/server
   npm ci --prefix apps/web
   npm ci --prefix apps/desktop
   ```

2. **Configure Firebase**

   Follow [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md#firebase-setup). In short: create a project,
   enable Google sign-in and Firestore, copy the web config into `apps/web/.env`, create a service
   account and base64 it into `FIREBASE_SERVICE_ACCOUNT` for the server, then deploy the rules:

   ```bash
   npx firebase-tools deploy --only firestore:rules,database --project <your-project-id>
   ```

   The server's `FIREBASE_PROJECT_ID` must match the web app's project.

3. **Configure the AI provider**

   ```bash
   cp services/server/.env.example services/server/.env
   # set GROQ_API_KEYS and/or ANTHROPIC_API_KEY
   ```

4. **Run it**

   ```bash
   npm run dev --prefix services/server   # API on http://127.0.0.1:8787
   npm run dev --prefix apps/web          # web app on http://127.0.0.1:5173 (proxies /api)
   ```

   Open `http://127.0.0.1:5173` and sign in with Google. The Google account must be allowed by
   Firebase Auth's authorised domains (add `localhost` for development).

5. **Build for production**

   ```bash
   npm run build --prefix apps/web
   npm run build --prefix services/server
   NODE_ENV=production SLATE_SERVE_WEB=1 npm start --prefix services/server
   ```

   The server serves `apps/web/dist` and the API from one origin — see
   [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Commands

| Where | Command | What it does |
| --- | --- | --- |
| `services/server` | `npm run dev` | Watch-mode API server |
| | `npm test` | Full API test suite (`node --test`, about 25 s) |
| | `npm run typecheck` | TypeScript check, no output |
| | `npm run build` | Compile to `dist/` |
| `apps/web` | `npm run dev` | Vite dev server with `/api` proxy |
| | `npm test` | Board/geometry/biology/chemistry test suite |
| | `npm run build` | Typecheck plus production bundle |
| | `npm run lint` | oxlint |
| `apps/desktop` | `SLATE_URL=https://your.site npm start` | Run the Electron shell |
| | `npm run dist` | Build the Windows NSIS installer |
| `apps/web/android` | `npx cap sync android` | Copy the web build into the Android project |
| | `./gradlew assembleDebug` | Build a debug APK |

## How it fits together

```text
┌────────────┐   /api (Bearer Firebase ID token)   ┌──────────────────────┐
│ web / PWA  │ ──────────────────────────────────▶ │  Node API (Express)  │
│ Android    │                                     │  auth · quotas · AI   │
│ Electron   │ ◀── Firestore sync, RTDB rooms ───▶ │  static web serving   │
└────────────┘                                     └──────────┬───────────┘
       │                                                    │
       ▼                                                    ▼
 Firebase Auth / Firestore / RTDB                 Groq and/or Anthropic API
```

- The browser talks to Firebase directly for auth, board sync and collaboration.
- Everything AI-related goes through the API, which verifies the ID token, enforces per-account
  and per-IP limits, and calls the configured provider.
- The same origin serves the built web app, so the app calls `/api` relatively.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Security and privacy

- Firebase ID tokens are verified on every API call, with revocation checks. `SLATE_AUTH_DISABLED`
  exists for local development and is ignored when `NODE_ENV=production`.
- Firestore rules restrict boards and profile data to their owner; `/usage/**`, `/devices/**` and
  entitlement fields are server-written only; everything else is denied. `billing/**` does not
  exist in this edition.
- The API sets a strict Content-Security-Policy, CORS allow-list, body-size limits and per-IP rate
  limits. See [`services/server/src/http.ts`](services/server/src/http.ts).
- AI requests send the relevant part of the board to the operator's chosen AI provider. **Operators
  must disclose and govern that in their own privacy policy** — the shipped policy is a DRAFT
  template.
- The open-source edition ships **no** production Firebase project, signing keys, service-account
  JSON, release signing configuration, customer data or deployment scripts.

Report vulnerabilities per [SECURITY.md](SECURITY.md). Never open a public issue with exploit
details.

## Licence and trademark

The code is licensed under the **GNU Affero General Public License v3.0 only**
(`AGPL-3.0-only`). See [LICENSE](LICENSE) and [NOTICE](NOTICE). If you run a modified version as a
network service, AGPL section 13 requires you to offer its users the corresponding source.

The Slate name and logo are trademarks of the project maintainers and are **not** granted by the
code licence. Forks that are not the official project must use a different name and icon, or comply
with [TRADEMARK.md](TRADEMARK.md).

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). By
contributing you agree your contribution is licensed under AGPL-3.0-only (inbound = outbound).

## Status

This edition is **derived from a working production application** and its core test suites pass
(see [CHANGELOG.md](CHANGELOG.md) for numbers). It is **not** a hardened multi-tenant distribution:
you supply your own Firebase project, AI keys, hosting, privacy notices and legal documents. The
in-app Terms and Privacy Policy are **DRAFT templates** that require review by a qualified lawyer in
your jurisdiction before you operate a public deployment. There is no support or uptime commitment;
see [SUPPORT.md](SUPPORT.md).
