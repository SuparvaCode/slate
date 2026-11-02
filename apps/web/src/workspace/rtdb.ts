/**
 * Firebase Realtime Database for Collaborate rooms, loaded only when a room is used.
 *
 * Dev builds can run against the local emulators instead (`?emu=1`, see services/README): a
 * separate Firebase app with an anonymous account per tab, so two tabs are two people.
 */
import type { Database } from 'firebase/database';

export interface Live {
  db: Database;
  m: typeof import('firebase/database');
  uid: string;
  name: string;
}

const EMU = (() => {
  if (!import.meta.env.DEV) return false;
  try {
    const flag = new URLSearchParams(location.search).get('emu');
    if (flag === '1') sessionStorage.setItem('slate.emu', '1');
    if (flag === '0') sessionStorage.removeItem('slate.emu');
    return sessionStorage.getItem('slate.emu') === '1';
  } catch {
    return false;
  }
})();

let live: Promise<Live> | null = null;

export function connectLive(name: string): Promise<Live> {
  live ??= (async (): Promise<Live> => {
    const m = await import('firebase/database');
    if (EMU) {
      const { initializeApp } = await import('firebase/app');
      const a = await import('firebase/auth');
      const app = initializeApp(
        { apiKey: 'demo-key', projectId: 'demo-slate', databaseURL: 'https://demo-slate-default-rtdb.firebaseio.com' },
        'live-emu',
      );
      const auth = a.initializeAuth(app, { persistence: a.browserSessionPersistence });
      a.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      const db = m.getDatabase(app);
      m.connectDatabaseEmulator(db, '127.0.0.1', 9000);
      // The same test person for the life of the tab, so a reload rejoins with the same colour.
      await auth.authStateReady();
      const user = auth.currentUser ?? (await a.signInAnonymously(auth)).user;
      return { db, m, uid: user.uid, name };
    }
    const { app, auth } = await import('../firebase');
    const user = auth.currentUser;
    if (!user) throw new Error(import.meta.env.DEV ? 'Rooms need a real sign-in, or open the app with ?emu=1.' : 'Sign in to collaborate.');
    return { db: m.getDatabase(app), m, uid: user.uid, name };
  })();
  live.catch(() => {
    live = null;
  });
  return live;
}
