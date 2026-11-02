# Security Policy

## Supported versions

This is a self-hosted open-source project with no downstream support contract. Security fixes are
made on `main`; there are no maintained release branches at this time. Operators are responsible
for tracking `main` and redeploying.

| Version | Supported |
| --- | --- |
| 0.1.x (current `main`) | Best effort |

## Reporting a vulnerability

**Do not open a public issue, discussion, or pull request for a vulnerability.**

Report it privately through GitHub's **Security → Advisories → Report a vulnerability** on the
repository. If advisories are unavailable, contact the maintainers at the address published in
`SECURITY` on the repository profile; replace this paragraph with a monitored address before
publishing.

Please include:

- the affected component and file or route;
- the version or commit you tested;
- steps to reproduce, with a minimal proof of concept where possible;
- the impact you believe it has (data exposure, auth bypass, quota bypass, DoS, …);
- any suggested fix or mitigation.

Do **not** include real user data, production credentials, or data from a deployment you do not
operate. Never test against the hosted service or any third party's deployment. Use your own Firebase
project and local build.

## What to expect

- Acknowledgement within about five working days.
- An assessment and, where warranted, a fix on `main` and a GitHub security advisory.
- Credit in the advisory unless you ask otherwise.

This is a volunteer project: we cannot promise a fixed remediation deadline or a bug bounty.

## Scope

In scope:

- the API server (`services/server`) — authentication, authorization, quotas, request handling;
- the web app (`apps/web`) — client-side authorization assumptions, XSS, token handling;
- Firestore and Realtime Database rules (`firestore.rules`, `database.rules.json`);
- the Electron shell (`apps/desktop`) — context isolation, navigation, IPC, sign-in callback;
- the Android shell (`apps/web/android`) — WebView configuration, intent handling;
- share links and collaboration rooms — access control and data leakage.

Out of scope:

- vulnerabilities in Firebase, AI providers, or other third-party services — report them upstream;
- misconfiguration of an operator's own deployment (open API keys, missing TLS, permissive rules
  deployed by the operator);
- findings that require physical access to a user's unlocked device;
- social engineering, spam, or volumetric denial of service;
- reports produced only by an automated scanner without a demonstrated impact.

## Security model in brief

- Every `/api` route except health and public share reads requires a verified Firebase ID token with
  revocation checking.
- Firestore/RTDB rules are the authority for per-user data; the Admin SDK bypasses rules, so server
  code trusts a uid only after token verification.
- Per-IP and per-account limits protect provider spend; they are abuse controls, not a security
  boundary.
- Provider keys and the service account live in the environment. This edition has no key store and
  no admin panel.
- `SLATE_MOCK` and `SLATE_AUTH_DISABLED` are development switches. `SLATE_AUTH_DISABLED` is ignored
  when `NODE_ENV=production`; never deploy with either set.

Reports that show a way around any of the above are especially welcome.

## Known dependency advisories (3 November 2026)

`npm audit` reports:

- **moderate** findings in `firebase-admin`'s Firestore client dependency chain
  (`@google-cloud/firestore-api` → `google-gax` → `rimraf` → `glob` → `minimatch`). The affected
  code parses static protocol-file paths at startup; no request data reaches it. A fix requires a
  breaking override of an internal Google client, so it is left to upstream;
- **moderate** findings in build-only tooling (Capacitor CLI/assets, `@trapezedev/*`,
  `electron-builder` and their transitive packages). These tools are not part of any shipped
  bundle;
- **no high or critical** findings after `@grpc/grpc-js` was pinned to 1.14.7 for the web
  dependency tree. That package is not included in the browser bundle.

Re-run `npm audit` in each package before a release; do not apply `npm audit fix --force` blindly,
because its suggested fixes are often downgrades across major versions.

