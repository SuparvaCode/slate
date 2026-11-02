/**
 * Ray optics: thin lenses and spherical mirrors with the three principal rays, and refraction
 * at a flat boundary (Snell's law, critical angle, total internal reflection).
 *
 * Lenses and mirrors use real-is-positive distances: 1/u + 1/v = 1/f, with f > 0 for a convex
 * lens or concave mirror, and magnification m = -v/u.
 */

import { BW, DEG, arrow, bool, fmt, label, line, num, str, text, tf } from './kit';
import type { Formula, Look, SimGrab, Readout, SimDef, SimParams, SimState } from './kit';

interface OpticsState extends SimState {
  /** The object's distance: the slider value, moving towards the lens and back while playing. */
  u: number;
  /** Incidence angle while sweeping, degrees. */
  i: number;
  dir: number;
}

const AXIS = 190;

const isSnell = (p: SimParams) => str(p, 'setup') === 'snell';
const isMirror = (p: SimParams) => str(p, 'setup', 'lens').startsWith('mirror');

/** Focal length with its sign: diverging elements are negative. */
function focal(p: SimParams) {
  const f = num(p, 'f', 15);
  const setup = str(p, 'setup', 'lens');
  return setup === 'concave' || setup === 'mirror-convex' ? -f : f;
}

function image(f: number, u: number) {
  const inv = 1 / f - 1 / u;
  const v = Math.abs(inv) < 1e-9 ? Infinity : 1 / inv;
  const m = Number.isFinite(v) ? -v / u : Infinity;
  return { v, m };
}

function nature(v: number, m: number): string {
  if (!Number.isFinite(v)) return 'At infinity';
  const kind = v > 0 ? 'Real' : 'Virtual';
  const way = m < 0 ? 'inverted' : 'upright';
  const size = Math.abs(Math.abs(m) - 1) < 0.02 ? 'same size' : Math.abs(m) > 1 ? 'magnified' : 'diminished';
  return `${kind}, ${way}, ${size}`;
}

function scale(p: SimParams) {
  const f = Math.abs(focal(p));
  const span = Math.max(num(p, 'u', 30), 2.2 * f, 10);
  return (isMirror(p) ? 340 : 250) / span;
}

/** Extends a ray from (x, y) along (dx, dy) to the edge of the drawing. */
function toEdge(x: number, y: number, dx: number, dy: number): [number, number] {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  let t = 2000;
  if (ux > 0) t = Math.min(t, (BW - 8 - x) / ux);
  if (ux < 0) t = Math.min(t, (8 - x) / ux);
  if (uy > 0) t = Math.min(t, (372 - y) / uy);
  if (uy < 0) t = Math.min(t, (8 - y) / uy);
  return [x + ux * Math.max(0, t), y + uy * Math.max(0, t)];
}

/** A small arrowhead halfway along a ray, showing which way the light goes. */
function midArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  if (len < 30) return;
  const ux = (x2 - x1) / len;
  const uy = (y2 - y1) / len;
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  arrow(ctx, mx - ux * 8, my - uy * 8, mx + ux * 8, my + uy * 8, color, { w: 1.8 });
}

function objectArrow(ctx: CanvasRenderingContext2D, x: number, h: number, color: string, look: Look, tag: string, dashed = false) {
  arrow(ctx, x, AXIS, x, AXIS - h, color, { w: 3, dash: dashed });
  label(ctx, tag, x, AXIS - h + (h > 0 ? -12 : 12), look, { color, size: 10.5 });
}

function drawLensOrMirror(ctx: CanvasRenderingContext2D, p: SimParams, s: OpticsState, look: Look) {
  const mirror = isMirror(p);
  const f = focal(p);
  const u = s.u;
  const { v, m } = image(f, u);
  const k = scale(p);
  const X = mirror ? 470 : 300; // the lens or mirror
  const h = num(p, 'h', 5) * k * 0.9 > 120 ? 120 : num(p, 'h', 5) * k * 0.9;
  const ox = X - u * k;
  const oy = AXIS - h;
  // Real images form on the outgoing side: right of a lens, left of (in front of) a mirror.
  const out = mirror ? -1 : 1;
  const ix = Number.isFinite(v) ? X + out * v * k : NaN;
  const imgTop = AXIS - m * h;

  // Principal axis and focal points.
  line(ctx, 10, AXIS, BW - 10, AXIS, look.faint, 1);
  const fpx = Math.abs(f) * k;
  // A concave mirror's focus is in front of it; a convex mirror's is behind.
  for (const sgn of mirror ? [f > 0 ? -1 : 1] : [-1, 1]) {
    for (const mult of [1, 2]) {
      const x = X + sgn * fpx * mult;
      if (x < 10 || x > BW - 10) continue;
      ctx.beginPath();
      ctx.arc(x, AXIS, mult === 1 ? 3.5 : 2.5, 0, Math.PI * 2);
      ctx.fillStyle = look.muted;
      ctx.fill();
      text(ctx, mult === 1 ? 'F' : mirror ? 'C' : '2F', x, AXIS + 14, { size: 10.5, weight: 650, color: look.muted, align: 'center' });
    }
  }

  // The element itself.
  const H = 150;
  ctx.save();
  ctx.strokeStyle = look.blue;
  ctx.lineWidth = 2.4;
  if (mirror) {
    const bulge = f > 0 ? -14 : 14; // a concave mirror's edges curve towards the object
    ctx.beginPath();
    ctx.moveTo(X + bulge, AXIS - H);
    ctx.quadraticCurveTo(X - bulge, AXIS, X + bulge, AXIS + H);
    ctx.stroke();
    ctx.strokeStyle = look.faint;
    ctx.lineWidth = 1;
    for (let y = -H + 8; y <= H - 8; y += 12) {
      const t = (y + H) / (2 * H);
      const cx = (1 - t) * (1 - t) * (X + bulge) + 2 * t * (1 - t) * (X - bulge) + t * t * (X + bulge);
      ctx.beginPath();
      ctx.moveTo(cx + 2, AXIS + y);
      ctx.lineTo(cx + 9, AXIS + y + 6);
      ctx.stroke();
    }
  } else {
    const w = 10;
    ctx.fillStyle = look.blue;
    ctx.globalAlpha = 0.12;
    ctx.beginPath();
    if (f > 0) {
      ctx.moveTo(X, AXIS - H);
      ctx.quadraticCurveTo(X + w * 2, AXIS, X, AXIS + H);
      ctx.quadraticCurveTo(X - w * 2, AXIS, X, AXIS - H);
    } else {
      ctx.moveTo(X - w, AXIS - H);
      ctx.lineTo(X + w, AXIS - H);
      ctx.quadraticCurveTo(X, AXIS, X + w, AXIS + H);
      ctx.lineTo(X - w, AXIS + H);
      ctx.quadraticCurveTo(X, AXIS, X - w, AXIS - H);
    }
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  }
  ctx.restore();

  objectArrow(ctx, ox, h, look.orange, look, 'object');

  // Rays from the object's tip: parallel, through the centre (or pole), and through F.
  if (bool(p, 'rays')) {
    const colors = [look.red, look.green, look.violet];
    const hits = [oy, AXIS, Number.isFinite(v) ? imgTop : oy];
    hits.forEach((hy, r) => {
      if (r === 2 && !Number.isFinite(v)) return;
      const c = colors[r];
      line(ctx, ox, oy, X, hy, c, 1.8);
      midArrow(ctx, ox, oy, X, hy, c);
      let dx: number;
      let dy: number;
      if (!Number.isFinite(v)) {
        // Image at infinity: every ray leaves parallel to the one through the centre (or, for
        // a mirror, to that ray reflected at the pole).
        dx = out * (X - ox);
        dy = AXIS - oy;
      } else if (v > 0) {
        dx = ix - X;
        dy = imgTop - hy;
      } else {
        dx = X - ix;
        dy = hy - imgTop;
      }
      const [ex, ey] = toEdge(X, hy, dx, dy);
      line(ctx, X, hy, ex, ey, c, 1.8);
      midArrow(ctx, X, hy, ex, ey, c);
      // A virtual image is where the outgoing rays seem to come from: dashed back to it.
      if (Number.isFinite(v) && v < 0) line(ctx, X, hy, ix, imgTop, c, 1.2, [4, 4]);
    });
  }

  if (Number.isFinite(v) && ix > -200 && ix < BW + 200) {
    const hh = AXIS - imgTop;
    if (Math.abs(hh) < 400) objectArrow(ctx, ix, hh, look.blue, look, v > 0 ? 'real image' : 'virtual image', v < 0);
  } else if (!Number.isFinite(v)) {
    label(ctx, 'Object at F: the image is at infinity', BW / 2, 352, look, { color: look.muted });
  }
  label(ctx, `u = ${fmt(u)} cm`, (ox + X) / 2, AXIS + 32, look, { color: look.orange, size: 10.5 });
  if (Number.isFinite(v)) label(ctx, `v = ${fmt(v)} cm`, (ix + X) / 2, AXIS + 48, look, { color: look.blue, size: 10.5 });
}

function snell(p: SimParams, i: number) {
  const n1 = num(p, 'n1', 1);
  const n2 = num(p, 'n2', 1.5);
  const sr = (n1 * Math.sin(i * DEG)) / n2;
  const tir = sr > 1;
  const r = tir ? NaN : Math.asin(sr) / DEG;
  const crit = n1 > n2 ? Math.asin(n2 / n1) / DEG : NaN;
  // Fresnel reflectance for unpolarised light.
  let R = 1;
  if (!tir) {
    const ci = Math.cos(i * DEG);
    const ct = Math.cos(r * DEG);
    const rs = ((n1 * ci - n2 * ct) / (n1 * ci + n2 * ct)) ** 2;
    const rp = ((n1 * ct - n2 * ci) / (n1 * ct + n2 * ci)) ** 2;
    R = (rs + rp) / 2;
  }
  return { n1, n2, r, tir, crit, R };
}

const MEDIA: Record<string, string> = { '1': 'air', '1.33': 'water', '1.5': 'glass', '2.42': 'diamond' };
const medium = (n: number) => MEDIA[String(n)] ?? `n = ${fmt(n)}`;

function drawSnell(ctx: CanvasRenderingContext2D, p: SimParams, s: OpticsState, look: Look) {
  const i = s.i;
  const k = snell(p, i);
  const cx = BW / 2;
  const cy = AXIS;
  ctx.save();
  ctx.fillStyle = look.blue;
  ctx.globalAlpha = Math.min(0.28, 0.05 + (k.n2 - 1) * 0.12);
  ctx.fillRect(10, cy, BW - 20, 182);
  ctx.globalAlpha = Math.min(0.28, 0.02 + (k.n1 - 1) * 0.12);
  ctx.fillRect(10, 8, BW - 20, cy - 8);
  ctx.restore();
  line(ctx, 10, cy, BW - 10, cy, look.muted, 2);
  line(ctx, cx, 20, cx, 360, look.faint, 1.2, [5, 5]);
  label(ctx, 'normal', cx + 26, 28, look, { color: look.faint, size: 10 });
  label(ctx, `${medium(k.n1)} · n₁ = ${fmt(k.n1)}`, 90, cy - 18, look, { color: look.muted, align: 'left' });
  label(ctx, `${medium(k.n2)} · n₂ = ${fmt(k.n2)}`, 90, cy + 20, look, { color: look.muted, align: 'left' });
  const L = 170;
  const a = i * DEG;
  const sx = cx - Math.sin(a) * L;
  const sy = cy - Math.cos(a) * L;
  line(ctx, sx, sy, cx, cy, look.red, 2.6);
  arrow(ctx, sx + (cx - sx) * 0.5, sy + (cy - sy) * 0.5, sx + (cx - sx) * 0.55, sy + (cy - sy) * 0.55, look.red, { w: 2.6 });
  // Reflected ray: brightness follows the share of light reflected.
  ctx.save();
  ctx.globalAlpha = Math.max(0.18, Math.min(1, k.R * 1.4));
  const rx = cx + Math.sin(a) * L;
  const ry = cy - Math.cos(a) * L;
  line(ctx, cx, cy, rx, ry, look.red, k.tir ? 2.6 : 1.8);
  arrow(ctx, cx + (rx - cx) * 0.5, cy + (ry - cy) * 0.5, cx + (rx - cx) * 0.55, cy + (ry - cy) * 0.55, look.red, { w: 1.8 });
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = look.muted;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(cx, cy, 44, -Math.PI / 2 - a, -Math.PI / 2);
  ctx.stroke();
  ctx.restore();
  label(ctx, `i = ${fmt(i)}°`, cx - Math.sin(a / 2) * 64, cy - Math.cos(a / 2) * 64, look, { color: look.red, size: 11 });
  if (!k.tir) {
    const b = k.r * DEG;
    const tx = cx + Math.sin(b) * L;
    const ty = cy + Math.cos(b) * L;
    line(ctx, cx, cy, tx, ty, look.orange, 2.6);
    arrow(ctx, cx + (tx - cx) * 0.5, cy + (ty - cy) * 0.5, cx + (tx - cx) * 0.55, cy + (ty - cy) * 0.55, look.orange, { w: 2.6 });
    ctx.save();
    ctx.strokeStyle = look.muted;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(cx, cy, 44, Math.PI / 2 - b, Math.PI / 2);
    ctx.stroke();
    ctx.restore();
    label(ctx, `r = ${fmt(k.r)}°`, cx + Math.sin(b / 2) * 66, cy + Math.cos(b / 2) * 66, look, { color: look.orange, size: 11 });
  } else {
    label(ctx, 'Total internal reflection', cx, cy + 60, look, { color: look.red, size: 12 });
  }
  if (Number.isFinite(k.crit)) label(ctx, `critical angle ${fmt(k.crit)}°`, BW - 90, cy - 18, look, { color: look.muted });
}

/** The object arrow can be dragged along the axis to change its distance. */
function grabObject(p: SimParams, s: OpticsState, x: number, y: number): SimGrab | null {
  if (isSnell(p)) return null;
  const k = scale(p);
  const X = isMirror(p) ? 470 : 300;
  const h = Math.min(120, num(p, 'h', 5) * k * 0.9);
  const ox = X - s.u * k;
  if (Math.abs(x - ox) > 16 || y < AXIS - h - 16 || y > AXIS + 10) return null;
  // The scale is held from the start of the drag, so the object follows the pointer.
  return {
    cursor: 'ew-resize',
    hint: 'Drag the object',
    drag: (nx) => ({ u: Math.round(Math.min(100, Math.max(2, (X - nx) / k)) * 2) / 2 }),
  };
}

export const opticsSim: SimDef<OpticsState> = {
  label: 'Lenses, mirrors & light',
  keywords: 'ray diagram convex concave lens mirror refraction snell image focal',
  grab: grabObject,
  blurb: 'Ray diagrams, image formation, Snell’s law',
  defaults: { setup: 'lens', f: 15, u: 30, h: 5, rays: true, i: 40, n1: 1, n2: 1.5 },
  controls: [
    {
      key: 'setup', label: 'Optics', type: 'choice', options: [
        { value: 'lens', label: 'Convex lens' }, { value: 'concave', label: 'Concave lens' },
        { value: 'mirror-concave', label: 'Concave mirror' }, { value: 'mirror-convex', label: 'Convex mirror' },
        { value: 'snell', label: 'Refraction' },
      ],
    },
    { key: 'f', label: 'Focal length', type: 'range', min: 4, max: 40, step: 0.5, unit: 'cm', show: (p) => !isSnell(p) },
    { key: 'u', label: 'Object distance', type: 'range', min: 2, max: 100, step: 0.5, unit: 'cm', show: (p) => !isSnell(p) },
    { key: 'h', label: 'Object height', type: 'range', min: 1, max: 12, step: 0.5, unit: 'cm', show: (p) => !isSnell(p) },
    { key: 'rays', label: 'Principal rays', type: 'toggle', show: (p) => !isSnell(p) },
    { key: 'i', label: 'Angle of incidence', type: 'range', min: 0, max: 89, step: 0.5, unit: '°', show: isSnell },
    {
      key: 'n1', label: 'From', type: 'choice', show: isSnell, options: [
        { value: '1', label: 'Air' }, { value: '1.33', label: 'Water' }, { value: '1.5', label: 'Glass' }, { value: '2.42', label: 'Diamond' },
      ],
    },
    {
      key: 'n2', label: 'Into', type: 'choice', show: isSnell, options: [
        { value: '1', label: 'Air' }, { value: '1.33', label: 'Water' }, { value: '1.5', label: 'Glass' }, { value: '2.42', label: 'Diamond' },
      ],
    },
  ],
  presets: [
    { label: 'Beyond 2F: real, smaller', params: { setup: 'lens', f: 15, u: 45 } },
    { label: 'Between F and 2F: real, bigger', params: { setup: 'lens', f: 15, u: 22 } },
    { label: 'Inside F: magnifying glass', params: { setup: 'lens', f: 15, u: 9 } },
    { label: 'Concave mirror at C', params: { setup: 'mirror-concave', f: 15, u: 30 } },
    { label: 'Glass to air: TIR', params: { setup: 'snell', n1: 1.5, n2: 1, i: 50 } },
    { label: 'Diverging lens', params: { setup: 'concave', f: 15, u: 30 } },
  ],
  title: (p) => {
    const s = str(p, 'setup', 'lens');
    if (s === 'snell') return 'Refraction · Snell’s law';
    return { lens: 'Convex lens', concave: 'Concave lens', 'mirror-concave': 'Concave mirror', 'mirror-convex': 'Convex mirror' }[s] ?? 'Lens';
  },
  init: (p) => ({ t: 0, done: false, u: num(p, 'u', 30), i: num(p, 'i', 40), dir: -1 }),
  step: (p, s, dt) => {
    s.t += dt;
    if (isSnell(p)) {
      // Play sweeps the incidence angle so the refracted ray and TIR can be watched.
      s.i += s.dir * 12 * dt;
      if (s.i <= 0 || s.i >= 89) {
        s.i = Math.min(89, Math.max(0, s.i));
        s.dir *= -1;
      }
      return;
    }
    const f = Math.abs(focal(p));
    const lo = Math.max(2, f * 0.35);
    const hi = Math.max(num(p, 'u', 30), f * 3);
    s.u += s.dir * f * 0.35 * dt;
    if (s.u <= lo || s.u >= hi) {
      s.u = Math.min(hi, Math.max(lo, s.u));
      s.dir *= -1;
    }
  },
  draw: (ctx, p, s, look) => (isSnell(p) ? drawSnell(ctx, p, s, look) : drawLensOrMirror(ctx, p, s, look)),
  readouts: (p, s) => {
    if (isSnell(p)) {
      const k = snell(p, s.i);
      return [
        { label: 'Incidence', value: `${fmt(s.i)}°`, color: 'red' },
        { label: 'Refraction', value: k.tir ? '—' : `${fmt(k.r)}°`, color: 'orange' },
        { label: 'Critical angle', value: Number.isFinite(k.crit) ? `${fmt(k.crit)}°` : 'none' },
        { label: 'Reflected', value: `${fmt(k.R * 100)}%` },
      ];
    }
    const f = focal(p);
    const { v, m } = image(f, s.u);
    const out: Readout[] = [
      { label: 'u', value: `${fmt(s.u)} cm`, color: 'orange' },
      { label: 'v', value: Number.isFinite(v) ? `${fmt(v)} cm` : '∞', color: 'blue' },
      { label: 'm', value: Number.isFinite(m) ? `${fmt(m)}×` : '∞' },
      { label: 'Power', value: `${fmt(100 / f)} D` },
      { label: 'Image', value: nature(v, m) },
    ];
    return out;
  },
  formulas: (p) => {
    if (isSnell(p)) {
      const i = num(p, 'i', 40);
      const k = snell(p, i);
      const out: Formula[] = [
        { label: "Snell's law", tex: `n_1 \\sin i = n_2 \\sin r` },
        k.tir
          ? { label: 'No refracted ray', tex: `\\sin r = \\dfrac{${tf(k.n1)} \\sin ${tf(i)}^\\circ}{${tf(k.n2)}} = ${tf((k.n1 * Math.sin(i * DEG)) / k.n2)} > 1` }
          : { label: 'Refraction angle', tex: `r = \\sin^{-1}\\!\\left(\\dfrac{${tf(k.n1)} \\sin ${tf(i)}^\\circ}{${tf(k.n2)}}\\right) = ${tf(k.r)}^\\circ` },
      ];
      if (Number.isFinite(k.crit)) out.push({ label: 'Critical angle', tex: `C = \\sin^{-1}\\dfrac{n_2}{n_1} = ${tf(k.crit)}^\\circ` });
      out.push({ label: 'Speed in medium 2', tex: `v = \\dfrac{c}{n_2} = ${tf(3 / k.n2)} \\times 10^8\\ \\text{m/s}` });
      return out;
    }
    const f = focal(p);
    const u = num(p, 'u', 30);
    const { v, m } = image(f, u);
    return [
      { label: isMirror(p) ? 'Mirror formula' : 'Lens formula', tex: `\\dfrac{1}{v} = \\dfrac{1}{f} - \\dfrac{1}{u} = \\dfrac{1}{${tf(f)}} - \\dfrac{1}{${tf(u)}}` },
      { label: 'Image distance', tex: Number.isFinite(v) ? `v = ${tf(v)}\\ \\text{cm}${v < 0 ? '\\ (\\text{virtual})' : ''}` : `v = \\infty` },
      { label: 'Magnification', tex: Number.isFinite(m) ? `m = -\\dfrac{v}{u} = ${tf(m)}` : `m \\to \\infty` },
      { label: 'Power', tex: `P = \\dfrac{100}{f\\ (\\text{cm})} = ${tf(100 / f)}\\ \\text{D}` },
      { label: 'Sign rule', tex: `\\text{real is positive; } f < 0 \\text{ for diverging}` },
    ];
  },
  readoutAt: 'left',
};
