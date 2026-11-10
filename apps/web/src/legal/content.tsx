/**
 * DRAFT Terms of Service and Privacy Policy shown in the app (sign-in screen, Settings) and at
 * /terms and /privacy.
 *
 * These are TEMPLATES. They describe what this edition of Slate actually does — Google sign-in,
 * boards synced to Firestore, AI requests to the provider the operator configures, optional
 * analytics — but they are not legal advice and have not been reviewed by a lawyer. Whoever
 * operates a deployment must fill the bracketed placeholders, adapt the text to their
 * jurisdiction and billing model, obtain legal review, and then remove the draft notice below.
 *
 * Keep the text in step with the code: sign-in (src/auth/session.ts), what is synced
 * (src/sync/cloud.ts), analytics (src/firebase.ts), and the hosted-only features the operator
 * turns on. Change LEGAL_UPDATED when the text changes.
 */
import type { ReactNode } from 'react';

export type LegalDoc = 'terms' | 'privacy';

/** Shown as "Last updated" on both documents. */
export const LEGAL_UPDATED = '10 November 2026';

/** Replace before publishing your own deployment. */
export const LEGAL_CONTACT = 'privacy@example.com';

export const LEGAL_TITLE: Record<LegalDoc, string> = {
  terms: 'Terms of Service',
  privacy: 'Privacy Policy',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="lg-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Draft() {
  return (
    <p className="lg-lead" role="note">
      <strong>DRAFT — not legal advice.</strong> This document is a template supplied with the
      open-source edition of Slate. The operator of this deployment must complete the placeholders,
      adapt it to their own jurisdiction and services, and have it reviewed by a qualified lawyer
      before relying on it. Bracketed text marks what must be filled in.
    </p>
  );
}

function Terms() {
  return (
    <>
      <Draft />
      <p className="lg-lead">
        These Terms of Service (the “Terms”) are an agreement between you and [OPERATOR NAME],
        [OPERATOR ADDRESS] (“we”, “us” or “our”) for the use of this Slate deployment (the
        “Service”). Slate is open-source software; the organisation that runs this deployment is
        its operator and is responsible for it.
      </p>

      <Section title="1. Accepting these terms">
        <p>
          By signing in with Google, creating an account, or using the Service in any other way, you
          agree to these Terms and to the <a href="/privacy">Privacy Policy</a>. If you do not agree,
          do not use the Service.
        </p>
        <p>
          You must be at least [MINIMUM AGE] years old, or have the consent of a parent or guardian
          where the law requires it, to use the Service. If you use it for a school or other
          organisation, you confirm that you have authority to accept these Terms for it.
        </p>
      </Section>

      <Section title="2. Your account">
        <ul>
          <li>Slate signs you in with your Google account. You need a Google account to use it.</li>
          <li>
            One account is for one person. This deployment allows one active device per account:
            signing in on another device signs the earlier device out automatically. Do not share
            your account.
          </li>
          <li>
            Keep your Google account secure. You are responsible for activity through your account,
            except activity we cause or that results from our breach of these Terms.
          </li>
          <li>
            Tell us at <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a> if you believe someone
            else has used your account.
          </li>
        </ul>
      </Section>

      <Section title="3. Your content">
        <ul>
          <li>
            You keep ownership of what you write, draw and save on Slate (“your content”). You grant
            us the limited licence needed to host, sync, process and display it so the Service can
            work for you — nothing more.
          </li>
          <li>
            You are responsible for your content and confirm you have the right to use it. Do not
            upload material that infringes someone else’s rights or that you are not allowed to
            share.
          </li>
          <li>
            When you share a board by link, anyone with that link can view the snapshot until you
            stop sharing it. You choose what to share.
          </li>
          <li>
            If you delete a board or your account, your content is removed from the live system as
            described in the Privacy Policy. Copies in routine backups remain until they are
            overwritten in the ordinary course.
          </li>
        </ul>
      </Section>

      <Section title="4. AI answers are not guaranteed">
        <p>
          Slate reads handwriting with an AI model and uses calculators and algebra tools to check
          much of its working. Even so, AI output can be wrong, incomplete or misleading, and
          handwriting can be misread. Treat answers as a study aid, check them against your
          textbook or teacher, and do not rely on them for decisions where an error could cause harm
          or loss. You are responsible for how you use the output.
        </p>
      </Section>

      <Section title="5. Acceptable use">
        <ul>
          <li>Do not use the Service to break the law, infringe rights, or harm other people.</li>
          <li>
            Do not probe, scan or attempt to bypass its authentication, access other people’s
            accounts or data, or interfere with its operation.
          </li>
          <li>
            Do not use it to send spam, malware or unlawful material, or to scrape it at scale.
          </li>
          <li>
            The Service applies daily limits and rate limits to keep it available for everyone. Do
            not try to get around them.
          </li>
        </ul>
      </Section>

      <Section title="6. Availability, changes and limits">
        <p>
          We aim to keep the Service available but it is provided on an “as is” and “as available”
          basis. It may change, be interrupted, or be discontinued. Features that call an AI model
          also depend on third-party providers and can fail or be rate-limited. Daily limits are set
          by the operator of this deployment and may change.
        </p>
      </Section>

      <Section title="7. Open-source software">
        <p>
          Slate’s source code is licensed under the GNU Affero General Public License v3.0 only
          (AGPL-3.0-only); the licence terms in the repository govern the software itself. These
          Terms govern your use of this hosted Service, which is separate from the software licence.
          Anyone may run their own deployment; this operator is not responsible for other
          deployments, and other operators are not responsible for this one.
        </p>
      </Section>

      <Section title="8. Paid features">
        <p>
          This edition ships with no payment, subscription or billing code. If this operator offers
          paid features, charges, refunds and cancellation terms are set out in the operator’s own
          additional terms, shown to you before you pay. Nothing in this template creates a
          payment obligation.
        </p>
      </Section>

      <Section title="9. Ending your access">
        <p>
          You can stop using the Service and delete your account at any time in Settings. We may
          suspend or end access if you materially breach these Terms or if we must for legal or
          security reasons. Where reasonable, we will tell you why. Sections that by their nature
          survive termination — ownership, disclaimers, liability limits — continue to apply.
        </p>
      </Section>

      <Section title="10. Disclaimers and liability">
        <p>
          To the extent permitted by law, the Service is provided without warranties of any kind,
          express or implied, including fitness for a particular purpose and non-infringement. To
          the extent permitted by law, we are not liable for indirect or consequential loss, or for
          loss of data, profits or goodwill arising from use of the Service. Nothing in these Terms
          limits liability that cannot be limited by law, including for death or personal injury
          caused by negligence, or for fraud. [Add the liability and consumer-law wording required
          in your jurisdiction.]
        </p>
      </Section>

      <Section title="11. Changes to these terms">
        <p>
          We may update these Terms as the Service or the law changes. The new version will be
          posted at <a href="/terms">/terms</a> with a new “Last updated” date. If a change materially
          affects your rights, we will tell you in the app or by email before it takes effect where
          practicable. If you keep using the Service after the change takes effect, you accept the
          updated Terms.
        </p>
      </Section>

      <Section title="12. Contact">
        <p>
          Questions about these Terms: <a href={`mailto:${LEGAL_CONTACT}`}>{LEGAL_CONTACT}</a>.
          [Add the operator’s legal name, registered address, and any grievance or regulatory contact
          required in your jurisdiction.]
        </p>
      </Section>
    </>
  );
}

function Privacy() {
  return (
    <>
      <Draft />
      <p className="lg-lead">
        This Privacy Policy explains what this Slate deployment collects, why, and the choices you
        have. [OPERATOR NAME], [OPERATOR ADDRESS] is the controller of the personal data described
        here. Slate is open-source software, and the operator of each deployment decides how it is
        run and hosted.
      </p>

      <Section title="1. What we collect">
        <ul>
          <li>
            <strong>Account details from Google</strong> — your Google account identifier, name,
            email address and profile picture, through Firebase Authentication. We never receive your
            Google password.
          </li>
          <li>
            <strong>Your boards and writing</strong> — the strokes, text, diagrams, notes, titles and
            settings you create, and the pictures you choose to add. They are stored on your device
            and synced to the account so they appear on every device you sign in on.
          </li>
          <li>
            <strong>Collaboration data</strong> — when you join a room, the room code, presence and
            the live board changes are relayed through a realtime database while the room is open.
          </li>
          <li>
            <strong>AI requests</strong> — the part of a board you ask Slate to read, solve, explain,
            diagram or turn into notes, together with the instructions sent with it. These are sent
            to the AI provider configured by the operator.
          </li>
          <li>
            <strong>Recognition records, only when the operator turns them on</strong> — with
            SLATE_SAVE_SAMPLES=1 the operator’s own server keeps the board picture sent for
            recognition and the text Slate read from it, so accuracy can be measured and improved.
            This is off by default, is not sent to a third party and is not used to train a model.
            [State whether this deployment has it on.]
          </li>
          <li>
            <strong>Device and usage records</strong> — a random device identifier used for the
            one-active-device rule, daily AI usage counters, and routine server logs (such as time,
            route and error) used for security and reliability.
          </li>
          <li>
            <strong>Analytics, only if enabled</strong> — anonymous counts of which features are used,
            through Firebase Analytics. Boards are never included. You can turn this off in Settings
            at any time.
          </li>
        </ul>
      </Section>

      <Section title="2. What we do not collect">
        <p>
          We do not ask for your phone number, contacts, precise location or payment details in this
          edition. We do not sell personal data. We do not use your boards to train AI models.
          Recognition records, when the operator enables them, are kept on the operator’s own server
          to measure accuracy — never sold and never used for model training. [Confirm this for your
          own deployment and providers before publishing.]
        </p>
      </Section>

      <Section title="3. Why we use it">
        <ul>
          <li>
            <strong>To provide the Service</strong> — sign you in, save and sync your boards, read
            your handwriting, answer questions, keep collaboration rooms working, and apply the
            one-device rule.
          </li>
          <li>
            <strong>To keep it safe and available</strong> — authenticate requests, apply rate and
            daily limits, detect abuse, and investigate errors.
          </li>
          <li>
            <strong>To improve it</strong> — only through the analytics counts described above, and
            only when enabled.
          </li>
          <li>
            <strong>To meet legal obligations</strong> — where we must keep records or respond to
            lawful requests.
          </li>
        </ul>
      </Section>

      <Section title="4. Who we share it with">
        <ul>
          <li>
            <strong>Google Firebase</strong> — authentication, database, file storage, realtime
            collaboration and, if enabled, analytics.
          </li>
          <li>
            <strong>The configured AI provider</strong> — receives the handwriting images and text
            needed to answer your request, under that provider’s terms. The operator chooses the
            provider; [name the provider and its data-retention terms here].
          </li>
          <li>
            <strong>Hosting and infrastructure providers</strong> — process data on the operator’s
            behalf so the Service can run.
          </li>
          <li>
            <strong>Authorities</strong> — where the law requires it, or to protect rights, safety and
            security.
          </li>
          <li>
            <strong>Others, with your direction</strong> — for example when you share a board link.
          </li>
        </ul>
      </Section>

      <Section title="5. How long we keep it">
        <p>
          Boards and account data are kept while your account exists. Usage counters and routine
          logs are kept only as long as needed for limits, security and debugging. Recognition
          records, when the operator has enabled them, are kept on that server until the operator
          deletes them; they are not part of your account and deleting a board does not remove them.
          When you delete a board or your account, it is removed from the live system; copies in
          routine backups are removed or overwritten in the ordinary course. Some records may be kept
          longer where the law requires. [State concrete retention periods for your deployment.]
        </p>
      </Section>

      <Section title="6. Your choices and rights">
        <ul>
          <li>Turn usage analytics on or off in Settings at any time.</li>
          <li>Delete a board from the dashboard; it is removed from every signed-in device.</li>
          <li>
            Delete your account in Settings. This removes your account and its data from the live
            system and signs you out everywhere.
          </li>
          <li>
            Ask for a copy of your data, or ask us to correct or delete it, by writing to
            <a href={`mailto:${LEGAL_CONTACT}`}> {LEGAL_CONTACT}</a>. Depending on where you live you
            may have further rights, including to object or to complain to a regulator.
          </li>
        </ul>
      </Section>

      <Section title="7. Children">
        <p>
          Slate is meant for students but is not directed at children under [MINIMUM AGE]. Where the
          law allows younger users with parental consent, a parent or guardian accepts these
          documents on their behalf. If you believe a child has given us personal data without the
          required consent, contact us and we will remove it.
        </p>
      </Section>

      <Section title="8. Security">
        <p>
          Requests are authenticated with Firebase ID tokens; data access is limited by database
          rules to the signed-in owner; one device at a time is enforced; AI calls are rate-limited
          and metered. No system is perfectly secure, so keep your Google account protected and
          tell us about anything suspicious.
        </p>
      </Section>

      <Section title="9. Where your data is processed">
        <p>
          Data may be processed in [COUNTRIES/REGION], including by Google Firebase and the AI
          provider. Where personal data is transferred across borders, the operator takes the steps
          required by applicable law to protect it. [Add the transfer mechanism relied on, e.g.
          standard contractual clauses, and any required notice.]
        </p>
      </Section>

      <Section title="10. Third-party links and services">
        <p>
          Slate can show search results, videos and other third-party material, and uses Google for
          sign-in. Those services are controlled by their own companies, and their privacy policies
          apply to what they collect. This policy does not cover them.
        </p>
      </Section>

      <Section title="11. Changes to this policy">
        <p>
          We may update this policy as Slate or the law changes. The new version will be posted at
          <a href="/privacy"> /privacy</a> with a new “Last updated” date. If a change materially
          affects how we use your personal data, we will tell you in the app or by email before it
          takes effect where practicable. If you keep using the Service after the change takes
          effect, you accept the updated policy.
        </p>
      </Section>

      <Section title="12. Contact">
        <p>
          For any question, request or complaint about privacy, write to
          <a href={`mailto:${LEGAL_CONTACT}`}> {LEGAL_CONTACT}</a>. [Add the operator’s legal name,
          address, data-protection contact and any grievance officer or regulator details required
          in your jurisdiction.]
        </p>
      </Section>
    </>
  );
}

/** The document body for one legal document. */
export function LegalBody({ doc }: { doc: LegalDoc }) {
  return <>{doc === 'terms' ? <Terms /> : <Privacy />}</>;
}
