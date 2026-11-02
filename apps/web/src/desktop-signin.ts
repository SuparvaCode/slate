/**
 * Google sign-in for the Windows app, opened in the system browser by apps/desktop/signin.js.
 * Google won't sign in inside an app's own window, so it happens here, and the Google tokens go
 * back to the app on this computer (127.0.0.1) with the one-time `state` the app made.
 *
 * Sign-in is kept in memory only, so the browser is not left signed in to Slate.
 */
import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, browserPopupRedirectResolver, inMemoryPersistence, initializeAuth, signInWithPopup } from 'firebase/auth';
import { firebaseConfig } from './firebase';

const msg = document.getElementById('msg')!;
const go = document.getElementById('go') as HTMLButtonElement;
const say = (text: string, error = false) => {
  msg.textContent = text;
  msg.className = error ? 'err' : '';
};

const q = new URLSearchParams(location.search);
const port = Number(q.get('port'));
const state = q.get('state') ?? '';

if (!Number.isInteger(port) || port < 1024 || port > 65535 || !/^[0-9a-f]{48}$/.test(state)) {
  say('Open this page from the Slate app: choose Continue with Google there.', true);
} else {
  const auth = initializeAuth(initializeApp(firebaseConfig, 'desktop-signin'), {
    persistence: inMemoryPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  go.hidden = false;
  go.onclick = async () => {
    go.disabled = true;
    say('Waiting for Google…');
    try {
      const cred = GoogleAuthProvider.credentialFromResult(await signInWithPopup(auth, provider));
      if (!cred?.idToken) throw new Error('no token');
      say('Signed in. Going back to Slate…');
      const back = new URLSearchParams({ state, id: cred.idToken, at: cred.accessToken ?? '' });
      // The tokens travel in the fragment, which the browser never sends over the network.
      location.replace(`http://127.0.0.1:${port}/done#${back}`);
    } catch (err) {
      const code = typeof err === 'object' && err && 'code' in err ? String((err as { code: unknown }).code) : '';
      go.disabled = false;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') say('Choose your Google account to continue.');
      else if (code === 'auth/popup-blocked') say('Your browser blocked the Google window. Allow pop-ups for this site and try again.', true);
      else say("Sign-in didn't finish. Try again.", true);
    }
  };
}
