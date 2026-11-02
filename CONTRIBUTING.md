# Contributing

Thanks for taking the time to improve Slate. This document covers how to get a change from an
idea to a merged pull request.

## Before you start

- Read [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) to run the app, and
  [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before touching the AI pipeline, sync or rules.
- For anything larger than a bug fix, **open an issue first**. Say what you want to change, why,
  and which part of the tree it touches. This avoids duplicated work and design churn.
- Do not report security vulnerabilities in an issue. Follow [SECURITY.md](SECURITY.md).
- By participating you agree to [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## What we accept

Good contributions in this edition:

- bug fixes with a test that fails before and passes after;
- accessibility, performance and mobile-web improvements;
- test coverage for board operations, geometry, chemistry, biology and the solver loop;
- documentation fixes — especially setup steps that did not work for you;
- self-hosting improvements that do **not** add a commercial layer.

Out of scope by design (fork if you need them):

- plans, trials, payments, invoices and plan gates;
- an admin panel, provider-key store or runtime model routing;
- telemetry that is on by default;
- changes that require a specific hosting provider or vendor account.

## Development workflow

1. Fork the repository and create a branch from `main`:
   `git switch -c fix/board-undo`.
2. Install and configure per [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Use your own Firebase
   project and your own AI key. **Never** commit credentials or point tests at a deployment you do
   not operate.
3. Make the change in small commits with clear messages.
4. Run the checks locally:

   ```bash
   npm run typecheck --prefix services/server
   npm test --prefix services/server
   npm test --prefix apps/web
   npm run lint --prefix apps/web
   npm run build --prefix apps/web
   ```

5. Open a pull request. Describe the problem, the approach, and how you verified it. Link the
   issue. Screenshots or a short recording help for UI changes.

## Code style

- TypeScript in the server and web app; JavaScript only in the Electron shell.
- Match the file you are editing: naming, comment density and error handling.
- Comments explain *why*. Do not narrate what the code already says.
- Server modules import with explicit `.ts` extensions — Node runs the source directly.
- Prefer small, typed modules. Avoid new dependencies unless the alternative is materially worse;
  justify them in the pull request.
- Do not add `any`, disable lint rules, or remove checks to make a test pass.

## Tests

- Server tests: `services/server/tests/*.test.ts` (`node:test`, run with `npm test`). They use
  `SLATE_MOCK=1`, in-memory quota counters and no network.
- Web tests: `apps/web/tests/*.test.ts` (`node:test`, run with `npm test`).
- A bug fix should come with a regression test where the bug is testable without a browser.
- For UI behaviour that is not covered by a unit test, describe exactly what you clicked and saw
  in the pull request.

## Rules and security-sensitive code

Changes to `firestore.rules`, `database.rules.json`, `services/server/src/auth.ts`, `http.ts`,
`limits.ts` or `entitlements.ts` get extra scrutiny. In the pull request, state:

- what an attacker could do before and after;
- which rule or middleware now prevents it;
- how you tested it (emulator, unit test, manual request).

Do not weaken a rule or a check to unblock a feature. Fix the feature.

## Licence

Contributions are accepted under **AGPL-3.0-only**, the licence of this repository (inbound =
outbound). By submitting a pull request you confirm you have the right to license your
contribution under those terms. There is no CLA and no copyright assignment.

## Review and merge

- A maintainer reviews every pull request. Expect questions and a request for changes.
- Keep the branch up to date; resolve conflicts rather than force-pushing over review.
- Merge is a squash unless the commits are individually meaningful.
- We may close a change that is out of scope, unreviewable, or that adds a maintenance burden the
  project cannot carry. That is not a judgement of the work.
