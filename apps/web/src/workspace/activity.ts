/**
 * Study time for the weekly report, kept in this browser only: minutes in which the board
 * changed, and minutes spent in Collaborate rooms, per local day.
 */
import { onBoardShown } from '../board';

const KEY = 'slate.activity.v1';
const KEEP_DAYS = 60;

export interface DayActivity {
  /** Minutes in which something was written or changed on a board. */
  board: number;
  /** Minutes spent in a Collaborate room. */
  room: number;
}

/** Local calendar day, YYYY-MM-DD. */
export const dayOf = (t = Date.now()): string => new Date(t).toLocaleDateString('en-CA');

function load(): Record<string, DayActivity> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

let data = load();

function add(kind: keyof DayActivity, minutes: number) {
  if (!(minutes > 0)) return;
  const d = dayOf();
  const row = data[d] ?? { board: 0, room: 0 };
  row[kind] = (Number(row[kind]) || 0) + minutes;
  data[d] = row;
  const keys = Object.keys(data).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete data[k];
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // storage full; the count lasts for this visit
  }
}

export function logActivity(kind: 'room', ms: number): void {
  add(kind, Math.round(ms / 60_000));
}

/** The last `n` days, oldest first, including days with nothing done. */
export function lastDays(n: number): { day: string; act: DayActivity }[] {
  data = load();
  const out: { day: string; act: DayActivity }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = dayOf(Date.now() - i * 86_400_000);
    const row = data[day];
    out.push({ day, act: { board: Number(row?.board) || 0, room: Number(row?.room) || 0 } });
  }
  return out;
}

// Each minute in which the board on screen changed counts once.
let lastMinute = 0;
let off: (() => void) | null = null;
onBoardShown((b) => {
  off?.();
  off = b.subscribe(() => {
    const m = Math.floor(Date.now() / 60_000);
    if (m === lastMinute) return;
    lastMinute = m;
    add('board', 1);
  });
});
