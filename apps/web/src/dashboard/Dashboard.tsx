/**
 * The dashboard: every board in the account as a card with a picture of what is on it, and the
 * study streak. Opening a card goes to /b/<id>.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { User } from 'firebase/auth';
import { Wordmark } from '../onboarding/Wordmark';
import { slateKey, subKey } from '../workspace/key';
import { newRough, newSlate, onSlates, removeSlate, renameSlate, slates, slatesVersion, type SlateInfo } from '../workspace/slates';
import { loadProfile, onStudy, profileLabel, streak } from '../notes/study';
import { drawPreview } from './preview';
import { goBoard } from './route';
import { ShareDialog, fetchShares, type ShareInfo } from './ShareDialog';
import { useBack } from '../back';
import { markDirty } from '../sync/dirty';
import { isCode, joinRoom, onRoom, roomState } from '../workspace/room';
import { onStoredTheme, storedTheme } from '../settings/bridge';

const DASH_KEY = 'slate.dash.v1';
type Sort = 'recent' | 'name';

/** Pinned boards and the sort order, kept on this device apart from the slate list. */
function loadDash(): { pins: string[]; sort: Sort } {
  try {
    const d = JSON.parse(localStorage.getItem(DASH_KEY) ?? '{}');
    return {
      pins: Array.isArray(d.pins) ? d.pins.filter((x: unknown) => typeof x === 'string').slice(0, 200) : [],
      sort: d.sort === 'name' ? 'name' : 'recent',
    };
  } catch {
    return { pins: [], sort: 'recent' };
  }
}
function saveDash(d: { pins: string[]; sort: Sort }) {
  try {
    localStorage.setItem(DASH_KEY, JSON.stringify(d));
  } catch {
    // lasts for this visit
  }
}

function ago(t: number): string {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function greeting(name: string): string {
  const h = new Date().getHours();
  return `${h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'}, ${name}`;
}

/** Draws the card's picture once it scrolls into view, so a long list stays quick. */
function Preview({ slate, dark }: { slate: SlateInfo; dark: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [empty, setEmpty] = useState(false);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    let drawn = false;
    const draw = () => {
      drawn = true;
      setEmpty(drawPreview(c, slateKey(slate.id), dark) === 0);
    };
    const io = new IntersectionObserver((entries) => {
      if (!drawn && entries.some((e) => e.isIntersecting)) 'requestIdleCallback' in window ? requestIdleCallback(draw, { timeout: 400 }) : setTimeout(draw, 0);
    });
    io.observe(c);
    return () => io.disconnect();
  }, [slate.id, slate.updatedAt, dark]);
  return (
    <div className="db-thumb">
      <canvas ref={ref} aria-hidden="true" />
      {empty && <span className="db-thumb-empty">Empty board</span>}
    </div>
  );
}

function Card({
  slate,
  dark,
  pinned,
  onPin,
  onDuplicate,
  onRename,
  onDelete,
  shared,
  onShare,
}: {
  slate: SlateInfo;
  dark: boolean;
  pinned: boolean;
  onPin: () => void;
  onDuplicate: () => void;
  onRename: () => void;
  onDelete: () => void;
  /** Has a public link that is still open. */
  shared: boolean;
  onShare: () => void;
}) {
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(false);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);
  return (
    <article className="db-card">
      <button type="button" className="db-card-open" onClick={() => goBoard(slate.id)} aria-label={`Open ${slate.title}`}>
        <Preview slate={slate} dark={dark} />
        <div className="db-card-meta">
          <h3>
            {pinned && (
              <svg className="db-pin" viewBox="0 0 24 24" role="img" aria-label="Pinned">
                <path fill="currentColor" d="M15.6 2.6a1 1 0 0 1 1.4 0l4.4 4.4a1 1 0 0 1 0 1.4l-1.6 1.6a1 1 0 0 1-1.1.2l-1.1-.4-3.4 3.4.5 3.2a1 1 0 0 1-.3.9l-1.1 1.1a1 1 0 0 1-1.4 0L8.4 14.9 4 19.3a1 1 0 0 1-1.4-1.4L7 13.5 3.5 10a1 1 0 0 1 0-1.4l1.1-1.1a1 1 0 0 1 .9-.3l3.2.5 3.4-3.4-.4-1.1a1 1 0 0 1 .2-1.1z" />
              </svg>
            )}
            {slate.title}
            {shared && <span className="db-shared">Shared</span>}
          </h3>
          <p>
            {ago(slate.updatedAt)}
            {slate.subs.length > 0 && ` · ${slate.subs.length} rough board${slate.subs.length > 1 ? 's' : ''}`}
            {slate.room && <span className="db-badge">Room {slate.room}</span>}
          </p>
        </div>
      </button>
      <button
        type="button"
        className="db-card-more"
        aria-label={`More for ${slate.title}`}
        aria-haspopup="menu"
        aria-expanded={menu}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => setMenu((v) => !v)}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {menu && (
        <div className="db-menu" role="menu" onPointerDown={(e) => e.stopPropagation()}>
          <button type="button" role="menuitem" onClick={() => (setMenu(false), goBoard(slate.id))}>
            Open
          </button>
          <button type="button" role="menuitem" onClick={() => (setMenu(false), onPin())}>
            {pinned ? 'Unpin' : 'Pin to top'}
          </button>
          <button type="button" role="menuitem" onClick={() => (setMenu(false), onRename())}>
            Rename
          </button>
          <button type="button" role="menuitem" onClick={() => (setMenu(false), onDuplicate())}>
            Duplicate
          </button>
          <button type="button" role="menuitem" onClick={() => (setMenu(false), onShare())}>
            {shared ? 'Shared link…' : 'Share link…'}
          </button>
          <button type="button" role="menuitem" className="danger" onClick={() => (setMenu(false), onDelete())}>
            Delete
          </button>
        </div>
      )}
    </article>
  );
}

export default function Dashboard({ user, missing }: { user: User; missing: boolean }) {
  useSyncExternalStore(onSlates, slatesVersion);
  const study = useSyncExternalStore(onStudy, () => JSON.stringify([streak(), profileLabel(loadProfile())]));
  const [st, label] = JSON.parse(study) as [{ days: number; today: boolean }, string];
  const [dash, setDash] = useState(loadDash);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<SlateInfo | null>(null);
  const [draft, setDraft] = useState('');
  const [deleting, setDeleting] = useState<SlateInfo | null>(null);
  const [sharing, setSharing] = useState<SlateInfo | null>(null);
  // Joining a room happens here: the room's board is added to this account's boards, then opened.
  const [joining, setJoining] = useState<string | null>(() => {
    const p = new URLSearchParams(location.search);
    const c = p.get('room');
    if (c === null) return null;
    p.delete('room');
    const rest = p.toString();
    history.replaceState(history.state, '', `${location.pathname}${rest ? `?${rest}` : ''}${location.hash}`);
    return c.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  });
  const room = useSyncExternalStore(onRoom, roomState);
  useBack(joining !== null, () => setJoining(null));
  useBack(!!renaming, () => setRenaming(null));
  useBack(!!deleting, () => setDeleting(null));
  const [shares, setShares] = useState<ShareInfo[]>([]);
  useEffect(() => {
    let live = true;
    fetchShares()
      .then((list) => live && setShares(list))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const [notice, setNotice] = useState(missing ? "That board isn't in your account. Here are your boards." : '');
  const theme = useSyncExternalStore(onStoredTheme, storedTheme);
  const dark = theme === 'dark';
  const name = (user.displayName || user.email?.split('@')[0] || 'there').split(' ')[0];

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.title = 'Slate';
  }, [theme]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(t);
  }, [notice]);

  const list = slates();
  const q = query.trim().toLowerCase();
  const pins = new Set(dash.pins);
  // Pinned boards first, then by the chosen order.
  const shown = (q ? list.filter((s) => s.title.toLowerCase().includes(q)) : list).sort(
    (a, b) =>
      Number(pins.has(b.id)) - Number(pins.has(a.id)) ||
      (dash.sort === 'name' ? a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true }) : b.updatedAt - a.updatedAt),
  );
  const create = () => goBoard(newSlate().id);
  const update = (next: { pins: string[]; sort: Sort }) => {
    setDash(next);
    saveDash(next);
  };
  const togglePin = (id: string) =>
    update({ ...dash, pins: pins.has(id) ? dash.pins.filter((p) => p !== id) : [id, ...dash.pins] });

  /** Copies a board and its rough boards to a new board on this device. */
  const duplicate = (src: SlateInfo) => {
    let copy: SlateInfo | null = null;
    try {
      copy = newSlate(`${src.title} copy`.slice(0, 60));
      const raw = localStorage.getItem(slateKey(src.id));
      if (raw) {
        localStorage.setItem(slateKey(copy.id), raw);
        markDirty(slateKey(copy.id));
      }
      for (const b of src.subs) {
        const r = localStorage.getItem(subKey(src.id, b.id));
        const nb = newRough(copy.id, b.title);
        if (nb && r) {
          localStorage.setItem(subKey(copy.id, nb.id), r);
          markDirty(subKey(copy.id, nb.id));
        }
      }
      setNotice(`Made a copy: ${copy.title}`);
    } catch {
      if (copy) removeSlate(copy.id);
      setNotice("Couldn't copy the board: storage is full.");
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (renaming || deleting || (e.target as HTMLElement)?.closest('input')) return;
      if (e.key === 'n' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        create();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const join = async () => {
    if (joining === null || !isCode(joining)) return;
    await joinRoom(joining, name);
    const r = roomState();
    if (r.status === 'live' && r.slateId) {
      setJoining(null);
      goBoard(r.slateId);
    }
  };

  return (
    <div className="db" data-theme={theme}>
      <header className="db-top">
        <Wordmark height={30} className="db-mark" />
      </header>

      <main className="db-main">
        <section className="db-hero">
          <div>
            <h1>{greeting(name)}</h1>
            <p className="db-muted">{label ? `${label} · ` : ''}{list.length} board{list.length === 1 ? '' : 's'}</p>
          </div>
          <div className="db-streak" title="Days in a row with study notes">
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path fill={st.days ? '#ff9500' : 'currentColor'} opacity={st.days ? 1 : 0.35} d="M12 2c1 3.5 5 5.6 5 10.2A5 5 0 0 1 12 17a5 5 0 0 1-5-4.8c0-2 1-3.4 2-4.4.2 1.6 1 2.6 2 3 0-3.6.5-6.3 1-8.8z" />
              <path fill={st.days ? '#ffcc00' : 'currentColor'} opacity={st.days ? 1 : 0.2} d="M12 22a4 4 0 0 1-4-4c0-1.7 1.2-2.8 2-3.6.3 1 .9 1.6 1.6 1.8.3-1.6 1-2.8 1.8-3.8.7 1.4 2.6 3 2.6 5.6a4 4 0 0 1-4 4z" />
            </svg>
            <div>
              <b>{st.days}</b>
              <span>{st.today || !st.days ? 'day streak' : 'study today to keep it'}</span>
            </div>
          </div>
        </section>

        {notice && <p className="db-notice" role="status">{notice}</p>}

        <div className="db-tools">
          <label className="db-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search boards" aria-label="Search boards" />
          </label>
          <select className="db-sort" value={dash.sort} onChange={(e) => update({ ...dash, sort: e.target.value === 'name' ? 'name' : 'recent' })} aria-label="Sort boards">
            <option value="recent">Recent</option>
            <option value="name">Name</option>
          </select>
          <button type="button" className="db-btn" onClick={() => setJoining('')}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="9" cy="8" r="3.5" />
              <path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5M17 8v6M14 11h6" />
            </svg>
            Join a room
          </button>
          <button type="button" className="db-btn primary" onClick={create}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            New board
          </button>
        </div>

        <div className="db-grid">
          {!q && (
            <button type="button" className="db-card db-new" onClick={create}>
              <span className="db-new-plus" aria-hidden="true">+</span>
              <span>New board</span>
              <kbd>N</kbd>
            </button>
          )}
          {shown.map((s) => (
            <Card
              key={s.id}
              slate={s}
              dark={dark}
              pinned={pins.has(s.id)}
              onPin={() => togglePin(s.id)}
              onDuplicate={() => duplicate(s)}
              onRename={() => {
                setDraft(s.title);
                setRenaming(s);
              }}
              onDelete={() => setDeleting(s)}
              shared={shares.some((x) => x.slate === s.id)}
              onShare={() => setSharing(s)}
            />
          ))}
        </div>
        {q && !shown.length && <p className="db-empty">No board called “{query.trim()}”.</p>}
      </main>

      {renaming && (
        <div className="db-scrim" onClick={() => setRenaming(null)}>
          <form
            className="db-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Rename board"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              renameSlate(renaming.id, draft);
              setRenaming(null);
            }}
          >
            <h2>Rename board</h2>
            <input autoFocus value={draft} maxLength={60} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)} aria-label="Board name" />
            <div className="db-row">
              <button type="button" className="db-btn" onClick={() => setRenaming(null)}>
                Cancel
              </button>
              <button type="submit" className="db-btn primary" disabled={!draft.trim()}>
                Save
              </button>
            </div>
          </form>
        </div>
      )}
      {joining !== null && (
        <div className="db-scrim" onClick={() => setJoining(null)}>
          <form
            className="db-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Join a room"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              void join();
            }}
          >
            <h2>Join a room</h2>
            <p className="db-muted">Type the 6-character code from the host. Their board is added to your boards, and you work on it together.</p>
            <input
              autoFocus
              className="db-code"
              value={joining}
              onChange={(e) => setJoining(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
              onKeyDown={(e) => e.key === 'Escape' && setJoining(null)}
              placeholder="ABC234"
              aria-label="Room code"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
            {room.error && <p className="db-error" role="alert">{room.error}</p>}
            <div className="db-row">
              <button type="button" className="db-btn" onClick={() => setJoining(null)}>
                Cancel
              </button>
              <button type="submit" className="db-btn primary" disabled={!isCode(joining) || room.status === 'joining'}>
                {room.status === 'joining' ? 'Joining…' : 'Join'}
              </button>
            </div>
          </form>
        </div>
      )}
      {sharing && (
        <ShareDialog
          slate={sharing}
          current={shares.find((x) => x.slate === sharing.id) ?? null}
          onChange={(next) => setShares((list) => [...list.filter((x) => x.slate !== sharing.id), ...(next ? [next] : [])])}
          onClose={() => setSharing(null)}
        />
      )}
      {deleting && (
        <div className="db-scrim" onClick={() => setDeleting(null)}>
          <div className="db-dialog" role="alertdialog" aria-modal="true" aria-label="Delete board" onClick={(e) => e.stopPropagation()}>
            <h2>Delete “{deleting.title}”?</h2>
            <p className="db-muted">Everything on it{deleting.subs.length ? ' and its rough boards' : ''} is deleted from your account on every device. This can't be undone.</p>
            <div className="db-row">
              <button type="button" className="db-btn" autoFocus onClick={() => setDeleting(null)}>
                Keep it
              </button>
              <button
                type="button"
                className="db-btn danger"
                onClick={() => {
                  removeSlate(deleting.id);
                  if (pins.has(deleting.id)) update({ ...dash, pins: dash.pins.filter((p) => p !== deleting.id) });
                  setDeleting(null);
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
