/**
 * Decides what the app shows: a splash while Firebase restores a saved session (so returning
 * users never see the sign-in screen flash), onboarding when signed out, and the board with an
 * account button when signed in.
 */
import { Suspense, lazy, useEffect, useState, useSyncExternalStore } from 'react';
import type { User } from 'firebase/auth';
import { startAnalytics, trackScreen } from '../firebase';
import Onboarding from '../onboarding/Onboarding';
import { Wordmark } from '../onboarding/Wordmark';
import { Avatar } from '../settings/Avatar';
import { apiEvents } from './events';
import type { LimitEvent } from './events';
import { completeRedirect, useAuth } from './session';
import { watchClaim } from './device';
import { authFetch } from './authFetch';
import { boardKey, onView } from '../workspace/key';
import { currentRoute, goBoard, goHome, onRoute, refreshRoute } from '../dashboard/route';
import '../dashboard/dashboard.css';
// Checks the saved view names a slate that exists, before the board loads it.
import '../workspace/slates';
import '../settings/settings.css';
import { exitApp, isNativeApp, listenNativeBack } from '../back';
import { storedTheme } from '../settings/bridge';
import { reloadSlates, newSlateWithBoard } from '../workspace/slates';
import { flushSync, runSync, startSync } from '../sync/cloud';
import { cleanElements, flushBoard } from '../board';

const App = lazy(() => import('../App.tsx'));
const Settings = lazy(() => import('../settings/Settings'));
const Workspace = lazy(() => import('../workspace/Workspace'));
const Dashboard = lazy(() => import('../dashboard/Dashboard'));

/** The splash follows the board's saved theme, so a dark-mode user isn't flashed with white. */
function splashDark(): boolean {
  try {
    const raw = localStorage.getItem('slate.board.v1');
    if (raw?.includes('"theme":"dark"')) return true;
    if (raw?.includes('"theme":"light"')) return false;
  } catch {
    // storage blocked
  }
  return storedTheme() === 'dark';
}

export function Splash() {
  return (
    <div className={`splash${splashDark() ? ' dark' : ''}`} role="status" aria-label="Loading Slate">
      <Wordmark height={40} />
    </div>
  );
}

function LimitToast() {
  const [event, setEvent] = useState<LimitEvent | null>(null);
  useEffect(() => apiEvents.on('limit', setEvent), []);
  useEffect(() => {
    if (!event) return;
    const t = setTimeout(() => setEvent(null), 9000);
    return () => clearTimeout(t);
  }, [event]);
  if (!event) return null;
  // The server also answers 429 for the per-minute limit and for too many answers at once;
  // only a wait of hours means today's quota is used up.
  const daily = event.retryAfter === null || event.retryAfter >= 3600;
  return (
    <div className="limit-toast" role="status" aria-live="polite">
      <div>
        <strong>{daily ? (event.message.includes('AI energy') ? 'Out of AI energy for today' : 'Daily limit reached') : 'One moment'}</strong>
        {event.message}
      </div>
      <button type="button" onClick={() => setEvent(null)} aria-label="Dismiss">
        OK
      </button>
    </div>
  );
}

function SignedIn({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  // The board's More menu opens Settings on phones, where there's no room for the avatar.
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('slate:settings', show);
    return () => window.removeEventListener('slate:settings', show);
  }, []);
  // Signed in elsewhere: this device learns at once, even while nobody is using the AI. The server
  // decides: a request it refuses for another device signs this one out (authFetch).
  useEffect(() => watchClaim(user.uid, () => void authFetch('/api/me/usage').catch(() => {})), [user.uid]);
  // Each slate and rough board is its own board: switching remounts the board with its own storage.
  const board = useSyncExternalStore(onView, boardKey);
  const route = useSyncExternalStore(onRoute, currentRoute);
  useEffect(() => trackScreen(route.page === 'home' ? 'dashboard' : 'board'), [route.page]);
  // Android Back with nothing open: a board goes to the dashboard, the dashboard leaves the app.
  useEffect(() => listenNativeBack(() => (currentRoute().page === 'home' ? void exitApp() : goHome())), []);
  // The Android app can be put in the background without the page hiding in time, so the board
  // on screen and anything waiting to sync are saved the moment the app leaves the foreground.
  useEffect(() => {
    if (!isNativeApp()) return;
    let done = false;
    const handles: { remove: () => Promise<void> }[] = [];
    const save = () => {
      flushBoard();
      void flushSync();
    };
    void import('@capacitor/app')
      .then(({ App }) =>
        Promise.all([App.addListener('appStateChange', ({ isActive }) => !isActive && save()), App.addListener('pause', save)]),
      )
      .then((hs) => {
        if (done) hs.forEach((h) => void h.remove());
        else handles.push(...hs);
      })
      .catch(() => {});
    return () => {
      done = true;
      handles.forEach((h) => void h.remove());
    };
  }, []);
  return (
    <>
      {route.page === 'home' ? (
        <Suspense fallback={<Splash />}>
          <Dashboard user={user} missing={route.missing} />
        </Suspense>
      ) : (
        <>
          <Suspense fallback={<Splash />}>
            <App key={board} />
          </Suspense>
          <Suspense fallback={null}>
            <Workspace user={user} />
          </Suspense>
          <button type="button" className="home-btn" onClick={goHome} aria-label="All boards" title="All boards">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
              <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
              <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
              <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
            </svg>
          </button>
        </>
      )}
      <button
        type="button"
        className={`acct-btn${route.page === 'home' ? ' top' : ''}`}
        onClick={() => setOpen(true)}
        aria-label={`Settings and account, signed in as ${user.displayName || user.email || 'you'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Settings"
      >
        <Avatar user={user} size={36} />
      </button>
      {open && (
        <Suspense fallback={null}>
          <Settings user={user} onClose={() => setOpen(false)} />
        </Suspense>
      )}
      <LimitToast />
    </>
  );
}

export default function AuthGate() {
  const auth = useAuth();
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    startAnalytics();
    void completeRedirect().then((msg) => msg && setNotice(msg));
    const offOther = apiEvents.on('other-device', () =>
      setNotice('Your account was signed in on another device, so you were signed out here. Slate allows one device per account.'),
    );
    const offExpired = apiEvents.on('session-expired', () => setNotice('Your session has ended. Sign in again to keep going.'));
    return () => {
      offOther();
      offExpired();
    };
  }, []);

  useEffect(() => {
    if (auth.status === 'signedOut') trackScreen('onboarding');
  }, [auth.status]);

  if (auth.status === 'loading') return <Splash />;
  if (auth.status === 'signedOut') return <Onboarding notice={notice} onClearNotice={() => setNotice(null)} />;
  return <Synced key={auth.user.uid} user={auth.user} />;
}

/**
 * A board someone shared a link to (see share/ShareView): "Make a copy" there asks the app to
 * make it, once signed in. The copy is a new slate of the signed-in user's; the owner's board is
 * never opened or changed.
 */
async function copyPendingShare(): Promise<void> {
  let id: string | null = null;
  try {
    id = localStorage.getItem('slate.pending-share');
    if (id) localStorage.removeItem('slate.pending-share');
  } catch {
    return; // storage blocked
  }
  if (!id || !/^[A-Za-z0-9_-]{22}$/.test(id)) return;
  try {
    const r = await fetch(`/api/share/${encodeURIComponent(id)}`);
    if (!r.ok) return; // link ended, or sharing was stopped
    const body: unknown = await r.json().catch(() => null);
    if (!body || typeof body !== 'object') return;
    const b = body as { title?: unknown; theme?: unknown; elements?: unknown };
    const title = typeof b.title === 'string' && b.title.trim() ? `${b.title.trim().slice(0, 54)} copy` : 'Shared board copy';
    const copy = newSlateWithBoard(
      title,
      JSON.stringify({ v: 1, elements: cleanElements(b.elements, true), cam: null, theme: b.theme === 'dark' ? 'dark' : 'light' }),
    );
    goBoard(copy.id);
    void flushSync();
  } catch {
    // offline: the link can be opened again to make the copy
  }
}

/** Boards live in the account: they are brought to this device before anything is shown. */
function Synced({ user }: { user: User }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let stop: (() => void) | null = null;
    let live = true;
    void startSync(user).then(async (r) => {
      if (!live) return;
      // Another account's boards were on this device: they were cleared, and the app starts again.
      if (r === 'reload') return location.reload();
      reloadSlates();
      refreshRoute();
      stop = runSync();
      // A shared board waiting to be copied becomes this account's own slate, then opens.
      await copyPendingShare();
      if (!live) return;
      setReady(true);
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [user]);
  if (!ready) return <Splash />;
  return <SignedIn user={user} />;
}
