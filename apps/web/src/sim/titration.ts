/**
 * Acids, bases & titration: a burette runs titrant (an alkali) into an acid in a conical flask.
 * The pH comes from the full charge balance, solved for [H⁺], so the start, the buffer region,
 * the equivalence point and the excess all follow from one equation:
 *
 *   strong acid + strong base:  [H⁺] + [Na⁺]  = [OH⁻] + [Cl⁻]
 *   weak acid + strong base:    [H⁺] + [Na⁺]  = [OH⁻] + C·Ka/(Ka + [H⁺])
 *   strong acid + weak base:    [H⁺] + [NH₄⁺] = [OH⁻] + [Cl⁻],  [NH₄⁺] = C·[H⁺]/([H⁺] + Kw/Kb)
 *
 * A second setup is a pH scale of everyday substances.
 */

import { fmt, label, line, num, str, text, tf } from './kit.ts';
import type { Formula, Look, Readout, SimDef, SimGrab, SimParams, SimState } from './kit.ts';

export const KW = 1e-14;
/** Ethanoic (acetic) acid. */
export const KA_ACETIC = 1.8e-5;
/** Ammonia. */
export const KB_AMMONIA = 1.8e-5;
const BURETTE = 50;

export type Kind = 'sa-sb' | 'wa-sb' | 'sa-wb';
export type Indicator = 'phph' | 'mo' | 'univ';

const kindOf = (p: SimParams): Kind => {
  const k = str(p, 'kind', 'sa-sb');
  return k === 'wa-sb' || k === 'sa-wb' ? k : 'sa-sb';
};
const indicatorOf = (p: SimParams): Indicator => {
  const k = str(p, 'indicator', 'phph');
  return k === 'mo' || k === 'univ' ? k : 'phph';
};
const isScale = (p: SimParams) => str(p, 'setup') === 'scale';
const isTitration = (p: SimParams) => !isScale(p);

const ACID: Record<Kind, { text: string; tex: string; name: string }> = {
  'sa-sb': { text: 'HCl', tex: '\\mathrm{HCl}', name: 'Hydrochloric acid' },
  'wa-sb': { text: 'CH₃COOH', tex: '\\mathrm{CH_3COOH}', name: 'Ethanoic acid' },
  'sa-wb': { text: 'HCl', tex: '\\mathrm{HCl}', name: 'Hydrochloric acid' },
};
const BASE: Record<Kind, { text: string; tex: string }> = {
  'sa-sb': { text: 'NaOH', tex: '\\mathrm{NaOH}' },
  'wa-sb': { text: 'NaOH', tex: '\\mathrm{NaOH}' },
  'sa-wb': { text: 'NH₃', tex: '\\mathrm{NH_3}' },
};

// --- chemistry --------------------------------------------------------------------------------

/**
 * pH after adding v mL of titrant (concentration cb) to va mL of acid (concentration ca).
 * Solves the charge balance by bisection on log[H⁺]; the balance rises steadily with [H⁺].
 */
export function phAt(kind: Kind, ca: number, va: number, cb: number, v: number): number {
  const V = va + v;
  const acid = (ca * va) / V;
  const base = (cb * v) / V;
  const f = (h: number) => {
    const oh = KW / h;
    if (kind === 'sa-sb') return h + base - oh - acid;
    if (kind === 'wa-sb') return h + base - oh - (acid * KA_ACETIC) / (KA_ACETIC + h);
    const ka = KW / KB_AMMONIA;
    return h + (base * h) / (h + ka) - oh - acid;
  };
  let lo = -15;
  let hi = 1;
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (f(10 ** mid) > 0) hi = mid;
    else lo = mid;
  }
  return -(lo + hi) / 2;
}

/** Equivalence volume in mL. */
export const veqOf = (ca: number, va: number, cb: number) => (ca * va) / cb;

function setup(p: SimParams) {
  const kind = kindOf(p);
  const ca = num(p, 'ca', 0.1);
  const va = num(p, 'va', 25);
  const cb = num(p, 'cb', 0.1);
  return { kind, ca, va, cb, veq: veqOf(ca, va, cb) };
}

type Region = 'start' | 'before' | 'equivalence' | 'after';
function regionOf(v: number, veq: number): Region {
  if (v < 1e-9) return 'start';
  if (Math.abs(v - veq) < 0.025) return 'equivalence';
  return v < veq ? 'before' : 'after';
}
const REGION_TEXT = (kind: Kind, r: Region) => {
  if (r === 'start') return 'Acid only';
  if (r === 'equivalence') return 'Equivalence point';
  if (r === 'before') return kind === 'wa-sb' ? 'Buffer region' : 'Acid in excess';
  return kind === 'sa-wb' ? 'Buffer (NH₃/NH₄⁺)' : 'Alkali in excess';
};

// --- colour -----------------------------------------------------------------------------------

function rgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function mix(a: string, b: string, t: number): string {
  const ca = rgb(a);
  const cb = rgb(b);
  const k = Math.max(0, Math.min(1, t));
  return `#${ca.map((v, i) => Math.round(v + (cb[i] - v) * k).toString(16).padStart(2, '0')).join('')}`;
}
function ramp(stops: [number, string][], x: number): string {
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) return mix(stops[i - 1][1], stops[i][1], (x - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  }
  return stops[stops.length - 1][1];
}

const pink = (look: Look) => mix(look.red, look.violet, 0.4);

const universalStops = (look: Look): [number, string][] => [
  [1, look.red], [3, look.red], [4.5, look.orange], [6, look.yellow], [7, look.green],
  [8.5, mix(look.green, look.blue, 0.65)], [10, look.blue], [12, look.violet],
];

const INDICATORS: Record<Indicator, { name: string; lo: number; hi: number; range: string }> = {
  phph: { name: 'Phenolphthalein', lo: 8.2, hi: 10, range: '8.2–10' },
  mo: { name: 'Methyl orange', lo: 3.1, hi: 4.4, range: '3.1–4.4' },
  univ: { name: 'Universal', lo: 0, hi: 14, range: '0–14' },
};

/** The indicator's own colour at this pH, and how strongly it tints the solution (0 for none). */
function indicatorColor(ind: Indicator, ph: number, look: Look): { color: string; strength: number; name: string } {
  if (ind === 'phph') {
    const t = Math.max(0, Math.min(1, (ph - 8.2) / 1.8));
    if (ph < 8.2) return { color: look.card, strength: 0, name: 'colourless' };
    return { color: pink(look), strength: 0.18 + 0.6 * t, name: indicatorName(ind, ph) };
  }
  if (ind === 'mo') {
    const c = ramp([[3.1, look.red], [3.75, look.orange], [4.4, look.yellow]], ph);
    return { color: c, strength: 0.65, name: indicatorName(ind, ph) };
  }
  const c = ramp(universalStops(look), ph);
  return { color: c, strength: 0.65, name: indicatorName(ind, ph) };
}

/** The colour a pupil would call it, without needing the theme. */
export function indicatorName(ind: Indicator, ph: number): string {
  if (ind === 'phph') return ph < 8.2 ? 'colourless' : ph < 9 ? 'pale pink' : 'pink';
  if (ind === 'mo') return ph < 3.1 ? 'red' : ph <= 4.4 ? 'orange' : 'yellow';
  return ph < 3 ? 'red' : ph < 5 ? 'orange' : ph < 6.5 ? 'yellow' : ph < 7.5 ? 'green' : ph < 10.5 ? 'blue' : 'purple';
}

function solutionColor(ind: Indicator, ph: number, look: Look) {
  const water = mix(look.card, look.blue, look.dark ? 0.14 : 0.08);
  const c = indicatorColor(ind, ph, look);
  return c.strength > 0 ? mix(water, c.color, c.strength) : water;
}

/** Is this indicator's colour change inside the steep part of the curve? */
function suitable(kind: Kind, ind: Indicator): boolean {
  if (ind === 'univ') return false;
  if (kind === 'sa-sb') return true;
  return kind === 'wa-sb' ? ind === 'phph' : ind === 'mo';
}

// --- number formatting ----------------------------------------------------------------------

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
function sciParts(v: number): [string, number] {
  const e = Math.floor(Math.log10(v));
  let m = v / 10 ** e;
  let ee = e;
  if (Number(m.toFixed(2)) >= 10) {
    m /= 10;
    ee += 1;
  }
  return [m.toFixed(2).replace(/\.?0+$/, ''), ee];
}
const sci = (v: number) => {
  const [m, e] = sciParts(v);
  return `${m} × 10${String(e).split('').map((c) => SUP[c]).join('')}`;
};
const sciTex = (v: number) => {
  const [m, e] = sciParts(v);
  return `${m} \\times 10^{${e}}`;
};
const ph2 = (ph: number) => ph.toFixed(2);
const mL = (v: number) => v.toFixed(2);

// --- titration layout ---------------------------------------------------------------------------

const BX = 78; // burette centre
const TUBE_TOP = 14;
const ZERO_Y = 24;
const PX_PER_ML = 4;
const TUBE_BOT = 236;
const TAP_Y = 244;
const JET_TIP = 272;
const NECK_TOP = 266;
const NECK_BOT = 290;
const FLASK_BOT = 362;
const NECK_HW = 9;
const BASE_HW = 46;

const PLOT = { x: 236, y: 18, w: 304, h: 266 };
const CHIP_X = 300;
const CHIP_W = 80;
const CHIP_GAP = 3;
const ROW1 = 322;
const ROW2 = 346;
const CHIP_H = 18;

const KIND_CHIPS: { value: Kind; label: string }[] = [
  { value: 'sa-sb', label: 'Strong–strong' },
  { value: 'wa-sb', label: 'Weak acid' },
  { value: 'sa-wb', label: 'Weak base' },
];
const IND_CHIPS: { value: Indicator; label: string }[] = [
  { value: 'phph', label: 'Phenolphthalein' },
  { value: 'mo', label: 'Methyl orange' },
  { value: 'univ', label: 'Universal' },
];

const px = (v: number) => PLOT.x + (v / BURETTE) * PLOT.w;
const py = (ph: number) => PLOT.y + PLOT.h - (ph / 14) * PLOT.h;

function chip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, s: string, on: boolean, look: Look, swatch?: string) {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, w, CHIP_H, CHIP_H / 2);
  ctx.fillStyle = on ? look.blue : look.cardEdge;
  ctx.fill();
  ctx.restore();
  if (swatch) {
    ctx.beginPath();
    ctx.arc(x + 8, y + CHIP_H / 2, 3, 0, Math.PI * 2);
    ctx.fillStyle = swatch;
    ctx.fill();
  }
  text(ctx, s, x + w / 2 + (swatch ? 5 : 0), y + CHIP_H / 2 + 0.5, { size: 8.5, weight: 650, color: on ? '#ffffff' : look.ink, align: 'center' });
}

function chipRow(ctx: CanvasRenderingContext2D, y: number, title: string, items: { value: string; label: string }[], current: string, look: Look, swatches?: string[]) {
  text(ctx, title, CHIP_X - 6, y + CHIP_H / 2, { size: 9.5, weight: 650, color: look.muted, align: 'right' });
  items.forEach((it, i) => chip(ctx, CHIP_X + i * (CHIP_W + CHIP_GAP), y, CHIP_W, it.label, it.value === current, look, swatches?.[i]));
}

function chipAt(x: number, y: number, rowY: number, n: number): number {
  if (y < rowY - 2 || y > rowY + CHIP_H + 2) return -1;
  const i = Math.floor((x - CHIP_X) / (CHIP_W + CHIP_GAP));
  return i >= 0 && i < n && x - CHIP_X - i * (CHIP_W + CHIP_GAP) <= CHIP_W ? i : -1;
}

function flaskPath(ctx: CanvasRenderingContext2D) {
  ctx.beginPath();
  ctx.moveTo(BX - NECK_HW, NECK_TOP);
  ctx.lineTo(BX - NECK_HW, NECK_BOT);
  ctx.lineTo(BX - BASE_HW, FLASK_BOT - 4);
  ctx.quadraticCurveTo(BX - BASE_HW, FLASK_BOT, BX - BASE_HW + 5, FLASK_BOT);
  ctx.lineTo(BX + BASE_HW - 5, FLASK_BOT);
  ctx.quadraticCurveTo(BX + BASE_HW, FLASK_BOT, BX + BASE_HW, FLASK_BOT - 4);
  ctx.lineTo(BX + NECK_HW, NECK_BOT);
  ctx.lineTo(BX + NECK_HW, NECK_TOP);
}

function drawApparatus(ctx: CanvasRenderingContext2D, p: SimParams, s: TitrState, look: Look) {
  const k = setup(p);
  const v = s.v;
  const ph = phAt(k.kind, k.ca, k.va, k.cb, v);
  const ind = indicatorOf(p);
  const flowing = s.t > 0 && !s.done;

  // Stand, base and clamp.
  ctx.save();
  ctx.fillStyle = look.cardEdge;
  ctx.beginPath();
  ctx.roundRect(8, 364, 150, 8, 3);
  ctx.fill();
  ctx.restore();
  line(ctx, 20, 8, 20, 364, look.muted, 4);
  line(ctx, 20, 120, BX - 10, 120, look.muted, 3);
  ctx.save();
  ctx.fillStyle = look.muted;
  ctx.fillRect(BX - 13, 114, 5, 12);
  ctx.fillRect(BX + 8, 114, 5, 12);
  ctx.restore();

  // Burette: titrant from the meniscus down to the tap.
  const tint = mix(look.card, look.blue, look.dark ? 0.22 : 0.14);
  const meniscus = ZERO_Y + v * PX_PER_ML;
  ctx.save();
  ctx.fillStyle = tint;
  ctx.fillRect(BX - 7, meniscus, 14, TUBE_BOT - meniscus);
  ctx.beginPath();
  ctx.moveTo(BX - 7, TUBE_BOT);
  ctx.lineTo(BX - 2.5, TAP_Y - 4);
  ctx.lineTo(BX + 2.5, TAP_Y - 4);
  ctx.lineTo(BX + 7, TUBE_BOT);
  ctx.fill();
  ctx.restore();
  line(ctx, BX - 7, meniscus, BX + 7, meniscus, look.blue, 1.6);
  // Tube outline.
  ctx.save();
  ctx.strokeStyle = look.muted;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(BX - 8, TUBE_TOP);
  ctx.lineTo(BX - 8, TUBE_BOT);
  ctx.lineTo(BX - 3, TAP_Y - 4);
  ctx.moveTo(BX + 8, TUBE_TOP);
  ctx.lineTo(BX + 8, TUBE_BOT);
  ctx.lineTo(BX + 3, TAP_Y - 4);
  ctx.moveTo(BX - 2, TAP_Y + 4);
  ctx.lineTo(BX - 1, JET_TIP);
  ctx.moveTo(BX + 2, TAP_Y + 4);
  ctx.lineTo(BX + 1, JET_TIP);
  ctx.stroke();
  ctx.restore();
  // Graduations: every mL, labelled every 10.
  for (let m = 0; m <= BURETTE; m++) {
    const y = ZERO_Y + m * PX_PER_ML;
    const long = m % 5 === 0;
    line(ctx, BX - 8, y, BX - 8 + (long ? 6 : 3), y, look.faint, 1);
    if (m % 10 === 0) text(ctx, String(m), BX - 12, y, { size: 8, color: look.muted, align: 'right' });
  }
  // Tap: a barrel with a handle, turned to vertical (open) while titrant is running.
  ctx.save();
  ctx.fillStyle = look.card;
  ctx.strokeStyle = look.ink;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.roundRect(BX - 6, TAP_Y - 5, 12, 10, 3);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  if (flowing) line(ctx, BX, TAP_Y - 13, BX, TAP_Y + 13, look.orange, 4);
  else line(ctx, BX - 18, TAP_Y, BX + 18, TAP_Y, look.orange, 4);

  // Flask with the solution, coloured by the indicator.
  const vol = k.va + v;
  const level = FLASK_BOT - 6 - (vol / 120) * 52;
  ctx.save();
  flaskPath(ctx);
  ctx.clip();
  ctx.fillStyle = solutionColor(ind, ph, look);
  ctx.fillRect(BX - BASE_HW - 2, level, BASE_HW * 2 + 4, FLASK_BOT - level + 2);
  ctx.restore();
  ctx.save();
  flaskPath(ctx);
  ctx.strokeStyle = look.muted;
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.restore();
  line(ctx, BX - NECK_HW - 2, NECK_TOP, BX + NECK_HW + 2, NECK_TOP, look.muted, 1.8);
  // A drop falling from the jet while it runs.
  if (flowing) {
    const f = (s.drip * 2.6) % 1;
    const dy = JET_TIP + 3 + f * (level - JET_TIP - 6);
    ctx.beginPath();
    ctx.ellipse(BX, dy, 2.2, 3, 0, 0, Math.PI * 2);
    ctx.fillStyle = mix(look.card, look.blue, 0.45);
    ctx.fill();
  }

  // Labels between the apparatus and the plot.
  const lx = 104;
  text(ctx, BASE[k.kind].text, lx, TAP_Y + 2, { size: 11, weight: 700, color: look.ink });
  text(ctx, `${fmt(k.cb)} mol/L`, lx, TAP_Y + 15, { size: 9.5, color: look.muted });
  line(ctx, BX + 9, meniscus, lx - 3, meniscus, look.faint, 1, [2, 2]);
  label(ctx, `${mL(v)} mL`, lx, meniscus, look, { size: 10, align: 'left', color: look.blue });
  text(ctx, `pH ${ph2(ph)}`, 180, 290, { size: 19, weight: 750, color: look.ink, align: 'center' });
  text(ctx, REGION_TEXT(k.kind, regionOf(v, k.veq)), 180, 309, { size: 9.5, weight: 600, color: look.muted, align: 'center' });
  text(ctx, ACID[k.kind].text, 180, 330, { size: 11, weight: 700, color: look.ink, align: 'center' });
  text(ctx, `${fmt(k.va)} mL · ${fmt(k.ca)} mol/L`, 180, 344, { size: 9.5, color: look.muted, align: 'center' });
  const ic = indicatorColor(ind, ph, look);
  text(ctx, `${INDICATORS[ind].name}: ${ic.name}`, 180, 358, { size: 8.5, color: look.faint, align: 'center' });
}

function drawCurve(ctx: CanvasRenderingContext2D, p: SimParams, s: TitrState, look: Look) {
  const k = setup(p);
  const ind = indicatorOf(p);
  const { x, y, w, h } = PLOT;

  // Indicator colour-change band.
  if (ind !== 'univ') {
    const I = INDICATORS[ind];
    const c = ind === 'phph' ? pink(look) : look.orange;
    ctx.save();
    ctx.fillStyle = mix(look.card, c, look.dark ? 0.25 : 0.18);
    ctx.fillRect(x, py(I.hi), w, py(I.lo) - py(I.hi));
    ctx.restore();
    text(ctx, `${I.name} ${I.range}`, x + w - 4, py(I.hi) - 6, { size: 8.5, weight: 600, color: look.muted, align: 'right' });
  }
  // Axes and grid.
  ctx.save();
  ctx.strokeStyle = look.cardEdge;
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
  for (let ph = 0; ph <= 14; ph += 2) {
    if (ph > 0 && ph < 14) line(ctx, x, py(ph), x + w, py(ph), look.cardEdge, 1);
    text(ctx, String(ph), x - 5, py(ph), { size: 8.5, color: look.muted, align: 'right' });
  }
  line(ctx, x, py(7), x + w, py(7), look.faint, 1, [3, 3]);
  for (let m = 0; m <= BURETTE; m += 10) {
    text(ctx, String(m), px(m), y + h + 9, { size: 8.5, color: look.muted, align: 'center' });
  }
  text(ctx, 'pH', x - 5, y - 8, { size: 9, weight: 650, color: look.muted, align: 'right' });
  text(ctx, `${BASE[k.kind].text} added (mL)`, x + w, y + h + 21, { size: 9, weight: 600, color: look.muted, align: 'right' });

  // The full curve, faint, then the part already run in, bold.
  const N = 500;
  const pts: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const v = (i / N) * BURETTE;
    pts.push([v, phAt(k.kind, k.ca, k.va, k.cb, v)]);
  }
  // Extra points through the steep part so the jump is drawn sharply.
  const steep: [number, number][] = [];
  for (let i = -20; i <= 20; i++) {
    const v = k.veq + i * 0.01;
    if (v > 0 && v < BURETTE) steep.push([v, phAt(k.kind, k.ca, k.va, k.cb, v)]);
  }
  const all = [...pts, ...steep].sort((a, b) => a[0] - b[0]);
  const path = (upTo: number) => {
    ctx.beginPath();
    let first = true;
    for (const [v, ph] of all) {
      if (v > upTo) break;
      if (first) ctx.moveTo(px(v), py(ph));
      else ctx.lineTo(px(v), py(ph));
      first = false;
    }
    if (upTo < BURETTE) ctx.lineTo(px(upTo), py(phAt(k.kind, k.ca, k.va, k.cb, upTo)));
  };
  ctx.save();
  ctx.lineJoin = 'round';
  path(BURETTE);
  ctx.strokeStyle = look.faint;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (s.v > 0) {
    path(s.v);
    ctx.strokeStyle = look.blue;
    ctx.lineWidth = 2.4;
    ctx.stroke();
  }
  ctx.restore();

  // Equivalence point, and the half-way point where pH = pKa.
  if (k.veq <= BURETTE) {
    const phe = phAt(k.kind, k.ca, k.va, k.cb, k.veq);
    line(ctx, px(k.veq), py(phe), px(k.veq), y + h, look.red, 1, [3, 3]);
    ctx.beginPath();
    ctx.arc(px(k.veq), py(phe), 4, 0, Math.PI * 2);
    ctx.fillStyle = look.red;
    ctx.fill();
    const right = k.veq <= 25;
    label(ctx, `equivalence ${fmt(k.veq)} mL, pH ${ph2(phe)}`, px(k.veq) + (right ? 8 : -8), py(phe), look, { size: 9.5, color: look.red, align: right ? 'left' : 'right' });
  } else {
    label(ctx, `Equivalence at ${fmt(k.veq)} mL: beyond the ${BURETTE} mL burette`, x + w / 2, y + 16, look, { size: 9.5, color: look.red });
  }
  const half = k.kind === 'wa-sb' ? k.veq / 2 : k.kind === 'sa-wb' ? 2 * k.veq : NaN;
  if (Number.isFinite(half) && half <= BURETTE) {
    const phh = phAt(k.kind, k.ca, k.va, k.cb, half);
    ctx.beginPath();
    ctx.arc(px(half), py(phh), 3.5, 0, Math.PI * 2);
    ctx.fillStyle = look.violet;
    ctx.fill();
    const tag = k.kind === 'wa-sb' ? `½ equivalence: pH ≈ pKa = ${ph2(phh)}` : `NH₃ = NH₄⁺: pH ≈ pKa(NH₄⁺) = ${ph2(phh)}`;
    const right = half < 26;
    label(ctx, tag, px(half) + (right ? 7 : -7), py(phh) + (k.kind === 'wa-sb' ? 13 : -13), look, { size: 9, color: look.violet, align: right ? 'left' : 'right' });
  }

  // Where the titration is now.
  const ph = phAt(k.kind, k.ca, k.va, k.cb, s.v);
  ctx.beginPath();
  ctx.arc(px(s.v), py(ph), 5, 0, Math.PI * 2);
  ctx.fillStyle = solutionColor(ind, ph, look);
  ctx.fill();
  ctx.strokeStyle = look.ink;
  ctx.lineWidth = 1.8;
  ctx.stroke();

  // Indicator advice.
  if (!suitable(k.kind, ind)) {
    const why = ind === 'univ' ? 'Universal: no sharp colour change' : ind === 'mo' ? 'Methyl orange changes too early' : 'Phenolphthalein changes too late';
    text(ctx, `⚠ ${why}`, x, y + h + 21, { size: 9, weight: 650, color: look.orange });
  }

  chipRow(ctx, ROW1, 'Mix', KIND_CHIPS, k.kind, look);
  chipRow(ctx, ROW2, 'Indicator', IND_CHIPS, ind, look, [pink(look), look.orange, look.green]);
}

// --- pH scale ---------------------------------------------------------------------------------

const SUBSTANCES: { key: string; name: string; ph: number }[] = [
  { key: 'battery', name: 'Battery acid', ph: 0.8 },
  { key: 'stomach', name: 'Stomach acid', ph: 1.5 },
  { key: 'lemon', name: 'Lemon juice', ph: 2.3 },
  { key: 'cola', name: 'Cola', ph: 2.5 },
  { key: 'vinegar', name: 'Vinegar', ph: 2.9 },
  { key: 'orange', name: 'Orange juice', ph: 3.5 },
  { key: 'tomato', name: 'Tomato juice', ph: 4.2 },
  { key: 'coffee', name: 'Black coffee', ph: 5.0 },
  { key: 'rain', name: 'Clean rain', ph: 5.6 },
  { key: 'milk', name: 'Milk', ph: 6.6 },
  { key: 'water', name: 'Pure water', ph: 7.0 },
  { key: 'blood', name: 'Blood', ph: 7.4 },
  { key: 'sea', name: 'Sea water', ph: 8.1 },
  { key: 'soda', name: 'Baking soda', ph: 8.3 },
  { key: 'magnesia', name: 'Milk of magnesia', ph: 10.5 },
  { key: 'ammonia', name: 'Household ammonia', ph: 11.5 },
  { key: 'bleach', name: 'Bleach', ph: 12.5 },
  { key: 'drain', name: 'Drain cleaner', ph: 13.5 },
];

const BAR = { x: 24, y: 34, w: 512, h: 20 };
const TILE = { x: 14, y: 100, w: 122, h: 32, gap: 4, cols: 3 };
const barX = (ph: number) => BAR.x + (ph / 14) * BAR.w;

function scaleValue(p: SimParams): { ph: number; name: string } {
  const sub = SUBSTANCES.find((x) => x.key === str(p, 'sub'));
  if (sub) return { ph: sub.ph, name: sub.name };
  return { ph: Math.max(0, Math.min(14, num(p, 'ph', 7))), name: 'Solution' };
}

function nature(ph: number) {
  if (Math.abs(ph - 7) < 0.05) return 'Neutral';
  if (ph < 7) return ph < 3 ? 'Strongly acidic' : ph < 6 ? 'Acidic' : 'Weakly acidic';
  return ph > 11 ? 'Strongly alkaline' : ph > 8 ? 'Alkaline' : 'Weakly alkaline';
}

function drawScale(ctx: CanvasRenderingContext2D, p: SimParams, look: Look) {
  const ind = indicatorOf(p);
  const { ph, name } = scaleValue(p);
  const stops = universalStops(look);
  for (let i = 0; i < BAR.w; i++) {
    ctx.fillStyle = mix(look.card, ramp(stops, (i / BAR.w) * 14), 0.75);
    ctx.fillRect(BAR.x + i, BAR.y, 1.2, BAR.h);
  }
  ctx.save();
  ctx.strokeStyle = look.cardEdge;
  ctx.strokeRect(BAR.x, BAR.y, BAR.w, BAR.h);
  ctx.restore();
  for (let k = 0; k <= 14; k++) {
    line(ctx, barX(k), BAR.y + BAR.h, barX(k), BAR.y + BAR.h + 4, look.muted, 1);
    text(ctx, String(k), barX(k), BAR.y + BAR.h + 12, { size: 9, weight: 600, color: look.muted, align: 'center' });
  }
  text(ctx, '← more acidic', BAR.x, BAR.y + BAR.h + 26, { size: 9, color: look.red });
  text(ctx, 'neutral', barX(7), BAR.y + BAR.h + 26, { size: 9, color: look.green, align: 'center' });
  text(ctx, 'more alkaline →', BAR.x + BAR.w, BAR.y + BAR.h + 26, { size: 9, color: look.violet, align: 'right' });
  // Pointer at the chosen pH.
  const mx = barX(ph);
  ctx.beginPath();
  ctx.moveTo(mx, BAR.y - 1);
  ctx.lineTo(mx - 6, BAR.y - 10);
  ctx.lineTo(mx + 6, BAR.y - 10);
  ctx.closePath();
  ctx.fillStyle = look.ink;
  ctx.fill();
  const tag = `${name} · pH ${ph.toFixed(1)}`;
  label(ctx, tag, Math.max(BAR.x + 60, Math.min(BAR.x + BAR.w - 60, mx)), BAR.y - 18, look, { size: 10 });

  // Substance tiles.
  SUBSTANCES.forEach((sub, i) => {
    const col = i % TILE.cols;
    const row = Math.floor(i / TILE.cols);
    const x = TILE.x + col * (TILE.w + TILE.gap);
    const y = TILE.y + row * (TILE.h + TILE.gap);
    const on = str(p, 'sub') === sub.key;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, TILE.w, TILE.h, 6);
    ctx.fillStyle = on ? mix(look.card, look.blue, 0.16) : look.card;
    ctx.fill();
    ctx.strokeStyle = on ? look.blue : look.cardEdge;
    ctx.lineWidth = on ? 1.8 : 1;
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(x + 6, y + 8, 16, 16, 4);
    ctx.fillStyle = mix(look.card, ramp(stops, sub.ph), 0.8);
    ctx.fill();
    ctx.restore();
    text(ctx, sub.name, x + 27, y + 11.5, { size: 9, weight: 650, color: look.ink });
    text(ctx, `pH ${sub.ph.toFixed(1)}`, x + 28, y + 23, { size: 9, color: look.muted });
  });

  // Test tube of the chosen solution with the chosen indicator.
  const bx = 404;
  const by = 104;
  const bw = 46;
  const bh = 150;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(bx, by + bh - bw / 2);
  ctx.arc(bx + bw / 2, by + bh - bw / 2, bw / 2, Math.PI, 0, true);
  ctx.lineTo(bx + bw, by);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = solutionColor(ind, ph, look);
  ctx.fillRect(bx - 2, by + 40, bw + 4, bh);
  ctx.restore();
  ctx.strokeStyle = look.muted;
  ctx.lineWidth = 1.8;
  ctx.stroke();
  ctx.restore();
  line(ctx, bx - 4, by, bx + bw + 4, by, look.muted, 1.8);
  const ic = indicatorColor(ind, ph, look);
  const tx = bx + bw + 14;
  text(ctx, `pH ${ph.toFixed(1)}`, tx, by + 12, { size: 18, weight: 750, color: look.ink });
  text(ctx, nature(ph), tx, by + 32, { size: 10, weight: 600, color: look.muted });
  text(ctx, '[H⁺] mol/L', tx, by + 54, { size: 8.5, color: look.faint });
  text(ctx, sci(10 ** -ph), tx, by + 66, { size: 10, weight: 600, color: look.ink });
  text(ctx, '[OH⁻] mol/L', tx, by + 84, { size: 8.5, color: look.faint });
  text(ctx, sci(10 ** -(14 - ph)), tx, by + 96, { size: 10, weight: 600, color: look.ink });
  text(ctx, INDICATORS[ind].name, tx, by + 118, { size: 8.5, color: look.faint });
  text(ctx, ic.name, tx, by + 130, { size: 10, weight: 650, color: look.ink });

  chipRow(ctx, ROW2, 'Indicator', IND_CHIPS, ind, look, [pink(look), look.orange, look.green]);
  text(ctx, 'Tap a substance, or drag along the scale', TILE.x, ROW2 + CHIP_H / 2, { size: 9, color: look.faint });
}

// --- definition ---------------------------------------------------------------------------------

interface TitrState extends SimState {
  /** Titrant run in so far, mL. Starts at the chosen reading; play adds to it. */
  v: number;
  drip: number;
}

// Whole twentieths of a mL, worked out as integers so 4.6 is stored as 4.6, not 4.6000000000000005.
const snap = (v: number) => Math.max(0, Math.min(BURETTE, Math.round(v * 20) / 20));

function grab(p: SimParams, s: TitrState, x: number, y: number): SimGrab | null {
  // Chips keep the titrant already run in, so switching does not start the titration over.
  const keep: SimParams = isScale(p) ? {} : { vb: snap(s.v) };
  const ki = chipAt(x, y, ROW2, IND_CHIPS.length);
  if (ki >= 0) return { tap: { indicator: IND_CHIPS[ki].value, ...keep }, hint: IND_CHIPS[ki].label };
  if (isScale(p)) {
    if (y >= BAR.y - 22 && y <= BAR.y + BAR.h + 8 && x >= BAR.x - 6 && x <= BAR.x + BAR.w + 6) {
      const at = (xx: number) => ({ sub: '', ph: Math.round(Math.max(0, Math.min(14, ((xx - BAR.x) / BAR.w) * 14)) * 10) / 10 });
      return { drag: (xx) => at(xx), tap: at(x), hint: 'Drag along the pH scale' };
    }
    const col = Math.floor((x - TILE.x) / (TILE.w + TILE.gap));
    const row = Math.floor((y - TILE.y) / (TILE.h + TILE.gap));
    const i = row * TILE.cols + col;
    if (col >= 0 && col < TILE.cols && row >= 0 && i < SUBSTANCES.length && y >= TILE.y) {
      const sub = SUBSTANCES[i];
      return { tap: { sub: sub.key }, hint: `${sub.name}: pH ${sub.ph.toFixed(1)}` };
    }
    return null;
  }
  const kc = chipAt(x, y, ROW1, KIND_CHIPS.length);
  if (kc >= 0) return { tap: { kind: KIND_CHIPS[kc].value, ...keep }, hint: KIND_CHIPS[kc].label };
  // The tap: drag right or down to run titrant in, 0.05 mL per pixel; back to take it out.
  if (x >= BX - 22 && x <= BX + 22 && y >= TAP_Y - 14 && y <= TAP_Y + 14) {
    const v0 = s.v;
    return { cursor: 'ew-resize', drag: (xx, yy) => ({ vb: snap(v0 + (xx - x + (yy - y)) * 0.05) }), hint: 'Drag the tap right to run titrant in' };
  }
  // The tube: drag the meniscus to a reading.
  if (x >= BX - 14 && x <= BX + 14 && y >= TUBE_TOP && y <= TUBE_BOT) {
    return { cursor: 'ns-resize', drag: (_xx, yy) => ({ vb: snap((yy - ZERO_Y) / PX_PER_ML) }), hint: 'Drag to set the burette reading' };
  }
  // The curve: scrub along the volume axis.
  if (x >= PLOT.x && x <= PLOT.x + PLOT.w && y >= PLOT.y && y <= PLOT.y + PLOT.h) {
    const at = (xx: number) => ({ vb: snap(((xx - PLOT.x) / PLOT.w) * BURETTE) });
    return { cursor: 'col-resize', tap: at(x), drag: (xx) => at(xx), hint: 'Drag along the curve' };
  }
  return null;
}

function titrationFormulas(p: SimParams): Formula[] {
  const k = setup(p);
  const v = num(p, 'vb', 0);
  const A = ACID[k.kind].tex;
  const B = BASE[k.kind].tex;
  const nA = k.ca * k.va; // mmol
  const nB = k.cb * v;
  const V = k.va + v;
  const ph = phAt(k.kind, k.ca, k.va, k.cb, v);
  const out: Formula[] = [];
  const eq = k.kind === 'sa-sb'
    ? `\\mathrm{HCl + NaOH \\rightarrow NaCl + H_2O}`
    : k.kind === 'wa-sb'
      ? `\\mathrm{CH_3COOH + NaOH \\rightarrow CH_3COONa + H_2O}`
      : `\\mathrm{HCl + NH_3 \\rightarrow NH_4Cl}`;
  out.push({ label: 'Reaction (1 : 1)', tex: eq });
  out.push({
    label: 'Equivalence volume',
    tex: `V_{eq} = \\dfrac{c_a V_a}{c_b} = \\dfrac{${tf(k.ca)} \\times ${tf(k.va)}}{${tf(k.cb)}} = ${tf(k.veq)}\\ \\text{mL}`,
  });
  const r = regionOf(v, k.veq);
  const pKa = -Math.log10(KA_ACETIC);
  const pKaNH4 = -Math.log10(KW / KB_AMMONIA);
  if (r === 'start') {
    if (k.kind === 'wa-sb') {
      out.push({ label: 'Weak acid alone', tex: `[\\mathrm{H^+}] \\approx \\sqrt{K_a c_a} = \\sqrt{1.8\\times10^{-5} \\times ${tf(k.ca)}},\\ \\ \\text{pH} \\approx ${tf(-Math.log10(Math.sqrt(KA_ACETIC * k.ca)))}` });
    } else {
      out.push({ label: 'Strong acid alone', tex: `\\text{pH} = -\\log ${tf(k.ca)} = ${tf(-Math.log10(k.ca))}` });
    }
  } else if (r === 'before') {
    if (k.kind === 'wa-sb') {
      out.push({
        label: 'Buffer: Henderson–Hasselbalch',
        tex: `\\text{pH} = \\text{p}K_a + \\log\\dfrac{n(\\mathrm{CH_3COO^-})}{n(\\mathrm{CH_3COOH})} = ${tf(pKa)} + \\log\\dfrac{${tf(nB)}}{${tf(nA - nB)}} = ${tf(pKa + Math.log10(nB / (nA - nB)))}`,
      });
    } else {
      out.push({
        label: 'Acid left over',
        tex: `[\\mathrm{H^+}] = \\dfrac{n_a - n_b}{V} = \\dfrac{${tf(nA)} - ${tf(nB)}}{${tf(V)}} = ${sciTex((nA - nB) / V)}`,
      });
    }
  } else if (r === 'equivalence') {
    const c = nA / V;
    if (k.kind === 'sa-sb') out.push({ label: 'Salt of strong acid and strong base', tex: `\\text{pH} = 7.00` });
    else if (k.kind === 'wa-sb') {
      out.push({ label: 'Ethanoate ions are basic', tex: `[\\mathrm{OH^-}] = \\sqrt{\\dfrac{K_w}{K_a} c} = \\sqrt{5.56\\times10^{-10} \\times ${tf(c)}},\\ \\ \\text{pH} \\approx ${tf(14 + Math.log10(Math.sqrt((KW / KA_ACETIC) * c)))}` });
    } else {
      out.push({ label: 'Ammonium ions are acidic', tex: `[\\mathrm{H^+}] = \\sqrt{\\dfrac{K_w}{K_b} c} = \\sqrt{5.56\\times10^{-10} \\times ${tf(c)}},\\ \\ \\text{pH} \\approx ${tf(-Math.log10(Math.sqrt((KW / KB_AMMONIA) * c)))}` });
    }
  } else if (k.kind === 'sa-wb') {
    out.push({
      label: 'Buffer of NH₃ and NH₄⁺',
      tex: `\\text{pH} = \\text{p}K_a(\\mathrm{NH_4^+}) + \\log\\dfrac{n(\\mathrm{NH_3})}{n(\\mathrm{NH_4^+})} = ${tf(pKaNH4)} + \\log\\dfrac{${tf(nB - nA)}}{${tf(nA)}} = ${tf(pKaNH4 + Math.log10((nB - nA) / nA))}`,
    });
  } else {
    out.push({
      label: 'Alkali in excess',
      tex: `[\\mathrm{OH^-}] = \\dfrac{n_b - n_a}{V} = \\dfrac{${tf(nB)} - ${tf(nA)}}{${tf(V)}},\\ \\ \\text{pH} = 14 + \\log[\\mathrm{OH^-}] = ${tf(14 + Math.log10((nB - nA) / V))}`,
    });
  }
  out.push({ label: `Exact (charge balance) at ${tf(v)} mL of ${BASE[k.kind].text}`, tex: `\\text{pH} = ${ph.toFixed(2)},\\quad n(${A}) = ${tf(nA)}\\ \\text{mmol},\\ n(${B}) = ${tf(nB)}\\ \\text{mmol}` });
  if (k.kind === 'wa-sb') out.push({ label: 'Ethanoic acid', tex: `K_a = 1.8\\times10^{-5},\\quad \\text{p}K_a = ${tf(pKa)}` });
  if (k.kind === 'sa-wb') out.push({ label: 'Ammonia', tex: `K_b = 1.8\\times10^{-5},\\quad \\text{p}K_a(\\mathrm{NH_4^+}) = ${tf(pKaNH4)}` });
  return out;
}

export const titrationSim: SimDef<TitrState> = {
  label: 'Acids, bases & titration',
  subject: 'Chemistry',
  display: ['indicator'],
  keywords: 'acid base alkali titration burette pipette conical flask neutralisation neutralization ph curve indicator phenolphthalein methyl orange universal equivalence end point buffer henderson hasselbalch pka ethanoic acetic ammonia ph scale',
  blurb: 'Titration curves, indicators, buffers, the pH scale',
  defaults: { setup: 'titration', kind: 'sa-sb', ca: 0.1, va: 25, cb: 0.1, vb: 0, indicator: 'phph', sub: 'lemon', ph: 7 },
  controls: [
    { key: 'setup', label: 'Show', type: 'choice', options: [{ value: 'titration', label: 'Titration' }, { value: 'scale', label: 'pH scale' }] },
    {
      key: 'kind', label: 'Acid and alkali', type: 'choice', show: isTitration, options: [
        { value: 'sa-sb', label: 'HCl + NaOH (strong, strong)' },
        { value: 'wa-sb', label: 'Ethanoic acid + NaOH (weak, strong)' },
        { value: 'sa-wb', label: 'HCl + ammonia (strong, weak)' },
      ],
    },
    { key: 'ca', label: 'Acid concentration', type: 'range', min: 0.01, max: 1, step: 0.01, unit: 'mol/L', show: isTitration },
    { key: 'va', label: 'Acid volume', type: 'range', min: 5, max: 50, step: 5, unit: 'mL', show: isTitration },
    { key: 'cb', label: 'Alkali concentration', type: 'range', min: 0.01, max: 1, step: 0.01, unit: 'mol/L', show: isTitration },
    { key: 'vb', label: 'Alkali added', type: 'range', min: 0, max: BURETTE, step: 0.05, unit: 'mL', show: isTitration },
    {
      key: 'indicator', label: 'Indicator', type: 'choice', options: IND_CHIPS.map((c) => ({ value: c.value, label: c.label })),
    },
    {
      key: 'sub', label: 'Substance', type: 'choice', show: isScale,
      options: [...SUBSTANCES.map((s) => ({ value: s.key, label: `${s.name} (${s.ph.toFixed(1)})` })), { value: '', label: 'Any pH (slider)' }],
    },
    { key: 'ph', label: 'pH', type: 'range', min: 0, max: 14, step: 0.1, show: (p) => isScale(p) && !SUBSTANCES.some((s) => s.key === str(p, 'sub')) },
  ],
  presets: [
    { label: 'HCl + NaOH, phenolphthalein', params: { setup: 'titration', kind: 'sa-sb', ca: 0.1, va: 25, cb: 0.1, vb: 0, indicator: 'phph' } },
    { label: 'Ethanoic acid: half-way, pH = pKa', params: { setup: 'titration', kind: 'wa-sb', ca: 0.1, va: 25, cb: 0.1, vb: 12.5, indicator: 'phph' } },
    { label: 'HCl + ammonia, methyl orange', params: { setup: 'titration', kind: 'sa-wb', ca: 0.1, va: 25, cb: 0.1, vb: 0, indicator: 'mo' } },
    { label: 'Wrong indicator: weak acid', params: { setup: 'titration', kind: 'wa-sb', ca: 0.1, va: 25, cb: 0.1, vb: 24, indicator: 'mo' } },
    { label: 'Dilute: 0.01 M with universal', params: { setup: 'titration', kind: 'sa-sb', ca: 0.01, va: 20, cb: 0.01, vb: 0, indicator: 'univ' } },
    { label: 'pH of everyday substances', params: { setup: 'scale', sub: 'lemon', indicator: 'univ' } },
  ],
  title: (p) => {
    if (isScale(p)) return 'The pH scale';
    const k = kindOf(p);
    return `Titration · ${ACID[k].text} with ${BASE[k].text}`;
  },
  init: (p) => ({ t: 0, done: false, v: isScale(p) ? 0 : snap(num(p, 'vb', 0)), drip: 0 }),
  // The volume run in is kept in "Alkali added", so the slider follows play; reset empties the burette.
  commit: (p, s) => (isScale(p) ? null : { vb: snap(s.v) }),
  resetParams: { vb: 0 },
  step: (p, s, dt) => {
    s.t += dt;
    if (isScale(p)) return;
    const { veq } = setup(p);
    // Fast at first, then drop by drop near the end point, as a careful titration is done.
    const rate = Math.abs(s.v - veq) < 1.5 ? 0.3 : 2.5;
    s.v += rate * dt;
    s.drip += dt * (rate > 1 ? 2 : 1);
    if (s.v >= BURETTE) {
      s.v = BURETTE;
      s.done = true;
    }
  },
  draw: (ctx, p, s, look) => {
    if (isScale(p)) {
      drawScale(ctx, p, look);
      return;
    }
    drawApparatus(ctx, p, s, look);
    drawCurve(ctx, p, s, look);
  },
  readouts: (p, s) => {
    const ind = indicatorOf(p);
    if (isScale(p)) {
      const { ph, name } = scaleValue(p);
      return [
        { label: 'Substance', value: name },
        { label: 'pH', value: ph.toFixed(1), color: 'blue' },
        { label: '[H⁺]', value: `${sci(10 ** -ph)} mol/L` },
        { label: 'Nature', value: nature(ph) },
        { label: INDICATORS[ind].name, value: indicatorName(ind, ph) },
      ];
    }
    const k = setup(p);
    const ph = phAt(k.kind, k.ca, k.va, k.cb, s.v);
    const out: Readout[] = [
      { label: `${BASE[k.kind].text} added`, value: `${mL(s.v)} mL`, color: 'blue' },
      { label: 'pH', value: ph2(ph) },
      { label: '[H⁺]', value: `${sci(10 ** -ph)} M` },
      { label: 'Equivalence', value: `${fmt(k.veq)} mL`, color: 'red' },
      { label: 'Stage', value: REGION_TEXT(k.kind, regionOf(s.v, k.veq)) },
      { label: INDICATORS[ind].name, value: indicatorName(ind, ph) },
    ];
    return out;
  },
  formulas: (p) => {
    if (!isScale(p)) return titrationFormulas(p);
    const { ph } = scaleValue(p);
    return [
      { label: 'pH', tex: `\\text{pH} = -\\log[\\mathrm{H^+}] \\Rightarrow [\\mathrm{H^+}] = 10^{-${tf(ph)}} = ${sciTex(10 ** -ph)}\\ \\text{mol/L}` },
      { label: 'Water', tex: `[\\mathrm{H^+}][\\mathrm{OH^-}] = K_w = 10^{-14},\\quad \\text{pOH} = 14 - ${tf(ph)} = ${tf(14 - ph)}` },
      { label: 'Each step of 1 is ten times', tex: `\\text{pH } ${tf(ph)} \\text{ has } 10^{${tf(Math.abs(7 - ph))}} = ${fmt(10 ** Math.abs(7 - ph), 3)}\\times \\text{ the } ${ph < 7 ? '[\\mathrm{H^+}]' : '[\\mathrm{OH^-}]'} \\text{ of pure water}` },
    ];
  },
  grab,
};
