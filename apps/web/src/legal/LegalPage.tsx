/**
 * The public page at /terms and /privacy: no sign-in needed, so the documents can be linked from
 * this app, the Play Store listing and anywhere else. The document switcher keeps the address
 * bar in step with what is on screen.
 */
import { useEffect, useRef, useState } from 'react';
import { Wordmark } from '../onboarding/Wordmark';
import { LEGAL_TITLE, LEGAL_UPDATED, LegalBody, type LegalDoc } from './content';
import './legal.css';

export default function LegalPage({ doc: initial }: { doc: LegalDoc }) {
  const [doc, setDoc] = useState<LegalDoc>(initial);
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = `${LEGAL_TITLE[doc]} · Slate`;
  }, [doc]);

  const switchTo = (next: LegalDoc) => {
    setDoc(next);
    // Keep the address bar on the document being read, so it can be copied or bookmarked.
    history.replaceState(null, '', `/${next}`);
    // A different document starts at its top.
    pageRef.current?.scrollTo({ top: 0 });
  };

  const onBodyClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href') ?? '';
    if (href === '/terms' || href === '/privacy') {
      e.preventDefault();
      switchTo(href.slice(1) as LegalDoc);
    }
  };

  return (
    <div className="lg-page" ref={pageRef}>
      <header className="lg-page-head">
        <a className="lg-page-home" href="/" aria-label="Slate home">
          <Wordmark height={26} />
        </a>
        <nav className="lg-page-tabs" aria-label="Legal documents">
          {(['terms', 'privacy'] as const).map((d) => (
            <a key={d} href={`/${d}`} aria-current={doc === d ? 'page' : undefined} onClick={(e) => { e.preventDefault(); switchTo(d); }}>
              {LEGAL_TITLE[d]}
            </a>
          ))}
        </nav>
      </header>

      <main className="lg-page-main">
        <article className="lg-page-doc">
          <h1>{LEGAL_TITLE[doc]}</h1>
          <p className="lg-page-updated">Last updated {LEGAL_UPDATED}</p>
          <div className="lg-body lg-body-page" onClick={onBodyClick}>
            <LegalBody doc={doc} />
          </div>
        </article>
        <p className="lg-page-back">
          <a href="/">← Back to Slate</a>
        </p>
      </main>
    </div>
  );
}
