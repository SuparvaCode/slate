# Roadmap

This is a direction, not a promise. Priorities can change with contributor interest and reported
problems. Items are ordered roughly by impact for self-hosters.

## Near term

- **CI for every shell.** Automated typecheck, test and build on `main` and pull requests; a
  licence and dependency check in the same workflow. (Only a minimal workflow ships initially.)
- **Setup friction.** A guided configuration check: the server logs exactly which required
  variables are missing, and the web app points at the first missing one instead of failing at
  sign-in.
- **Android build verification.** Document and test the Gradle build on a clean machine, including
  the `CAPACITOR_SERVER_URL` path.
- **Test coverage.** More tests around board sync and conflict resolution, share-link expiry, and
  the solver verification loop.

## Later, if there is demand

- **Pluggable quota store.** A documented interface so operators can use Redis instead of Firestore
  for daily counters.
- **Local-first mode.** Run the board without Firebase: a local persistence adapter and an offline
  sign-in stub for classrooms and demos.
- **Accessibility pass.** Full keyboard navigation on the board, screen-reader labels for tools,
  reduced-motion support.
- **Internationalisation.** Externalised UI strings, starting with a community-contributed locale.
- **Docker Compose example** with the Firebase emulator suite for an end-to-end local stack.

## Not planned for this edition

These are deliberately out of scope. Forks are welcome to add them under a different name:

- paid plans, trials, subscriptions, invoices, checkout, or plan gates;
- an admin panel, provider-key store, or runtime model routing;
- usage billing or revenue reporting;
- multi-tenant administration, SSO, or enterprise audit logs.

The seams for entitlement and provider configuration are described in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); building a commercial edition on top is a supported
use of the code under AGPL-3.0, but it is not maintained here.

## How to influence this

Open an issue describing the problem you have, not only the feature you want. Real use cases with
a clear reproduction move items up faster than votes.
