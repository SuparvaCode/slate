import type { Camera } from './board';
import { placePaths } from './figures';
import { strokesAt, writtenFor } from './hand';
import { compose } from './notes/compose';
import { freehandPath, strokePath } from './ink';
import { FONT, LINE_HEIGHT, boxOf, canRotate, isTurned, unionBounds, visualBounds } from './model';
import type { AiEl, Bounds, ColorKey, El, ImageEl, NoteEl } from './model';
import { drawSim, lookFor } from './sim';
import { drawDiagramCard } from './diagram/draw';
import { GRID_DOT } from './theme';
import type { Theme } from './theme';

export type Colors = Record<ColorKey, string>;

export interface DrawOpts {
  mono?: string;
  live?: boolean;
  /** For AI answers and diagrams: how much has been written or built, 0 to 1. */
  progress?: number;
  /** Clock for the waiting animation, in ms. */
  now?: number;
  /** Draw typeset answers as handwriting too; used for exports, where DOM cannot be drawn. */
  ink?: boolean;
}

/**
 * While the model is reading, and when it fails: three pen dots that pulse, and a struck-through
 * dash on failure. Drawn as ink so nothing about the answer is DOM text.
 */
function drawAiPending(ctx: CanvasRenderingContext2D, el: AiEl, color: string, now: number) {
  if (el.status === 'done') return; // answered, but with nothing to write
  const r = Math.max(1.4, el.penWidth * 0.52);
  const gap = r * 3.4;
  const y = el.y - el.fontSize * 0.2;
  ctx.save();
  ctx.fillStyle = color;
  if (el.status === 'error') {
    ctx.globalAlpha = 0.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = color;
    ctx.lineWidth = el.penWidth * 0.8;
    ctx.beginPath();
    ctx.moveTo(el.x, y);
    ctx.lineTo(el.x + gap * 2.4, y);
    ctx.stroke();
  } else {
    for (let i = 0; i < 3; i++) {
      // Each dot fades in turn, like a pen tapping while thinking.
      const phase = (now / 1000 - i * 0.16) % 1.1;
      ctx.globalAlpha = 0.25 + 0.6 * Math.max(0, Math.sin(Math.max(0, phase) * Math.PI * 1.8));
      ctx.beginPath();
      ctx.arc(el.x + r + i * gap, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}
export type Corner = 'tl' | 'tr' | 'bl' | 'br';
export const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br'];

export function cornerPoint(b: Bounds, c: Corner): [number, number] {
  return [c[1] === 'l' ? b.x : b.x + b.w, c[0] === 't' ? b.y : b.y + b.h];
}

export function drawElement(
  ctx: CanvasRenderingContext2D,
  el: El,
  colors: Colors,
  opts: DrawOpts = {},
) {
  const color = opts.mono ?? colors[el.color];
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (el.type) {
    case 'stroke':
      if (el.kind === 'highlight') {
        ctx.save();
        ctx.globalAlpha = 0.38;
        ctx.fill(strokePath(el, opts.live));
        ctx.restore();
      } else {
        ctx.fill(strokePath(el, opts.live));
      }
      break;

    case 'rect':
    case 'ellipse':
    case 'diamond': {
      const b = boxOf(el);
      ctx.save();
      turnCtx(ctx, el, b);
      ctx.beginPath();
      if (el.type === 'rect') {
        ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(12, b.w / 4, b.h / 4));
      } else if (el.type === 'ellipse') {
        ctx.ellipse(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, b.h / 2, 0, 0, Math.PI * 2);
      } else {
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        ctx.moveTo(cx, b.y);
        ctx.lineTo(b.x + b.w, cy);
        ctx.lineTo(cx, b.y + b.h);
        ctx.lineTo(b.x, cy);
        ctx.closePath();
      }
      if (el.fill) {
        ctx.save();
        ctx.globalAlpha = 0.16;
        ctx.fill();
        ctx.restore();
      }
      ctx.lineWidth = el.size;
      ctx.stroke();
      ctx.restore();
      break;
    }

    case 'line':
    case 'arrow': {
      ctx.lineWidth = el.size;
      ctx.beginPath();
      ctx.moveTo(el.x1, el.y1);
      ctx.lineTo(el.x2, el.y2);
      ctx.stroke();
      if (el.type === 'arrow') {
        const len = Math.hypot(el.x2 - el.x1, el.y2 - el.y1);
        if (len > 1) {
          const head = Math.min(Math.max(12, el.size * 3.4), len * 0.6);
          const a = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
          ctx.beginPath();
          ctx.moveTo(el.x2 - head * Math.cos(a - 0.5), el.y2 - head * Math.sin(a - 0.5));
          ctx.lineTo(el.x2, el.y2);
          ctx.lineTo(el.x2 - head * Math.cos(a + 0.5), el.y2 - head * Math.sin(a + 0.5));
          ctx.stroke();
        }
      }
      break;
    }

    case 'figure': {
      const b = boxOf(el);
      ctx.save();
      turnCtx(ctx, el, b);
      for (const p of placePaths(el.kind, b.x, b.y, b.w, b.h)) {
        if (p.dot > 0) {
          ctx.beginPath();
          ctx.arc(p.pts[0][0], p.pts[0][1], Math.max(1.5, el.size * p.dot), 0, Math.PI * 2);
          ctx.fill();
          continue;
        }
        ctx.beginPath();
        p.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        if (p.closed) ctx.closePath();
        if (el.fill && p.fill && p.closed) {
          ctx.save();
          ctx.globalAlpha = 0.16;
          ctx.fill();
          ctx.restore();
        }
        ctx.lineWidth = p.thin ? Math.max(1, el.size * 0.45) : el.size;
        ctx.setLineDash(p.dash ? [el.size * 2.4, el.size * 2.4] : []);
        ctx.stroke();
        ctx.setLineDash([]);
        if (p.arrow && p.pts.length >= 2) {
          const tip = p.pts[p.pts.length - 1];
          const from = p.pts[p.pts.length - 2];
          const len = Math.hypot(tip[0] - from[0], tip[1] - from[1]);
          if (len > 1) {
            const head = Math.min(Math.max(12, el.size * 3.4), len * 0.6);
            const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
            ctx.lineWidth = el.size;
            ctx.beginPath();
            ctx.moveTo(tip[0] - head * Math.cos(a - 0.5), tip[1] - head * Math.sin(a - 0.5));
            ctx.lineTo(tip[0], tip[1]);
            ctx.lineTo(tip[0] - head * Math.cos(a + 0.5), tip[1] - head * Math.sin(a + 0.5));
            ctx.stroke();
          }
        }
      }
      ctx.restore();
      break;
    }

    case 'text':
      drawLines(ctx, el.text.split('\n'), el.x, el.y, el.fontSize);
      break;

    case 'sim':
      drawSim(ctx, el, lookFor(colors, color));
      break;

    case 'diagram':
      drawDiagramCard(ctx, el, lookFor(colors, color), { progress: opts.progress });
      break;

    case 'image':
      drawImage(ctx, el, color, opts.now ?? 0);
      break;

    case 'note': {
      const c = noteStrokes(el);
      const parts = strokesAt(c, opts.progress ?? 1);
      ctx.save();
      ctx.translate(el.x, el.y);
      // Margin notes are written in the accent ink, the way a teacher switches pens for an aside.
      for (const { stroke, done } of parts) ctx.fill(freehandPath(stroke, el.penWidth, done));
      ctx.restore();
      break;
    }

    case 'ai': {
      // Real pen strokes, in a handwriting style, so the answer reads as written by hand.
      const written = writtenFor(el);
      if (!written) {
        drawAiPending(ctx, el, color, opts.now ?? 0);
        break;
      }
      if (el.typeset && !opts.ink) break; // drawn as typeset maths by the page
      const progress = opts.progress ?? 1;
      const parts = strokesAt(written, progress);
      ctx.save();
      ctx.translate(el.x, el.y - written.ascent);
      for (const { stroke, done } of parts) {
        ctx.fill(freehandPath(stroke, el.penWidth, done));
      }
      ctx.restore();
      break;
    }
  }
}

/** The strokes of a notes block, written at its size and wrapped to its column. */
export const noteStrokes = (el: NoteEl) =>
  compose(el.block, { fontSize: el.fontSize, penWidth: el.penWidth, wrap: el.wrap, seed: el.seed });

// --- pictures -------------------------------------------------------------------------------------

const images = new Map<string, HTMLImageElement>();
let onImageLoad: (() => void) | null = null;

/** Called when a picture finishes decoding, so the board can repaint with it. */
export function setImageLoadListener(fn: (() => void) | null) {
  onImageLoad = fn;
}

function imageFor(src: string): HTMLImageElement {
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.onload = () => onImageLoad?.();
    img.src = src;
    if (images.size > 120) images.delete(images.keys().next().value!);
    images.set(src, img);
  }
  return img;
}

function drawImage(ctx: CanvasRenderingContext2D, el: ImageEl, color: string, now: number) {
  const b = boxOf(el);
  const img = imageFor(el.src);
  const r = Math.min(10, b.w * 0.04, b.h * 0.04);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(b.x, b.y, b.w, b.h, r);
  if (img.complete && img.naturalWidth > 0) {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.14)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.restore();
    ctx.clip();
    ctx.drawImage(img, b.x, b.y, b.w, b.h);
  } else {
    // Still decoding: a soft shimmering placeholder of the same size.
    const t = (now % 1400) / 1400;
    const g = ctx.createLinearGradient(b.x + b.w * (t * 2 - 1), 0, b.x + b.w * (t * 2), 0);
    g.addColorStop(0, 'rgba(127,127,127,0.10)');
    g.addColorStop(0.5, 'rgba(127,127,127,0.22)');
    g.addColorStop(1, 'rgba(127,127,127,0.10)');
    ctx.fillStyle = g;
    ctx.fill();
  }
  ctx.restore();
  void color;
}

function drawLines(ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, fontSize: number) {
  ctx.font = `${fontSize}px ${FONT}`;
  ctx.textBaseline = 'top';
  const lh = fontSize * LINE_HEIGHT;
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lh + (lh - fontSize) / 2));
}

/** Draws the dot grid in world space. The context must already carry the camera transform. */
export function drawGrid(ctx: CanvasRenderingContext2D, cam: Camera, vw: number, vh: number, theme: Theme) {
  let step = 24;
  while (step * cam.z < 14) step *= 2;
  const x0 = Math.floor(-cam.x / cam.z / step) * step;
  const y0 = Math.floor(-cam.y / cam.z / step) * step;
  const x1 = (vw - cam.x) / cam.z;
  const y1 = (vh - cam.y) / cam.z;
  const dot = 1.6 / cam.z;
  ctx.fillStyle = GRID_DOT[theme];
  for (let x = x0; x <= x1; x += step) {
    for (let y = y0; y <= y1; y += step) ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
  }
}

export function selectionBox(elements: El[]): Bounds | null {
  return unionBounds(elements.map(visualBounds));
}

/** Turns the canvas so an upright shape drawn in box `b` comes out turned and mirrored like `el`. */
function turnCtx(ctx: CanvasRenderingContext2D, el: El, b: Bounds) {
  if (!isTurned(el) || !('fx' in el || 'rot' in el)) return;
  const t = el as { rot?: number; fx?: boolean; fy?: boolean };
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  ctx.translate(cx, cy);
  ctx.rotate(t.rot ?? 0);
  ctx.scale(t.fx ? -1 : 1, t.fy ? -1 : 1);
  ctx.translate(-cx, -cy);
}

export type Handle = Corner | 'tm' | 'bm' | 'ml' | 'mr' | 'rot';

/** Screen px from the top of the selection to the rotate handle. */
const ROT_GAP = 30;

/** Text, answers, simulators, diagrams and turned shapes only scale evenly, so they get no side handles. */
export const scalesEvenly = (sel: El[]) =>
  sel.some((e) => e.type === 'text' || e.type === 'ai' || e.type === 'sim' || e.type === 'diagram' || e.type === 'image' || e.type === 'note' || (isTurned(e) && !!(e as { rot?: number }).rot));

export const rotatable = (sel: El[]) => sel.some(canRotate);

/** Where each handle of the selection sits, in board units. The overlay and the hit test share this. */
export function selectionHandles(sel: El[], z: number): { box: Bounds; list: { h: Handle; x: number; y: number }[] } | null {
  const box = selectionBox(sel);
  if (!box) return null;
  const pad = 6 / z;
  const p = { x: box.x - pad, y: box.y - pad, w: box.w + 2 * pad, h: box.h + 2 * pad };
  const list: { h: Handle; x: number; y: number }[] = CORNERS.map((c) => {
    const [x, y] = cornerPoint(p, c);
    return { h: c, x, y };
  });
  if (!scalesEvenly(sel)) {
    // Side handles only where there is room between the corners, and something to stretch.
    if (p.w * z >= 44 && box.h * z >= 8) list.push({ h: 'tm', x: p.x + p.w / 2, y: p.y }, { h: 'bm', x: p.x + p.w / 2, y: p.y + p.h });
    if (p.h * z >= 44 && box.w * z >= 8) list.push({ h: 'ml', x: p.x, y: p.y + p.h / 2 }, { h: 'mr', x: p.x + p.w, y: p.y + p.h / 2 });
  }
  if (rotatable(sel)) list.push({ h: 'rot', x: p.x + p.w / 2, y: p.y - ROT_GAP / z });
  return { box: p, list };
}

export interface Overlay {
  selected: El[];
  showHandles: boolean;
  accent: string;
  z: number;
  marquee: Bounds | null;
  lasso: [number, number][] | null;
  sourceBox: Bounds | null;
  theme: Theme;
  /** Corner handle radius in screen px; larger for fingers. */
  handleR?: number;
  /** While rotating: the angle so far, shown beside the pointer. */
  angle?: { x: number; y: number; deg: number } | null;
}

export function drawOverlay(ctx: CanvasRenderingContext2D, o: Overlay) {
  const px = 1 / o.z;
  ctx.lineJoin = 'round';

  if (o.sourceBox) {
    ctx.save();
    ctx.strokeStyle = o.accent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1.5 * px;
    ctx.setLineDash([5 * px, 4 * px]);
    const b = o.sourceBox;
    ctx.beginPath();
    ctx.roundRect(b.x - 8, b.y - 8, b.w + 16, b.h + 16, 10);
    ctx.stroke();
    ctx.restore();
  }

  if (o.selected.length > 0) {
    ctx.strokeStyle = o.accent;
    ctx.lineWidth = 1.2 * px;
    ctx.globalAlpha = 0.5;
    if (o.selected.length > 1) {
      for (const el of o.selected) {
        const b = visualBounds(el);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
      }
    }
    ctx.globalAlpha = 1;
    const box = selectionBox(o.selected);
    if (box) {
      const pad = 6 * px;
      ctx.lineWidth = 1.5 * px;
      ctx.beginPath();
      ctx.roundRect(box.x - pad, box.y - pad, box.w + 2 * pad, box.h + 2 * pad, 6 * px);
      ctx.stroke();
      const hs = o.showHandles ? selectionHandles(o.selected, o.z) : null;
      if (hs) {
        const r = (o.handleR ?? 6.5) * px;
        const face = o.theme === 'dark' ? '#2c2c2e' : '#ffffff';
        ctx.lineWidth = 1.6 * px;
        for (const h of hs.list) {
          ctx.beginPath();
          if (h.h === 'rot') {
            // A stalk up from the top edge, and a round handle with a turn arrow in it.
            ctx.save();
            ctx.globalAlpha = 0.6;
            ctx.moveTo(h.x, hs.box.y);
            ctx.lineTo(h.x, h.y + r * 1.2);
            ctx.stroke();
            ctx.restore();
            ctx.beginPath();
            ctx.arc(h.x, h.y, r * 1.25, 0, Math.PI * 2);
            ctx.fillStyle = o.accent;
            ctx.fill();
            ctx.save();
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.5 * px;
            ctx.beginPath();
            ctx.arc(h.x, h.y, r * 0.62, -Math.PI * 0.15, Math.PI * 1.35);
            ctx.stroke();
            const ex = h.x + Math.cos(-Math.PI * 0.15) * r * 0.62;
            const ey = h.y + Math.sin(-Math.PI * 0.15) * r * 0.62;
            ctx.beginPath();
            ctx.moveTo(ex - r * 0.42, ey - r * 0.05);
            ctx.lineTo(ex, ey);
            ctx.lineTo(ex + r * 0.08, ey - r * 0.45);
            ctx.stroke();
            ctx.restore();
            continue;
          }
          if (h.h === 'tm' || h.h === 'bm' || h.h === 'ml' || h.h === 'mr') {
            // Side handles are short bars along the edge they move.
            const along = h.h === 'tm' || h.h === 'bm';
            const lw = r * 2.6;
            const th = r * 1.15;
            ctx.roundRect(h.x - (along ? lw : th) / 2, h.y - (along ? th : lw) / 2, along ? lw : th, along ? th : lw, th / 2);
          } else {
            ctx.arc(h.x, h.y, r, 0, Math.PI * 2);
          }
          ctx.fillStyle = face;
          ctx.fill();
          ctx.stroke();
        }
      }
    }
  }

  if (o.angle) {
    const px = 1 / o.z;
    const t = `${Math.round(o.angle.deg)}°`;
    ctx.save();
    ctx.font = `600 ${12 * px}px ${FONT}`;
    const w = ctx.measureText(t).width + 14 * px;
    const x = o.angle.x + 16 * px;
    const y = o.angle.y - 30 * px;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.roundRect(x, y, w, 22 * px, 11 * px);
    ctx.fillStyle = o.accent;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, x + 7 * px, y + 11.5 * px);
    ctx.restore();
  }

  if (o.marquee) {
    const m = o.marquee;
    ctx.fillStyle = o.accent;
    ctx.globalAlpha = 0.08;
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = o.accent;
    ctx.lineWidth = 1 * px;
    ctx.strokeRect(m.x, m.y, m.w, m.h);
    ctx.globalAlpha = 1;
  }

  if (o.lasso && o.lasso.length > 1) {
    ctx.beginPath();
    ctx.moveTo(o.lasso[0][0], o.lasso[0][1]);
    for (const [x, y] of o.lasso) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fillStyle = o.accent;
    ctx.globalAlpha = 0.07;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = o.accent;
    ctx.lineWidth = 2 * px;
    ctx.setLineDash([7 * px, 5 * px]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
}

/**
 * Renders elements as black ink on white, cropped to the box, for the vision model. Small
 * writing is scaled up so the model sees enough pixels, and large regions are capped.
 *
 * Strokes are drawn solid and no thicker than 1/40 of the image's longest side. Highlighter
 * writing on the board is wide and see-through: sent as it looks, letters turn into grey blobs
 * whose overlaps show darker, and the model misreads them ("x = 7, y = 8" came back as
 * "x = 3 - t, y = 4 + t"). The same writing as solid, thinner ink is read correctly.
 */
export function renderRegion(elements: El[], box: Bounds, colors: Colors): string {
  const PAD = 32;
  const longest = Math.max(box.w, box.h, 1);
  let scale = 1;
  if (longest < 400) scale = Math.min(4, 400 / longest);
  if (longest * scale > 1500) scale = 1500 / longest;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(box.w * scale + PAD * 2);
  canvas.height = Math.ceil(box.h * scale + PAD * 2);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, PAD - box.x * scale, PAD - box.y * scale);
  const widest = Math.max(canvas.width, canvas.height) / 40 / scale;
  for (const el of elements) {
    const read: El =
      el.type === 'stroke' && (el.kind === 'highlight' || el.size > widest)
        ? { ...el, kind: 'pen', size: Math.min(el.size, widest) }
        : el;
    drawElement(ctx, read, colors, { mono: '#000000' });
  }
  return canvas.toDataURL('image/png');
}

/**
 * Whole board as a PNG blob, 2x where it fits, in the current theme's colors.
 *
 * A board can be far larger than a canvas may be: a phone's WebView refuses one over roughly
 * 16k px a side or a quarter of the app's memory, and `toBlob` then answers with null, which
 * used to look like the export button doing nothing. The picture is therefore drawn at the
 * largest scale that fits, and if the canvas still refuses it, drawn again smaller.
 */
export async function exportBoard(elements: El[], colors: Colors, background: string): Promise<Blob | null> {
  const box = selectionBox(elements);
  if (!box) return null;
  const PAD = 48;
  const wide = box.w + PAD * 2;
  const tall = box.h + PAD * 2;
  const MAX_SIDE = 6000;
  const MAX_PIXELS = 12_000_000;
  let scale = Math.min(
    2,
    MAX_SIDE / Math.max(wide, tall),
    Math.sqrt(MAX_PIXELS / Math.max(wide * tall, 1)),
  );
  if (!Number.isFinite(scale) || scale <= 0) return null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(wide * scale));
    canvas.height = Math.max(1, Math.ceil(tall * scale));
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const s = canvas.width / wide;
      ctx.setTransform(s, 0, 0, s, (PAD - box.x) * s, (PAD - box.y) * s);
      for (const el of elements) drawElement(ctx, el, colors, { ink: true });
      const blob = await pngBlob(canvas);
      if (blob) return blob;
    }
    scale *= 0.6; // this canvas was too much for the device; try a smaller one
  }
  return null;
}

/** `toBlob`, with the data-URL route as a fallback for WebViews where it answers with null. */
function pngBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }
      try {
        const url = canvas.toDataURL('image/png');
        const comma = url.indexOf(',');
        const binary = atob(url.slice(comma + 1));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
        resolve(new Blob([bytes], { type: 'image/png' }));
      } catch {
        resolve(null);
      }
    }, 'image/png');
  });
}
