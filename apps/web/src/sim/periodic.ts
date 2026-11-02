/**
 * Periodic table: all 118 elements in the 18-column layout, with the f-block rows below,
 * coloured by category, block, electronegativity, atomic radius, first ionisation energy or
 * state at room temperature. Tapping an element selects it; a detail pane in the gap above the
 * transition metals shows its facts and a Bohr shell diagram whose electrons orbit on play.
 */

import { BW, fmt, label, line, num, str, text } from './kit.ts';
import type { Formula, Look, Readout, SimDef, SimGrab, SimParams, SimState } from './kit.ts';
import { CATEGORY_NAMES, ELEMENTS, STATE_NAMES, configTex, configText, element, fullConfigText } from './periodic-data.ts';
import type { Category, Element } from './periodic-data.ts';

// --- layout (base box) ------------------------------------------------------------------------

const X0 = 17;
const PX = 29.5;
const Y0 = 15;
const PY = 34;
/** Top of the lanthanide row; the actinides sit one row below. */
const FY = Y0 + 7 * PY + 7;
const LEGEND_Y = FY + 2 * PY + 10;

const cellX = (col: number) => X0 + col * PX;
const cellY = (row: number) => (row < 7 ? Y0 + row * PY : FY + (row - 7) * PY);

/** The detail pane: the empty columns 3 to 12 of periods 1 to 3. */
const PANE = { x: cellX(2) + 2, y: Y0 + 1, w: 10 * PX - 4, h: 3 * PY - 13 };
/** "Colour by" switch: the empty top row above groups 13 to 17. */
const CHIPS = { x: cellX(12) + 2, y: Y0 + 1, w: 5 * PX - 4, h: PY - 2 };

type Mode = 'category' | 'block' | 'en' | 'radius' | 'ie' | 'state';
const MODES: { value: Mode; chip: string; label: string }[] = [
  { value: 'category', chip: 'Category', label: 'Category' },
  { value: 'block', chip: 'Block', label: 'Block (s, p, d, f)' },
  { value: 'en', chip: 'EN', label: 'Electronegativity' },
  { value: 'radius', chip: 'Radius', label: 'Atomic radius' },
  { value: 'ie', chip: 'IE₁', label: 'First ionisation energy' },
  { value: 'state', chip: 'State', label: 'State at 25 °C' },
];
const modeOf = (p: SimParams): Mode => {
  const m = str(p, 'color', 'category');
  return (MODES.some((x) => x.value === m) ? m : 'category') as Mode;
};

const SHORT: Record<Category, string> = {
  am: 'Alkali metal', ae: 'Alkaline earth', tm: 'Transition metal', pt: 'Post-transition', md: 'Metalloid',
  nm: 'Non-metal', hl: 'Halogen', ng: 'Noble gas', la: 'Lanthanide', ac: 'Actinide', un: 'Unknown',
};
const CATS = Object.keys(SHORT) as Category[];

/** Numeric properties: how to read them and the span the colour ramp covers. */
const NUMERIC: Record<'en' | 'radius' | 'ie', { get: (e: Element) => number | null; lo: number; hi: number; title: string; unit: string }> = {
  en: { get: (e) => e.en, lo: 0.7, hi: 3.98, title: 'Electronegativity (Pauling)', unit: '' },
  radius: { get: (e) => e.radius, lo: 30, hi: 300, title: 'Atomic radius (calculated)', unit: 'pm' },
  ie: { get: (e) => e.ie, lo: 370, hi: 2400, title: 'First ionisation energy', unit: 'kJ/mol' },
};

// --- colour -----------------------------------------------------------------------------------

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
/** Blend two #rrggbb colours: t = 0 gives a, 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const ca = rgb(a);
  const cb = rgb(b);
  const k = Math.max(0, Math.min(1, t));
  return `#${ca.map((v, i) => Math.round(v + (cb[i] - v) * k).toString(16).padStart(2, '0')).join('')}`;
}
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};

function categoryColor(c: Category, look: Look): string {
  switch (c) {
    case 'am': return look.red;
    case 'ae': return look.orange;
    case 'tm': return look.yellow;
    case 'pt': return mix(look.green, look.blue, 0.55);
    case 'md': return mix(look.green, look.yellow, 0.5);
    case 'nm': return look.green;
    case 'hl': return look.blue;
    case 'ng': return look.violet;
    case 'la': return mix(look.red, look.violet, 0.5);
    case 'ac': return mix(look.violet, look.blue, 0.45);
    default: return look.faint;
  }
}
const blockColor = (b: string, look: Look) => ({ s: look.red, p: look.yellow, d: look.blue, f: look.green })[b] ?? look.faint;
const stateColor = (s: string, look: Look) => ({ s: look.muted, l: look.blue, g: look.red })[s] ?? look.faint;

/** Low to high: yellow, orange, red, violet. */
function ramp(t: number, look: Look): string {
  const stops = [look.yellow, look.orange, look.red, look.violet];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return mix(stops[i], stops[i + 1], x - i);
}

/** The key a tile is grouped by in this mode, for highlighting one family from the legend. */
function keyOf(e: Element, mode: Mode): string {
  if (mode === 'category') return e.category;
  if (mode === 'block') return e.block;
  if (mode === 'state') return e.state;
  return '';
}

/** Tile fill, or null for "no data". */
function tileFill(e: Element, mode: Mode, look: Look): string | null {
  const soft = look.dark ? 0.5 : 0.42;
  if (mode === 'category') return mix(look.card, categoryColor(e.category, look), soft);
  if (mode === 'block') return mix(look.card, blockColor(e.block, look), soft);
  if (mode === 'state') return e.state === 'u' ? null : mix(look.card, stateColor(e.state, look), e.state === 's' ? 0.22 : soft);
  const n = NUMERIC[mode];
  const v = n.get(e);
  if (v === null) return null;
  const t = (v - n.lo) / (n.hi - n.lo);
  const k = Math.max(0, Math.min(1, t));
  return mix(look.card, ramp(k, look), look.dark ? 0.55 + 0.4 * k : 0.38 + 0.55 * k);
}

const propText = (e: Element, mode: Mode): string => {
  if (mode === 'en') return e.en === null ? '' : e.en.toFixed(2);
  if (mode === 'radius') return e.radius === null ? '' : String(e.radius);
  if (mode === 'ie') return e.ie === null ? '' : String(Math.round(e.ie));
  return '';
};

// --- legend -----------------------------------------------------------------------------------

const SLOT_W = 90;
const SLOT_H = 15;

interface Slot { key: string; label: string; x: number; y: number }

function legendSlots(mode: Mode): Slot[] {
  let items: [string, string][] = [];
  if (mode === 'category') items = CATS.map((c) => [c, SHORT[c]]);
  else if (mode === 'block') items = [['s', 's-block'], ['p', 'p-block'], ['d', 'd-block'], ['f', 'f-block']];
  else if (mode === 'state') items = [['s', 'Solid'], ['l', 'Liquid'], ['g', 'Gas'], ['u', 'Unknown']];
  const perRow = 6;
  return items.map(([key, lab], i) => ({
    key, label: lab,
    x: X0 + (i % perRow) * SLOT_W,
    y: LEGEND_Y + Math.floor(i / perRow) * (SLOT_H + 3),
  }));
}

// --- drawing ----------------------------------------------------------------------------------

function drawTile(ctx: CanvasRenderingContext2D, e: Element, p: SimParams, look: Look, mode: Mode, dim: boolean) {
  const x = cellX(e.col) + 0.75;
  const y = cellY(e.row) + 0.75;
  const w = PX - 1.5;
  const h = PY - 1.5;
  const fill = tileFill(e, mode, look);
  ctx.save();
  if (dim) ctx.globalAlpha = 0.28;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 3);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  } else {
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = look.faint;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const fg = fill ? (luminance(fill) < 0.5 ? '#ffffff' : '#1d1d1f') : look.muted;
  const sub = fill ? (luminance(fill) < 0.5 ? 'rgba(255,255,255,0.8)' : 'rgba(29,29,31,0.7)') : look.faint;
  text(ctx, String(e.z), x + 2.5, y + 6.5, { size: 7, weight: 550, color: sub });
  const pv = propText(e, mode);
  text(ctx, e.symbol, x + w / 2, y + (pv ? h / 2 + 0.5 : h / 2 + 2.5), { size: e.symbol.length > 1 ? 11.5 : 12.5, weight: 700, color: fg, align: 'center' });
  if (pv) text(ctx, pv, x + w / 2, y + h - 5.5, { size: 6.8, weight: 550, color: sub, align: 'center' });
  else if (e.state !== 's' && mode === 'state' && e.state !== 'u') {
    text(ctx, e.state === 'l' ? 'liquid' : 'gas', x + w / 2, y + h - 5.5, { size: 6.5, weight: 550, color: sub, align: 'center' });
  }
  ctx.restore();
  if (e.z === Math.round(num(p, 'z', 16))) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x - 1, y - 1, w + 2, h + 2, 4);
    ctx.strokeStyle = look.ink;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();
  }
}

/** The "57–71" and "89–103" cells where the f-block rows belong in the main table. */
function drawPlaceholder(ctx: CanvasRenderingContext2D, row: number, cat: Category, look: Look, mode: Mode, dim: boolean) {
  const x = cellX(2) + 0.75;
  const y = cellY(row) + 0.75;
  ctx.save();
  if (dim) ctx.globalAlpha = 0.28;
  ctx.beginPath();
  ctx.roundRect(x, y, PX - 1.5, PY - 1.5, 3);
  if (mode === 'category') {
    ctx.fillStyle = mix(look.card, categoryColor(cat, look), look.dark ? 0.3 : 0.24);
    ctx.fill();
  }
  ctx.setLineDash([2, 2]);
  ctx.strokeStyle = look.faint;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
  text(ctx, row === 5 ? '57–71' : '89–103', x + (PX - 1.5) / 2, y + (PY - 1.5) / 2, { size: 7.2, weight: 600, color: look.muted, align: 'center' });
}

function drawBohr(ctx: CanvasRenderingContext2D, e: Element, cx: number, cy: number, R: number, t: number, look: Look) {
  const n = e.shells.length;
  const nucleus = 8;
  const gap = Math.min(9, (R - nucleus - 2) / n);
  ctx.save();
  for (let k = 0; k < n; k++) {
    const r = nucleus + 3 + gap * (k + 1);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.strokeStyle = look.cardEdge;
    ctx.lineWidth = 1;
    ctx.stroke();
    const count = e.shells[k];
    // Inner shells turn faster, alternating direction so neighbouring shells read apart.
    const turn = t * (1.6 / (k + 1)) * (k % 2 ? -1 : 1);
    const dot = count > 18 ? 1.35 : 1.75;
    ctx.fillStyle = k === n - 1 ? look.blue : look.muted;
    for (let i = 0; i < count; i++) {
      const a = turn + (i / count) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, dot, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.beginPath();
  ctx.arc(cx, cy, nucleus, 0, Math.PI * 2);
  ctx.fillStyle = mix(look.card, look.red, 0.5);
  ctx.fill();
  ctx.restore();
  text(ctx, e.symbol, cx, cy + 0.5, { size: e.symbol.length > 1 ? 7.5 : 8.5, weight: 700, color: look.dark ? '#ffffff' : '#1d1d1f', align: 'center' });
}

function drawPane(ctx: CanvasRenderingContext2D, e: Element, look: Look, mode: Mode, t: number) {
  const { x, y, w, h } = PANE;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  ctx.fillStyle = look.card;
  ctx.fill();
  ctx.strokeStyle = look.cardEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();

  // Big tile: atomic number, symbol, mass.
  const tx = x + 7;
  const ty = y + 6;
  const ts = 40;
  const fill = tileFill(e, mode, look) ?? mix(look.card, look.faint, 0.25);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(tx, ty, ts, ts, 5);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
  const fg = luminance(fill) < 0.5 ? '#ffffff' : '#1d1d1f';
  text(ctx, String(e.z), tx + 4, ty + 7, { size: 8.5, weight: 650, color: fg });
  text(ctx, e.symbol, tx + ts / 2, ty + ts / 2, { size: 17, weight: 750, color: fg, align: 'center' });
  text(ctx, e.mass, tx + ts / 2, ty + ts - 6, { size: 7, weight: 550, color: fg, align: 'center' });

  const lx = tx + ts + 8;
  text(ctx, e.name, lx, ty + 8, { size: 14, weight: 700, color: look.ink });
  text(ctx, CATEGORY_NAMES[e.category], lx, ty + 22, { size: 10, weight: 550, color: look.muted });
  text(ctx, e.unstable ? 'No stable isotope' : `${STATE_NAMES[e.state]} at 25 °C`, lx, ty + 35, { size: 9, color: look.faint });

  const cfg = configText(e.z);
  text(ctx, cfg, tx, y + 57, { size: cfg.length > 22 ? 10 : 11, weight: 650, color: look.ink });
  const group = e.group === null ? 'no group' : `Group ${e.group}`;
  text(ctx, `${group} · Period ${e.period} · ${e.block}-block`, tx, y + 71, { size: 10, weight: 550, color: look.muted });
  const val = e.valency.length ? `Valency ${e.valency.join(', ')}` : 'Valency unknown';
  text(ctx, val, tx, y + 83, { size: 10, weight: 550, color: look.muted });

  drawBohr(ctx, e, x + w - 46, y + h / 2, 42, t, look);
}

function drawChips(ctx: CanvasRenderingContext2D, mode: Mode, look: Look) {
  const { x, y, w } = CHIPS;
  const cw = (w - 4) / 3;
  MODES.forEach((m, i) => {
    const cx = x + (i % 3) * (cw + 2);
    const cy = y + Math.floor(i / 3) * 13;
    const on = m.value === mode;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(cx, cy, cw, 11.5, 5.75);
    ctx.fillStyle = on ? look.blue : look.cardEdge;
    ctx.fill();
    ctx.restore();
    text(ctx, m.chip, cx + cw / 2, cy + 6, { size: 8, weight: 650, color: on ? '#ffffff' : look.ink, align: 'center' });
  });
}

function drawLegend(ctx: CanvasRenderingContext2D, p: SimParams, e: Element, mode: Mode, look: Look) {
  if (mode === 'en' || mode === 'radius' || mode === 'ie') {
    const n = NUMERIC[mode];
    const y = LEGEND_Y + 4;
    text(ctx, n.title, X0, y + 4, { size: 9.5, weight: 650, color: look.muted });
    const bx = X0 + 158;
    const bw = 240;
    for (let i = 0; i < bw; i++) {
      ctx.fillStyle = mix(look.card, ramp(i / bw, look), look.dark ? 0.55 + 0.4 * (i / bw) : 0.38 + 0.55 * (i / bw));
      ctx.fillRect(bx + i, y, 1.2, 9);
    }
    text(ctx, `${fmt(n.lo)}`, bx - 4, y + 4.5, { size: 8.5, color: look.muted, align: 'right' });
    text(ctx, `${fmt(n.hi)} ${n.unit}`, bx + bw + 4, y + 4.5, { size: 8.5, color: look.muted });
    const v = n.get(e);
    if (v !== null) {
      const px = bx + Math.max(0, Math.min(1, (v - n.lo) / (n.hi - n.lo))) * bw;
      line(ctx, px, y - 3, px, y + 12, look.ink, 2);
      label(ctx, `${e.symbol} ${mode === 'en' ? v.toFixed(2) : fmt(v, 4)}`, px, y + 21, look, { size: 9 });
    } else {
      label(ctx, `${e.symbol}: no value`, bx + bw / 2, y + 21, look, { size: 9, color: look.muted });
    }
    ctx.save();
    ctx.setLineDash([2, 2]);
    ctx.strokeStyle = look.faint;
    ctx.strokeRect(BW - 66, y, 9, 9);
    ctx.restore();
    text(ctx, 'no data', BW - 53, y + 4.5, { size: 8.5, color: look.muted });
    return;
  }
  const hi = str(p, 'hi');
  for (const s of legendSlots(mode)) {
    const key = `${mode}:${s.key}`;
    const on = hi === key;
    const off = hi.startsWith(`${mode}:`) && !on;
    let c: string;
    if (mode === 'category') c = categoryColor(s.key as Category, look);
    else if (mode === 'block') c = blockColor(s.key, look);
    else c = stateColor(s.key, look);
    ctx.save();
    if (off) ctx.globalAlpha = 0.45;
    if (on) {
      ctx.beginPath();
      ctx.roundRect(s.x - 3, s.y - 1, SLOT_W - 4, SLOT_H, 5);
      ctx.fillStyle = look.cardEdge;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.roundRect(s.x, s.y + 2.5, 9, 9, 2);
    if (mode === 'state' && s.key === 'u') {
      ctx.setLineDash([2, 2]);
      ctx.strokeStyle = look.faint;
      ctx.stroke();
    } else {
      ctx.fillStyle = mix(look.card, c, mode === 'state' && s.key === 's' ? 0.3 : 0.6);
      ctx.fill();
    }
    ctx.restore();
    text(ctx, s.label, s.x + 13, s.y + 7.2, { size: 9.5, weight: on ? 700 : 550, color: off ? look.faint : look.ink });
  }
  text(ctx, 'Tap a key to pick it out', BW - 12, LEGEND_Y + (mode === 'category' ? 25 : 7), { size: 8.5, color: look.faint, align: 'right' });
}

function draw(ctx: CanvasRenderingContext2D, p: SimParams, s: SimState, look: Look) {
  const mode = modeOf(p);
  const sel = element(num(p, 'z', 16));
  const hi = str(p, 'hi');
  const hiKey = hi.startsWith(`${mode}:`) ? hi.slice(mode.length + 1) : '';

  // Group numbers over the columns and period numbers down the side.
  for (let g = 1; g <= 18; g++) {
    const col = g - 1;
    const top = g === 1 || g === 18 ? 0 : g === 2 || g >= 13 ? 1 : 3;
    text(ctx, String(g), cellX(col) + PX / 2, cellY(top) - 4.5, { size: 7.5, weight: 600, color: look.faint, align: 'center' });
  }
  for (let r = 0; r < 7; r++) text(ctx, String(r + 1), X0 - 6, cellY(r) + PY / 2, { size: 8, weight: 600, color: look.faint, align: 'center' });
  text(ctx, 'Lanthanides', cellX(2) - 4, cellY(7) + PY / 2, { size: 8, weight: 600, color: look.muted, align: 'right' });
  text(ctx, 'Actinides', cellX(2) - 4, cellY(8) + PY / 2, { size: 8, weight: 600, color: look.muted, align: 'right' });

  for (const e of ELEMENTS) drawTile(ctx, e, p, look, mode, !!hiKey && keyOf(e, mode) !== hiKey);
  for (const [row, cat] of [[5, 'la'], [6, 'ac']] as const) {
    const own = mode === 'category' ? cat : mode === 'block' ? 'f' : 's';
    drawPlaceholder(ctx, row, cat, look, mode, !!hiKey && hiKey !== own);
  }

  drawPane(ctx, sel, look, mode, s.t);
  drawChips(ctx, mode, look);
  drawLegend(ctx, p, sel, mode, look);
}

// --- hand editing -----------------------------------------------------------------------------

function elementAt(x: number, y: number): Element | null {
  const col = Math.floor((x - X0) / PX);
  if (col < 0 || col > 17) return null;
  let row = -1;
  if (y >= Y0 && y < Y0 + 7 * PY) row = Math.floor((y - Y0) / PY);
  else if (y >= FY && y < FY + 2 * PY) row = 7 + Math.floor((y - FY) / PY);
  if (row < 0) return null;
  return ELEMENTS.find((e) => e.col === col && e.row === row) ?? null;
}

function grab(p: SimParams, _s: SimState, x: number, y: number): SimGrab | null {
  const mode = modeOf(p);
  // Colour-by chips.
  if (x >= CHIPS.x && x <= CHIPS.x + CHIPS.w && y >= CHIPS.y && y <= CHIPS.y + 25) {
    const cw = (CHIPS.w - 4) / 3;
    const i = Math.min(2, Math.floor((x - CHIPS.x) / (cw + 2))) + (y - CHIPS.y >= 12.25 ? 3 : 0);
    const m = MODES[i];
    return { tap: { color: m.value, hi: '' }, hint: `Colour by ${m.label.toLowerCase()}` };
  }
  const e = elementAt(x, y);
  if (e) return { tap: { z: e.z }, hint: `${e.z} ${e.name}` };
  // The 57–71 and 89–103 markers jump to the start of their row.
  if (x >= cellX(2) && x < cellX(3) && y >= cellY(5) && y < cellY(7)) {
    const z = y < cellY(6) ? 57 : 89;
    return { tap: { z }, hint: z === 57 ? 'Lanthanides' : 'Actinides' };
  }
  // Legend keys pick out one family; tapping it again shows them all.
  if (y >= LEGEND_Y - 2) {
    for (const s of legendSlots(mode)) {
      if (x >= s.x - 3 && x < s.x + SLOT_W - 6 && y >= s.y - 1 && y < s.y + SLOT_H) {
        const key = `${mode}:${s.key}`;
        const on = str(p, 'hi') === key;
        return { tap: { hi: on ? '' : key }, hint: on ? 'Show all' : `Pick out: ${s.label}` };
      }
    }
  }
  return null;
}

// --- definition ---------------------------------------------------------------------------------

export const periodicSim: SimDef<SimState> = {
  label: 'Periodic table',
  subject: 'Chemistry',
  display: ['hi'],
  keywords: 'elements periodic table electron configuration shells bohr model valency electronegativity atomic radius ionisation ionization energy groups periods blocks metals non-metals noble gases halogens',
  blurb: 'All 118 elements, trends, configurations, shells',
  defaults: { z: 16, color: 'category', hi: '' },
  controls: [
    { key: 'z', label: 'Element (Z)', type: 'range', min: 1, max: 118, step: 1 },
    { key: 'color', label: 'Colour by', type: 'choice', options: MODES.map((m) => ({ value: m.value, label: m.label })) },
    {
      key: 'hi', label: 'Pick out', type: 'choice', show: (p) => ['category', 'block', 'state'].includes(modeOf(p)),
      options: [
        { value: '', label: 'All' },
        ...CATS.map((c) => ({ value: `category:${c}`, label: SHORT[c] })),
        ...['s', 'p', 'd', 'f'].map((b) => ({ value: `block:${b}`, label: `${b}-block` })),
        ...(['s', 'l', 'g'] as const).map((k) => ({ value: `state:${k}`, label: STATE_NAMES[k] })),
      ],
    },
  ],
  presets: [
    { label: 'Sulfur: families', params: { z: 16, color: 'category', hi: '' } },
    { label: 'Halogens', params: { z: 17, color: 'category', hi: 'category:hl' } },
    { label: 'Electronegativity trend', params: { z: 9, color: 'en', hi: '' } },
    { label: 'Atomic radius trend', params: { z: 55, color: 'radius', hi: '' } },
    { label: 'Ionisation energy', params: { z: 2, color: 'ie', hi: '' } },
    { label: 'Iron and the d-block', params: { z: 26, color: 'block', hi: 'block:d' } },
  ],
  title: (p) => {
    const e = element(num(p, 'z', 16));
    return `Periodic table · ${e.name}`;
  },
  init: () => ({ t: 0, done: false }),
  step: (_p, s, dt) => {
    s.t += dt;
  },
  draw,
  readouts: (p) => {
    const e = element(num(p, 'z', 16));
    const out: Readout[] = [
      { label: 'Element', value: `${e.z} ${e.symbol} · ${e.name}` },
      { label: 'Atomic mass', value: e.mass },
      { label: 'Shells', value: e.shells.join(', '), color: 'blue' },
      { label: 'Electroneg.', value: e.en === null ? '—' : e.en.toFixed(2) },
      { label: 'Radius', value: e.radius === null ? '—' : `${e.radius} pm` },
      { label: '1st ionisation', value: e.ie === null ? '—' : `${fmt(e.ie, 4)} kJ/mol` },
    ];
    return out;
  },
  formulas: (p) => {
    const e = element(num(p, 'z', 16));
    const a = Math.round(e.massValue);
    const full = fullConfigText(e.z);
    const out: Formula[] = [
      { label: 'Electron configuration', tex: `\\mathrm{${e.symbol}}:\\ ${configTex(e.z)}` },
      { label: 'In full', tex: `\\text{${full}}` },
      { label: 'Electrons per shell (at most 2n²)', tex: `${e.shells.join(',\\ ')}\\qquad 2n^2 = 2,\\ 8,\\ 18,\\ 32` },
      {
        label: e.unstable ? 'Particles (longest-lived isotope)' : 'Particles (mass number ≈ rounded atomic mass)',
        tex: `p^+ = e^- = Z = ${e.z},\\quad n^0 \\approx A - Z = ${a} - ${e.z} = ${a - e.z}`,
      },
      {
        label: 'Place in the table',
        tex: `\\text{period } ${e.period}\\ (\\text{${e.shells.length} occupied shells});\\ ${e.group === null ? '\\text{f-block, no group}' : `\\text{group } ${e.group}`},\\ \\text{${e.block}-block}`,
      },
    ];
    if (e.z >= 104) out.push({ label: 'Note', tex: `\\text{Configuration and properties from } Z = 104 \\text{ on are predictions}` });
    return out;
  },
  grab,
};
