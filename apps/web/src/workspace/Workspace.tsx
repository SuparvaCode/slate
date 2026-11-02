/**
 * The workspace around the board: a slate bar at the top (title, rough board, room and voice), a
 * slates sidebar like a chat app's, and sheets for the Collaborate room, the mistake notebook and
 * the weekly report. It changes the board only through the view (key.ts) and the room sync (room.ts).
 */
import { useEffect, useMemo, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { currentBoard, onBoardShown } from '../board';
import { Icon, type IconName } from '../icons';
import { loadMemory } from '../memory';
import { Tex } from '../Tex';
import { lastDays } from './activity';
import { askPractice, type Practice } from './assist';
import { boardKey, currentView, onView } from './key';
import { addMistake, mistakes, notebookVersion, onNotebook, recordTry, removeMistake, updateMistake, type Mistake } from './notebook';
import {
  MAX_PEOPLE, closeRoomRough, createRoom, dismissRoomMessage, isHost, joinRoom, leaveRoom, makeHost, onRoom, openRoomRough, removeMember,
  roomState, setLocked, type Member, type RoomColor,
} from './room';
import {
  MAX_SUBS, activeSlate, getSlate, newRough, newSlate, onSlates, openSlate, removeRough, removeSlate, renameSlate, slates, slatesVersion,
  touchSlate, type SlateInfo,
} from './slates';
import { hasRelay, onVoice, setMuted, startVoice, stopVoice, voiceState } from './voice';
import './autoTitle';
import './workspace.css';
import { useBack } from '../back';
import { shareText } from '../native/share';

type SheetName = 'room' | 'notebook' | 'report';

const DOT: Record<RoomColor, string> = { blue: '#0a84ff', red: '#ff453a', green: '#30d158', violet: '#bf5af2' };
const COLOR_NAME: Record<RoomColor, string> = { blue: 'Blue', red: 'Red', green: 'Green', violet: 'Purple' };

const useSlates = () => useSyncExternalStore(onSlates, slatesVersion);
const useView = () => useSyncExternalStore(onView, boardKey);
const useRoom = () => useSyncExternalStore(onRoom, roomState);
const useVoice = () => useSyncExternalStore(onVoice, voiceState);
const useNotebook = () => useSyncExternalStore(onNotebook, notebookVersion);

const narrow = () => typeof matchMedia === 'function' && matchMedia('(max-width: 900px)').matches;

// --- small pieces -----------------------------------------------------------------------------

function IconBtn({
  icon, label, onClick, on, badge, tone, children, disabled,
}: {
  icon: IconName;
  label: string;
  onClick: () => void;
  on?: boolean;
  badge?: number;
  tone?: 'live' | 'danger';
  children?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`ws-ib${on ? ' on' : ''}${tone ? ` ${tone}` : ''}${children ? ' wide' : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      <Icon name={icon} size={19} />
      {children && <span className="ws-ib-label">{children}</span>}
      {badge !== undefined && <i className="ws-ib-badge">{badge}</i>}
    </button>
  );
}

function Face({ m, speaking, size = 30 }: { m: Pick<Member, 'name' | 'color' | 'online'>; speaking?: boolean; size?: number }) {
  const style = { background: DOT[m.color], width: size, height: size, fontSize: Math.round(size * 0.42), '--c': DOT[m.color] } as CSSProperties;
  return (
    <span className={`ws-face${speaking ? ' speaking' : ''}${m.online ? '' : ' away'}`} style={style} aria-hidden>
      {(m.name.trim()[0] ?? '?').toUpperCase()}
    </span>
  );
}

// In-app confirmation, in place of the browser's confirm().
interface Ask {
  title: string;
  body?: string;
  action: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
}
let asking: Ask | null = null;
const askListeners = new Set<() => void>();
const subscribeAsk = (fn: () => void) => {
  askListeners.add(fn);
  return () => {
    askListeners.delete(fn);
  };
};
function confirmDialog(o: Omit<Ask, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    asking?.resolve(false);
    asking = { ...o, resolve };
    askListeners.forEach((f) => f());
  });
}
function answerDialog(ok: boolean) {
  const cur = asking;
  asking = null;
  askListeners.forEach((f) => f());
  cur?.resolve(ok);
}

function ConfirmDialog() {
  const a = useSyncExternalStore(subscribeAsk, () => asking);
  useBack(!!a, () => answerDialog(false));
  useEffect(() => {
    if (!a) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      answerDialog(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [a]);
  if (!a) return null;
  return (
    <div className="ws-modal" role="presentation" onClick={() => answerDialog(false)}>
      <div className="ws-dialog" role="alertdialog" aria-modal="true" aria-labelledby="ws-dlg-t" onClick={(e) => e.stopPropagation()}>
        <h3 id="ws-dlg-t">{a.title}</h3>
        {a.body && <p>{a.body}</p>}
        <div className="ws-dialog-actions">
          <button type="button" className="ws-btn" onClick={() => answerDialog(false)}>
            Cancel
          </button>
          <button type="button" className={`ws-btn ${a.danger ? 'danger' : 'primary'}`} autoFocus onClick={() => answerDialog(true)}>
            {a.action}
          </button>
        </div>
      </div>
    </div>
  );
}

function Sheet({ title, side, onClose, children }: { title: string; side: 'left' | 'right'; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="ws-scrim sheet" onClick={onClose} aria-hidden />
      <section className={`ws-sheet ${side}`} role="dialog" aria-label={title}>
        <span className="ws-grip" aria-hidden />
        <header className="ws-sheet-head">
          <h2>{title}</h2>
          <button type="button" className="ws-x" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="ws-sheet-body">{children}</div>
      </section>
    </>
  );
}

// --- the slate bar ----------------------------------------------------------------------------

function TopBar({ sidebar, onSidebar, roomOpen, onRoom: onRoomBtn }: { sidebar: boolean; onSidebar: () => void; roomOpen: boolean; onRoom: () => void }) {
  useSlates();
  useView();
  const room = useRoom();
  const voice = useVoice();
  const view = currentView();
  const slate = activeSlate();
  const rough = view.sub ? (slate.subs.find((b) => b.id === view.sub) ?? null) : null;
  // The room belongs to one slate: on any other board the bar shows no room at all.
  const live = room.status === 'live' && room.slateId === slate.id;
  const online = room.members.filter((m) => m.online);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const commit = () => {
    if (draft.trim()) renameSlate(slate.id, draft);
    setEditing(false);
  };

  return (
    <>
      <div className={`ws-bar${sidebar ? ' beside-side' : ''}`} role="toolbar" aria-label="Slate">
        <IconBtn icon="sidebar" label={sidebar ? 'Hide slates' : 'Slates'} on={sidebar} onClick={onSidebar} />
        <div className="ws-bar-title">
          {editing ? (
            <input
              className="ws-title-input"
              autoFocus
              value={draft}
              maxLength={60}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit();
                if (e.key === 'Escape') setEditing(false);
              }}
              aria-label="Slate title"
            />
          ) : rough ? (
            <>
              <button type="button" className="ws-title-btn" onClick={() => openSlate(slate.id)} title="Back to the main board">
                <Icon name="goBack" size={15} />
                <span className="ws-title-text">{slate.title}</span>
              </button>
              <span className="ws-crumb">
                <Icon name="layers" size={14} />
                <span>{rough.title}</span>
              </span>
            </>
          ) : (
            <button
              type="button"
              className="ws-title-btn"
              title="Rename this slate"
              onClick={() => {
                setDraft(slate.title);
                setEditing(true);
              }}
            >
              <span className="ws-title-text">{slate.title}</span>
            </button>
          )}
        </div>
        {live && (
          <div className="ws-faces" aria-label={`${online.length} in the room`}>
            {online.slice(0, MAX_PEOPLE).map((m) => (
              <Face key={m.uid} m={m} speaking={!!voice.speaking[m.uid]} size={26} />
            ))}
          </div>
        )}
        {live &&
          (voice.on ? (
            <IconBtn icon={voice.muted ? 'micOff' : 'mic'} label={voice.muted ? 'Unmute' : 'Mute'} tone={voice.muted ? 'danger' : 'live'} onClick={() => setMuted(!voice.muted)} />
          ) : (
            <IconBtn icon="headset" label={voice.connecting ? 'Starting voice…' : 'Join voice'} disabled={voice.connecting} onClick={() => void startVoice()} />
          ))}
        <IconBtn icon="users" label={live ? `Room ${room.code}` : 'Collaborate'} on={roomOpen} badge={live ? online.length : undefined} onClick={onRoomBtn}>
          {live ? null : 'Collaborate'}
        </IconBtn>
      </div>
      {rough && (
        <button type="button" className="ws-rough-pill" onClick={() => openSlate(slate.id)}>
          <Icon name="goBack" size={15} />
          <span>
            <b>{rough.title}</b> · back to slate
          </span>
        </button>
      )}
    </>
  );
}

// --- slates sidebar ---------------------------------------------------------------------------

function groupOf(t: number): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = today.getTime();
  const day = 86_400_000;
  if (t >= d) return 'Today';
  if (t >= d - day) return 'Yesterday';
  if (t >= d - 7 * day) return 'Previous 7 days';
  if (t >= d - 30 * day) return 'Previous 30 days';
  return 'Older';
}

function Sidebar({ onClose, onSheet }: { onClose: () => void; onSheet: (s: SheetName) => void }) {
  useSlates();
  useView();
  const room = useRoom();
  const view = currentView();
  const active = activeSlate();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const inRoom = room.status === 'live' && room.slateId === active.id;

  const go = (id: string, sub: string | null = null) => {
    openSlate(id, sub);
    if (narrow()) onClose();
  };
  const commitRename = () => {
    if (editing && draft.trim()) renameSlate(editing, draft);
    setEditing(null);
  };
  const addRough = async () => {
    const id = inRoom ? await openRoomRough('') : (newRough(active.id)?.id ?? null);
    if (id) go(active.id, id);
  };
  const closeRough = async (id: string, title: string) => {
    const ok = await confirmDialog({
      title: `Close “${title}”?`,
      body: inRoom ? 'Its work is deleted for everyone in the room.' : 'Its work is deleted.',
      action: 'Close rough board',
      danger: true,
    });
    if (!ok) return;
    if (inRoom) void closeRoomRough(id);
    else removeRough(active.id, id);
  };
  const deleteSlate = async (s: SlateInfo) => {
    const roomSlate = room.status === 'live' && room.slateId === s.id;
    const ok = await confirmDialog({
      title: `Delete “${s.title}”?`,
      body: roomSlate
        ? 'You will leave the room, and your copy of its board is deleted. Others in the room keep theirs.'
        : 'The slate and its rough boards are deleted from your account. This can’t be undone.',
      action: roomSlate ? 'Leave and delete' : 'Delete',
      danger: true,
    });
    if (!ok) return;
    if (roomSlate) await leaveRoom();
    removeSlate(s.id);
  };

  const needle = q.trim().toLowerCase();
  const list = slates().filter((s) => !needle || s.title.toLowerCase().includes(needle));
  const groups: { name: string; items: SlateInfo[] }[] = [];
  for (const s of list) {
    const name = groupOf(s.updatedAt);
    const g = groups.at(-1);
    if (g?.name === name) g.items.push(s);
    else groups.push({ name, items: [s] });
  }

  return (
    <>
      <div className="ws-scrim side" onClick={onClose} aria-hidden />
      <aside className="ws-side" aria-label="Slates">
        <header className="ws-side-head">
          <h2>Slates</h2>
          <button type="button" className="ws-x" onClick={onClose} aria-label="Close">
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="ws-side-actions">
          <button
            type="button"
            className="ws-btn primary block"
            onClick={() => {
              newSlate();
              if (narrow()) onClose();
            }}
          >
            <Icon name="plus" size={16} />
            New slate
          </button>
          <label className="ws-search">
            <Icon name="search" size={16} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search slates" aria-label="Search slates" />
          </label>
        </div>

        <div className="ws-side-scroll">
          <section className="ws-group current">
            <h3>On this slate</h3>
            <ul className="ws-nav">
              <li className={!view.sub ? 'on' : undefined}>
                <button type="button" className={`ws-nav-item${!view.sub ? ' on' : ''}`} onClick={() => go(active.id)}>
                  <Icon name="edit" size={16} />
                  <span className="ws-nav-text">Main board</span>
                </button>
              </li>
              {active.subs.map((b) => (
                <li key={b.id} className={view.sub === b.id ? 'on' : undefined}>
                  <button type="button" className={`ws-nav-item${view.sub === b.id ? ' on' : ''}`} onClick={() => go(active.id, b.id)}>
                    <Icon name="layers" size={16} />
                    <span className="ws-nav-text">{b.title}</span>
                  </button>
                  <button type="button" className="ws-row-act" aria-label={`Close ${b.title}`} title="Close rough board" onClick={() => void closeRough(b.id, b.title)}>
                    <Icon name="close" size={14} />
                  </button>
                </li>
              ))}
              <li>
                <button type="button" className="ws-nav-item add" disabled={active.subs.length >= MAX_SUBS} onClick={() => void addRough()}>
                  <Icon name="plus" size={16} />
                  <span className="ws-nav-text">
                    New rough board
                    <small>{inRoom ? 'Shared with the room' : 'Scratch work that never touches the slate'}</small>
                  </span>
                </button>
              </li>
            </ul>
          </section>

          {groups.map((g) => (
            <section key={g.name} className="ws-group">
              <h3>{g.name}</h3>
              <ul className="ws-nav">
                {g.items.map((s) => (
                  <li key={s.id} className={s.id === active.id && editing !== s.id ? 'on' : undefined}>
                    {editing === s.id ? (
                      <input
                        className="ws-input inline"
                        autoFocus
                        value={draft}
                        maxLength={60}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        aria-label="Slate title"
                      />
                    ) : (
                      <>
                        <button type="button" className={`ws-nav-item${s.id === active.id ? ' on' : ''}`} onClick={() => go(s.id)}>
                          <Icon name={s.room ? 'users' : 'pen'} size={16} />
                          <span className="ws-nav-text">
                            {s.title}
                            {(() => {
                              // The room's code is shown unless the title already is it.
                              const room = s.room && !s.title.includes(s.room) ? `Room ${s.room}` : '';
                              const rough = s.subs.length ? `${s.subs.length} rough` : '';
                              const line = [room, rough].filter(Boolean).join(' · ');
                              return line ? <small>{line}</small> : null;
                            })()}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="ws-row-act"
                          aria-label={`Rename ${s.title}`}
                          title="Rename"
                          onClick={() => {
                            setEditing(s.id);
                            setDraft(s.title);
                          }}
                        >
                          <Icon name="edit" size={14} />
                        </button>
                        <button type="button" className="ws-row-act" aria-label={`Delete ${s.title}`} title="Delete" onClick={() => void deleteSlate(s)}>
                          <Icon name="trash" size={14} />
                        </button>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {list.length === 0 && <p className="ws-empty-line">No slates match “{q}”.</p>}
        </div>

        <footer className="ws-side-foot">
          <button type="button" className="ws-nav-item" onClick={() => onSheet('notebook')}>
            <Icon name="book" size={17} />
            <span className="ws-nav-text">Mistake notebook</span>
          </button>
          <button type="button" className="ws-nav-item" onClick={() => onSheet('report')}>
            <Icon name="chart" size={17} />
            <span className="ws-nav-text">Weekly report</span>
          </button>
        </footer>
      </aside>
    </>
  );
}

// --- collaborate ------------------------------------------------------------------------------

function inviteUrl(code: string): string {
  // From the site root: a friend's device doesn't have this slate's /b/<id>, and the router sends
  // an unknown board to the dashboard. At the root, ?room opens the room's board.
  const u = new URL('/', location.origin);
  u.searchParams.set('room', code);
  return u.toString();
}

function callState(m: Member, myUid: string | null, peers: Record<string, RTCPeerConnectionState>, voiceOn: boolean): string | null {
  if (!m.voice) return null;
  if (m.uid === myUid) return m.muted ? 'Muted' : 'In call';
  if (!voiceOn) return m.muted ? 'In call · muted' : 'In call';
  const s = peers[m.uid];
  if (s === 'connected') return m.muted ? 'Connected · muted' : 'Connected';
  if (s === 'failed' || s === 'disconnected') return 'Can’t connect';
  return 'Connecting…';
}

function RoomBody({ name }: { name: string }) {
  // Redraws on a board switch: the sheet says whether this board is the room's.
  useView();
  const room = useRoom();
  const voice = useVoice();
  const [flash, setFlash] = useState<string | null>(null);
  const host = isHost();

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1600);
    return () => clearTimeout(t);
  }, [flash]);

  // In a room, but this board isn't the room's: nothing here is shared.
  const roomSlate = room.status === 'live' && room.slateId ? getSlate(room.slateId) : null;
  if (room.status === 'live' && roomSlate && currentView().slate !== room.slateId) {
    return (
      <div className="ws-stack">
        <p className="ws-alert" role="status">
          This board is not shared. You are still in room <b>{room.code}</b>, on the board “{roomSlate.title}”.
        </p>
        <button type="button" className="ws-btn primary block lg" onClick={() => openSlate(roomSlate.id)}>
          Go to the room’s board
        </button>
        <button
          type="button"
          className="ws-btn block"
          onClick={async () => {
            const ok = await confirmDialog({
              title: 'Leave the room?',
              body: 'Your copy of its board stays in your slates. Then you can start or join a room from this board.',
              action: 'Leave room',
              danger: true,
            });
            if (ok) void leaveRoom();
          }}
        >
          Leave the room
        </button>
      </div>
    );
  }

  if (room.status !== 'live') {
    return (
      <div className="ws-stack">
        <div className="ws-hero">
          <span className="ws-hero-icon">
            <Icon name="users" size={26} />
          </span>
          <p>
            Study or create together on one live board, up to {MAX_PEOPLE} friends. Everyone draws in their own colour and you can talk while
            you work.
          </p>
        </div>
        <button type="button" className="ws-btn primary block lg" disabled={room.status === 'joining'} onClick={() => void createRoom(name)}>
          {room.status === 'joining' ? 'Connecting…' : 'Share this board in a room'}
        </button>
        <p className="ws-fine">You are the host. Everyone who joins gets a copy of this board in their own boards, and you all work on it together.</p>
        {room.error && (
          <p className="ws-alert" role="alert">
            {room.error}
          </p>
        )}
        <p className="ws-fine">To join someone else’s room, go to your boards and choose Join a room.</p>
      </div>
    );
  }

  const share = async () => {
    const url = inviteUrl(room.code!);
    if (await shareText({ title: 'Join my Slate room', text: `Join my Slate room (code ${room.code})`, url })) return;
    try {
      await navigator.clipboard.writeText(url);
      setFlash('Invite link copied');
    } catch {
      setFlash('Copy the code instead');
    }
  };
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.code!);
      setFlash('Code copied');
    } catch {
      // the code is on screen
    }
  };
  const leave = async () => {
    const ok = await confirmDialog({
      title: 'Leave the room?',
      body: 'Your copy of the board stays in your slates. You can come back with the code if a seat is free.',
      action: 'Leave room',
      danger: true,
    });
    if (ok) void leaveRoom();
  };

  return (
    <div className="ws-stack">
      <div className="ws-invite">
        <button type="button" className="ws-code" onClick={() => void copyCode()} title="Copy the code" aria-label={`Room code ${room.code}, copy`}>
          {room.code}
        </button>
        <button type="button" className="ws-btn primary" onClick={() => void share()}>
          <Icon name="share" size={16} />
          Invite
        </button>
      </div>
      {flash && (
        <p className="ws-flash" role="status">
          {flash}
        </p>
      )}

      <section>
        <h3 className="ws-label">
          People · {room.members.length}/{MAX_PEOPLE}
          {room.locked && (
            <span className="ws-tag">
              <Icon name="lock" size={12} /> Locked
            </span>
          )}
        </h3>
        <ul className="ws-people">
          {room.members.map((m) => {
            const call = callState(m, room.uid, voice.peers, voice.on);
            return (
              <li key={m.uid} className={m.online ? '' : 'away'}>
                <Face m={m} speaking={!!voice.speaking[m.uid]} size={34} />
                <span className="ws-person">
                  <b>
                    {m.name}
                    {m.uid === room.uid ? ' (you)' : ''}
                  </b>
                  <small>
                    {COLOR_NAME[m.color]} pen{m.uid === room.host ? ' · host' : ''}
                    {!m.online ? ' · away' : m.board !== 'main' ? ' · on a rough board' : ''}
                  </small>
                </span>
                {call && <span className={`ws-call${call === 'Can’t connect' ? ' bad' : call.startsWith('Connecting') ? ' wait' : ''}`}>{call}</span>}
                {host && m.uid !== room.uid && (
                  <span className="ws-person-acts">
                    {!m.online && (
                      <button type="button" className="ws-btn tiny" title="Free this seat. They can come back if a seat is free." onClick={() => void removeMember(m.uid, false)}>
                        Free seat
                      </button>
                    )}
                    <button
                      type="button"
                      className="ws-btn tiny"
                      title="Give them the host controls"
                      onClick={async () => {
                        const ok = await confirmDialog({ title: `Make ${m.name} the host?`, body: 'They can remove people, lock the room and pass host on. You stay in the room.', action: 'Make host' });
                        if (ok) void makeHost(m.uid);
                      }}
                    >
                      Make host
                    </button>
                    <button
                      type="button"
                      className="ws-row-act"
                      aria-label={`Remove ${m.name}`}
                      title="Remove from room"
                      onClick={async () => {
                        const ok = await confirmDialog({ title: `Remove ${m.name}?`, body: 'They won’t be able to join this room again.', action: 'Remove', danger: true });
                        if (ok) void removeMember(m.uid);
                      }}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
        {host && (
          <label className="ws-switch">
            <input type="checkbox" checked={room.locked} onChange={(e) => void setLocked(e.target.checked)} />
            <i aria-hidden />
            <span>
              Lock room
              <small>No one new can join</small>
            </span>
          </label>
        )}
      </section>

      <section className="ws-voicebox">
        <h3 className="ws-label">Voice</h3>
        {voice.on ? (
          <div className="ws-call-row">
            <button type="button" className={`ws-round${voice.muted ? ' danger' : ''}`} onClick={() => setMuted(!voice.muted)} aria-label={voice.muted ? 'Unmute' : 'Mute'}>
              <Icon name={voice.muted ? 'micOff' : 'mic'} size={20} />
            </button>
            <span className="ws-call-text">
              {voice.muted ? 'You are muted' : voice.speaking[room.uid ?? ''] ? 'Speaking' : 'Mic on'}
              <small>{hasRelay() ? 'Relay ready for strict networks' : 'Direct connection'}</small>
            </span>
            <button type="button" className="ws-round hang" onClick={() => void stopVoice()} aria-label="Leave call">
              <Icon name="hangup" size={20} />
            </button>
          </div>
        ) : (
          <button type="button" className="ws-btn block" disabled={voice.connecting} onClick={() => void startVoice()}>
            <Icon name="headset" size={17} />
            {voice.connecting ? 'Starting…' : 'Join voice'}
          </button>
        )}
        {voice.error && (
          <p className="ws-alert" role="alert">
            {voice.error}
          </p>
        )}
      </section>

      {room.notice && (
        <p className="ws-alert" role="status">
          {room.notice}
        </p>
      )}
      <p className="ws-fine">AI answers use the credits of whoever asks. Rough boards for this room are in the slates sidebar.</p>
      <button type="button" className="ws-btn danger-text block" onClick={() => void leave()}>
        <Icon name="logout" size={16} />
        Leave room
      </button>
    </div>
  );
}

// --- mistake notebook -------------------------------------------------------------------------

interface Answered {
  question: string;
  tex: boolean;
  answer: string;
}

/** Questions the AI answered on the board on screen. */
function answeredOnBoard(): Answered[] {
  const b = currentBoard();
  if (!b) return [];
  const out: Answered[] = [];
  for (const e of b.elements) {
    if (e.type !== 'ai' || e.status !== 'done' || !e.response) continue;
    const r = e.response.result;
    const q = (e.readOverride || r.latex || r.text || '').trim();
    if (q) out.push({ question: q, tex: !!(e.readOverride || r.latex), answer: r.answer_latex || r.steps?.at(-1) || '' });
  }
  return out.reverse().slice(0, 12);
}

function MistakeCard({ m }: { m: Mistake }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [show, setShow] = useState<'none' | 'hint' | 'answer'>('none');
  const [showOwn, setShowOwn] = useState(false);

  const practise = async () => {
    setBusy(true);
    setError(null);
    setShow('none');
    try {
      const p: Practice = await askPractice(m.question, m.answer, m.note);
      updateMistake(m.id, { practice: p });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const p = m.practice;
  return (
    <li className="ws-card">
      <div className="ws-card-head">
        <span className="ws-tag subtle">
          {m.subject} · {m.topic}
        </span>
        <button
          type="button"
          className="ws-row-act"
          aria-label="Remove from notebook"
          title="Remove"
          onClick={async () => {
            if (await confirmDialog({ title: 'Remove this question?', action: 'Remove', danger: true })) removeMistake(m.id);
          }}
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
      <div className="ws-q">{m.tex ? <Tex latex={m.question} /> : m.question}</div>
      {m.note && <p className="ws-fine">What went wrong: {m.note}</p>}
      {m.answer && (
        <button type="button" className="ws-link" onClick={() => setShowOwn((v) => !v)}>
          {showOwn ? 'Hide answer' : 'Show answer'}
        </button>
      )}
      {showOwn && m.answer && (
        <div className="ws-a">
          <Tex latex={m.answer} />
        </div>
      )}

      {p && (
        <div className="ws-practice">
          <span className="ws-label">Try one like it</span>
          <div className="ws-q">{p.question_latex ? <Tex latex={p.question_latex} /> : p.question_text}</div>
          {show === 'hint' && <p className="ws-fine">{p.hint}</p>}
          {show === 'answer' ? (
            <>
              <div className="ws-a">
                <Tex latex={p.answer_latex} />
              </div>
              <div className="ws-row">
                <button
                  type="button"
                  className="ws-btn small primary"
                  onClick={() => {
                    recordTry(m.id, true);
                    void practise();
                  }}
                >
                  <Icon name="check" size={15} />
                  Got it
                </button>
                <button
                  type="button"
                  className="ws-btn small"
                  onClick={() => {
                    recordTry(m.id, false);
                    setShow('none');
                  }}
                >
                  Not yet
                </button>
              </div>
            </>
          ) : (
            <div className="ws-row">
              {p.hint && show === 'none' && (
                <button type="button" className="ws-link" onClick={() => setShow('hint')}>
                  Hint
                </button>
              )}
              <button type="button" className="ws-link" onClick={() => setShow('answer')}>
                Check answer
              </button>
            </div>
          )}
        </div>
      )}
      <div className="ws-row">
        <button type="button" className="ws-btn small" disabled={busy} onClick={() => void practise()}>
          <Icon name="sparkle" size={15} />
          {busy ? 'Writing a question…' : p ? 'Another one' : 'Practise this'}
        </button>
        {m.tries > 0 && (
          <span className="ws-fine">
            {m.right} of {m.tries} right
          </span>
        )}
      </div>
      {error && <p className="ws-alert">{error}</p>}
    </li>
  );
}

function NotebookBody() {
  useNotebook();
  const [adding, setAdding] = useState<'none' | 'board' | 'type'>('none');
  const [q, setQ] = useState('');
  const [a, setA] = useState('');
  const [note, setNote] = useState('');
  const fromBoard = useMemo(() => (adding === 'board' ? answeredOnBoard() : []), [adding]);
  const list = mistakes();

  return (
    <div className="ws-stack">
      <p className="ws-lead">Save questions you got wrong. Slate writes new ones like them, so you can practise until they're easy.</p>
      <div className="ws-seg" role="group" aria-label="Add a question">
        <button type="button" aria-pressed={adding === 'board'} className={adding === 'board' ? 'on' : ''} onClick={() => setAdding(adding === 'board' ? 'none' : 'board')}>
          From this board
        </button>
        <button type="button" aria-pressed={adding === 'type'} className={adding === 'type' ? 'on' : ''} onClick={() => setAdding(adding === 'type' ? 'none' : 'type')}>
          Type a question
        </button>
      </div>

      {adding === 'board' &&
        (fromBoard.length === 0 ? (
          <p className="ws-fine">No answered questions on this board yet. Circle a question with Solve first.</p>
        ) : (
          <ul className="ws-pick">
            {fromBoard.map((x, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    addMistake(x.question, x.tex, x.answer);
                    setAdding('none');
                  }}
                >
                  <span className="ws-q">{x.tex ? <Tex latex={x.question} /> : x.question}</span>
                  <Icon name="plus" size={16} />
                </button>
              </li>
            ))}
          </ul>
        ))}

      {adding === 'type' && (
        <form
          className="ws-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (addMistake(q, false, a, note)) {
              setQ('');
              setA('');
              setNote('');
              setAdding('none');
            }
          }}
        >
          <textarea className="ws-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="The question" maxLength={600} rows={3} required />
          <input className="ws-input" value={a} onChange={(e) => setA(e.target.value)} placeholder="The right answer (optional)" maxLength={400} />
          <input className="ws-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What went wrong (optional)" maxLength={400} />
          <button type="submit" className="ws-btn primary" disabled={!q.trim()}>
            Save to notebook
          </button>
        </form>
      )}

      {list.length === 0 ? (
        <div className="ws-empty">
          <Icon name="book" size={28} />
          <p>Nothing saved yet.</p>
        </div>
      ) : (
        <ul className="ws-cards">
          {list.map((m) => (
            <MistakeCard key={m.id} m={m} />
          ))}
        </ul>
      )}
    </div>
  );
}

// --- weekly report ----------------------------------------------------------------------------

interface Report {
  days: { day: string; minutes: number; room: number }[];
  minutes: number;
  roomMinutes: number;
  activeDays: number;
  solved: number;
  topics: { topic: string; subject: string; n: number }[];
  added: number;
  tries: number;
  right: number;
  weak: { topic: string; n: number }[];
}

function buildReport(): Report {
  const days = lastDays(7).map(({ day, act }) => ({ day, minutes: act.board, room: act.room }));
  const since = Date.now() - 7 * 86_400_000;
  const mem = loadMemory().filter((e) => e.at >= since);
  const topicMap = new Map<string, { topic: string; subject: string; n: number }>();
  for (const e of mem) {
    const t = topicMap.get(e.topic) ?? { topic: e.topic, subject: e.subject, n: 0 };
    t.n += e.times || 1;
    topicMap.set(e.topic, t);
  }
  const list = mistakes();
  const weakMap = new Map<string, number>();
  for (const m of list) {
    // A mistake practised until it is right most of the time no longer counts as weak.
    if (m.tries >= 3 && m.right / m.tries >= 0.75) continue;
    weakMap.set(m.topic, (weakMap.get(m.topic) ?? 0) + 1);
  }
  const practised = list.filter((m) => (m.practisedAt ?? 0) >= since);
  return {
    days,
    minutes: days.reduce((s, d) => s + d.minutes, 0),
    roomMinutes: days.reduce((s, d) => s + d.room, 0),
    activeDays: days.filter((d) => d.minutes > 0 || d.room > 0).length,
    solved: mem.filter((e) => e.kind === 'solve').reduce((s, e) => s + (e.times || 1), 0),
    topics: [...topicMap.values()].sort((a, b) => b.n - a.n).slice(0, 6),
    added: list.filter((m) => m.at >= since).length,
    tries: practised.reduce((s, m) => s + m.tries, 0),
    right: practised.reduce((s, m) => s + m.right, 0),
    weak: [...weakMap.entries()].map(([topic, n]) => ({ topic, n })).sort((a, b) => b.n - a.n).slice(0, 3),
  };
}

const hm = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`);

function reportText(r: Report, name: string): string {
  const lines = [
    `Slate weekly report${name ? ` for ${name}` : ''}`,
    `Study time: ${hm(r.minutes)} on ${r.activeDays} of 7 days${r.roomMinutes ? `, plus ${hm(r.roomMinutes)} studying with friends` : ''}.`,
    `Questions worked through: ${r.solved}.`,
  ];
  if (r.topics.length) lines.push(`Topics: ${r.topics.map((t) => `${t.topic} (${t.n})`).join(', ')}.`);
  lines.push(`Mistakes saved to practise: ${r.added}.`);
  if (r.tries) lines.push(`Practice questions: ${r.right} of ${r.tries} right.`);
  if (r.weak.length) lines.push(`Worth more practice: ${r.weak.map((w) => w.topic).join(', ')}.`);
  return lines.join('\n');
}

function ReportBody({ name, onShared }: { name: string; onShared: (msg: string) => void }) {
  const [r, setR] = useState<Report>(buildReport);
  useEffect(() => onNotebook(() => setR(buildReport())), []);
  const max = Math.max(30, ...r.days.map((d) => d.minutes + d.room));
  const share = async () => {
    const text = reportText(r, name);
    if (await shareText({ title: 'Slate weekly report', text })) return;
    try {
      await navigator.clipboard.writeText(text);
      onShared('Report copied. Paste it into a message to your parents.');
    } catch {
      onShared('Couldn’t copy the report.');
    }
  };

  return (
    <div className="ws-stack">
      <div className="ws-stats">
        <div>
          <b>{hm(r.minutes + r.roomMinutes)}</b>
          <small>Study time</small>
        </div>
        <div>
          <b>{r.activeDays}/7</b>
          <small>Days active</small>
        </div>
        <div>
          <b>{r.solved}</b>
          <small>Questions</small>
        </div>
      </div>
      <div className="ws-chart">
        <div className="ws-bars" role="img" aria-label={`Minutes per day: ${r.days.map((d) => d.minutes + d.room).join(', ')}`}>
          {r.days.map((d) => (
            <div key={d.day} className="ws-day">
              <div className="ws-bar-track">
                <i className="room" style={{ height: `${(d.room / max) * 100}%` }} />
                <i style={{ height: `${(d.minutes / max) * 100}%` }} />
              </div>
              <small>{new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2)}</small>
            </div>
          ))}
        </div>
        <p className="ws-legend">
          <i /> On your own <i className="room" /> With friends
        </p>
      </div>

      <section>
        <h3 className="ws-label">Topics</h3>
        {r.topics.length ? (
          <ul className="ws-chips">
            {r.topics.map((t) => (
              <li key={t.topic}>
                {t.topic} <small>{t.n}</small>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ws-fine">Questions you solve this week show up here by topic.</p>
        )}
      </section>

      <section>
        <h3 className="ws-label">Mistakes and practice</h3>
        <p className="ws-lead">
          {r.added} saved this week{r.tries ? ` · ${r.right} of ${r.tries} practice questions right` : ''}
        </p>
        {r.weak.length > 0 && <p className="ws-fine">Worth more practice: {r.weak.map((w) => w.topic).join(', ')}.</p>}
      </section>

      <button type="button" className="ws-btn primary block" onClick={() => void share()}>
        <Icon name="share" size={16} />
        Share with parents
      </button>
      <p className="ws-fine">Saved in your account. No one else sees it unless you share it.</p>
    </div>
  );
}

// --- the workspace ----------------------------------------------------------------------------

export default function Workspace({ user }: { user: User }) {
  const [sidebar, setSidebar] = useState(false);
  const [sheet, setSheet] = useState<SheetName | null>(null);
  useBack(sidebar, () => setSidebar(false));
  useBack(!!sheet, () => setSheet(null));
  const [toast, setToast] = useState<string | null>(null);
  const room = useRoom();
  const name = (user.displayName || user.email?.split('@')[0] || 'Student').split(' ')[0];

  // Esc closes the topmost layer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || asking) return;
      if (sheet) setSheet(null);
      else if (sidebar) setSidebar(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheet, sidebar]);

  // Working on a slate moves it to the top of the list.
  useEffect(() => {
    let off: (() => void) | null = null;
    const stop = onBoardShown((b) => {
      off?.();
      off = b.subscribe(() => touchSlate());
    });
    return () => {
      stop();
      off?.();
    };
  }, []);

  // A slate that belongs to a room rejoins it when opened (after a reload, or switching back to it).
  const view = useView();
  useEffect(() => {
    const code = activeSlate().room;
    const r = roomState();
    if (code && r.status === 'idle' && !r.error) void joinRoom(code, name);
  }, [view, name]);

  // Room problems show as a toast while the room sheet is closed.
  const message = room.error ?? room.notice;
  useEffect(() => {
    if (message && sheet !== 'room') setToast(message);
  }, [message, sheet]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      setToast(null);
      dismissRoomMessage(true);
    }, 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // Leaving the page leaves voice, so the microphone is never left on.
  useEffect(() => {
    const bye = () => void stopVoice();
    window.addEventListener('pagehide', bye);
    return () => window.removeEventListener('pagehide', bye);
  }, []);

  // A sheet replaces the drawer: the two never stack, at any width.
  const openSheet = (s: SheetName) => {
    setSheet((cur) => (cur === s ? null : s));
    setSidebar(false);
  };

  return (
    <>
      <TopBar
        sidebar={sidebar}
        onSidebar={() => {
          setSidebar((v) => !v);
          setSheet(null);
        }} roomOpen={sheet === 'room'} onRoom={() => openSheet('room')} />
      {sidebar && <Sidebar onClose={() => setSidebar(false)} onSheet={openSheet} />}
      {sheet === 'room' && (
        <Sheet title={room.status === 'live' ? 'Room' : 'Collaborate'} side="left" onClose={() => setSheet(null)}>
          <RoomBody name={name} />
        </Sheet>
      )}
      {sheet === 'notebook' && (
        <Sheet title="Mistake notebook" side="right" onClose={() => setSheet(null)}>
          <NotebookBody />
        </Sheet>
      )}
      {sheet === 'report' && (
        <Sheet title="This week" side="right" onClose={() => setSheet(null)}>
          <ReportBody name={name} onShared={setToast} />
        </Sheet>
      )}
      {toast && (
        <div className="ws-toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
      <ConfirmDialog />
    </>
  );
}
