# Privacy Policy — DRAFT

> **DRAFT — not legal advice.** This document is a template supplied with the open-source edition of
> Slate. The operator of a deployment must complete the bracketed placeholders, adapt it to their
> own jurisdiction and services, and have it reviewed by a qualified lawyer before relying on it.
> Bracketed text marks what must be filled in. The same text is shown in the app
> (`apps/web/src/legal/content.tsx`); keep both in step.

**Last updated:** 3 November 2026

This Privacy Policy explains what this Slate deployment collects, why, and the choices you have.
**[OPERATOR NAME], [OPERATOR ADDRESS]** is the controller of the personal data described here.
Slate is open-source software, and the operator of each deployment decides how it is run and
hosted.

## 1. What we collect

- **Account details from Google** — your Google account identifier, name, email address and profile
  picture, through Firebase Authentication. We never receive your Google password.
- **Your boards and writing** — the strokes, text, diagrams, notes, titles and settings you create,
  and the pictures you choose to add. They are stored on your device and synced to the account so
  they appear on every device you sign in on.
- **Collaboration data** — when you join a room, the room code, presence and the live board changes
  are relayed through a realtime database while the room is open.
- **AI requests** — the part of a board you ask Slate to read, solve, explain, diagram or turn into
  notes, together with the instructions sent with it. These are sent to the AI provider configured
  by the operator.
- **Device and usage records** — a random device identifier used for the one-active-device rule,
  daily AI usage counters, and routine server logs (such as time, route and error) used for
  security and reliability.
- **Analytics, only if enabled** — anonymous counts of which features are used, through Firebase
  Analytics. Boards are never included. You can turn this off in Settings at any time.

## 2. What we do not collect

We do not ask for your phone number, contacts, precise location or payment details in this edition.
We do not sell personal data. We do not use your boards to train AI models. **[Confirm this for
your own deployment and providers before publishing.]**

## 3. Why we use it

- **To provide the Service** — sign you in, save and sync your boards, read your handwriting,
  answer questions, keep collaboration rooms working, and apply the one-device rule.
- **To keep it safe and available** — authenticate requests, apply rate and daily limits, detect
  abuse, and investigate errors.
- **To improve it** — only through the analytics counts described above, and only when enabled.
- **To meet legal obligations** — where we must keep records or respond to lawful requests.

## 4. Who we share it with

- **Google Firebase** — authentication, database, file storage, realtime collaboration and, if
  enabled, analytics.
- **The configured AI provider** — receives the handwriting images and text needed to answer your
  request, under that provider’s terms. The operator chooses the provider; **[name the provider and
  its data-retention terms here]**.
- **Hosting and infrastructure providers** — process data on the operator’s behalf so the Service
  can run.
- **Authorities** — where the law requires it, or to protect rights, safety and security.
- **Others, with your direction** — for example when you share a board link.

## 5. How long we keep it

Boards and account data are kept while your account exists. Usage counters and routine logs are
kept only as long as needed for limits, security and debugging. When you delete a board or your
account, it is removed from the live system; copies in routine backups are removed or overwritten
in the ordinary course. Some records may be kept longer where the law requires. **[State concrete
retention periods for your deployment.]**

## 6. Your choices and rights

- Turn usage analytics on or off in Settings at any time.
- Delete a board from the dashboard; it is removed from every signed-in device.
- Delete your account in Settings. This removes your account and its data from the live system and
  signs you out everywhere.
- Ask for a copy of your data, or ask us to correct or delete it, by writing to
  **[privacy@example.com]**. Depending on where you live you may have further rights, including to
  object or to complain to a regulator.

## 7. Children

Slate is meant for students but is not directed at children under **[MINIMUM AGE]**. Where the law
allows younger users with parental consent, a parent or guardian accepts these documents on their
behalf. If you believe a child has given us personal data without the required consent, contact us
and we will remove it.

## 8. Security

Requests are authenticated with Firebase ID tokens; data access is limited by database rules to the
signed-in owner; one device at a time is enforced; AI calls are rate-limited and metered. No system
is perfectly secure, so keep your Google account protected and tell us about anything suspicious.

## 9. Where your data is processed

Data may be processed in **[COUNTRIES/REGION]**, including by Google Firebase and the AI provider.
Where personal data is transferred across borders, the operator takes the steps required by
applicable law to protect it. **[Add the transfer mechanism relied on, e.g. standard contractual
clauses, and any required notice.]**

## 10. Third-party links and services

Slate can show search results, videos and other third-party material, and uses Google for sign-in.
Those services are controlled by their own companies, and their privacy policies apply to what they
collect. This policy does not cover them.

## 11. Changes to this policy

We may update this policy as Slate or the law changes. The new version will be posted in the app
with a new “Last updated” date. If a change materially affects how we use your personal data, we
will tell you in the app or by email before it takes effect where practicable. If you keep using
the Service after the change takes effect, you accept the updated policy.

## 12. Contact

For any question, request or complaint about privacy, write to **[privacy@example.com]**. **[Add the
operator’s legal name, address, data-protection contact and any grievance officer or regulator
details required in your jurisdiction.]**
