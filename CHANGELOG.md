# Changelog

All notable changes to the open-source edition are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) for its own releases.

## [0.1.0] — 2026-11-03

The first open-source edition, derived from the production application.

### Added

- Web app (React 19 + Vite), API server (Node 22 + Express 5), Android shell (Capacitor) and
  Windows desktop shell (Electron).
- Firestore and Realtime Database rules for per-user boards, collaboration rooms, shares and
  server-written counters.
- Environment-configured AI providers (Groq and/or Anthropic), tool-loop solving with a calculator
  and a computer-algebra engine, handwriting recognition, notes, diagrams and molecules.
- Daily per-account quotas and per-IP rate limits as abuse protection, with an
  `entitlementFor(uid)` seam for operators who want different entitlements.
- AGPL-3.0 `LICENSE`, `NOTICE`, `TRADEMARK.md` and a documentation set: README, development,
  architecture, deployment, contributing, code of conduct, security, support and roadmap.
- DRAFT Terms of Service and Privacy Policy templates in `docs/legal/`, mirrored in-app with
  placeholders and a DRAFT notice.
- A Dockerfile for a single-origin deployment, and example environment files.

### Removed from the production baseline

- Pricing, plan catalogue, trial, Razorpay checkout, subscription and invoice code, billing
  documents, and every HTTP 402 plan gate.
- The admin panel: password/TOTP sign-in, encrypted provider-key store, model routing, coupons and
  audit log. AI configuration is environment-only.
- The legacy `services/api` Python service.
- Production Firebase configuration, Google services files, signing configuration, app-linking
  fingerprints, generated web assets, and all production identifiers.

### Changed

- Android application id is `org.slate.app`; release signing reads only the path in
  `SLATE_RELEASE_PROPS`.
- The desktop shell requires `SLATE_URL` and refuses to start without it.
- The web Firebase config has no production fallbacks; missing values log a clear error.
- Quotas remain but grant no purchase path: every signed-in account receives the same limits.

### Verified

- `services/server`: **221 tests pass, 0 fail** (~17–23 s), TypeScript typecheck and build succeed.
- `apps/web`: **10 tests pass**, lint reports warnings only, and typecheck plus the Vite production
  build succeed.
- **Android debug APK** built from this tree with Gradle (`app-debug.apk`, about 7.9 MB).
- **Windows desktop installer** built from this tree with electron-builder (`Slate-Setup-0.1.0.exe`,
  unsigned).
- Firestore and Realtime Database rules are the versions shipped in this tree.

### Known limitations

- CI builds the server, web app and Docker image, but not the Android APK or the desktop installer;
  those need a local SDK or Windows toolchain.
- The desktop installer and Android APK are unsigned; configure your own signing before
  distribution.
- Two moderate `npm audit` findings remain in build-time tooling (`@capacitor/*`,
  `electron-builder`) and six moderate findings in `firebase-admin`'s Firestore client dependency
  chain. See the security notes in the release report; none is reachable from untrusted input in
  this application.
- The legal documents are **drafts**, not legal advice.
- There is no upgrade path from the commercial product's data model beyond the boards, profile and
  shares that this edition already reads; billing documents are ignored and denied.

[0.1.0]: https://github.com/SuparvaCode/slate/releases/tag/v0.1.0
