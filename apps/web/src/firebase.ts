/**
 * Firebase for the web app: one app, Google sign-in, and analytics that load only after first
 * paint and only when the user has not opted out. Firestore is imported on demand (see auth/userDoc.ts).
 *
 * This edition ships no Firebase project of its own: every value comes from VITE_FIREBASE_*
 * variables, set by whoever deploys it (see `.env.example` and docs/DEVELOPMENT.md). The web
 * config is public by design; access is controlled by Firestore rules, the authorized domains
 * list, and the API key's HTTP referrer restriction.
 */
import { initializeApp } from 'firebase/app';
import { browserLocalPersistence, browserPopupRedirectResolver, initializeAuth } from 'firebase/auth';

const env = import.meta.env;
const pick = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export const firebaseConfig = {
  apiKey: pick(env.VITE_FIREBASE_API_KEY),
  authDomain: pick(env.VITE_FIREBASE_AUTH_DOMAIN),
  projectId: pick(env.VITE_FIREBASE_PROJECT_ID),
  storageBucket: pick(env.VITE_FIREBASE_STORAGE_BUCKET),
  messagingSenderId: pick(env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  appId: pick(env.VITE_FIREBASE_APP_ID),
  measurementId: pick(env.VITE_FIREBASE_MEASUREMENT_ID),
  // Collaborate rooms (Realtime Database).
  databaseURL: pick(env.VITE_FIREBASE_DATABASE_URL),
};

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error(
    'Slate is not configured: set VITE_FIREBASE_* in apps/web/.env (copy .env.example) before signing in.',
  );
}

export const app = initializeApp(firebaseConfig);

export const auth = initializeAuth(app, {
  persistence: browserLocalPersistence,
  popupRedirectResolver: browserPopupRedirectResolver,
});

// ---------- Analytics ----------

const ANALYTICS_KEY = 'slate.analytics';
const disableFlag = `ga-disable-${firebaseConfig.measurementId}`;

/** Analytics are on unless the user turned them off in Settings. */
export function analyticsAllowed(): boolean {
  try {
    return localStorage.getItem(ANALYTICS_KEY) !== '0';
  } catch {
    return true;
  }
}

type AnalyticsKit = {
  a: import('firebase/analytics').Analytics;
  m: typeof import('firebase/analytics');
};
let kit: Promise<AnalyticsKit | null> | null = null;

function loadAnalytics(): Promise<AnalyticsKit | null> {
  kit ??= (async () => {
    // No measurement id: this deployment has no analytics project, so nothing is loaded.
    if (!firebaseConfig.measurementId) return null;
    const m = await import('firebase/analytics');
    if (!(await m.isSupported())) return null;
    const a = m.getAnalytics(app);
    m.setAnalyticsCollectionEnabled(a, analyticsAllowed());
    return { a, m };
  })().catch(() => null);
  return kit;
}

const setDisableFlag = (off: boolean) => {
  if (!firebaseConfig.measurementId) return;
  (window as unknown as Record<string, unknown>)[disableFlag] = off;
};

/** Starts analytics once the browser is idle, so it never delays the first paint. */
export function startAnalytics(): void {
  setDisableFlag(!analyticsAllowed());
  if (!firebaseConfig.measurementId || !analyticsAllowed()) return;
  const go = () => void loadAnalytics();
  if ('requestIdleCallback' in window) requestIdleCallback(go, { timeout: 4000 });
  else setTimeout(go, 1500);
}

/** Turns analytics collection on or off and remembers the choice. */
export function setAnalyticsAllowed(on: boolean): void {
  try {
    localStorage.setItem(ANALYTICS_KEY, on ? '1' : '0');
  } catch {
    // storage blocked; the choice lasts for this session
  }
  setDisableFlag(!on);
  if (on) {
    void loadAnalytics().then((k) => k?.m.setAnalyticsCollectionEnabled(k.a, true));
  } else if (kit) {
    void kit.then((k) => k?.m.setAnalyticsCollectionEnabled(k.a, false));
  }
}

/** Logs an analytics event. Does nothing when the user opted out. */
export function track(name: string, params?: Record<string, string | number | boolean>): void {
  if (!analyticsAllowed()) return;
  void loadAnalytics().then((k) => {
    if (k) k.m.logEvent(k.a, name, params);
  });
}

export function trackScreen(screen: string): void {
  track('screen_view', { firebase_screen: screen, firebase_screen_class: screen });
}
