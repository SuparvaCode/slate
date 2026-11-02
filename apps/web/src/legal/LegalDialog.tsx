/**
 * Terms and Privacy in a dialog, readable without leaving the page: opened from the sign-in
 * screen and from Settings. Traps focus while open, closes on Esc, a click outside or the
 * Android Back button, and gives focus back to the button that opened it.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useBack } from '../back';
import { LEGAL_TITLE, LEGAL_UPDATED, LegalBody, type LegalDoc } from './content';
import './legal.css';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Props {
  /** The document to open first. */
  doc?: LegalDoc;
  /** "dark" matches the sign-in screen, which is dark whatever the app theme. */
  tone?: 'auto' | 'dark';
  onClose: () => void;
}

export default function LegalDialog({ doc: initial = 'terms', tone = 'auto', onClose }: Props) {
  const [doc, setDoc] = useState<LegalDoc>(initial);
  const [closing, setClosing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const close = useCallback(() => setClosing(true), []);
  useBack(true, close);

  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(onClose, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
    return () => clearTimeout(t);
  }, [closing, onClose]);

  // Focus the close button on open, and give focus back to the opener on close.
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>('.lg-close')?.focus();
    return () => opener?.focus?.();
  }, []);

  // A different document starts at its top.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [doc]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const items = [...panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!panelRef.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    // Capture, so board shortcuts don't also see these keys.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  // A link from one document to the other switches inside the dialog instead of leaving the page.
  const onBodyClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a');
    const href = a?.getAttribute('href') ?? '';
    if (href === '/terms' || href === '/privacy') {
      e.preventDefault();
      setDoc(href.slice(1) as LegalDoc);
    }
  };

  return createPortal(
    <div
      className={`lg-scrim${closing ? ' closing' : ''}${tone === 'dark' ? ' lg-dark' : ''}`}
      onPointerDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="lg-panel" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="lg-head">
          <div className="lg-head-row">
            <div className="lg-head-text">
              <h2 id={titleId} className="lg-title">
                {LEGAL_TITLE[doc]}
              </h2>
              <p className="lg-updated">Last updated {LEGAL_UPDATED}</p>
            </div>
            <button type="button" className="lg-close" onClick={close} aria-label="Close">
              <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
          <div className="lg-tabs" role="radiogroup" aria-label="Choose a document">
            {(['terms', 'privacy'] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={doc === d}
                className={doc === d ? 'on' : ''}
                onClick={() => setDoc(d)}
              >
                {LEGAL_TITLE[d]}
              </button>
            ))}
          </div>
        </header>
        <div className="lg-body" ref={bodyRef} onClick={onBodyClick}>
          <LegalBody doc={doc} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
