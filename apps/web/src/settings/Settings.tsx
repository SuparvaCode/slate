/**
 * Settings: a sheet on phones, a centred panel on larger screens. Traps focus while open,
 * closes on Esc or a click outside, and gives focus back to the button that opened it.
 */
import { Suspense, lazy, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { User } from 'firebase/auth';
import type { LegalDoc } from '../legal/content';
import { energyWord, refillsIn, useEnergy } from '../dashboard/energy';
import { deleteAccount, friendlyAuthError, signOutUser } from '../auth/session';
import { trackScreen } from '../firebase';
import * as bridge from './bridge';
import { changeSetting, currentSettings } from './store';
import type { SyncedSettings } from './store';
import { Avatar } from './Avatar';
import './settings.css';
import { useBack } from '../back';

const LegalDialog = lazy(() => import('../legal/LegalDialog'));

const VERSION = import.meta.env.VITE_APP_VERSION || '0.1.0';
/** The AI thought level, in words. The values are what the server maps to reasoning effort. */
const THOUGHTS = [
  { value: 'none', label: 'No thoughts' },
  { value: 'low', label: 'Think' },
  { value: 'medium', label: 'Think more' },
  { value: 'high', label: 'Think most' },
] as const;
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Switch({ id, checked, onChange, label }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`st-switch${checked ? ' on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <i />
    </button>
  );
}

function Row({
  title, hint, control, htmlFor, stacked,
}: { title: string; hint?: string; control: React.ReactNode; htmlFor?: string; stacked?: boolean }) {
  return (
    <div className={`st-row${stacked ? ' st-row-stacked' : ''}`}>
      <div className="st-row-text">
        <label className="st-row-title" htmlFor={htmlFor}>
          {title}
        </label>
        {hint && <div className="st-row-hint">{hint}</div>}
      </div>
      <div className="st-row-control">{control}</div>
    </div>
  );
}

/** Today's AI energy: one meter for every AI feature, with no counts to watch. */
function Usage() {
  const e = useEnergy();
  if (!e) return <p className="st-muted" aria-live="polite">Checking today's AI energy…</p>;
  const left = e.left;
  return (
    <div className="st-usage">
      <div className="st-meter">
        <div className="st-meter-head">
          <span>AI energy</span>
          <span className="st-meter-num">{energyWord(left)}</span>
        </div>
        <div
          className={`st-bar${left <= 0 ? ' full' : left < 15 ? ' high' : ''}`}
          role="meter"
          aria-label="AI energy left today"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={left}
          aria-valuetext={energyWord(left)}
        >
          <i style={{ transform: `scaleX(${left / 100})` }} />
        </div>
      </div>
      <p className="st-muted st-usage-foot">
        Answers, notes, summaries and titles all use it. {refillsIn(e.reset)}.
      </p>
    </div>
  );
}

/** When this account last signed in, from Firebase's own record. */
function lastSignIn(user: User): string {
  const t = Date.parse(user.metadata?.lastSignInTime ?? '');
  return Number.isFinite(t) ? `Last sign-in ${new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}` : 'Signed in with Google';
}

interface Props {
  user: User;
  onClose: () => void;
}

export default function Settings({ user, onClose }: Props) {
  const [s, setS] = useState<SyncedSettings>(currentSettings);
  const [closing, setClosing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [legal, setLegal] = useState<LegalDoc | null>(null);
  const [busy, setBusy] = useState<null | 'signout' | 'delete'>(null);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const ids = { haptics: useId(), analytics: useId(), solution: useId(), fingers: useId() };
  const canTheme = bridge.canSetTheme();
  const hasSolution = bridge.readSolution() !== null;
  const hasFingers = bridge.readFingers() !== null;

  const close = useCallback(() => setClosing(true), []);
  // A confirm step opened inside Settings closes before Settings itself.
  useBack(true, close);
  useBack(confirmDelete, () => setConfirmDelete(false));

  useEffect(() => trackScreen('settings'), []);

  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(onClose, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220);
    return () => clearTimeout(t);
  }, [closing, onClose]);

  // Focus the panel on open, keep Tab inside it, and give focus back on close.
  useLayoutEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>('.st-close')?.focus();
    return () => opener?.focus?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // The legal dialog sits above Settings and handles its own keys.
      if (legal) return;
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
  }, [close, legal]);

  const set = <K extends 'theme' | 'haptics' | 'analytics' | 'solution' | 'fingers' | 'thought'>(
    key: K,
    value: NonNullable<SyncedSettings[K]>,
  ) => {
    changeSetting(key, value);
    // The board applies theme and toggles on its next render, so take the new value directly.
    setS({ ...currentSettings(), [key]: value });
  };

  const signOut = async () => {
    setBusy('signout');
    setError(null);
    try {
      await signOutUser();
    } catch {
      setError("Couldn't sign out. Check your connection and try again.");
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy('delete');
    setError(null);
    try {
      await deleteAccount(user);
      // Deleting the account signs out, which returns to the sign-in screen.
    } catch (err) {
      setError(friendlyAuthError(err) ?? 'Account not deleted. Confirm with Google to delete it.');
      setBusy(null);
    }
  };

  const theme = s.theme ?? bridge.readTheme() ?? 'dark';

  return (
    <div className={`st-scrim${closing ? ' closing' : ''}`} onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="st-panel" ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="st-grabber" aria-hidden="true" />
        <header className="st-head">
          <h2 id={titleId}>Settings</h2>
          <button type="button" className="st-close" onClick={close} aria-label="Close settings">
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M2 2l10 10M12 2 2 12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="st-body">
          <section className="st-section st-account" aria-label="Account">
            <Avatar user={user} size={52} />
            <div className="st-who">
              <div className="st-name">{user.displayName || 'Signed in'}</div>
              {user.email && <div className="st-email">{user.email}</div>}
            </div>
            <button type="button" className="st-btn" onClick={signOut} disabled={busy !== null}>
              {busy === 'signout' ? 'Signing out…' : 'Sign out'}
            </button>
          </section>

          <section className="st-section" aria-labelledby={`${titleId}-look`}>
            <h3 id={`${titleId}-look`}>Appearance</h3>
            {canTheme && (
              <Row
                title="Theme"
                control={
                  <div className="st-seg" role="radiogroup" aria-label="Theme">
                    {(['light', 'dark'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="radio"
                        aria-checked={theme === t}
                        className={theme === t ? 'on' : ''}
                        onClick={() => set('theme', t)}
                      >
                        {t === 'light' ? 'Light' : 'Dark'}
                      </button>
                    ))}
                  </div>
                }
              />
            )}
            <Row
              title="Haptics"
              hint="A light tap when you pick a tool or an answer arrives, on devices that support it."
              htmlFor={ids.haptics}
              control={<Switch id={ids.haptics} label="Haptics" checked={s.haptics !== false} onChange={(v) => set('haptics', v)} />}
            />
          </section>

          <section className="st-section" aria-labelledby={`${titleId}-ai`}>
            <h3 id={`${titleId}-ai`}>AI</h3>
            <Row
              stacked
              title="AI thought level"
              hint="How much the AI thinks before it answers. More thinking takes a little longer and gives better answers on hard questions."
              control={
                <div className="st-seg st-seg-grid" role="radiogroup" aria-label="AI thought level">
                  {THOUGHTS.map((t) => {
                    const on = (s.thought ?? 'low') === t.value;
                    return (
                      <button
                        key={t.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        className={on ? 'on' : ''}
                        onClick={() => set('thought', t.value)}
                      >
                        {t.label}
                      </button>
                    );
                  })}
                </div>
              }
            />
          </section>

          {(hasSolution || hasFingers) && (
            <section className="st-section" aria-labelledby={`${titleId}-write`}>
              <h3 id={`${titleId}-write`}>Writing</h3>
              {hasSolution && (
                <Row
                  title="Write every step"
                  hint="Slate writes the full working, not only the answer."
                  htmlFor={ids.solution}
                  control={
                    <Switch id={ids.solution} label="Write every step" checked={!!s.solution} onChange={(v) => set('solution', v)} />
                  }
                />
              )}
              {hasFingers && (
                <Row
                  title="Draw with fingers"
                  hint="Turn off to draw only with a pen or mouse. Two fingers always move the board."
                  htmlFor={ids.fingers}
                  control={
                    <Switch
                      id={ids.fingers}
                      label="Draw with fingers"
                      checked={s.fingers !== 'pan'}
                      onChange={(v) => set('fingers', v ? 'draw' : 'pan')}
                    />
                  }
                />
              )}
            </section>
          )}

          <section className="st-section" aria-labelledby={`${titleId}-usage`}>
            <h3 id={`${titleId}-usage`}>Usage</h3>
            <Usage />
          </section>

          <section className="st-section" aria-labelledby={`${titleId}-security`}>
            <h3 id={`${titleId}-security`}>Security</h3>
            <Row title="Google account" hint={lastSignIn(user)} control={null} />
            <Row
              title="One device at a time"
              hint="Signing in on another device signs this one out automatically, so there is no need to sign out everywhere."
              control={null}
            />
          </section>

          <section className="st-section" aria-labelledby={`${titleId}-privacy`}>
            <h3 id={`${titleId}-privacy`}>Privacy</h3>
            <Row
              title="Share usage analytics"
              hint="Anonymous counts of features used, to help improve Slate. Your boards are never included."
              htmlFor={ids.analytics}
              control={
                <Switch id={ids.analytics} label="Share usage analytics" checked={s.analytics !== false} onChange={(v) => set('analytics', v)} />
              }
            />
            <Row
              title="Terms of Service"
              hint="The agreement for using Slate."
              control={
                <button type="button" className="st-btn" onClick={() => setLegal('terms')}>
                  Read
                </button>
              }
            />
            <Row
              title="Privacy Policy"
              hint="What Slate collects, why, and the choices you have."
              control={
                <button type="button" className="st-btn" onClick={() => setLegal('privacy')}>
                  Read
                </button>
              }
            />
          </section>

          <section className="st-section st-danger" aria-labelledby={`${titleId}-delete`}>
            <h3 id={`${titleId}-delete`}>Delete account</h3>
            {confirmDelete ? (
              <div className="st-confirm" role="group" aria-label="Confirm account deletion">
                <p>
                  This deletes your Slate account and signs you out. Your saved data on Slate's servers is removed
                  separately within a few days. Your boards are deleted with it.
                </p>
                <div className="st-confirm-actions">
                  <button type="button" className="st-btn" onClick={() => setConfirmDelete(false)} disabled={busy !== null}>
                    Keep account
                  </button>
                  <button type="button" className="st-btn danger" onClick={remove} disabled={busy !== null}>
                    {busy === 'delete' ? 'Deleting…' : 'Delete account'}
                  </button>
                </div>
              </div>
            ) : (
              <Row
                title="Delete your account"
                hint="You may be asked to confirm with Google."
                control={
                  <button type="button" className="st-btn danger-ghost" onClick={() => setConfirmDelete(true)}>
                    Delete…
                  </button>
                }
              />
            )}
          </section>

          {error && (
            <p className="st-error" role="alert">
              {error}
            </p>
          )}

          <footer className="st-foot">Slate {VERSION}</footer>
        </div>
        {legal && (
          <Suspense fallback={null}>
            <LegalDialog doc={legal} onClose={() => setLegal(null)} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
