/**
 * A shared board, read-only, for anyone with its link (`/s/<id>`): no sign-in. It draws the
 * snapshot the owner shared, with the board's own renderer, and can be moved and zoomed.
 */
import { useEffect, useRef, useState } from 'react';
import { cleanElements } from '../board';
import type { El } from '../model';
import { drawElement, drawGrid, selectionBox, setImageLoadListener } from '../render';
import { PALETTE, THEME_BG } from '../theme';
import { Wordmark } from '../onboarding/Wordmark';
import './share.css';

interface Shared {
  title: string;
  theme: 'light' | 'dark';
  updatedAt: number;
  expiresAt: number | null;
  elements: El[];
}

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ok'; share: Shared };

const when = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export default function ShareView({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });

  useEffect(() => {
    const ctrl = new AbortController();
    void (async () => {
      try {
        const r = await fetch(`/api/share/${encodeURIComponent(id)}`, { signal: ctrl.signal });
        const body = await r.json().catch(() => null);
        if (!r.ok) throw new Error(typeof body?.detail === 'string' ? body.detail : 'This link could not be opened.');
        // `remote`: an answer still loading in the snapshot stays as it is, not "stopped part-way".
        setLoad({ state: 'ok', share: { ...body, elements: cleanElements(body.elements, true) } });
      } catch (e) {
        if (!ctrl.signal.aborted) setLoad({ state: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => ctrl.abort();
  }, [id]);

  useEffect(() => {
    document.title = load.state === 'ok' ? `${load.share.title} · Slate` : 'Slate';
  }, [load]);

  if (load.state !== 'ok') {
    return (
      <div className="sv-empty">
        <Wordmark height={32} />
        <p>{load.state === 'loading' ? 'Opening the board…' : load.message}</p>
        {load.state === 'error' && (
          <a className="sv-btn" href="/">
            Open Slate
          </a>
        )}
      </div>
    );
  }
  return <Viewer share={load.share} id={id} />;
}

function Viewer({ share, id }: { share: Shared; id: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const cam = useRef({ x: 0, y: 0, z: 1 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; z: number; mx: number; my: number; cx: number; cy: number } | null>(null);
  const frame = useRef(0);
  const theme = share.theme;

  const draw = () => {
    frame.current = 0;
    const c = canvasRef.current;
    if (!c) return;
    // A phone at 3x would draw three times the pixels for no visible gain; the board caps it too.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = THEME_BG[theme];
    ctx.fillRect(0, 0, c.width, c.height);
    const k = cam.current;
    ctx.setTransform(dpr * k.z, 0, 0, dpr * k.z, dpr * k.x, dpr * k.y);
    drawGrid(ctx, k, w, h, theme);
    // `ink`: typeset answers are drawn as handwriting, since this page has no typeset layer.
    for (const el of share.elements) drawElement(ctx, el, PALETTE[theme], { ink: true });
  };
  const redraw = () => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  };
  /**
   * Paints at once rather than waiting for the next frame. The frame scheduled while the page is
   * in the background (a phone's WebView, or a newly opened tab) can never arrive, and a stuck
   * `frame.current` would then keep every later redraw from being scheduled at all.
   */
  const drawNow = () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    draw();
  };

  /**
   * The view the board opens at. A whole-board fit is used while the writing stays readable;
   * a tall board (usually a notes column) used to shrink to a hairline strip at 0.1x, so below
   * that size the top of it is shown at reading size instead, and the viewer pans and zooms.
   */
  const fit = () => {
    const c = canvasRef.current;
    if (!c) return;
    const W = c.clientWidth;
    const H = c.clientHeight;
    if (!W || !H) return; // not laid out yet; the size watcher fits once it is
    // The bar floats over the board: start the writing below it rather than under it.
    const top = Math.max(72, (barRef.current?.getBoundingClientRect().bottom ?? 60) + 12);
    const box = selectionBox(share.elements);
    if (!box) {
      cam.current = { x: W / 2, y: H / 2, z: 1 };
      drawNow();
      return;
    }
    const pad = 24;
    const READABLE = 0.6;
    const whole = Math.min((W - pad * 2) / box.w, (H - top - pad) / box.h, 1.5);
    if (whole >= READABLE) {
      cam.current = {
        z: whole,
        x: W / 2 - (box.x + box.w / 2) * whole,
        y: top + (H - top) / 2 - (box.y + box.h / 2) * whole,
      };
    } else {
      const z = Math.min(1.25, Math.max(READABLE, (W - pad * 2) / box.w));
      const x = box.w * z <= W - pad * 2 ? W / 2 - (box.x + box.w / 2) * z : pad - box.x * z;
      cam.current = { z, x, y: top - box.y * z };
    }
    drawNow();
  };

  useEffect(() => {
    fit();
    setImageLoadListener(redraw);
    const onResize = () => redraw();
    // Fit only once the canvas has a size; until then the first paint may be empty.
    let sized = (canvasRef.current?.clientWidth ?? 0) > 0;
    const ro = new ResizeObserver(() => {
      if (!sized && (canvasRef.current?.clientWidth ?? 0) > 0) {
        sized = true;
        fit();
      } else redraw();
    });
    if (canvasRef.current) ro.observe(canvasRef.current);
    window.addEventListener('resize', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    return () => {
      setImageLoadListener(null);
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
      cancelAnimationFrame(frame.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [share]);

  const zoomAt = (mx: number, my: number, z: number) => {
    const k = cam.current;
    const nz = Math.min(8, Math.max(0.05, z));
    cam.current = { z: nz, x: mx - ((mx - k.x) / k.z) * nz, y: my - ((my - k.y) / k.z) * nz };
    redraw();
  };

  const centre = () => {
    const ps = [...pointers.current.values()];
    return { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2, d: Math.hypot(ps[0].x - ps[1].x, ps[0].y - ps[1].y) };
  };

  return (
    <div className={`sv${theme === 'dark' ? ' dark' : ''}`}>
      <canvas
        ref={canvasRef}
        className="sv-board"
        onWheel={(e) => {
          if (e.ctrlKey || e.metaKey) zoomAt(e.clientX, e.clientY, cam.current.z * Math.exp(-e.deltaY * 0.01));
          else {
            cam.current = { ...cam.current, x: cam.current.x - e.deltaX, y: cam.current.y - e.deltaY };
            redraw();
          }
        }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 2) {
            const c = centre();
            pinch.current = { d: c.d, z: cam.current.z, mx: c.x, my: c.y, cx: cam.current.x, cy: cam.current.y };
          }
        }}
        onPointerMove={(e) => {
          const p = pointers.current.get(e.pointerId);
          if (!p) return;
          const dx = e.clientX - p.x;
          const dy = e.clientY - p.y;
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (pointers.current.size === 1) {
            cam.current = { ...cam.current, x: cam.current.x + dx, y: cam.current.y + dy };
            redraw();
          } else if (pinch.current && pointers.current.size === 2) {
            const c = centre();
            const s = pinch.current;
            const z = Math.min(8, Math.max(0.05, s.z * (c.d / (s.d || 1))));
            // The world point under the fingers' first centre follows the fingers.
            const wx = (s.mx - s.cx) / s.z;
            const wy = (s.my - s.cy) / s.z;
            cam.current = { z, x: c.x - wx * z, y: c.y - wy * z };
            redraw();
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          if (pointers.current.size < 2) pinch.current = null;
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          pinch.current = null;
        }}
      />
      <header className="sv-bar" ref={barRef}>
        <a href="/" aria-label="Slate">
          <Wordmark height={22} />
        </a>
        <div className="sv-title">
          <b>{share.title}</b>
          <small>
            Shared {when(share.updatedAt)} · view only — make a copy to edit your own{share.expiresAt ? ` · link ends ${when(share.expiresAt)}` : ''}
          </small>
        </div>
        <div className="sv-actions">
          <button
            type="button"
            className="sv-btn primary"
            onClick={() => {
              // The copy is made by the app after sign-in: the owner's board is never touched.
              try {
                localStorage.setItem('slate.pending-share', id);
              } catch {
                // storage blocked; the app still opens
              }
              location.href = '/';
            }}
          >
            Make a copy
          </button>
          <button type="button" className="sv-btn" onClick={fit}>
            Fit
          </button>
        </div>
      </header>
    </div>
  );
}
