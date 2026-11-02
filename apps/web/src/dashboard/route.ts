/**
 * Where the app is: the dashboard at "/", or a board at "/b/<slate id>" (a rough board at
 * "/b/<slate id>/<rough id>"). The address follows the board on screen without adding history
 * entries, so a reload opens the same board and Back leaves the board for the dashboard.
 * Query strings are kept as they are; an invite (?room=CODE) opens the dashboard's join dialog.
 */
import { boardKey, currentView, onView } from '../workspace/key';
import { getSlate, openSlate } from '../workspace/slates';
import { flushBoard } from '../board';

export type Route = { page: 'home'; missing: boolean } | { page: 'board' };

const BOARD = /^\/b\/([a-z0-9]{1,24})(?:\/([a-z0-9]{1,24}))?\/?$/;

const boardPath = () => {
  const v = currentView();
  return v.sub ? `/b/${v.slate}/${v.sub}` : `/b/${v.slate}`;
};
const withQuery = (path: string) => `${path}${location.search}${location.hash}`;

/** Reads the address. A board link for a board this device does not have shows the dashboard. */
function read(): Route {
  const m = BOARD.exec(location.pathname);
  // An invite link (?room=CODE) opens the dashboard, which asks to join the room.
  if (!m || new URLSearchParams(location.search).has('room')) {
    if (m) history.replaceState(history.state, '', withQuery('/'));
    return { page: 'home', missing: false };
  }
  const [, slate, sub] = m;
  const s = getSlate(slate);
  if (!s) {
    history.replaceState(history.state, '', withQuery('/'));
    return { page: 'home', missing: true };
  }
  openSlate(slate, sub && s.subs.some((b) => b.id === sub) ? sub : null);
  if (location.pathname !== boardPath()) history.replaceState(history.state, '', withQuery(boardPath()));
  return { page: 'board' };
}

let route: Route = read();
/** True while the board on screen was opened from the dashboard in this page, with pushState. */
let pushed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export const currentRoute = (): Route => route;

/** Reads the address again once the account's boards have reached this device. */
export function refreshRoute(): void {
  route = read();
  emit();
}
export function onRoute(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Opens a board: one history entry, so Back returns to the dashboard. */
export function goBoard(slate: string, sub: string | null = null): void {
  openSlate(slate, sub);
  const path = boardPath();
  if (route.page === 'board') history.replaceState(history.state, '', withQuery(path));
  else {
    history.pushState({ slate: true }, '', withQuery(path));
    pushed = true;
  }
  route = { page: 'board' };
  emit();
}

export function goHome(): void {
  if (route.page === 'home') return;
  // Leaving unmounts the board, which would cancel its pending autosave.
  flushBoard();
  // Back from a board this page opened from the dashboard. After a reload the entry before it
  // belongs to the old page, so the address is replaced instead.
  if (pushed && history.state?.slate) {
    pushed = false;
    history.back();
  }
  else {
    history.replaceState(null, '', withQuery('/'));
    route = { page: 'home', missing: false };
    emit();
  }
}

window.addEventListener('popstate', () => {
  if (route.page === 'board') flushBoard();
  pushed = false;
  route = read();
  emit();
});

// Switching boards from the board itself (the slate list, rough boards) keeps the address right.
let lastKey = boardKey();
onView(() => {
  if (boardKey() === lastKey) return;
  lastKey = boardKey();
  if (route.page === 'board' && location.pathname !== boardPath()) history.replaceState(history.state, '', withQuery(boardPath()));
});
