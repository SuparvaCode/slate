# Legal documents

This directory contains **DRAFT templates**, not finished legal documents and not legal advice:

- [TERMS_AND_CONDITIONS.md](TERMS_AND_CONDITIONS.md)
- [PRIVACY_POLICY.md](PRIVACY_POLICY.md)

They describe what this edition of the software actually does (Google sign-in, boards in
Firestore, AI requests to the operator's provider, optional analytics). They deliberately contain
bracketed placeholders:

| Placeholder | Fill in with |
| --- | --- |
| `[OPERATOR NAME]`, `[OPERATOR ADDRESS]` | The legal entity operating the deployment |
| `[MINIMUM AGE]` | The age required in your jurisdiction for this kind of service |
| `[COUNTRIES/REGION]` | Where data is processed and stored |
| `[privacy@example.com]` | A monitored contact address |
| Provider and retention wording | Your AI provider, hosting provider and their actual terms |

## Before you operate a public deployment

1. Fill every placeholder.
2. Add the liability, consumer-law, transfer-mechanism and grievance wording your jurisdiction
   requires.
3. Have a qualified lawyer review both documents.
4. Remove the DRAFT notice.
5. Make the final documents available at the URLs the app uses (`/terms` and `/privacy`).

## Keeping the app in step

The in-app text lives in [`apps/web/src/legal/content.tsx`](../../apps/web/src/legal/content.tsx).
The markdown here is a convenience copy for review and for filing on a website. When you change
one, change the other, and update `LEGAL_UPDATED` in the component. A mismatch between the app and
the published document is a trap for users — treat the app's text as the operative one and make
the published copy match it.

## Why they are in the open-source repository at all

Operators need a starting point that matches the code, and reviewers need to see what the
application claims. Shipping them as clearly marked drafts avoids the worse outcome: a deployment
that quietly reuses someone else's production legal documents, which may describe features,
companies or data practices that do not exist here.
