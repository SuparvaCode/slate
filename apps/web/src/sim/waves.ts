/**
 * Waves: travelling waves on a string and in air, superposition, standing waves on strings and
 * in pipes, two-source interference and the Doppler effect.
 *
 * Distances are in metres and drawn at a fixed scale per setup, so the wavelength a student
 * measures with the markers matches v = fλ. Drag the two markers to measure a wavelength.
 */

import { BH, BW, arrow, label, line, num, str, text, tf, fmt } from './kit.ts';
import type { Formula, Look, Readout, SimDef, SimGrab, SimParams, SimState } from './kit.ts';

// --- the physics ------------------------------------------------------------------------------------

export const wavelength = (v: number, f: number) => v / f;
/** Frequency of the nth harmonic on a string of length L fixed at both ends, wave speed v. */
export const stringHarmonic = (n: number, v: number, L: number) => (n * v) / (2 * L);
/** Resonant frequencies of a pipe: open at both ends (any n), or closed at one end (odd n only). */
export function pipeHarmonic(n: number, v: number, L: number, closed: boolean): number {
  return closed ? ((2 * n - 1) * v) / (4 * L) : (n * v) / (2 * L);
}
/** Frequency heard: source moving towards the observer at vs (negative: away), observer still. */
export const dopplerSource = (f: number, v: number, vs: number) => (f * v) / (v - vs);
/** Path difference in wavelengths at a point, and whether it is a maximum (whole number) or minimum (half). */
export function pathDifference(x: number, y: number, s1: [number, number], s2: [number, number], lambda: number) {
  const d = Math.abs(Math.hypot(x - s1[0], y - s1[1]) - Math.hypot(x - s2[0], y - s2[1])) / lambda;
  const frac = d - Math.floor(d);
  return { d, kind: frac < 0.1 || frac > 0.9 ? 'max' : Math.abs(frac - 0.5) < 0.1 ? 'min' : 'between' as 'max' | 'min' | 'between' };
}

const SOUND = 343;

// --- layout -------------------------------------------------------------------------------------------

/** The string and the travelling waves: 2 m across 480 px. */
const X0 = 40;
const X1 = 520;
const SPAN = 2;
const PX = (X1 - X0) / SPAN;
const MID = 170;

interface WS extends SimState {
  /** Doppler: wavefront emission times and places. */
  fronts: { t: number; x: number }[];
  sx: number;
}

const setupOf = (p: SimParams) => str(p, 'setup', 'transverse');

// --- drawing ---------------------------------------------------------------------------------------------

function axis(ctx: CanvasRenderingContext2D, look: Look, y = MID) {
  line(ctx, X0 - 10, y, X1 + 10, y, look.cardEdge, 1, [4, 4]);
}

function wavePath(ctx: CanvasRenderingContext2D, f: (x: number) => number, color: string, w = 2.6, dash?: number[]) {
  ctx.save();
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  for (let px = X0; px <= X1; px += 2) {
    const y = MID - f((px - X0) / PX);
    if (px === X0) ctx.moveTo(px, y);
    else ctx.lineTo(px, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

function markers(ctx: CanvasRenderingContext2D, p: SimParams, look: Look) {
  const a = num(p, 'ma', 0.25);
  const b = num(p, 'mb', 0.75);
  const xa = X0 + a * PX;
  const xb = X0 + b * PX;
  for (const x of [xa, xb]) {
    line(ctx, x, 60, x, 300, look.violet, 1.4, [5, 4]);
    ctx.beginPath();
    ctx.moveTo(x - 7, 52);
    ctx.lineTo(x + 7, 52);
    ctx.lineTo(x, 62);
    ctx.closePath();
    ctx.fillStyle = look.violet;
    ctx.fill();
  }
  arrow(ctx, (xa + xb) / 2, 310, xa, 310, look.violet, { w: 1.6 });
  arrow(ctx, (xa + xb) / 2, 310, xb, 310, look.violet, { w: 1.6 });
  label(ctx, `${fmt(Math.abs(b - a) * 100)} cm`, (xa + xb) / 2, 324, look, { color: look.violet });
}

function scaleBar(ctx: CanvasRenderingContext2D, look: Look) {
  line(ctx, X0, BH - 34, X0 + PX * 0.5, BH - 34, look.muted, 1.6);
  line(ctx, X0, BH - 38, X0, BH - 30, look.muted, 1.6);
  line(ctx, X0 + PX * 0.5, BH - 38, X0 + PX * 0.5, BH - 30, look.muted, 1.6);
  text(ctx, '50 cm', X0 + PX * 0.25, BH - 45, { size: 10, color: look.muted, align: 'center' });
}

function drawTransverse(ctx: CanvasRenderingContext2D, p: SimParams, s: WS, look: Look) {
  const A = num(p, 'A', 40);
  const f = num(p, 'f', 1);
  const lam = num(p, 'lambda', 0.5);
  const k = (2 * Math.PI) / lam;
  const w = 2 * Math.PI * f;
  axis(ctx, look);
  wavePath(ctx, (x) => A * Math.sin(k * x - w * s.t), look.blue);
  // One particle of the string, to show it only moves up and down.
  const xp = 0.6;
  const yp = A * Math.sin(k * xp - w * s.t);
  const px = X0 + xp * PX;
  line(ctx, px, MID - A - 8, px, MID + A + 8, look.faint, 1, [2, 3]);
  ctx.beginPath();
  ctx.arc(px, MID - yp, 7, 0, Math.PI * 2);
  ctx.fillStyle = look.red;
  ctx.fill();
  // Amplitude.
  const ax = X0 + (lam / 4 + ((w * s.t) / k) % lam) * PX;
  if (ax < X1 - 10) {
    arrow(ctx, ax, MID, ax, MID - A, look.orange, { w: 1.8 });
    label(ctx, 'A', ax + 12, MID - A / 2, look, { color: look.orange });
  }
  arrow(ctx, X1 - 70, 70, X1 - 10, 70, look.muted, { w: 2, tag: 'v', look });
  markers(ctx, p, look);
  scaleBar(ctx, look);
}

function drawLongitudinal(ctx: CanvasRenderingContext2D, p: SimParams, s: WS, look: Look) {
  const f = num(p, 'f', 1);
  const lam = num(p, 'lambda', 0.5);
  const k = (2 * Math.PI) / lam;
  const w = 2 * Math.PI * f;
  const amp = Math.min(0.06, lam / 7);
  // Particles in rows; each moves back and forth along the direction of travel.
  for (let row = 0; row < 9; row++) {
    const y = 95 + row * 18;
    for (let i = 0; i <= 64; i++) {
      const x0 = (i / 64) * SPAN + (row % 2) * (SPAN / 128);
      const x = x0 + amp * Math.sin(k * x0 - w * s.t);
      if (x < 0 || x > SPAN) continue;
      ctx.beginPath();
      ctx.arc(X0 + x * PX, y, 2.6, 0, Math.PI * 2);
      ctx.fillStyle = i === 32 && row === 4 ? look.red : look.ink;
      ctx.fill();
    }
  }
  // Label one compression and one rarefaction: density is highest where the slope of the displacement is most negative.
  const phase = ((w * s.t) / k) % lam;
  for (let c = phase + lam / 2; c < SPAN; c += lam) {
    const x = X0 + c * PX;
    if (x > X0 + 30 && x < X1 - 30) {
      label(ctx, 'C', x, 82, look, { color: look.blue });
      const r = x + (lam / 2) * PX;
      if (r < X1 - 10) label(ctx, 'R', r, 82, look, { color: look.orange });
    }
  }
  text(ctx, 'C compression · R rarefaction · the red particle only moves back and forth', X0, 278, { size: 10.5, color: look.muted });
  arrow(ctx, X1 - 70, 60, X1 - 10, 60, look.muted, { w: 2, tag: 'v', look });
  markers(ctx, p, look);
  scaleBar(ctx, look);
}

function drawSuperposition(ctx: CanvasRenderingContext2D, p: SimParams, s: WS, look: Look) {
  const A = num(p, 'A', 40) * 0.6;
  const f = num(p, 'f', 1);
  const lam = num(p, 'lambda', 0.5);
  const k = (2 * Math.PI) / lam;
  const w = 2 * Math.PI * f;
  const phi = (num(p, 'phase', 0) * Math.PI) / 180;
  const f2 = num(p, 'f2', 1);
  const k2 = k * (f2 / f);
  const w2 = 2 * Math.PI * f2;
  const y1 = (x: number) => A * Math.sin(k * x - w * s.t);
  const y2 = (x: number) => A * Math.sin(k2 * x - w2 * s.t + phi);
  ctx.save();
  ctx.translate(0, -70);
  axis(ctx, look);
  wavePath(ctx, y1, look.blue, 2);
  // Dashed, so both show when they line up exactly.
  wavePath(ctx, y2, look.orange, 2, [7, 5]);
  ctx.restore();
  ctx.save();
  ctx.translate(0, 90);
  axis(ctx, look);
  wavePath(ctx, (x) => y1(x) + y2(x), look.green, 3);
  ctx.restore();
  text(ctx, 'Wave 1', X0, 50, { size: 11, weight: 650, color: look.blue });
  text(ctx, 'Wave 2', X0 + 60, 50, { size: 11, weight: 650, color: look.orange });
  text(ctx, 'Sum: y = y₁ + y₂', X0, 196, { size: 11, weight: 650, color: look.green });
}

function drawString(ctx: CanvasRenderingContext2D, p: SimParams, s: WS, look: Look) {
  const n = Math.round(num(p, 'n', 2));
  const L = SPAN;
  const A = num(p, 'A', 40);
  const v = num(p, 'v', 20);
  const f = stringHarmonic(n, v, L);
  // Slowed down so the motion is visible: one oscillation every 1.2 s on screen.
  const ph = (2 * Math.PI * s.t) / 1.2;
  axis(ctx, look);
  const shape = (x: number) => A * Math.sin((n * Math.PI * x) / L);
  ctx.save();
  ctx.globalAlpha = 0.25;
  wavePath(ctx, shape, look.blue, 1.6);
  wavePath(ctx, (x) => -shape(x), look.blue, 1.6);
  ctx.restore();
  wavePath(ctx, (x) => shape(x) * Math.cos(ph), look.blue);
  for (let k = 0; k <= n; k++) {
    const x = X0 + (k / n) * (X1 - X0);
    ctx.beginPath();
    ctx.arc(x, MID, 5, 0, Math.PI * 2);
    ctx.fillStyle = look.red;
    ctx.fill();
    if (k > 0 && k < n) label(ctx, 'N', x, MID + 22, look, { color: look.red });
    if (k < n) label(ctx, 'A', x + (X1 - X0) / n / 2, MID - A - 16, look, { color: look.green });
  }
  ctx.fillStyle = look.muted;
  ctx.fillRect(X0 - 14, MID - 50, 10, 100);
  ctx.fillRect(X1 + 4, MID - 50, 10, 100);
  text(ctx, 'N node (no motion) · A antinode · motion slowed down', X0, 280, { size: 10.5, color: look.muted });
  const lam = (2 * L) / n;
  arrow(ctx, X0 + PX * 0.05, 310, X0, 310, look.violet, { w: 1.6 });
  arrow(ctx, X0, 310, X0 + lam * PX, 310, look.violet, { w: 1.6 });
  label(ctx, `λ = 2L/n = ${fmt(lam * 100)} cm`, X0 + (lam * PX) / 2, 324, look, { color: look.violet });
  text(ctx, `f${n === 1 ? '₁' : `${'₀₁₂₃₄₅₆₇₈₉'[n] ?? ''}`} = ${fmt(f)} Hz`, X1, 60, { size: 13, weight: 650, color: look.ink, align: 'right' });
}

function drawPipe(ctx: CanvasRenderingContext2D, p: SimParams, s: WS, look: Look) {
  const n = Math.round(num(p, 'n', 1));
  const closed = str(p, 'pipe', 'open') === 'closed';
  const L = num(p, 'L', 0.8);
  const x0 = 70;
  const x1 = 490;
  const top = 120;
  const bot = 220;
  const mid = (top + bot) / 2;
  const half = (bot - top) / 2 - 8;
  ctx.fillStyle = look.dark ? '#2c2c2e' : '#f2f2f5';
  ctx.fillRect(x0, top, x1 - x0, bot - top);
  ctx.strokeStyle = look.ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x0, top);
  ctx.lineTo(x1, top);
  ctx.moveTo(x0, bot);
  ctx.lineTo(x1, bot);
  if (closed) {
    ctx.moveTo(x1, top);
    ctx.lineTo(x1, bot);
  }
  ctx.stroke();
  // Air displacement: antinode at an open end, node at a closed end.
  const k = closed ? ((2 * n - 1) * Math.PI) / (2 * (x1 - x0)) : (n * Math.PI) / (x1 - x0);
  const ph = Math.cos((2 * Math.PI * s.t) / 1.2);
  const env = (x: number) => half * Math.cos(k * (x - x0));
  ctx.save();
  ctx.globalAlpha = 0.3;
  for (const sg of [1, -1]) {
    ctx.beginPath();
    for (let x = x0; x <= x1; x += 2) {
      const y = mid - sg * env(x);
      if (x === x0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = look.blue;
    ctx.lineWidth = 1.6;
    ctx.stroke();
  }
  ctx.restore();
  ctx.beginPath();
  for (let x = x0; x <= x1; x += 2) {
    const y = mid - env(x) * ph;
    if (x === x0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = look.blue;
  ctx.lineWidth = 2.6;
  ctx.stroke();
  // Nodes where cos = 0.
  for (let m = 0; m < 12; m++) {
    const x = x0 + ((m + 0.5) * Math.PI) / k;
    if (x > x1 + 0.5) break;
    label(ctx, 'N', x, bot + 18, look, { color: look.red });
  }
  const f = pipeHarmonic(n, SOUND, L, closed);
  const harmonic = closed ? 2 * n - 1 : n;
  text(ctx, `${closed ? 'Closed' : 'Open'} pipe, L = ${fmt(L * 100)} cm`, x0, 80, { size: 13, weight: 650, color: look.ink });
  text(ctx, `Harmonic ${harmonic}: f = ${fmt(f)} Hz`, x1, 80, { size: 13, weight: 650, color: look.ink, align: 'right' });
  text(ctx, closed ? 'Closed end: displacement node. Only odd harmonics.' : 'Open ends: displacement antinodes. All harmonics.', x0, 280, { size: 10.5, color: look.muted });
}

const SRC = { y1: 140, y2: 240, x: 60 };

function drawInterference(ctx: CanvasRenderingContext2D, p: SimParams, s: WS, look: Look) {
  const lamPx = num(p, 'lambdaPx', 40);
  const d = num(p, 'sep', 100);
  const s1: [number, number] = [SRC.x, BH / 2 - d / 2];
  const s2: [number, number] = [SRC.x, BH / 2 + d / 2];
  const k = (2 * Math.PI) / lamPx;
  const w = 2 * Math.PI * 1;
  const step = 5;
  const blue = look.dark ? [10, 132, 255] : [0, 122, 255];
  const base = look.dark ? [36, 36, 38] : [255, 255, 255];
  for (let x = 0; x < BW; x += step) {
    for (let y = 0; y < BH; y += step) {
      const r1 = Math.hypot(x - s1[0], y - s1[1]);
      const r2 = Math.hypot(x - s2[0], y - s2[1]);
      const h = (Math.sin(k * r1 - w * s.t) + Math.sin(k * r2 - w * s.t)) / 2;
      const t = (h + 1) / 2;
      const c = base.map((b, i) => Math.round(b + (blue[i] - b) * t * 0.9));
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      ctx.fillRect(x, y, step, step);
    }
  }
  for (const src of [s1, s2]) {
    ctx.beginPath();
    ctx.arc(src[0], src[1], 6, 0, Math.PI * 2);
    ctx.fillStyle = look.red;
    ctx.fill();
  }
  const px = num(p, 'px', 400);
  const py = num(p, 'py', 190);
  const pd = pathDifference(px, py, s1, s2, lamPx);
  line(ctx, s1[0], s1[1], px, py, look.orange, 1.4, [4, 3]);
  line(ctx, s2[0], s2[1], px, py, look.orange, 1.4, [4, 3]);
  ctx.beginPath();
  ctx.arc(px, py, 7, 0, Math.PI * 2);
  ctx.fillStyle = look.orange;
  ctx.fill();
  label(ctx, pd.kind === 'max' ? 'Bright: in phase' : pd.kind === 'min' ? 'Quiet: out of phase' : '', px, py - 18, look, { color: look.orange });
  text(ctx, 'Drag the orange probe', 12, BH - 12, { size: 10.5, color: look.ink });
}

function drawDoppler(ctx: CanvasRenderingContext2D, p: SimParams, s: WS, look: Look) {
  const c = 120; // wave speed on screen, px/s
  const ratio = num(p, 'vs', 0.4);
  const y = BH / 2 - 10;
  ctx.strokeStyle = look.blue;
  ctx.lineWidth = 1.6;
  for (const fr of s.fronts) {
    const r = (s.t - fr.t) * c;
    if (r <= 0 || r > 700) continue;
    ctx.beginPath();
    ctx.arc(fr.x, y, r, 0, Math.PI * 2);
    ctx.globalAlpha = Math.max(0.15, 1 - r / 700);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(s.sx, y, 9, 0, Math.PI * 2);
  ctx.fillStyle = look.red;
  ctx.fill();
  if (ratio > 0) arrow(ctx, s.sx + 14, y, s.sx + 14 + 40 * ratio + 10, y, look.red, { w: 2.2, tag: 'vₛ', look });
  for (const [x, lbl] of [[BW - 34, 'Ahead'], [34, 'Behind']] as [number, string][]) {
    ctx.beginPath();
    ctx.arc(x, y, 10, 0, Math.PI * 2);
    ctx.fillStyle = look.green;
    ctx.fill();
    label(ctx, lbl, x, y + 24, look, { color: look.green });
  }
  if (ratio >= 1) label(ctx, 'Faster than the waves: a shock wave (sonic boom)', BW / 2, 30, look, { color: look.orange });
  else text(ctx, 'Wavefronts bunch up ahead (higher pitch) and spread out behind (lower pitch)', 12, BH - 12, { size: 10.5, color: look.muted });
}

// --- operating it by hand ---------------------------------------------------------------------------------

function grab(p: SimParams, _s: WS, x: number, y: number): SimGrab | null {
  const setup = setupOf(p);
  if (setup === 'transverse' || setup === 'longitudinal') {
    for (const key of ['ma', 'mb']) {
      const mx = X0 + num(p, key, key === 'ma' ? 0.25 : 0.75) * PX;
      if (Math.abs(x - mx) < 10 && y > 44 && y < 300) {
        return { cursor: 'ew-resize', hint: 'Drag to measure', drag: (bx) => ({ [key]: Math.max(0, Math.min(SPAN, Math.round(((bx - X0) / PX) * 200) / 200)) }) };
      }
    }
  }
  if (setup === 'interference' && Math.hypot(x - num(p, 'px', 400), y - num(p, 'py', 190)) < 14) {
    return { hint: 'Drag the probe', drag: (bx, by) => ({ px: Math.max(SRC.x + 30, Math.min(BW - 10, bx)), py: Math.max(10, Math.min(BH - 24, by)) }) };
  }
  return null;
}

// --- readouts and working ------------------------------------------------------------------------------------

function readouts(p: SimParams, s: WS): Readout[] {
  const setup = setupOf(p);
  if (setup === 'transverse' || setup === 'longitudinal') {
    const f = num(p, 'f', 1);
    const lam = num(p, 'lambda', 0.5);
    return [
      { label: 'Frequency', value: `${fmt(f)} Hz` },
      { label: 'Wavelength', value: `${fmt(lam * 100)} cm` },
      { label: 'Speed v = fλ', value: `${fmt(f * lam)} m/s`, color: 'blue' },
      { label: 'Period', value: `${fmt(1 / f)} s` },
      { label: 'Markers apart', value: `${fmt(Math.abs(num(p, 'mb', 0.75) - num(p, 'ma', 0.25)) * 100)} cm`, color: 'violet' },
    ];
  }
  if (setup === 'superposition') {
    const phase = num(p, 'phase', 0);
    const same = num(p, 'f2', 1) === num(p, 'f', 1);
    const kind = !same ? 'Beats' : phase % 360 === 0 ? 'Constructive' : phase % 360 === 180 ? 'Destructive' : 'Partial';
    return [
      { label: 'Phase difference', value: `${fmt(phase)}°` },
      { label: 'Result', value: kind, color: kind === 'Constructive' ? 'green' : kind === 'Destructive' ? 'red' : undefined },
      { label: 'Peak of the sum', value: same ? `${fmt(2 * Math.abs(Math.cos((phase * Math.PI) / 360)), 2)} A` : '2A, rising and falling' },
      ...(same ? [] : [{ label: 'Beat frequency', value: `${fmt(Math.abs(num(p, 'f2', 1) - num(p, 'f', 1)))} Hz` }]),
    ];
  }
  if (setup === 'string') {
    const n = Math.round(num(p, 'n', 2));
    const v = num(p, 'v', 20);
    return [
      { label: 'Harmonic', value: String(n) },
      { label: 'Wavelength', value: `${fmt((2 * SPAN) / n * 100)} cm` },
      { label: 'Frequency', value: `${fmt(stringHarmonic(n, v, SPAN))} Hz`, color: 'blue' },
      { label: 'Nodes', value: String(n + 1) },
      { label: 'Antinodes', value: String(n) },
    ];
  }
  if (setup === 'pipe') {
    const n = Math.round(num(p, 'n', 1));
    const closed = str(p, 'pipe', 'open') === 'closed';
    const L = num(p, 'L', 0.8);
    const f = pipeHarmonic(n, SOUND, L, closed);
    return [
      { label: 'Harmonic', value: String(closed ? 2 * n - 1 : n) },
      { label: 'Frequency', value: `${fmt(f)} Hz`, color: 'blue' },
      { label: 'Wavelength', value: `${fmt((SOUND / f) * 100)} cm` },
      { label: 'Fundamental', value: `${fmt(pipeHarmonic(1, SOUND, L, closed))} Hz` },
    ];
  }
  if (setup === 'interference') {
    const lamPx = num(p, 'lambdaPx', 40);
    const d = num(p, 'sep', 100);
    const pd = pathDifference(num(p, 'px', 400), num(p, 'py', 190), [SRC.x, BH / 2 - d / 2], [SRC.x, BH / 2 + d / 2], lamPx);
    return [
      { label: 'Path difference', value: `${fmt(pd.d, 2)} λ`, color: 'orange' },
      { label: 'At the probe', value: pd.kind === 'max' ? 'Maximum' : pd.kind === 'min' ? 'Minimum' : 'In between' },
      { label: 'Source gap', value: `${fmt(d / lamPx, 2)} λ` },
    ];
  }
  const f = num(p, 'f0', 440);
  const vs = num(p, 'vs', 0.4) * SOUND;
  return [
    { label: 'Source', value: `${fmt(f)} Hz` },
    { label: 'Source speed', value: `${fmt(vs)} m/s` },
    { label: 'Heard ahead', value: vs < SOUND ? `${fmt(dopplerSource(f, SOUND, vs))} Hz` : 'Shock wave', color: 'green' },
    { label: 'Heard behind', value: `${fmt(dopplerSource(f, SOUND, -vs))} Hz`, color: 'green' },
    { label: 'Elapsed', value: `${fmt(s.t, 2)} s` },
  ];
}

function formulas(p: SimParams): Formula[] {
  const setup = setupOf(p);
  if (setup === 'transverse' || setup === 'longitudinal') {
    const f = num(p, 'f', 1);
    const lam = num(p, 'lambda', 0.5);
    return [
      { label: 'Wave equation', tex: `v = f\\lambda = (${tf(f)})(${tf(lam)}) = ${tf(f * lam)}\\ \\text{m/s}` },
      { label: 'Displacement', tex: 'y = A\\sin\\left(\\frac{2\\pi x}{\\lambda} - 2\\pi f t\\right)' },
    ];
  }
  if (setup === 'superposition') {
    return [{ label: 'Principle of superposition', tex: 'y = y_1 + y_2' }, { label: 'Beats', tex: 'f_{beat} = |f_1 - f_2|' }];
  }
  if (setup === 'string') {
    const n = Math.round(num(p, 'n', 2));
    const v = num(p, 'v', 20);
    return [{ label: 'String fixed at both ends', tex: `f_n = \\frac{nv}{2L} = \\frac{${n}(${tf(v)})}{2(${tf(SPAN)})} = ${tf(stringHarmonic(n, v, SPAN))}\\ \\text{Hz}` }];
  }
  if (setup === 'pipe') {
    const closed = str(p, 'pipe', 'open') === 'closed';
    const n = Math.round(num(p, 'n', 1));
    const L = num(p, 'L', 0.8);
    const h = closed ? 2 * n - 1 : n;
    return [{
      label: closed ? 'Closed at one end (odd harmonics)' : 'Open at both ends',
      tex: `f = \\frac{${h}v}{${closed ? 4 : 2}L} = \\frac{${h}(343)}{${closed ? 4 : 2}(${tf(L)})} = ${tf(pipeHarmonic(n, SOUND, L, closed))}\\ \\text{Hz}`,
    }];
  }
  if (setup === 'interference') {
    return [
      { label: 'Maxima', tex: '\\Delta r = n\\lambda' },
      { label: 'Minima', tex: '\\Delta r = \\left(n + \\tfrac{1}{2}\\right)\\lambda' },
    ];
  }
  const f = num(p, 'f0', 440);
  const vs = num(p, 'vs', 0.4) * SOUND;
  return [
    { label: 'Moving source, still observer (ahead)', tex: `f' = f\\frac{v}{v - v_s} = ${tf(f)}\\cdot\\frac{343}{343 - ${tf(vs)}} = ${vs < SOUND ? tf(dopplerSource(f, SOUND, vs)) : '\\infty'}\\ \\text{Hz}` },
    { label: 'Behind', tex: `f' = f\\frac{v}{v + v_s} = ${tf(dopplerSource(f, SOUND, -vs))}\\ \\text{Hz}` },
  ];
}

// --- the simulator ---------------------------------------------------------------------------------------------

const SETUPS = [
  { value: 'transverse', label: 'Transverse wave' },
  { value: 'longitudinal', label: 'Longitudinal wave' },
  { value: 'superposition', label: 'Superposition' },
  { value: 'string', label: 'Standing wave: string' },
  { value: 'pipe', label: 'Standing wave: pipe' },
  { value: 'interference', label: 'Interference' },
  { value: 'doppler', label: 'Doppler effect' },
];
const is = (...k: string[]) => (p: SimParams) => k.includes(setupOf(p));

export const wavesSim: SimDef<WS> = {
  label: 'Waves',
  subject: 'Physics',
  keywords: 'wave transverse longitudinal sound wavelength frequency amplitude superposition interference standing wave harmonic node antinode pipe resonance doppler beats ripple tank',
  blurb: 'Travelling and standing waves, interference, Doppler',
  display: ['ma', 'mb', 'px', 'py'],
  autoplay: true,
  defaults: {
    setup: 'transverse', A: 40, f: 1, lambda: 0.5, f2: 1, phase: 0, n: 2, v: 20, pipe: 'open', L: 0.8,
    lambdaPx: 40, sep: 100, f0: 440, vs: 0.4, ma: 0.25, mb: 0.75, px: 400, py: 190,
  },
  controls: [
    { key: 'setup', label: 'Setup', type: 'choice', options: SETUPS },
    { key: 'A', label: 'Amplitude', type: 'range', min: 10, max: 70, step: 1, unit: 'px', show: is('transverse', 'superposition', 'string') },
    { key: 'f', label: 'Frequency', type: 'range', min: 0.2, max: 3, step: 0.1, unit: 'Hz', show: is('transverse', 'longitudinal', 'superposition') },
    { key: 'lambda', label: 'Wavelength', type: 'range', min: 0.2, max: 1.5, step: 0.05, unit: 'm', show: is('transverse', 'longitudinal', 'superposition') },
    { key: 'f2', label: 'Wave 2 frequency', type: 'range', min: 0.2, max: 3, step: 0.1, unit: 'Hz', show: is('superposition') },
    { key: 'phase', label: 'Phase difference', type: 'range', min: 0, max: 360, step: 15, unit: '°', show: is('superposition') },
    { key: 'n', label: 'Harmonic', type: 'range', min: 1, max: 6, step: 1, show: is('string', 'pipe') },
    { key: 'v', label: 'Wave speed', type: 'range', min: 5, max: 100, step: 1, unit: 'm/s', show: is('string') },
    { key: 'pipe', label: 'Pipe', type: 'choice', options: [{ value: 'open', label: 'Open both ends' }, { value: 'closed', label: 'Closed one end' }], show: is('pipe') },
    { key: 'L', label: 'Pipe length', type: 'range', min: 0.2, max: 2, step: 0.05, unit: 'm', show: is('pipe') },
    { key: 'lambdaPx', label: 'Wavelength', type: 'range', min: 20, max: 80, step: 2, unit: 'px', show: is('interference') },
    { key: 'sep', label: 'Source gap', type: 'range', min: 40, max: 220, step: 5, unit: 'px', show: is('interference') },
    { key: 'f0', label: 'Source pitch', type: 'range', min: 100, max: 1000, step: 10, unit: 'Hz', show: is('doppler') },
    { key: 'vs', label: 'Source speed', type: 'range', min: 0, max: 1.3, step: 0.05, unit: '× sound', show: is('doppler') },
  ],
  presets: [
    { label: 'Transverse', params: { setup: 'transverse' } },
    { label: 'Sound in air', params: { setup: 'longitudinal' } },
    { label: 'Constructive', params: { setup: 'superposition', phase: 0, f2: 1 } },
    { label: 'Destructive', params: { setup: 'superposition', phase: 180, f2: 1 } },
    { label: 'Beats', params: { setup: 'superposition', phase: 0, f2: 1.2 } },
    { label: 'Guitar string', params: { setup: 'string', n: 3 } },
    { label: 'Open pipe', params: { setup: 'pipe', pipe: 'open', n: 2 } },
    { label: 'Closed pipe', params: { setup: 'pipe', pipe: 'closed', n: 2 } },
    { label: 'Ripple tank', params: { setup: 'interference' } },
    { label: 'Ambulance siren', params: { setup: 'doppler', vs: 0.4 } },
    { label: 'Sonic boom', params: { setup: 'doppler', vs: 1.2 } },
  ],
  title: (p) => SETUPS.find((x) => x.value === setupOf(p))?.label ?? 'Waves',
  init: () => ({ t: 0, done: false, fronts: [], sx: 60 }),
  step: (p, s, dt) => {
    s.t += dt;
    if (setupOf(p) !== 'doppler') return;
    const c = 120;
    s.sx += num(p, 'vs', 0.4) * c * dt;
    if (s.sx > BW + 20) {
      s.sx = -20;
      s.fronts = [];
    }
    const period = 0.35;
    const last = s.fronts[s.fronts.length - 1];
    if (!last || s.t - last.t >= period) s.fronts.push({ t: s.t, x: s.sx });
    while (s.fronts.length && (s.t - s.fronts[0].t) * c > 700) s.fronts.shift();
  },
  draw: (ctx, p, s, look) => {
    const setup = setupOf(p);
    if (setup === 'transverse') drawTransverse(ctx, p, s, look);
    else if (setup === 'longitudinal') drawLongitudinal(ctx, p, s, look);
    else if (setup === 'superposition') drawSuperposition(ctx, p, s, look);
    else if (setup === 'string') drawString(ctx, p, s, look);
    else if (setup === 'pipe') drawPipe(ctx, p, s, look);
    else if (setup === 'interference') drawInterference(ctx, p, s, look);
    else drawDoppler(ctx, p, s, look);
  },
  grab,
  readouts,
  formulas,
};
