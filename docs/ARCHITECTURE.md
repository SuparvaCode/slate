# Architecture

How Slate is put together, and where the important boundaries are. Read this before changing the
AI pipeline, the sync layer or the rules.

## 1. Pieces

| Piece | Stack | Responsibility |
| --- | --- | --- |
| `apps/web` | React 19, Vite, TypeScript | Board, dashboard, settings, notes, diagrams, collaboration UI, Firebase SDK |
| `apps/web/android` | Capacitor 8 | Android shell around the web app |
| `apps/desktop` | Electron 45 | Windows shell around the web app, with system-browser Google sign-in |
| `services/server` | Node 22, Express 5, TypeScript | Token verification, quotas, AI routes, share links, static serving |
| Firebase | Auth, Firestore, RTDB | Sign-in, board storage/sync, collaboration rooms |

There is no database in the server. Firestore and RTDB are the only stores; the server holds no
session state.

## 2. Request flow

```text
browser ──(Firebase SDK)──▶ Auth / Firestore / RTDB
   │
   └──(fetch, Authorization: Bearer <ID token>)──▶ /api/*
                                                     │
                            requireAuth (verify + revocation)
                                                     │
                            per-IP rate limit → per-account meter()
                                                     │
                            route → AI provider (Groq / Anthropic)
                                                     │
                            response; token usage counted into that day
```

- `authFetch` (`apps/web/src/auth/authFetch.ts`) attaches the ID token, retries once on 401 with a
  refreshed token, signs the user out on a second 401 or on the "other device" reason.
- `requireAuth` (`services/server/src/auth.ts`) verifies the token with revocation checking and
  sets `res.locals.caller`; every route under `/api` except `/api/health` and `/api/share/:id`
  needs it.
- `meter()` (`services/server/src/limits.ts`) charges the caller's day **before** the AI call, so a
  failed call still counts something; 429 responses carry `Retry-After` and quota headers.
- AI token usage is counted by reading provider responses inside an `AsyncLocalStorage` scope
  (`usage.ts`), so provider modules never know about quotas.

## 3. Entitlements seam

`entitlements.ts` is the only place that answers "what may this caller do today". The shipped
implementation gives every signed-in account the same environment-configured limits and AI token
budget. It does not know about plans, trials or payments.

To build an edition with different entitlements, implement `entitlementFor(uid)` against your own
store. Nothing else in the server needs to change: `limits.ts` imports only `entitlementFor`,
`defaultLimits`, `CLASSES` and the types. The open-source edition deliberately has no 402
"plan required" path; removing that gate is not something you need to do.

Model and provider selection has a similar seam: `runtime.ts` returns environment fallbacks (empty
values), and the AI modules fall back to `SLATE_*_MODEL`, `SLATE_PROVIDER` and the provider keys.
A commercial edition can replace `runtime.ts` with a settings store without touching the AI modules.

## 4. Data model

### Firestore

| Path | Written by | Contents |
| --- | --- | --- |
| `users/{uid}` | client (limited fields) | `displayName`, `email`, `photoURL`, `createdAt`, `lastLoginAt`, `settings` |
| `users/{uid}/store/slates` | client | The board list (titles, ids, timestamps) |
| `users/{uid}/store/extra` | client | Small per-account data |
| `users/{uid}/boards/{board}` | client | `key`, `v` (version), `n` (parts), `at` |
| `users/{uid}/boards/{board}/parts/{part}` | client | `d` — one serialized part of the board |
| `devices/{uid}` | server | The active device claim (one device per account) |
| `usage/{uid}/…` | server | Daily counters and AI token totals |
| `shares/{id}` | server | Public share snapshots (22-character ids), expiry |
| `limits`, `blocked`, `role` (fields on `users/{uid}`) | server | Abuse controls; not client-writable |

The client can only write the fields listed above for its own uid. The catch-all rule denies
everything else, including `billing/**` (which this edition never writes).

### Realtime Database

`rooms/{code}` holds `meta` (host, title, lock), `slots` (four colours), `members`, `banned`,
`subs` (rough boards), `boards` (element trees), `cursors`, `signal` (WebRTC signalling), and
`live` (in-progress strokes). Room codes are six characters from an unambiguous alphabet. Rules
require membership for reads and constrain writes per field, including element size limits.

## 5. Board sync

- The board is serialized into parts (each under Firestore's size limit) and written through
  `apps/web/src/sync/cloud.ts`.
- Each board has a version `v`; writes are conflict-aware (the client compares the stored version
  before overwriting). A merge is attempted on version skew; failure surfaces in the UI rather than
  silently discarding data.
- Deletions are tombstoned in the slate list first, then the documents are removed, so a device
  that comes online later does not resurrect a deleted board.
- The device claim (`/api/me/device`) is refreshed periodically; a 401 with
  `X-Slate-Reason: other-device` signs the old device out.

## 6. AI pipeline

1. The client renders the region of interest to a PNG and sends it with a request
   (`/api/recognize`, `/api/solve`, `/api/diagram`, notes routes).
2. The server builds a prompt (see `*-prompt.ts`), calls the provider, and streams or returns
   JSON.
3. For solving, the model must use tools; the server runs the calculator (`calc-*`) and CAS
   (`nerdamer`) and feeds results back in a loop (`solver.ts`, `solver-verify.ts`). The final
   answer is checked against the computed value where the problem allows it.
4. The response is written back to the board as strokes by the client.

Provider keys are read from the environment. There is no key store, no admin override and no
runtime model routing in this edition.

## 7. Security model

- **Authentication**: Firebase ID tokens, verified per request, with revocation. Client-side
  tokens are never trusted for authorization decisions beyond the uid.
- **Authorization**: Firestore/RTDB rules are the authority for client data; the server is the
  authority for quotas, shares and device claims. The Admin SDK bypasses rules, so server code
  treats uids as authoritative only after token verification.
- **Limits**: per-IP (before auth), per-account daily counters, per-account AI token budget,
  per-request body limits, and concurrency limits on expensive calls.
- **Headers**: helmet CSP with no `unsafe-eval`, `frame-ancestors 'none'`, `object-src 'none'`,
  HSTS in production, and a CORS allow-list that grants nothing by default.
- **Logging**: error names/messages only; never tokens, request bodies or provider keys.

Out of scope for this edition: multi-tenant isolation beyond Firebase projects, SSO, audit logs
(the removed admin panel had them), and billing fraud controls.

## 8. Where things live

| Concern | File |
| --- | --- |
| Route table and middleware | `services/server/src/app.ts`, `routes.ts` |
| Auth | `services/server/src/auth.ts`, `device.ts` |
| Quotas and entitlement seam | `limits.ts`, `entitlements.ts`, `usage.ts` |
| Provider calls | `groq.ts`, `solver.ts`, `recognize.ts`, `diagram.ts`, `notes.ts`, `assist.ts` |
| Calculator and verification | `calc*.ts`, `solver-verify.ts` |
| Shares | `shares.ts` |
| Security headers / CORS | `http.ts` |
| Sync | `apps/web/src/sync/cloud.ts` |
| Collaboration | `apps/web/src/workspace/room.ts` |
| Firebase client config | `apps/web/src/firebase.ts` |
| Rules | `firestore.rules`, `database.rules.json` |
