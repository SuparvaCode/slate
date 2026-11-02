/**
 * A small picture of a saved board for its dashboard card: ink as lines, pictures as pictures,
 * everything else as soft blocks where it sits. Drawn from storage, so the board never loads.
 */
import { loadSaved } from '../board';
import { boundsOf, unionBounds, type El } from '../model';
import { PALETTE } from '../theme';

const images = new Map<string, HTMLImageElement>();

function image(src: string, redraw: () => void): HTMLImageElement | null {
  let img = images.get(src);
  if (!img) {
    if (images.size > 60) images.clear();
    img = new Image();
    img.onload = redraw;
    img.src = src;
    images.set(src, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

/** Draws the board saved under `key` into `canvas`; returns how many things are on it. */
export function drawPreview(canvas: HTMLCanvasElement, key: string, dark: boolean): number {
  const { elements } = loadSaved(key);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (!W || !H) return elements.length;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return elements.length;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (!elements.length) return 0;

  const b = unionBounds(elements.map(boundsOf));
  if (!b) return 0;
  const pad = 14;
  // Fit the width, like a page thumbnail: a tall column of notes shows its top, readable,
  // instead of shrinking to a thin strip. Wide or short boards still fit whole.
  const sw = (W - pad * 2) / Math.max(b.w, 1);
  const sh = (H - pad * 2) / Math.max(b.h, 1);
  const s = Math.min(1.2, b.h * sw > (H - pad * 2) * 2.5 ? sw : Math.min(sw, sh));
  const ox = (W - b.w * s) / 2 - b.x * s;
  const oy = b.h * s > H - pad * 2 ? pad - b.y * s : (H - b.h * s) / 2 - b.y * s;
  const colors = PALETTE[dark ? 'dark' : 'light'];
  const redraw = () => drawPreview(canvas, key, dark);

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const el of elements as El[]) {
    const color = colors[el.color] ?? colors.ink;
    if (el.type === 'stroke') {
      const p = el.points;
      if (!p.length) continue;
      ctx.globalAlpha = el.kind === 'highlight' ? 0.3 : 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(0.8, el.size * s * (el.kind === 'highlight' ? 2.6 : 0.7));
      ctx.beginPath();
      ctx.moveTo(p[0][0] * s + ox, p[0][1] * s + oy);
      // Every other point is plenty at this size.
      for (let i = 1; i < p.length; i += p.length > 40 ? 2 : 1) ctx.lineTo(p[i][0] * s + ox, p[i][1] * s + oy);
      ctx.stroke();
      continue;
    }
    const r = boundsOf(el);
    const x = r.x * s + ox;
    const y = r.y * s + oy;
    const w = Math.max(2, r.w * s);
    const h = Math.max(2, r.h * s);
    if (el.type === 'image') {
      const img = image(el.src, redraw);
      ctx.globalAlpha = 1;
      if (img) ctx.drawImage(img, x, y, w, h);
      else {
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)';
        ctx.fillRect(x, y, w, h);
      }
      continue;
    }
    // Text, notes, answers and diagrams: a soft block in their colour, lines suggested inside.
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(4, h / 2));
    ctx.fill();
    if (h > 10 && w > 14) {
      ctx.globalAlpha = 0.45;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      for (let ly = y + 5; ly < y + h - 3; ly += 6) {
        ctx.beginPath();
        ctx.moveTo(x + 4, ly);
        ctx.lineTo(x + w - 4 - ((ly * 7) % (w / 3)), ly);
        ctx.stroke();
      }
    }
  }
  ctx.globalAlpha = 1;
  return elements.length;
}
