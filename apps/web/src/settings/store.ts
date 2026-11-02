/**
 * Settings that follow the user between devices. Each change is saved to localStorage at once
 * and then merged into `users/{uid}.settings` in Firestore. When a device signs in, whichever
 * copy changed most recently wins.
 *
 * Storage:
 * - `slate.haptics`   '0' off, anything else on (read by the haptics module)
 * - `slate.analytics` '0' off, anything else on (see firebase.ts)
 * - `slate.settings.v1` the last synced snapshot, including theme and board options, with `updatedAt`
 * Theme and board options themselves stay in the board's own storage (see bridge.ts).
 */
import { analyticsAllowed, setAnalyticsAllowed, track } from '../firebase';
import * as bridge from './bridge';

/** How much the AI thinks before it answers; Settings shows these as words, never levels. */
export type Thought = 'none' | 'low' | 'medium' | 'high';

export interface SyncedSettings {
  theme?: 'light' | 'dark';
  haptics?: boolean;
  analytics?: boolean;
  solution?: boolean;
  fingers?: 'draw' | 'pan';
  thought?: Thought;
  /** Epoch milliseconds of the last change. */
  updatedAt?: number;
}

const HAPTICS_KEY = 'slate.haptics';
const SNAP_KEY = 'slate.settings.v1';

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    // storage blocked
  }
};

export const hapticsOn = () => read(HAPTICS_KEY) !== '0';

/**
 * The AI thought level for every AI request: "Think" by default, so answers that need reasoning get
 * it at little cost. Every request carries it (see authFetch), so the app and the board agree.
 */
export const thoughtLevel = (): Thought => snapshot().thought ?? 'low';

/** Keeps only fields of the right type, so a bad remote value can't break the app. */
export function clean(raw: unknown): SyncedSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: SyncedSettings = {};
  if (s.theme === 'light' || s.theme === 'dark') out.theme = s.theme;
  if (typeof s.haptics === 'boolean') out.haptics = s.haptics;
  if (typeof s.analytics === 'boolean') out.analytics = s.analytics;
  if (typeof s.solution === 'boolean') out.solution = s.solution;
  if (s.fingers === 'draw' || s.fingers === 'pan') out.fingers = s.fingers;
  if (s.thought === 'none' || s.thought === 'low' || s.thought === 'medium' || s.thought === 'high') out.thought = s.thought;
  if (typeof s.updatedAt === 'number' && Number.isFinite(s.updatedAt)) out.updatedAt = Math.floor(s.updatedAt);
  return out;
}

function snapshot(): SyncedSettings {
  return clean(JSON.parse(read(SNAP_KEY) || '{}'));
}

/** The settings as they are on this device right now. */
export function currentSettings(): SyncedSettings {
  const snap = snapshot();
  const out: SyncedSettings = { ...snap, haptics: hapticsOn(), analytics: analyticsAllowed() };
  const theme = bridge.readTheme();
  if (theme) out.theme = theme;
  const solution = bridge.readSolution();
  if (solution !== null) out.solution = solution;
  const fingers = bridge.readFingers();
  if (fingers) out.fingers = fingers;
  return out;
}

type Push = (settings: SyncedSettings) => Promise<void>;
let pushRemote: Push | null = null;
let pushTimer: ReturnType<typeof setTimeout> | undefined;

/** Set by userDoc.ts once the user's document is known to exist. */
export function setRemotePusher(fn: Push | null): void {
  pushRemote = fn;
}

function schedulePush(s: SyncedSettings) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    void pushRemote?.(s).catch(() => {
      // offline; the snapshot is pushed again on the next sign-in
    });
  }, 600);
}

/** Changes one setting: applied and saved locally at once, then synced. */
export function changeSetting<K extends keyof Omit<SyncedSettings, 'updatedAt'>>(key: K, value: NonNullable<SyncedSettings[K]>): void {
  switch (key) {
    case 'haptics':
      write(HAPTICS_KEY, value ? '1' : '0');
      break;
    case 'analytics':
      // Log the opt-out before collection stops, so the change itself is counted once.
      if (!value) track('settings_change', { key, value: String(value) });
      setAnalyticsAllowed(value as boolean);
      break;
    case 'theme':
      bridge.setTheme(value as 'light' | 'dark');
      break;
    case 'solution':
      bridge.setSolution(value as boolean);
      break;
    case 'fingers':
      bridge.setFingers(value as 'draw' | 'pan');
      break;
  }
  const next: SyncedSettings = { ...currentSettings(), [key]: value, updatedAt: Date.now() };
  write(SNAP_KEY, JSON.stringify(next));
  if (key !== 'analytics' || value) track('settings_change', { key, value: String(value) });
  schedulePush(next);
}

/** Applies settings that came from another device. */
function applyRemote(s: SyncedSettings) {
  if (s.haptics !== undefined) write(HAPTICS_KEY, s.haptics ? '1' : '0');
  if (s.analytics !== undefined && s.analytics !== analyticsAllowed()) setAnalyticsAllowed(s.analytics);
  write(SNAP_KEY, JSON.stringify(s));
  bridge.whenBoardReady(() => {
    if (s.theme) bridge.setTheme(s.theme);
    if (s.solution !== undefined) bridge.setSolution(s.solution);
    if (s.fingers) bridge.setFingers(s.fingers);
  });
}

/**
 * Decides which copy wins after sign-in. Returns the settings to write to Firestore, or null
 * when the remote copy is newer and has been applied here.
 */
export function reconcile(remoteRaw: unknown): SyncedSettings | null {
  const remote = clean(remoteRaw);
  const local = snapshot();
  if ((remote.updatedAt ?? 0) > (local.updatedAt ?? 0)) {
    applyRemote(remote);
    return null;
  }
  return { ...currentSettings(), updatedAt: local.updatedAt ?? Date.now() };
}
