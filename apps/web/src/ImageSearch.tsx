/** Pictures for the board: a web image search, or one of the student's own. The picker's Images tab. */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from './icons';
import { fetchImageBlob, searchImages } from './notes/api';
import { shrinkImage } from './notes/image';
import type { ImageHit } from './notes/types';
import type { PlacedImage } from './StudyPanel';
import './study.css';

const Spinner = ({ size = 16 }: { size?: number }) => <span className="st-spin" style={{ width: size, height: size }} aria-hidden="true" />;

export function ImageSearch({ onPlace, onUpload, notify }: {
  onPlace: (img: PlacedImage) => void;
  onUpload: () => void;
  notify: (msg: string) => void;
}) {
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [hits, setHits] = useState<ImageHit[] | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  const search = async (e: FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    try {
      setHits(await searchImages(text, c.signal));
      setBroken(new Set());
    } catch (err) {
      if (!c.signal.aborted) notify(err instanceof Error ? err.message : String(err));
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  };

  const add = async (hit: ImageHit) => {
    if (importing) return;
    setImporting(hit.imageUrl);
    try {
      let blob: Blob;
      try {
        blob = await fetchImageBlob(hit.imageUrl);
      } catch {
        // The full picture's site refused; the search engine's copy is smaller but always there.
        blob = await fetchImageBlob(hit.thumbUrl);
      }
      const img = await shrinkImage(blob);
      onPlace({ ...img, title: hit.title, source: hit.sourceUrl });
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(null);
    }
  };

  const shown = (hits ?? []).filter((h) => !broken.has(h.thumbUrl));

  return (
    <section className="st-images">
      <form className="st-search" onSubmit={search}>
        <Icon name="search" size={15} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder="Search pictures: “human heart diagram”"
          aria-label="Search pictures"
          maxLength={160}
          autoFocus
        />
        <button className="sp-btn primary" type="submit" disabled={!q.trim() || loading}>{loading ? <Spinner size={14} /> : 'Search'}</button>
      </form>
      <div className="sp-row tight">
        <button className="sp-btn" onClick={onUpload}><Icon name="plus" size={14} /> Upload your own</button>
        <span className="st-hint inline">or paste / drop a picture on the board</span>
      </div>

      {loading && (
        <div className="st-grid" aria-hidden="true">
          {Array.from({ length: 9 }, (_, i) => <i key={i} className="st-tile skel" style={{ animationDelay: `${i * 60}ms` }} />)}
        </div>
      )}
      {!loading && hits && (
        shown.length ? (
          <div className="st-grid">
            {shown.map((h) => (
              <button
                key={h.imageUrl}
                className={`st-tile${importing === h.imageUrl ? ' busy' : ''}`}
                onClick={() => void add(h)}
                disabled={!!importing}
                title={`${h.title}${h.site ? ` · ${h.site}` : ''}`}
              >
                <img
                  src={h.thumbUrl}
                  alt={h.title}
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  onError={() => setBroken((b) => new Set(b).add(h.thumbUrl))}
                />
                <span className="st-tile-add">{importing === h.imageUrl ? <Spinner size={18} /> : '+ Add'}</span>
                {h.site && <span className="st-tile-site">{h.site}</span>}
              </button>
            ))}
          </div>
        ) : <p className="st-hint">No pictures found. Try other words.</p>
      )}
      {!hits && !loading && (
        <p className="st-hint">Pictures you add are saved with the board and can be moved, resized and drawn over.</p>
      )}
    </section>
  );
}
