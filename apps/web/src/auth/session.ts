/**
 * Google sign-in. Uses a popup on desktop and falls back to a full-page redirect when popups
 * are blocked, in iOS home-screen apps, and in in-app browsers where popups do not work.
 */
import { useEffect, useState } from 'react';
import type { User, UserCredential } from 'firebase/auth';
import {
  GoogleAuthProvider,
  getAdditionalUserInfo,
  getRedirectResult,
  onAuthStateChanged,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInWithCredential,
  signInWithPopup,
  signInWithRedirect,
  signOut,
} from 'firebase/auth';
import { auth, track } from '../firebase';
import { syncUserDoc } from './userDoc';
import { claimAfterSignIn, forgetClaim } from './device';

const provider = () => {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  return p;
};

/** Browsers where a popup cannot come back to the page: iOS standalone and in-app webviews. */
export function prefersRedirect(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iosStandalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (/iPhone|iPad|iPod/.test(ua) && matchMedia?.('(display-mode: standalone)').matches);
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|LinkedInApp|Snapchat|Twitter|TikTok|MicroMessenger|GSA\/|; wv\)/i.test(ua);
  return iosStandalone || inApp;
}

const REDIRECT_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/web-storage-unsupported',
]);

const QUIET_CODES = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled']);

const codeOf = (err: unknown) =>
  typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';

/** A message fit to show the user, or null when the user simply closed the popup. */
export function friendlyAuthError(err: unknown): string | null {
  const code = codeOf(err);
  if (QUIET_CODES.has(code)) return null;
  switch (code) {
    case 'auth/network-request-failed':
      return "Can't reach Google. Check your connection and try again.";
    case 'auth/user-disabled':
      return 'This account has been disabled. Contact support if you think this is a mistake.';
    case 'auth/too-many-requests':
      return 'Too many sign-in attempts. Wait a minute, then try again.';
    case 'auth/unauthorized-domain':
      return "Sign-in isn't set up for this web address yet. Add it to the authorized domains in Firebase.";
    case 'auth/operation-not-allowed':
      return "Google sign-in isn't turned on for this project yet.";
    case 'auth/account-exists-with-different-credential':
      return 'This email is already linked to another sign-in method.';
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Allow popups for this site and try again.';
    case 'auth/web-storage-unsupported':
      return 'Your browser is blocking storage that sign-in needs. Turn off private mode or allow cookies.';
    default:
      return "Sign-in didn't finish. Try again.";
  }
}

async function finish(cred: UserCredential | null): Promise<void> {
  if (!cred) return;
  // A new sign-in makes this the account's only device; the others are signed out.
  await claimAfterSignIn(cred.user, true);
  const isNew = getAdditionalUserInfo(cred)?.isNewUser ?? false;
  track(isNew ? 'sign_up' : 'login', { method: 'google' });
}

/**
 * Inside the Android app, Google sign-in uses the phone's own account picker: web popups and
 * redirects can't come back to an app's web view. The native plugin returns a Google ID token,
 * and the web SDK signs in with it, so `auth` works the same as on the web.
 */
const isNative = (): boolean =>
  !!(globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

async function nativeGoogleCredential() {
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
  try {
    // Signed out natively first, so the account picker always shows.
    await FirebaseAuthentication.signOut().catch(() => {});
    const res = await FirebaseAuthentication.signInWithGoogle();
    const idToken = res.credential?.idToken;
    if (!idToken) throw Object.assign(new Error('No token'), { code: 'auth/user-cancelled' });
    return GoogleAuthProvider.credential(idToken);
  } catch (err) {
    // The plugin reports a closed picker as a plain error.
    if (!codeOf(err) && /cancel/i.test(String((err as Error)?.message))) throw Object.assign(new Error('Cancelled'), { code: 'auth/user-cancelled' });
    throw err;
  }
}

/**
 * Inside the Windows app, Google sign-in runs in the system browser (apps/desktop/signin.js) and
 * comes back as Google tokens, which the web SDK signs in with.
 */
interface DesktopBridge {
  googleSignIn: () => Promise<{ idToken?: string; accessToken?: string; cancelled?: boolean }>;
}
const desktop = (): DesktopBridge | null => (globalThis as { slateDesktop?: DesktopBridge }).slateDesktop ?? null;

async function desktopGoogleCredential(d: DesktopBridge) {
  const res = await d.googleSignIn();
  if (!res?.idToken) throw Object.assign(new Error('Cancelled'), { code: 'auth/user-cancelled' });
  return GoogleAuthProvider.credential(res.idToken, res.accessToken || undefined);
}

/** Starts Google sign-in. Resolves when signed in, or when the page is about to redirect. */
export async function signInWithGoogle(): Promise<void> {
  const d = desktop();
  if (d) {
    await finish(await signInWithCredential(auth, await desktopGoogleCredential(d)));
    return;
  }
  if (isNative()) {
    await finish(await signInWithCredential(auth, await nativeGoogleCredential()));
    return;
  }
  if (prefersRedirect()) {
    await signInWithRedirect(auth, provider());
    return;
  }
  try {
    await finish(await signInWithPopup(auth, provider()));
  } catch (err) {
    if (REDIRECT_CODES.has(codeOf(err))) {
      await signInWithRedirect(auth, provider());
      return;
    }
    throw err;
  }
}

/** Picks up the result of a redirect sign-in. Call once at startup. Returns an error message if it failed. */
export async function completeRedirect(): Promise<string | null> {
  try {
    await finish(await getRedirectResult(auth));
    return null;
  } catch (err) {
    return friendlyAuthError(err);
  }
}

export async function signOutUser(): Promise<void> {
  forgetClaim();
  if (isNative()) {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    await FirebaseAuthentication.signOut().catch(() => {});
  }
  await signOut(auth);
}

/**
 * Deletes the Firebase account and the boards stored with it. The user confirms with Google first.
 */
export async function deleteAccount(user: User): Promise<void> {
  // Google confirms first, so the boards are only removed once the account will really go.
  const d = desktop();
  if (d) await reauthenticateWithCredential(user, await desktopGoogleCredential(d));
  else if (isNative()) await reauthenticateWithCredential(user, await nativeGoogleCredential());
  else await reauthenticateWithPopup(user, provider());
  const { wipeAccountData } = await import('../sync/cloud');
  await wipeAccountData(user.uid);
  await user.delete();
}

export type AuthState =
  | { status: 'loading'; user: null }
  | { status: 'signedOut'; user: null }
  | { status: 'signedIn'; user: User };

/**
 * Dev builds only: `?devuser=1` signs in a fake local account so the board can be tested without
 * Google (`?devuser=0` turns it off). It sends no token, so it only works against an API running
 * with auth disabled. Production builds drop this code entirely.
 */
function devUser(): User | null {
  if (!import.meta.env.DEV) return null;
  const flag = new URLSearchParams(location.search).get('devuser');
  if (flag === '1') localStorage.setItem('slate.devUser', '1');
  if (flag === '0') localStorage.removeItem('slate.devUser');
  if (localStorage.getItem('slate.devUser') !== '1') return null;
  return {
    uid: 'dev-user',
    displayName: 'Test Student',
    email: 'test@slate.local',
    photoURL: null,
    getIdToken: async () => '',
    delete: async () => localStorage.removeItem('slate.devUser'),
  } as unknown as User;
}

/** The current auth state. Starts as 'loading' until Firebase has restored any saved session. */
const DEV_USER = devUser();

export const useAuth: () => AuthState = DEV_USER
  ? () => ({ status: 'signedIn', user: DEV_USER })
  : useFirebaseAuth;

function useFirebaseAuth(): AuthState {
  const [state, setState] = useState<AuthState>(() =>
    auth.currentUser ? { status: 'signedIn', user: auth.currentUser } : { status: 'loading', user: null },
  );
  useEffect(
    () =>
      onAuthStateChanged(auth, (user) => {
        setState(user ? { status: 'signedIn', user } : { status: 'signedOut', user: null });
        if (user) {
          void syncUserDoc(user);
          // A restored session keeps its claim; one from before this check claims the account now.
          void claimAfterSignIn(user, false);
        }
      }),
    [],
  );
  return state;
}
