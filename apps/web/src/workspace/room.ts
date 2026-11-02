/**
 * Collaborate rooms: 2-4 students share one slate (and its rough boards) through the Firebase
 * Realtime Database. Each person gets a fixed pen colour by the order they join. A room is found
 * only by its code; there is no list of rooms. Whoever made the room can lock it and remove people.
 *
 * Each board element is stored as JSON under rooms/{code}/boards/{board}/els/{id}, with its author.
 * Changes are sent as a diff of the board's elements (they are immutable, so a changed element is
 * a new object), and changes from others are applied without entering this person's undo history.
 * AI answers are requested by whoever asks, on their own account and daily credits.
 */
import { cleanElements, currentBoard, onBoardShown, type Board } from '../board';
import { COLOR_KEYS, type ColorKey, type El, type Pt, type StrokeEl } from '../model';
import { currentGhosts, setGhosts, setSender, type Ghost } from './livebus';
import { currentView, slateKey } from './key';
import { connectLive, type Live } from './rtdb';
import { getSlate, newRough, newSlate, openSlate, removeRough, renameSlate, setSlateRoom, slates } from './slates';
import { logActivity } from './activity';

export const ROOM_COLORS = ['blue', 'red', 'green', 'violet'] as const;
export type RoomColor = (typeof ROOM_COLORS)[number];
export const MAX_PEOPLE = ROOM_COLORS.length;
/** A seat away this long may go to someone new (the database rules use the same time). */
const SEAT_AWAY_MS = 600_000;

const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const isCode = (s: string): boolean => /^[A-HJKMNP-Z2-9]{6}$/.test(s);
const EL_ID = /^[A-Za-z0-9_-]{1,40}$/;
const MAX_EL_CHARS = 60_000;

export interface Member {
  uid: string;
  name: string;
  color: RoomColor;
  online: boolean;
  voice: boolean;
  muted: boolean;
  /** Which board they have open: "main" or a rough board id. */
  board: string;
}

export interface RoomSub {
  id: string;
  title: string;
  by: string;
}

export interface RoomState {
  status: 'idle' | 'joining' | 'live';
  code: string | null;
  uid: string | null;
  host: string | null;
  locked: boolean;
  title: string;
  members: Member[];
  subs: RoomSub[];
  /** The slate that holds this room's board. */
  slateId: string | null;
  error: string | null;
  notice: string | null;
}

const IDLE: RoomState = {
  status: 'idle', code: null, uid: null, host: null, locked: false, title: '', members: [], subs: [], slateId: null, error: null, notice: null,
};

let state: RoomState = IDLE;
const listeners = new Set<() => void>();

function set(patch: Partial<RoomState>) {
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn());
}

export const roomState = (): RoomState => state;
export function onRoom(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Clears the room's last notice or error once the user has seen it. */
export function dismissRoomMessage(noticeOnly = false): void {
  if (noticeOnly) {
    if (state.notice) set({ notice: null });
  } else if (state.notice || state.error) set({ notice: null, error: null });
}

export const me = (): Member | undefined => state.members.find((m) => m.uid === state.uid);
export const isHost = (): boolean => !!state.uid && state.host === state.uid;

let live: Live | null = null;
let stops: (() => void)[] = [];
let boardStop: (() => void) | null = null;
let joinedAt = 0;
/** The host's own board a new room starts from; its work is sent up instead of cleared. */
let seedSlate: string | null = null;
/** Rough boards the host's board already had: they stay the host's own and are not shared. */
let privateSubs = new Set<string>();

const roomPath = (p = '') => `rooms/${state.code}${p ? `/${p}` : ''}`;

function randomCode(): string {
  const a = new Uint32Array(6);
  crypto.getRandomValues(a);
  return [...a].map((n) => CODE_CHARS[n % CODE_CHARS.length]).join('');
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

// --- entering and leaving ---------------------------------------------------------------------

/** Starts a room on one of this person's boards: everyone who joins gets a copy of it. */
export async function createRoom(name: string, slateId = currentView().slate): Promise<void> {
  if (state.status !== 'idle') return;
  seedSlate = getSlate(slateId) ? slateId : null;
  set({ ...IDLE, status: 'joining' });
  try {
    const L = await connectLive(name);
    // A clash with an existing room fails the write; try another code.
    for (let i = 0; i < 5; i++) {
      const code = randomCode();
      try {
        await L.m.set(L.m.ref(L.db, `rooms/${code}/meta`), { host: L.uid, at: L.m.serverTimestamp() });
        return await enter(L, code);
      } catch (e) {
        if (i === 4) throw e;
      }
    }
  } catch (e) {
    seedSlate = null;
    set({ ...IDLE, error: `Couldn't make a room. ${message(e)}` });
  }
}

export async function joinRoom(rawCode: string, name: string): Promise<void> {
  const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!isCode(code)) {
    set({ error: 'A room code is 6 letters and numbers.' });
    return;
  }
  // A join already under way finishes first (React may ask twice in development).
  if (state.status === 'joining') return;
  if (state.status === 'live') {
    if (state.code === code) return;
    await leaveRoom();
  }
  set({ ...IDLE, status: 'joining' });
  try {
    await enter(await connectLive(name), code);
  } catch (e) {
    set({ ...IDLE, error: message(e) });
  }
}

async function enter(L: Live, code: string): Promise<void> {
  const { m, db, uid } = L;
  const room = m.ref(db, `rooms/${code}`);
  const name = L.name.replace(/\s+/g, ' ').trim().slice(0, 40) || 'Student';

  // Coming back to a room keeps your colour.
  let color: RoomColor | null = null;
  try {
    const mine = await m.get(m.child(room, `members/${uid}`));
    if (mine.exists()) color = mine.val().color;
  } catch {
    // not a member yet
  }
  if (color) {
    // A seat left empty too long may have gone to someone else; then join again for a free one.
    const slot = await m.get(m.child(room, `slots/${color}`)).catch(() => null);
    if (slot?.val() !== uid) {
      await m.remove(m.child(room, `members/${uid}`)).catch(() => {});
      color = null;
    } else {
      await m.update(m.child(room, `members/${uid}`), { online: true, name });
    }
  }
  if (!color) {
    const meta = await m.get(m.child(room, 'meta'));
    if (!meta.exists()) throw new Error('There is no room with that code.');
    if (meta.val()?.locked) throw new Error('This room is locked.');
    // Take the first free colour; the rules refuse one that is taken.
    for (const c of ROOM_COLORS) {
      try {
        await m.update(room, {
          [`slots/${c}`]: uid,
          [`members/${uid}`]: { name, color: c, at: Date.now(), online: true, voice: false, muted: false, board: 'main' },
        });
        color = c;
        break;
      } catch {
        // taken; try the next colour
      }
    }
    if (!color) throw new Error(`This room is full (${MAX_PEOPLE} people), or you can't join it.`);
    // A seat taken over from someone long gone: their old entry goes. Only one that is really
    // gone (away, and not seen for 10 minutes): never someone who is here, such as the host.
    try {
      const ms = await m.get(m.child(room, 'members'));
      const stale: Record<string, null> = {};
      const longAgo = Date.now() - SEAT_AWAY_MS;
      ms.forEach((c) => {
        const v = c.val();
        if (c.key !== uid && v?.color === color && v.online === false && typeof v.seen === 'number' && v.seen < longAgo) stale[c.key!] = null;
      });
      if (Object.keys(stale).length) await m.update(m.child(room, 'members'), stale);
    } catch {
      // the host can remove it
    }
  }

  live = L;
  joinedAt = Date.now();
  const online = m.child(room, `members/${uid}/online`);
  await m.onDisconnect(online).set(false);
  // When they were last here: a seat away for 10 minutes can go to someone new.
  await m.onDisconnect(m.child(room, `members/${uid}/seen`)).set(m.serverTimestamp());
  await m.onDisconnect(m.child(room, `members/${uid}/voice`)).set(false);
  await m.onDisconnect(m.child(room, `live/${uid}`)).remove();
  // A dropped connection marks the seat away; coming back online must mark it here again and
  // re-arm the disconnect writes, or after 10 minutes the next person to join takes the seat.
  let wasOff = false;
  const connected = m.onValue(m.ref(db, '.info/connected'), (s) => {
    if (s.val() !== true) {
      wasOff = true;
      return;
    }
    if (!wasOff) return;
    wasOff = false;
    void (async () => {
      try {
        await m.onDisconnect(online).set(false);
        await m.onDisconnect(m.child(room, `members/${uid}/seen`)).set(m.serverTimestamp());
        await m.onDisconnect(m.child(room, `members/${uid}/voice`)).set(false);
        await m.onDisconnect(m.child(room, `live/${uid}`)).remove();
        await m.set(online, true);
      } catch {
        // the seat was lost meanwhile; the members listener reports it
      }
    })();
  });

  // The room's own slate: the host's board for a new room, otherwise a copy made on joining.
  const seeded = seedSlate ? getSlate(seedSlate) : undefined;
  const slate = seeded ?? slates().find((s) => s.room === code) ?? newSlate(`Room ${code}`, code);
  privateSubs = new Set(seeded ? seeded.subs.map((b) => b.id) : []);
  setSlateRoom(slate.id, code);
  set({ status: 'live', code, uid, slateId: slate.id, error: null });

  stops.push(
    connected,
    m.onValue(m.child(room, 'meta'), (s) => {
      const v = s.val() ?? {};
      set({ host: typeof v.host === 'string' ? v.host : null, locked: v.locked === true, title: typeof v.title === 'string' ? v.title : '' });
      if (typeof v.title === 'string' && v.title) renameSlate(slate.id, v.title, false);
    }),
    m.onValue(
      m.child(room, 'members'),
      (s) => {
        const list: Member[] = [];
        s.forEach((c) => {
          const v = c.val();
          if (v && ROOM_COLORS.includes(v.color)) {
            list.push({
              uid: c.key!, name: String(v.name ?? 'Student').slice(0, 40), color: v.color,
              online: v.online !== false, voice: v.voice === true, muted: v.muted === true, board: typeof v.board === 'string' ? v.board : 'main',
            });
          }
        });
        list.sort((a, b) => ROOM_COLORS.indexOf(a.color) - ROOM_COLORS.indexOf(b.color));
        set({ members: list });
      },
      // Reading members fails once this person is no longer one: they were removed.
      () => void dropOut('You were removed from the room.'),
    ),
    m.onValue(m.child(room, 'subs'), (s) => {
      const subs: RoomSub[] = [];
      s.forEach((c) => {
        const v = c.val();
        if (v) subs.push({ id: c.key!, title: String(v.title ?? 'Rough work'), by: String(v.by ?? '') });
      });
      set({ subs });
      // The slate's rough boards follow the room's.
      const local = getSlate(slate.id);
      for (const b of subs) newRough(slate.id, b.title, b.id);
      for (const b of local?.subs ?? []) if (!privateSubs.has(b.id) && !subs.some((x) => x.id === b.id)) removeRough(slate.id, b.id);
    }),
    onBoardShown((b) => void attachBoard(b)),
    startLive(L, code),
  );

  // The board on screen is attached at once (onBoardShown); opening the room's slate attaches that one.
  if (currentView().slate !== slate.id) openSlate(slate.id);
}

async function dropOut(reason: string | null) {
  // Leaving or being removed ends the room for this slate: it stays as a copy and is not rejoined.
  if (state.slateId) setSlateRoom(state.slateId, undefined);
  stops.forEach((fn) => fn());
  stops = [];
  boardStop?.();
  boardStop = null;
  stopVoiceHook?.();
  if (joinedAt) logActivity('room', Date.now() - joinedAt);
  joinedAt = 0;
  privateSubs = new Set();
  seedSlate = null;
  live = null;
  set({ ...IDLE, error: reason });
}

/** Leaves the room for good: frees the colour so someone else can join. */
export async function leaveRoom(): Promise<void> {
  if (!live || !state.code) return dropOut(null);
  const L = live;
  const mine = me();
  const path = roomPath();
  // The host hands the room to someone still in it (here now if possible), so it keeps a host.
  const next = isHost() ? (state.members.find((m) => m.uid !== L.uid && m.online) ?? state.members.find((m) => m.uid !== L.uid)) : undefined;
  if (next) await L.m.update(L.m.ref(L.db, `${path}/meta`), { host: next.uid }).catch(() => {});
  await dropOut(null);
  try {
    await L.m.onDisconnect(L.m.ref(L.db, `${path}/members/${L.uid}/online`)).cancel();
    await L.m.onDisconnect(L.m.ref(L.db, `${path}/members/${L.uid}/seen`)).cancel();
    await L.m.update(L.m.ref(L.db, path), {
      [`members/${L.uid}`]: null,
      [`live/${L.uid}`]: null,
      ...(mine ? { [`slots/${mine.color}`]: null } : {}),
    });
  } catch {
    // offline; the host can remove the seat later
  }
}

// --- host controls ----------------------------------------------------------------------------

export async function setLocked(locked: boolean): Promise<void> {
  if (!live || !isHost()) return;
  await live.m.update(live.m.ref(live.db, roomPath('meta')), { locked }).catch((e) => set({ notice: message(e) }));
}

/** Removes someone. With `ban` they can't come back; without it their seat is just freed. */
export async function removeMember(uid: string, ban = true): Promise<void> {
  if (!live || !isHost() || uid === state.uid) return;
  const who = state.members.find((m) => m.uid === uid);
  await live.m
    .update(live.m.ref(live.db, roomPath()), {
      ...(ban ? { [`banned/${uid}`]: true } : {}),
      [`members/${uid}`]: null,
      [`live/${uid}`]: null,
      ...(who ? { [`slots/${who.color}`]: null } : {}),
    })
    .catch((e) => set({ notice: message(e) }));
}

/** The host makes someone else the host. They get the host controls; this person keeps drawing. */
export async function makeHost(uid: string): Promise<void> {
  if (!live || !isHost() || uid === state.uid || !state.members.some((m) => m.uid === uid)) return;
  await live.m.update(live.m.ref(live.db, roomPath('meta')), { host: uid }).catch((e) => set({ notice: message(e) }));
}

/** The host names the room (and every member's copy of the slate follows). */
export async function setRoomTitle(title: string): Promise<void> {
  if (!live || !isHost()) return;
  const t = title.replace(/\s+/g, ' ').trim().slice(0, 60);
  if (t) await live.m.update(live.m.ref(live.db, roomPath('meta')), { title: t }).catch(() => {});
}

// --- rough boards -----------------------------------------------------------------------------

export async function openRoomRough(title: string): Promise<string | null> {
  if (!live || !state.slateId) return null;
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  const id = `s${a[0].toString(36)}${a[1].toString(36)}`.slice(0, 13);
  const t = title.trim().slice(0, 40) || `Rough ${state.subs.length + 1}`;
  try {
    await live.m.set(live.m.ref(live.db, roomPath(`subs/${id}`)), { title: t, by: live.uid, at: Date.now() });
  } catch (e) {
    set({ notice: `Couldn't open a rough board. ${message(e)}` });
    return null;
  }
  newRough(state.slateId, t, id);
  return id;
}

export async function closeRoomRough(id: string): Promise<void> {
  if (!live) return;
  await live.m
    .update(live.m.ref(live.db, roomPath()), { [`subs/${id}`]: null, [`boards/${id}`]: null })
    .catch((e) => set({ notice: `Only whoever opened it, or the host, can close it. ${message(e)}` }));
}

// --- the shared board -------------------------------------------------------------------------

/** "main", a rough board id, or null when this board is not part of the room. */
function boardIdOf(b: Board): string | null {
  if (!state.slateId) return null;
  const base = slateKey(state.slateId);
  if (b.key === base) return 'main';
  const prefix = `${base}.sub.`;
  const sub = b.key.startsWith(prefix) ? b.key.slice(prefix.length) : null;
  return sub && !privateSubs.has(sub) ? sub : null;
}

function parse(d: unknown, by?: string): El | null {
  if (typeof d !== 'string') return null;
  let el: El | undefined;
  try {
    el = cleanElements([JSON.parse(d)], true)[0];
  } catch {
    return null;
  }
  if (!el) return null;
  // Pen ink shows in its writer's room colour, whatever colour was sent. Ink already in another
  // member's colour (a piece of their stroke left by erasing) keeps it.
  if (el.type === 'stroke' && el.kind === 'pen') {
    const colors = new Set<string>(state.members.map((m) => m.color));
    const writer = state.members.find((m) => m.uid === by);
    if (writer && !colors.has(el.color)) el = { ...el, color: writer.color };
  }
  return el;
}

async function attachBoard(board: Board): Promise<void> {
  boardStop?.();
  boardStop = null;
  const L = live;
  const boardId = boardIdOf(board);
  if (!L || !boardId) return;
  const { m, db, uid } = L;
  const code = state.code;
  const elsRef = m.ref(db, `rooms/${code}/boards/${boardId}/els`);
  void m.update(m.ref(db, `rooms/${code}/members/${uid}`), { board: boardId }).catch(() => {});

  /** id -> JSON the server has, so our own writes coming back are ignored. */
  const server = new Map<string, string>();
  const authors = new Map<string, string>();
  /** id -> the element object last synced; a different object means it changed here. */
  const known = new Map<string, El>();
  let stopped = false;

  let snap;
  try {
    // Who is who comes first: pen ink is shown in its writer's colour.
    if (!state.members.length) {
      const ms = await m.get(m.ref(db, `rooms/${code}/members`));
      const list: Member[] = [];
      ms.forEach((c) => {
        const v = c.val();
        if (v && ROOM_COLORS.includes(v.color)) {
          list.push({ uid: c.key!, name: String(v.name ?? 'Student'), color: v.color, online: v.online !== false, voice: v.voice === true, muted: v.muted === true, board: 'main' });
        }
      });
      if (!state.members.length) set({ members: list });
    }
    snap = await m.get(elsRef);
  } catch (e) {
    set({ notice: `Couldn't load the room's board. ${message(e)}` });
    return;
  }
  if (stopped || currentBoard() !== board) return;
  const remote: El[] = [];
  snap.forEach((c) => {
    const v = c.val();
    const el = parse(v?.d, String(v?.by));
    if (el) {
      remote.push(el);
      server.set(el.id, v.d);
      authors.set(el.id, String(v.by));
    }
  });
  // A new room starts from the host's board: what is on it goes up to the room.
  const seeding = !remote.length && seedSlate === state.slateId && boardId === 'main';
  if (seeding) seedSlate = null;
  else {
    // The room's copy wins over anything left on this device from an earlier visit.
    const ids = new Set(remote.map((e) => e.id));
    board.applyRemote(remote, board.elements.filter((e) => !ids.has(e.id)).map((e) => e.id));
    for (const e of board.elements) known.set(e.id, e);
  }

  const onPut = (c: import('firebase/database').DataSnapshot) => {
    const v = c.val();
    if (!v || typeof v.d !== 'string' || !c.key) return;
    authors.set(c.key, String(v.by));
    if (server.get(c.key) === v.d) return;
    const el = parse(v.d, String(v.by));
    if (!el) return;
    server.set(c.key, v.d);
    known.set(el.id, el);
    board.applyRemote([el], []);
  };

  const flush = () => {
    if (stopped) return;
    const now = new Map(board.elements.map((e) => [e.id, e]));
    const mine = me();
    const theirs = new Set(state.members.filter((x) => x.uid !== uid).map((x) => x.color as string));
    const updates: Record<string, unknown> = {};
    const fixes: El[] = [];
    for (const [id, el] of now) {
      if (known.get(id) === el) continue;
      let e = el;
      // Your pen writes in your room colour, so everyone can see who wrote what. (Pieces left by
      // erasing part of someone else's stroke keep that person's colour.)
      if (mine && e.type === 'stroke' && e.kind === 'pen' && e.color !== mine.color && !theirs.has(e.color) && (authors.get(id) ?? uid) === uid) {
        e = { ...e, color: mine.color };
        fixes.push(e);
      }
      known.set(id, e);
      if (!EL_ID.test(id)) continue;
      // An answer's Work log (the model's thinking) stays with whoever asked; it can be long.
      const d = JSON.stringify(e.type === 'ai' ? { ...e, work: undefined } : e);
      if (server.get(id) === d) continue;
      if (d.length > MAX_EL_CHARS) {
        set({ notice: 'That item is too large to share with the room.' });
        continue;
      }
      updates[id] = { d, by: authors.get(id) ?? uid, t: m.serverTimestamp() };
      server.set(id, d);
      if (!authors.has(id)) authors.set(id, uid);
    }
    for (const id of [...known.keys()]) {
      if (now.has(id)) continue;
      known.delete(id);
      if (server.delete(id)) updates[id] = null;
      authors.delete(id);
    }
    if (fixes.length) board.applyRemote(fixes, []);
    if (Object.keys(updates).length) {
      m.update(elsRef, updates).catch((e) => set({ notice: `A change didn't reach the room. ${message(e)}` }));
    }
  };

  let timer = 0;
  const schedule = () => {
    if (!timer) timer = window.setTimeout(() => {
      timer = 0;
      flush();
    }, 40);
  };

  const offs = [
    m.onChildAdded(elsRef, onPut),
    m.onChildChanged(elsRef, onPut),
    m.onChildRemoved(elsRef, (c) => {
      if (!c.key) return;
      server.delete(c.key);
      authors.delete(c.key);
      if (known.delete(c.key)) board.applyRemote([], [c.key]);
    }),
    board.subscribe(schedule),
  ];
  if (seeding) schedule();
  boardStop = () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = 0;
      flush();
    }
    offs.forEach((off) => off());
  };
}

// --- live: strokes being drawn and pointers -----------------------------------------------------

/** How often the live stroke and pointer are sent, like a game's network tick. */
const TICK_MS = 30;
/** A live stroke stops streaming past this many chunks; it still arrives whole when finished. */
const MAX_CHUNKS = 3000;
/** A finished live stroke whose committed copy never arrives (erased at once) is dropped after this. */
const ENDED_MS = 2500;
const POINTER_IDLE_MS = 4000;

const r1 = (v: number) => Math.round(v * 10) / 10;
const packPoints = (pts: readonly Pt[]) => pts.map(([x, y, p]) => `${r1(x)},${r1(y)},${Math.round(p * 100) / 100}`).join(' ');
function unpackPoints(chunk: unknown, into: Pt[]) {
  if (typeof chunk !== 'string') return;
  for (const part of chunk.split(' ')) {
    const [x, y, p] = part.split(',').map(Number);
    if (Number.isFinite(x) && Number.isFinite(y)) into.push([x, y, Number.isFinite(p) ? p : 0.5]);
  }
}

/** Streams this person's live stroke and pointer, and turns everyone else's into ghosts. */
function startLive(L: Live, code: string): () => void {
  const { m, db, uid } = L;
  const mineRef = m.ref(db, `rooms/${code}/live/${uid}`);
  const board = () => {
    const b = currentBoard();
    return b ? boardIdOf(b) : null;
  };

  // --- sending ---
  let stroke: StrokeEl | null = null;
  let strokeId: string | null = null;
  let sent = 0;
  let seq = 0;
  let ended = false;
  let pointer: [number, number] | null = null;
  let timer = 0;
  let lastTick = 0;

  const tick = () => {
    timer = 0;
    lastTick = performance.now();
    const b = board();
    if (!b || state.status !== 'live') return;
    const up: Record<string, unknown> = {};
    if (pointer) {
      up.x = Math.round(pointer[0]);
      up.y = Math.round(pointer[1]);
      up.b = b;
      up.t = Date.now();
      pointer = null;
    }
    if (stroke && strokeId === stroke.id && seq < MAX_CHUNKS && stroke.points.length > sent) {
      up[`p/${seq++}`] = packPoints(stroke.points.slice(sent));
      sent = stroke.points.length;
    }
    if (ended) {
      up.e = true;
      ended = false;
      stroke = null;
    }
    if (Object.keys(up).length) void m.update(mineRef, up).catch(() => {});
  };
  const schedule = () => {
    if (!timer) timer = window.setTimeout(tick, Math.max(0, TICK_MS - (performance.now() - lastTick)));
  };

  setSender({
    stroke: (s) => {
      if (!s) {
        if (strokeId) {
          ended = true;
          schedule();
        }
        return;
      }
      if (s.id !== strokeId) {
        const b = board();
        if (!b) return;
        // A new stroke replaces the last one whole; its first points go with it.
        strokeId = s.id;
        stroke = s;
        sent = s.points.length;
        seq = 1;
        ended = false;
        const mine = me();
        const color = s.kind === 'pen' && mine ? mine.color : s.color;
        void m
          .set(mineRef, {
            b, x: Math.round(s.points[0][0]), y: Math.round(s.points[0][1]), t: Date.now(),
            sid: s.id, k: s.kind, c: color, w: s.size, m: s.simulate, p: { 0: packPoints(s.points) },
          })
          .catch(() => {});
        return;
      }
      stroke = s;
      schedule();
    },
    pointer: (x, y) => {
      pointer = [x, y];
      schedule();
    },
  });

  // --- receiving ---
  const cache = new Map<string, { sid: string; chunks: number; points: Pt[]; endedAt: number | null }>();
  const seen = new Map<string, { x: number; y: number; at: number }>();
  const off = m.onValue(m.ref(db, `rooms/${code}/live`), (snap) => {
    const here = board();
    const list: Ghost[] = [];
    const now = performance.now();
    snap.forEach((c) => {
      const id = c.key!;
      if (id === uid) return;
      const v = c.val();
      const who = state.members.find((x) => x.uid === id);
      if (!v || !who || !who.online || v.b !== here) return;
      let at: [number, number] | null = null;
      if (Number.isFinite(v.x) && Number.isFinite(v.y)) {
        const last = seen.get(id);
        if (!last || last.x !== v.x || last.y !== v.y) seen.set(id, { x: v.x, y: v.y, at: now });
        at = [v.x, v.y];
      }
      let ghost: StrokeEl | null = null;
      if (typeof v.sid === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(v.sid) && v.p && typeof v.p === 'object') {
        let entry = cache.get(id);
        if (!entry || entry.sid !== v.sid) {
          entry = { sid: v.sid, chunks: 0, points: [], endedAt: null };
          cache.set(id, entry);
        }
        const chunks = v.p as Record<string, unknown>;
        // Chunks arrive in order; parse only the new ones.
        while (entry.chunks in chunks) unpackPoints(chunks[entry.chunks++], entry.points);
        if (v.e === true && entry.endedAt === null) entry.endedAt = now;
        if (entry.points.length && (entry.endedAt === null || now - entry.endedAt < ENDED_MS)) {
          const kind = v.k === 'highlight' ? 'highlight' : 'pen';
          const color: ColorKey = kind === 'pen' ? who.color : COLOR_KEYS.includes(v.c) ? v.c : 'yellow';
          ghost = {
            id: v.sid, type: 'stroke', kind, color, points: entry.points,
            size: Math.min(60, Math.max(1, Number(v.w) || 5)), simulate: v.m !== false,
          };
        }
      }
      list.push({ uid: id, name: who.name, color: who.color, at, stroke: ghost, seen: seen.get(id)?.at ?? 0 });
    });
    setGhosts(list);
  });

  // Labels fade on their own; a slow tick keeps the fade moving between updates.
  const fade = window.setInterval(() => {
    const now = performance.now();
    const ghosts = [...seen.values()].some((p) => now - p.at < POINTER_IDLE_MS + 200);
    if (ghosts) setGhosts([...currentGhosts()]);
  }, 500);

  return () => {
    clearTimeout(timer);
    clearInterval(fade);
    off();
    setSender(null);
  };
}

// --- voice hook -------------------------------------------------------------------------------

let stopVoiceHook: (() => void) | null = null;

/** The live connection, for voice. Voice registers how to stop when the room is left. */
export function roomLive(onLeave: () => void): Live | null {
  stopVoiceHook = onLeave;
  return live;
}

export async function setMyVoice(patch: { voice?: boolean; muted?: boolean }): Promise<void> {
  if (!live || !state.code) return;
  await live.m.update(live.m.ref(live.db, roomPath(`members/${live.uid}`)), patch).catch(() => {});
}
