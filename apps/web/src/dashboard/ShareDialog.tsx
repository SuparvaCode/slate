/**
 * Shares one board as a public, view-only link: anyone with it can open the board, signed in or
 * not. The link shows a copy of the board as it was when shared; "Update" sends the board again
 * and keeps the same link. Links can end after a day, a week or a month, or never.
 */
import { useEffect, useState } from 'react';
import { authFetch } from '../auth/authFetch';
import { loadSaved } from '../board';
import { copyText } from '../copy';
import { slateKey } from '../workspace/key';
import type { SlateInfo } from '../workspace/slates';
import { useBack } from '../back';
import { shareText } from '../native/share';

export interface ShareInfo {
  id: string;
  slate: string;
  title: string;
  updatedAt: number;
  expiresAt: number | null;
}

const EXPIRY = [
  { days: 1, label: '1 day' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 0, label: 'Never' },
] as const;

/** What the server accepts in one share; the room left over is for the other fields. */
const MAX_CHARS = 900_000;

const linkOf = (id: string) => `${location.origin}/s/${id}`;
const when = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await authFetch(path, init);
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : 'Something went wrong. Try again.');
  return body as T;
}

export const fetchShares = () => call<{ shares: ShareInfo[] }>('/api/shares').then((r) => r.shares);

export function ShareDialog({
  slate,
  current,
  onChange,
  onClose,
}: {
  slate: SlateInfo;
  current: ShareInfo | null;
  onChange: (share: ShareInfo | null) => void;
  onClose: () => void;
}) {
  const [days, setDays] = useState<number>(7);
  const [busy, setBusy] = useState<'share' | 'stop' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  useBack(true, onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const share = async () => {
    setError(null);
    const saved = loadSaved(slateKey(slate.id));
    if (!saved.elements.length) {
      setError('This board is empty. Write something on it first.');
      return;
    }
    if (JSON.stringify(saved.elements).length > MAX_CHARS) {
      setError('This board is too big to share. Pictures take the most room: remove some and try again.');
      return;
    }
    setBusy('share');
    try {
      const s = await call<ShareInfo>('/api/shares', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slate: slate.id, title: slate.title.slice(0, 60) || 'Board', theme: saved.theme ?? 'light', elements: saved.elements, days }),
      });
      onChange(s);
      if (await copyText(linkOf(s.id), { quiet: true })) setCopied(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const stop = async () => {
    if (!current) return;
    setError(null);
    setBusy('stop');
    try {
      await call(`/api/shares/${current.id}/stop`, { method: 'POST' });
      onChange(null);
      setCopied(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="db-scrim" onClick={onClose}>
      <div className="db-dialog db-share" role="dialog" aria-modal="true" aria-label="Share board" onClick={(e) => e.stopPropagation()}>
        <h2>Share “{slate.title}”</h2>
        <p className="db-muted">
          Anyone with the link can view this board, even without an account. They can’t change it. The link shows the board as it is
          when you share or update it.
        </p>

        {current && (
          <div className="db-share-link">
            <input readOnly value={linkOf(current.id)} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
            <button
              type="button"
              className="db-btn"
              onClick={async () => setCopied(await copyText(linkOf(current.id), { quiet: true }))}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              className="db-btn"
              onClick={() => void shareText({ title: slate.title, text: `View my Slate board “${slate.title}”`, url: linkOf(current.id) })}
            >
              Share
            </button>
          </div>
        )}
        {current && (
          <p className="db-muted db-small">
            Updated {when(current.updatedAt)} · {current.expiresAt ? `ends ${when(current.expiresAt)}` : 'never ends'}
          </p>
        )}

        <div className="db-field">
          <span>{current ? 'Link ends after (from now)' : 'Link ends after'}</span>
          <div className="db-seg" role="radiogroup" aria-label="Link ends after">
            {EXPIRY.map((x) => (
              <button key={x.days} type="button" role="radio" aria-checked={days === x.days} className={days === x.days ? 'on' : ''} onClick={() => setDays(x.days)}>
                {x.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="db-error" role="alert">
            {error}
          </p>
        )}

        <div className="db-row">
          {current ? (
            <button type="button" className="db-btn danger" disabled={busy !== null} onClick={() => void stop()}>
              {busy === 'stop' ? 'Stopping…' : 'Stop sharing'}
            </button>
          ) : (
            <button type="button" className="db-btn" onClick={onClose}>
              Cancel
            </button>
          )}
          <button type="button" className="db-btn primary" disabled={busy !== null} onClick={() => void share()}>
            {busy === 'share' ? 'Sharing…' : current ? 'Update link' : 'Create link'}
          </button>
        </div>
      </div>
    </div>
  );
}
