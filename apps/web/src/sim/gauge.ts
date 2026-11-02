/**
 * Measuring instruments: vernier caliper, screw gauge, ammeter and voltmeter, spring balance,
 * thermometers and a measuring cylinder, each operated by hand on the card.
 *
 * The scales are drawn from the same numbers the readings come from, so a student reading the
 * picture gets the reading in the strip. "Show the reading" off turns it into a quiz: the
 * instrument still works but the strip keeps the answer back.
 */

import { bool, fmt, label, line, num, str, text, tf } from './kit.ts';
import type { Formula, Look, Readout, SimDef, SimGrab, SimParams, SimState } from './kit.ts';

const DEG = Math.PI / 180;
const G = 9.8;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const snap = (v: number, step: number) => Math.round(v / step) * step;
const dec = (lc: number) => (lc >= 1 ? 0 : lc >= 0.1 ? 1 : lc >= 0.01 ? 2 : 3);
/** A reading to the instrument's least count, with a real minus sign. */
export const fix = (v: number, lc: number) => (Math.abs(v) < lc / 1000 ? 0 : v).toFixed(dec(lc)).replace('-', '−');

// --- readings ------------------------------------------------------------------------------------

/**
 * A vernier caliper whose vernier zero is `pos` mm along the main scale: main scale reading,
 * the vernier line that lines up with a main-scale line, and the reading MSR + k × LC.
 */
export function vernierReading(pos: number, lc: number) {
  const n = Math.round(1 / lc);
  let msr = Math.floor(pos + 1e-9);
  let k = Math.round((pos - msr) / lc);
  if (k >= n) {
    msr += 1;
    k -= n;
  }
  return { msr, k, reading: Math.round((msr + k * lc) * 1e6) / 1e6 };
}

/** A screw gauge with the thimble edge `pos` mm along the sleeve: PSR, CSR and the reading. */
export function screwReading(pos: number, pitch: number, n: number) {
  const lc = pitch / n;
  let psr = Math.floor((pos + 1e-9) / pitch) * pitch;
  let csr = Math.round((pos - psr) / lc);
  if (csr >= n) {
    psr += pitch;
    csr -= n;
  }
  return { psr: Math.round(psr * 1e6) / 1e6, csr, lc, reading: Math.round((psr + csr * lc) * 1e6) / 1e6 };
}

/** Where a meter's needle rests, as a fraction of full scale; it hits the stops just past the ends. */
export const meterFraction = (value: number, full: number) => clamp(value / full, -0.02, 1.04);

/** The measuring cylinder, in drawing-box pixels. */
export const CYL = { x0: 244, x1: 316, eyeX: 110, zeroY: 324, pxPerMl: 2.8 };

/**
 * The volume read with the eye `eyeOff` px below the meniscus (negative: above). The sight line
 * meets the scale on the front of the glass before it reaches the meniscus in the middle, so an
 * eye above the level reads high and one below reads low.
 */
export function seenVolume(vol: number, eyeOff: number): number {
  const ym = CYL.zeroY - vol * CYL.pxPerMl;
  const ye = ym + eyeOff;
  const cx = (CYL.x0 + CYL.x1) / 2;
  const yc = ye + ((ym - ye) * (CYL.x0 - CYL.eyeX)) / (cx - CYL.eyeX);
  return (CYL.zeroY - yc) / CYL.pxPerMl;
}

// --- shared drawing ------------------------------------------------------------------------------

const metal = (look: Look) => (look.dark ? '#636366' : '#d1d1d6');
const metalDark = (look: Look) => (look.dark ? '#48484a' : '#aeaeb2');
const metalLight = (look: Look) => (look.dark ? '#7c7c80' : '#ececf0');

function poly(ctx: CanvasRenderingContext2D, pts: [number, number][], fill: string, stroke: string) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

/** A slider drawn on the card, for the quantity the instrument measures. */
const SL = { x0: 150, x1: 410 };
function drawSlider(ctx: CanvasRenderingContext2D, y: number, f: number, caption: string, value: string, look: Look) {
  text(ctx, caption, SL.x0, y - 15, { size: 10.5, color: look.muted });
  text(ctx, value, SL.x1, y - 15, { size: 10.5, weight: 650, color: look.ink, align: 'right' });
  const w = SL.x1 - SL.x0;
  ctx.beginPath();
  ctx.roundRect(SL.x0, y - 3, w, 6, 3);
  ctx.fillStyle = look.cardEdge;
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(SL.x0, y - 3, w * clamp(f, 0, 1), 6, 3);
  ctx.fillStyle = look.blue;
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.arc(SL.x0 + w * clamp(f, 0, 1), y, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 4;
  ctx.fill();
  ctx.restore();
}

function sliderGrab(x: number, y: number, sy: number, hint: string, set: (f: number) => SimParams): SimGrab | null {
  if (Math.abs(y - sy) > 14 || x < SL.x0 - 14 || x > SL.x1 + 14) return null;
  return { cursor: 'ew-resize', hint, drag: (bx) => set(clamp((bx - SL.x0) / (SL.x1 - SL.x0), 0, 1)) };
}

const hint = (ctx: CanvasRenderingContext2D, s: string, look: Look, y = 368) => text(ctx, s, 14, y, { size: 10.5, color: look.faint });

// --- vernier caliper -----------------------------------------------------------------------------

const V = { x0: 66, px: 8, edge: 150, mm: 56 };
const V_OBJ: Record<string, { d: number; label: string }> = {
  none: { d: 0, label: 'Nothing' }, ball: { d: 18.4, label: 'Steel ball' }, rod: { d: 25.7, label: 'Rod' }, bead: { d: 9.3, label: 'Glass bead' },
};

function vernierState(p: SimParams) {
  const lc = Number(str(p, 'lc', '0.1')) || 0.1;
  const nv = Math.round(1 / lc);
  const obj = V_OBJ[str(p, 'obj', 'ball')] ?? V_OBJ.none;
  const maxGap = V.mm - (nv - 1) - 0.5;
  const gap = clamp(snap(Math.max(obj.d, num(p, 'gap', 18.4)), lc), 0, maxGap);
  const ze = Math.round(num(p, 'zev', 0)) * lc;
  const pos = gap + ze;
  return { lc, nv, obj, gap, ze, pos, maxGap, r: vernierReading(pos, lc) };
}

function drawVernier(ctx: CanvasRenderingContext2D, p: SimParams, look: Look) {
  const v = vernierState(p);
  const { x0, px, edge } = V;
  const show = bool(p, 'show');
  // Beam with the main scale along its lower edge, in millimetres.
  ctx.beginPath();
  ctx.roundRect(x0 - 44, 98, 548 - (x0 - 44), edge - 98, 3);
  ctx.fillStyle = metalLight(look);
  ctx.fill();
  ctx.strokeStyle = metalDark(look);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  for (let m = 0; m <= V.mm; m++) {
    const x = x0 + m * px;
    const len = m % 10 === 0 ? 20 : m % 5 === 0 ? 14 : 9;
    line(ctx, x, edge, x, edge - len, look.ink, 1);
    if (m % 10 === 0) text(ctx, String(m / 10), x, edge - 30, { size: 11.5, weight: 650, color: look.ink, align: 'center' });
  }
  text(ctx, 'cm', 536, edge - 30, { size: 10, color: look.muted, align: 'center' });
  poly(ctx, [[x0 - 30, edge], [x0, edge], [x0, 300], [x0 - 8, 300], [x0 - 30, 262]], metal(look), metalDark(look));

  if (v.obj.d > 0) {
    // Seen from the side between the jaws; tall objects are cut to the jaws' height.
    const rx = (v.obj.d * px) / 2;
    const ry = Math.min(rx, 70);
    ctx.beginPath();
    ctx.ellipse(x0 + rx, 228, rx, ry, 0, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(x0 + rx * 0.7, 210, 2, x0 + rx, 228, Math.max(rx, ry));
    g.addColorStop(0, look.dark ? '#c9b48a' : '#fff4dc');
    g.addColorStop(1, look.dark ? '#7a5c2e' : '#e0a95a');
    ctx.fillStyle = g;
    ctx.fill();
  }

  // The sliding jaw with the vernier on it.
  const F = x0 + v.gap * px;
  const vz = x0 + v.pos * px;
  const vlen = (v.nv - 1) * px;
  const left = Math.min(F, vz) - 6;
  const right = vz + vlen + 18;
  ctx.fillStyle = metalDark(look);
  ctx.fillRect(left, 92, right - left, 6);
  ctx.beginPath();
  ctx.rect(left, edge, right - left, 34);
  ctx.fillStyle = look.dark ? '#8e8e93' : '#f5f5f7';
  ctx.fill();
  ctx.strokeStyle = metalDark(look);
  ctx.stroke();
  poly(ctx, [[F, edge + 34], [F + 30, edge + 34], [F + 30, 262], [F + 8, 300], [F, 300]], metal(look), metalDark(look));
  // Numbered 0, 5, 10 on a 10-division vernier; 0, 2, 4 ... 10 (tenths of a millimetre) on a 20-division one.
  const every = v.nv === 10 ? 5 : 4;
  for (let k = 0; k <= v.nv; k++) {
    const x = vz + k * (1 - v.lc) * px;
    const len = k % (v.nv / 2) === 0 ? 16 : k % every === 0 ? 12 : 8;
    const hit = show && k === v.r.k;
    line(ctx, x, edge, x, edge + len, hit ? look.red : look.ink, hit ? 1.8 : 1);
    if (k % every === 0) text(ctx, String(v.nv === 10 ? k : k / 2), x, edge + 25, { size: 9, weight: 600, color: hit ? look.red : look.muted, align: 'center' });
  }
  if (show) {
    const x = vz + v.r.k * (1 - v.lc) * px;
    line(ctx, x, edge - 22, x, edge, look.red, 1.8);
  }
  // Thumb wheel.
  const tx = right - 10;
  ctx.beginPath();
  ctx.arc(tx, edge + 48, 9, 0, Math.PI * 2);
  ctx.fillStyle = metalDark(look);
  ctx.fill();
  for (let k = 0; k < 6; k++) line(ctx, tx - 7 + k * 2.8, edge + 41, tx - 7 + k * 2.8, edge + 55, metal(look), 1);
  text(ctx, `Least count ${v.lc} mm · ${v.nv} vernier divisions = ${v.nv - 1} mm`, 14, 40, { size: 11, weight: 600, color: look.muted });
  if (v.ze) text(ctx, v.gap === 0 ? 'Jaws closed: this reading is the zero error' : 'Zero error set: close the jaws to see it', 14, 58, { size: 10.5, color: look.orange });
  hint(ctx, 'Drag the sliding jaw or its thumb wheel', look);
}

function vernierGrab(p: SimParams, x: number, y: number): SimGrab | null {
  const v = vernierState(p);
  const F = V.x0 + v.gap * V.px;
  const right = V.x0 + v.pos * V.px + (v.nv - 1) * V.px + 18;
  if (x < Math.min(F, V.x0 + v.pos * V.px) - 8 || x > right + 4 || y < V.edge - 4 || y > 300) return null;
  const dx = x - F;
  return {
    cursor: 'ew-resize',
    hint: 'Slide the jaw',
    drag: (bx) => ({ gap: clamp(snap((bx - dx - V.x0) / V.px, v.lc), v.obj.d, v.maxGap) }),
  };
}

// --- screw gauge -----------------------------------------------------------------------------------

/** 14 px per millimetre; the frame leaves room for 7 mm between anvil and spindle. */
const S = { anvil: 112, y: 176, s0: 250, k: 14, max: 7 };
const S_OBJ: Record<string, { d: number; label: string }> = {
  none: { d: 0, label: 'Nothing' }, wire: { d: 1.27, label: 'Wire' }, sheet: { d: 0.48, label: 'Metal sheet' }, ball: { d: 6.35, label: 'Ball bearing' },
};

function screwState(p: SimParams) {
  const pitch = Number(str(p, 'pitch', '0.5')) || 0.5;
  const n = Number(str(p, 'div', '50')) || 50;
  const lc = pitch / n;
  const obj = S_OBJ[str(p, 'sobj', 'wire')] ?? S_OBJ.none;
  const gap = clamp(snap(Math.max(obj.d, num(p, 'sgap', 1.27)), lc), 0, S.max);
  const ze = Math.round(num(p, 'zes', 0)) * lc;
  const pos = gap + ze;
  return { pitch, n, lc, obj, gap, ze, pos, r: screwReading(pos, pitch, n) };
}

function drawScrew(ctx: CanvasRenderingContext2D, p: SimParams, look: Look) {
  const v = screwState(p);
  const { anvil, y, s0, k } = S;
  const frame = look.dark ? '#3a4a66' : '#4a6a9a';
  // The U-shaped frame, anvil and spindle.
  ctx.fillStyle = frame;
  ctx.beginPath();
  ctx.roundRect(44, y - 22, 30, 150, 8);
  ctx.roundRect(44, y + 104, 196, 28, 8);
  ctx.roundRect(212, y - 22, 28, 154, 8);
  ctx.fill();
  ctx.fillStyle = metal(look);
  ctx.fillRect(66, y - 9, anvil - 66, 18);
  const face = anvil + v.gap * k;
  const g = ctx.createLinearGradient(0, y - 8, 0, y + 8);
  g.addColorStop(0, metalLight(look));
  g.addColorStop(0.5, metal(look));
  g.addColorStop(1, metalDark(look));
  ctx.fillStyle = g;
  ctx.fillRect(face, y - 8, 236 - face, 16);
  if (v.obj.d > 0) {
    const w = Math.max(3, v.obj.d * k);
    ctx.fillStyle = look.dark ? '#a0783c' : '#e0a95a';
    if (str(p, 'sobj') === 'ball') {
      ctx.beginPath();
      ctx.arc(anvil + w / 2, y, w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else ctx.fillRect(anvil, y - (str(p, 'sobj') === 'sheet' ? 30 : 14), w, str(p, 'sobj') === 'sheet' ? 60 : 28);
  }
  // Sleeve with the main scale: millimetres above the line, half millimetres below.
  ctx.fillStyle = metalLight(look);
  ctx.fillRect(228, y - 17, S.s0 + S.max * k + 8 - 228, 34);
  line(ctx, 228, y, 478, y, look.ink, 1.2);
  for (let m = 0; m <= S.max; m++) {
    const x = s0 + m * k;
    line(ctx, x, y, x, y - (m % 5 === 0 ? 13 : 9), look.ink, 1);
    if (m % 5 === 0) text(ctx, String(m), x, y - 22, { size: 10, weight: 650, color: look.ink, align: 'center' });
    if (v.pitch === 0.5 && m < S.max) line(ctx, x + k / 2, y, x + k / 2, y + 8, look.ink, 1);
  }
  // Thimble, its circular scale where it meets the sleeve, and the ratchet.
  const te = s0 + v.pos * k;
  ctx.beginPath();
  ctx.moveTo(te, y - 26);
  ctx.lineTo(te + 12, y - 36);
  ctx.lineTo(te + 82, y - 36);
  ctx.lineTo(te + 82, y + 36);
  ctx.lineTo(te + 12, y + 36);
  ctx.lineTo(te, y + 26);
  ctx.closePath();
  const tg = ctx.createLinearGradient(0, y - 36, 0, y + 36);
  tg.addColorStop(0, metal(look));
  tg.addColorStop(0.45, metalLight(look));
  tg.addColorStop(1, metalDark(look));
  ctx.fillStyle = tg;
  ctx.fill();
  ctx.strokeStyle = metalDark(look);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  const c = (v.pos - v.r.psr) / v.lc;
  const every = v.n === 100 ? 10 : 5;
  const show = bool(p, 'show');
  for (let d = Math.ceil(c - v.n / 4); d <= Math.floor(c + v.n / 4); d++) {
    const phi = ((d - c) * 2 * Math.PI) / v.n;
    if (Math.cos(phi) < 0.25) continue;
    const yy = y - 26 * Math.sin(phi);
    const dd = ((d % v.n) + v.n) % v.n;
    const hit = show && dd === v.r.csr;
    line(ctx, te + 1, yy, te + (dd % every === 0 ? 15 : 9), yy, hit ? look.red : look.ink, hit ? 1.8 : 1);
    if (dd % every === 0) text(ctx, String(dd), te + 26, yy, { size: 9, weight: 650, color: hit ? look.red : look.ink, align: 'center' });
  }
  ctx.fillStyle = metalDark(look);
  ctx.fillRect(te + 82, y - 16, 26, 32);
  for (let q = 0; q < 7; q++) line(ctx, te + 85 + q * 3.4, y - 16, te + 85 + q * 3.4, y + 16, metal(look), 1);
  text(ctx, `Pitch ${v.pitch} mm · ${v.n} divisions · least count ${v.lc} mm`, 14, 40, { size: 11, weight: 600, color: look.muted });
  if (v.ze) text(ctx, v.gap === 0 ? 'Closed: this reading is the zero error' : 'Zero error set: close it to see it', 14, 58, { size: 10.5, color: look.orange });
  hint(ctx, 'Drag the thimble to turn the screw', look);
}

function screwGrab(p: SimParams, x: number, y: number): SimGrab | null {
  const v = screwState(p);
  const te = S.s0 + v.pos * S.k;
  if (x < te - 4 || x > te + 110 || Math.abs(y - S.y) > 38) return null;
  const dx = x - te;
  return {
    cursor: 'ew-resize',
    hint: 'Turn the thimble',
    drag: (bx) => ({ sgap: clamp(snap((bx - dx - S.s0) / S.k - v.ze, v.lc), v.obj.d, S.max) }),
  };
}

// --- ammeter and voltmeter -----------------------------------------------------------------------------

const M = { cx: 280, cy: 252, r: 150, slider: 346 };
const RANGES = { ammeter: ['1', '5'], voltmeter: ['3', '15'] };

function meterRange(p: SimParams, kind: 'ammeter' | 'voltmeter') {
  const r = str(p, 'range', RANGES[kind][0]);
  return Number(RANGES[kind].includes(r) ? r : RANGES[kind][0]);
}
const meterAngle = (f: number) => (-150 + 120 * f) * DEG;

function drawMeter(ctx: CanvasRenderingContext2D, p: SimParams, s: GS, look: Look, kind: 'ammeter' | 'voltmeter') {
  const full = meterRange(p, kind);
  const unit = kind === 'ammeter' ? 'A' : 'V';
  const { cx, cy, r } = M;
  ctx.beginPath();
  ctx.roundRect(96, 28, 368, 290, 18);
  ctx.fillStyle = look.dark ? '#1c1c1e' : '#fbfbf6';
  ctx.fill();
  ctx.strokeStyle = look.cardEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Mirror strip: line the needle up with its reflection to avoid parallax.
  ctx.beginPath();
  ctx.arc(cx, cy, r + 12, meterAngle(0), meterAngle(1));
  ctx.arc(cx, cy, r + 5, meterAngle(1), meterAngle(0), true);
  ctx.closePath();
  ctx.fillStyle = look.dark ? '#5a5a5e' : '#d8dde4';
  ctx.fill();
  for (let k = 0; k <= 50; k++) {
    const a = meterAngle(k / 50);
    const len = k % 10 === 0 ? 18 : k % 5 === 0 ? 12 : 7;
    line(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, cx + Math.cos(a) * (r - len), cy + Math.sin(a) * (r - len), look.ink, k % 10 === 0 ? 1.6 : 1);
    if (k % 10 === 0) text(ctx, fmt((full * k) / 50), cx + Math.cos(a) * (r - 32), cy + Math.sin(a) * (r - 32), { size: 12, weight: 650, color: look.ink, align: 'center' });
  }
  text(ctx, unit, cx, cy - 62, { size: 30, weight: 750, color: look.ink, align: 'center' });
  text(ctx, `${fmt(full / 50)} ${unit} per division`, cx, cy - 34, { size: 10, color: look.muted, align: 'center' });
  const a = meterAngle(s.th);
  line(ctx, cx - Math.cos(a) * 16, cy - Math.sin(a) * 16, cx + Math.cos(a) * (r + 8), cy + Math.sin(a) * (r + 8), look.red, 2);
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fillStyle = look.ink;
  ctx.fill();
  // Terminals: common, then one per range.
  const terms: [string, string, boolean][] = [['−', 'COM', false], ...RANGES[kind].map((v) => ['+', `${v} ${unit}`, Number(v) === full] as [string, string, boolean])];
  terms.forEach(([sign, lbl, on], i) => {
    const x = cx - 70 + i * 70;
    ctx.beginPath();
    ctx.arc(x, 290, 9, 0, Math.PI * 2);
    ctx.fillStyle = i === 0 ? (look.dark ? '#8e8e93' : '#1c1c1e') : look.red;
    ctx.fill();
    if (on || i === 0) {
      ctx.strokeStyle = look.blue;
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }
    text(ctx, sign, x, 290.5, { size: 11, weight: 800, color: '#ffffff', align: 'center' });
    text(ctx, lbl, x, 309, { size: 9.5, weight: 600, color: on || i === 0 ? look.ink : look.muted, align: 'center' });
  });
  const val = num(p, 'val', full * 0.6);
  if (val > full * 1.02) label(ctx, 'Over range: use the higher range', cx, 52, look, { color: look.red, size: 12 });
  const maxVal = full * 1.25;
  drawSlider(ctx, M.slider, val / maxVal, kind === 'ammeter' ? 'Current in the circuit' : 'Voltage across the part', bool(p, 'show') ? `${fmt(val)} ${unit}` : '', look);
}

// --- spring balance -----------------------------------------------------------------------------------

/** 0 to 5 N over 140 px: the spring stretches 2.8 cm per newton (k = 35.7 N/m). */
const B = { x: 280, top: 22, zero: 40, perN: 28, full: 5 };

function drawBalance(ctx: CanvasRenderingContext2D, p: SimParams, s: GS, look: Look) {
  const { x, top, zero, perN } = B;
  const ext = clamp(s.th, 0, B.full + 0.2) * perN;
  const pointer = zero + ext;
  // Hanging hook and body.
  ctx.strokeStyle = look.ink;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.arc(x, top - 6, 6, Math.PI * 0.2, Math.PI * 1.8, true);
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(x - 34, top, 68, 162, 10);
  ctx.fillStyle = look.dark ? '#3a3a3c' : '#e8eef7';
  ctx.fill();
  ctx.strokeStyle = metalDark(look);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  // Spring in the slot, from the top to the pointer.
  ctx.beginPath();
  const coils = 12;
  ctx.moveTo(x, top + 6);
  for (let i = 0; i <= coils * 2; i++) ctx.lineTo(x + (i % 2 ? 8 : -8) * (i && i < coils * 2 ? 1 : 0), top + 6 + ((pointer - top - 8) * i) / (coils * 2));
  ctx.strokeStyle = look.muted;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  for (let k = 0; k <= B.full * 10; k++) {
    const yy = zero + (k / 10) * perN;
    const len = k % 10 === 0 ? 14 : k % 5 === 0 ? 10 : 6;
    line(ctx, x + 14, yy, x + 14 + len, yy, look.ink, 1);
    if (k % 10 === 0) text(ctx, String(k / 10), x + 32, yy, { size: 10.5, weight: 650, color: look.ink });
  }
  text(ctx, 'N', x + 30, top + 8, { size: 10, weight: 700, color: look.muted });
  line(ctx, x - 12, pointer, x + 26, pointer, look.red, 2.4);
  // Rod, hook and mass.
  const hook = top + 168 + ext;
  line(ctx, x, pointer, x, hook, look.ink, 2.2);
  ctx.beginPath();
  ctx.arc(x, hook + 6, 6, -Math.PI / 2, Math.PI * 0.9);
  ctx.stroke();
  const m = num(p, 'mass', 200);
  if (m > 0) {
    const h = 14 + Math.min(26, m / 25);
    ctx.beginPath();
    ctx.roundRect(x - 26, hook + 14, 52, h, 5);
    ctx.fillStyle = look.dark ? '#636366' : '#8e8e93';
    ctx.fill();
    text(ctx, `${fmt(m)} g`, x, hook + 14 + h / 2, { size: 11, weight: 700, color: '#ffffff', align: 'center' });
  }
  if (num(p, 'mass', 200) * G / 1000 > B.full) label(ctx, 'Over the 5 N limit', x + 120, 60, look, { color: look.red });
  hint(ctx, 'Drag the mass up or down to change it', look);
}

function balanceGrab(p: SimParams, s: GS, x: number, y: number): SimGrab | null {
  const hook = B.top + 168 + clamp(s.th, 0, B.full + 0.2) * B.perN;
  if (Math.abs(x - B.x) > 34 || y < hook || y > hook + 60) return null;
  const m0 = num(p, 'mass', 200);
  const y0 = y;
  return { cursor: 'ns-resize', hint: 'Drag to change the mass', drag: (_bx, by) => ({ mass: clamp(snap(m0 + (by - y0) * 4, 10), 0, 600) }) };
}

// --- thermometer ------------------------------------------------------------------------------------------

const T = { x: 268, top: 36, bottom: 304, bulb: 326 };

function thermoScale(p: SimParams) {
  const clinical = str(p, 'thermo', 'lab') === 'clinical';
  return clinical ? { clinical, lo: 35, hi: 42, lc: 0.1, minor: 0.1, mid: 0.5, major: 1 } : { clinical, lo: -10, hi: 110, lc: 1, minor: 1, mid: 5, major: 10 };
}
const thermoY = (t: number, sc: ReturnType<typeof thermoScale>) => T.bottom - ((t - sc.lo) / (sc.hi - sc.lo)) * (T.bottom - T.top);

function drawThermometer(ctx: CanvasRenderingContext2D, p: SimParams, s: GS, look: Look) {
  const sc = thermoScale(p);
  const liquid = sc.clinical || str(p, 'liquid', 'mercury') === 'mercury' ? (look.dark ? '#c7c7cc' : '#8e8e93') : look.red;
  const temp = sc.clinical ? s.max : s.temp;
  if (!sc.clinical) {
    // Beaker of water round the bulb, warmer colours as it heats.
    const f = clamp((num(p, 'T', 25) + 10) / 110, 0, 1);
    ctx.fillStyle = `rgba(${Math.round(80 + 175 * f)}, ${Math.round(150 - 60 * f)}, ${Math.round(255 - 200 * f)}, 0.28)`;
    ctx.fillRect(200, 284, 136, 62);
    ctx.strokeStyle = look.muted;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(196, 262);
    ctx.lineTo(200, 346);
    ctx.lineTo(336, 346);
    ctx.lineTo(340, 262);
    ctx.stroke();
  }
  // Glass, then the liquid thread.
  ctx.beginPath();
  ctx.roundRect(T.x - 9, T.top - 14, 18, T.bulb - T.top + 6, 9);
  ctx.fillStyle = look.dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)';
  ctx.fill();
  ctx.strokeStyle = look.faint;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(T.x, T.bulb, 15, 0, Math.PI * 2);
  ctx.fillStyle = liquid;
  ctx.fill();
  const yTop = clamp(thermoY(temp, sc), T.top - 8, T.bulb);
  ctx.fillStyle = liquid;
  ctx.fillRect(T.x - 2.5, yTop, 5, T.bulb - yTop);
  if (sc.clinical) {
    // The kink stops the thread falling back until the thermometer is shaken (the card's reset).
    ctx.fillStyle = look.card;
    ctx.fillRect(T.x - 2.5, T.bottom + 8, 1.6, 6);
    ctx.fillRect(T.x + 0.9, T.bottom + 8, 1.6, 6);
  }
  const n = Math.round((sc.hi - sc.lo) / sc.minor);
  for (let k = 0; k <= n; k++) {
    const t = sc.lo + k * sc.minor;
    const yy = thermoY(t, sc);
    const isMajor = Math.abs(t / sc.major - Math.round(t / sc.major)) < 1e-6;
    const isMid = Math.abs(t / sc.mid - Math.round(t / sc.mid)) < 1e-6;
    line(ctx, T.x + 12, yy, T.x + 12 + (isMajor ? 14 : isMid ? 10 : 6), yy, look.ink, isMajor ? 1.3 : 0.9);
    if (isMajor) text(ctx, String(Math.round(t)), T.x + 32, yy, { size: 10.5, weight: 650, color: look.ink });
  }
  text(ctx, '°C', T.x + 32, T.top - 22, { size: 10, weight: 700, color: look.muted });
  if (sc.clinical && s.max > num(p, 'T', 37) + 0.05) text(ctx, 'Still showing the highest reading: press reset to shake it down', 14, 40, { size: 10.5, color: look.orange });
  const tl = sc.clinical ? 'Body temperature' : 'Water temperature';
  const lo = sc.clinical ? 35 : -10;
  const hi = sc.clinical ? 42 : 100;
  drawSlider(ctx, 370, (num(p, 'T', sc.clinical ? 37 : 25) - lo) / (hi - lo), tl, bool(p, 'show') ? `${fmt(num(p, 'T', 25))} °C` : '', look);
}

// --- measuring cylinder -----------------------------------------------------------------------------------

function drawCylinder(ctx: CanvasRenderingContext2D, p: SimParams, look: Look) {
  const vol = num(p, 'vol', 64.5);
  const eye = num(p, 'eye', 0);
  const mercury = str(p, 'fluid', 'water') === 'mercury';
  const { x0, x1, zeroY, pxPerMl } = CYL;
  const ym = zeroY - vol * pxPerMl;
  const cx = (x0 + x1) / 2;
  // Liquid with its meniscus: water curves up at the glass, mercury bulges.
  const lift = mercury ? -6 : 7;
  ctx.beginPath();
  ctx.moveTo(x0, zeroY + 10);
  ctx.lineTo(x0, ym - lift);
  ctx.quadraticCurveTo(cx, ym + lift, x1, ym - lift);
  ctx.lineTo(x1, zeroY + 10);
  ctx.closePath();
  ctx.fillStyle = mercury ? (look.dark ? '#8e8e93' : '#b8b8c0') : look.dark ? 'rgba(10,132,255,0.35)' : 'rgba(0,122,255,0.22)';
  ctx.fill();
  // Glass and base.
  ctx.strokeStyle = look.muted;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0 - 4, 22);
  ctx.lineTo(x0, 30);
  ctx.lineTo(x0, zeroY + 10);
  ctx.lineTo(x1, zeroY + 10);
  ctx.lineTo(x1, 30);
  ctx.stroke();
  ctx.fillStyle = look.muted;
  ctx.fillRect(x0 - 26, zeroY + 10, x1 - x0 + 52, 8);
  for (let v = 0; v <= 100; v++) {
    const yy = zeroY - v * pxPerMl;
    const len = v % 10 === 0 ? 18 : v % 5 === 0 ? 12 : 7;
    line(ctx, x0, yy, x0 + len, yy, look.ink, v % 10 === 0 ? 1.3 : 0.9);
    if (v % 10 === 0 && v > 0) text(ctx, String(v), x0 + 22, yy, { size: 10, weight: 650, color: look.ink });
  }
  text(ctx, 'mL', x1 + 8, 40, { size: 10, weight: 700, color: look.muted });
  // The eye and its line of sight through the scale to the meniscus.
  const ye = ym + eye;
  const yc = ye + ((ym - ye) * (x0 - CYL.eyeX)) / (cx - CYL.eyeX);
  line(ctx, CYL.eyeX + 14, ye, cx, ym, Math.abs(eye) < 3 ? look.green : look.orange, 1.4, [5, 4]);
  ctx.beginPath();
  ctx.arc(x0, yc, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = Math.abs(eye) < 3 ? look.green : look.orange;
  ctx.fill();
  ctx.save();
  ctx.translate(CYL.eyeX, ye);
  ctx.beginPath();
  ctx.ellipse(0, 0, 15, 9, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = look.ink;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(5, 0, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#1c1c1e';
  ctx.fill();
  ctx.restore();
  text(ctx, Math.abs(eye) < 3 ? 'Eye level with the meniscus' : eye < 0 ? 'Eye too high: reads high' : 'Eye too low: reads low', 14, 40, { size: 11, weight: 650, color: Math.abs(eye) < 3 ? look.green : look.orange });
  text(ctx, mercury ? 'Mercury: read the top of the curve' : 'Water: read the bottom of the curve', 14, 58, { size: 10.5, color: look.muted });
  hint(ctx, 'Drag the eye up or down · drag the liquid surface to pour', look);
}

function cylinderGrab(p: SimParams, x: number, y: number): SimGrab | null {
  const vol = num(p, 'vol', 64.5);
  const ym = CYL.zeroY - vol * CYL.pxPerMl;
  const eye = num(p, 'eye', 0);
  if (Math.hypot(x - CYL.eyeX, y - (ym + eye)) < 20) {
    return { cursor: 'ns-resize', hint: 'Move your eye', drag: (_bx, by) => {
      const off = clamp(by - ym, -90, 90);
      return { eye: Math.abs(off) < 4 ? 0 : off };
    } };
  }
  if (x > CYL.x0 && x < CYL.x1 && Math.abs(y - ym) < 12) {
    return { cursor: 'ns-resize', hint: 'Pour in or out', drag: (_bx, by) => ({ vol: clamp(snap((CYL.zeroY - by) / CYL.pxPerMl, 0.5), 5, 98) }) };
  }
  return null;
}

// --- the simulator -----------------------------------------------------------------------------------------

interface GS extends SimState {
  /** Needle (fraction of full scale) or spring balance pointer (newtons), and its speed. */
  th: number;
  w: number;
  temp: number;
  /** Highest temperature reached, for the clinical thermometer. */
  max: number;
}

const INSTRUMENTS = [
  { value: 'vernier', label: 'Vernier caliper' },
  { value: 'screw', label: 'Screw gauge' },
  { value: 'ammeter', label: 'Ammeter' },
  { value: 'voltmeter', label: 'Voltmeter' },
  { value: 'balance', label: 'Spring balance' },
  { value: 'thermometer', label: 'Thermometer' },
  { value: 'cylinder', label: 'Measuring cylinder' },
];
const inst = (p: SimParams) => str(p, 'inst', 'vernier');
const is = (...k: string[]) => (p: SimParams) => k.includes(inst(p));
const meterKind = (p: SimParams): 'ammeter' | 'voltmeter' => (inst(p) === 'voltmeter' ? 'voltmeter' : 'ammeter');

function readouts(p: SimParams, s: GS): Readout[] {
  const show = bool(p, 'show');
  const hidden: Readout = { label: 'Reading', value: 'Hidden: read it yourself' };
  switch (inst(p)) {
    case 'vernier': {
      const v = vernierState(p);
      const base: Readout[] = [{ label: 'Least count', value: `${v.lc} mm` }];
      if (!show) return [...base, hidden];
      return [
        ...base,
        { label: 'Main scale', value: `${fix(v.r.msr, 1)} mm` },
        { label: 'Vernier line', value: String(v.r.k), color: 'red' },
        { label: 'Observed', value: `${fix(v.r.reading, v.lc)} mm` },
        { label: 'Zero error', value: `${v.ze > 0 ? '+' : ''}${fix(v.ze, v.lc)} mm`, color: v.ze ? 'orange' : undefined },
        { label: 'Corrected', value: `${fix(v.r.reading - v.ze, v.lc)} mm`, color: 'green' },
      ];
    }
    case 'screw': {
      const v = screwState(p);
      const base: Readout[] = [{ label: 'Least count', value: `${v.lc} mm` }];
      if (!show) return [...base, hidden];
      return [
        ...base,
        { label: 'Sleeve (PSR)', value: `${fix(v.r.psr, v.pitch)} mm` },
        { label: 'Thimble (CSR)', value: String(v.r.csr), color: 'red' },
        { label: 'Zero error', value: `${v.ze > 0 ? '+' : ''}${fix(v.ze, v.lc)} mm`, color: v.ze ? 'orange' : undefined },
        { label: 'Corrected', value: `${fix(v.r.reading - v.ze, v.lc)} mm`, color: 'green' },
      ];
    }
    case 'ammeter':
    case 'voltmeter': {
      const kind = meterKind(p);
      const full = meterRange(p, kind);
      const unit = kind === 'ammeter' ? 'A' : 'V';
      const lc = full / 50;
      const base: Readout[] = [{ label: 'Range', value: `0–${full} ${unit}` }, { label: 'Least count', value: `${fmt(lc)} ${unit}` }];
      if (!show) return [...base, hidden];
      const val = num(p, 'val', full * 0.6);
      return [...base, {
        label: 'Reading', value: val > full * 1.02 ? 'Off the scale' : `${fix(clamp(snap(val, lc), 0, full), lc)} ${unit}`,
        color: val > full * 1.02 ? 'red' : 'green',
      }];
    }
    case 'balance': {
      const W = (num(p, 'mass', 200) * G) / 1000;
      const base: Readout[] = [{ label: 'Range', value: '0–5 N' }, { label: 'Least count', value: '0.1 N' }];
      if (!show) return [...base, hidden];
      return [...base, { label: 'Reading', value: W > B.full ? 'Over 5 N' : `${fix(snap(W, 0.1), 0.1)} N`, color: 'green' }, { label: 'Extension', value: `${fmt(Math.min(W, B.full) * 2.8)} cm` }];
    }
    case 'thermometer': {
      const sc = thermoScale(p);
      const base: Readout[] = [{ label: 'Range', value: `${sc.lo} to ${sc.hi} °C` }, { label: 'Least count', value: `${sc.lc} °C` }];
      if (!show) return [...base, hidden];
      const t = sc.clinical ? s.max : s.temp;
      return [...base, { label: 'Reading', value: `${fix(snap(t, sc.lc), sc.lc)} °C`, color: 'green' }, { label: 'In kelvin', value: `${fmt(snap(t, sc.lc) + 273.15)} K` }];
    }
    default: {
      const vol = num(p, 'vol', 64.5);
      const seen = seenVolume(vol, num(p, 'eye', 0));
      const base: Readout[] = [{ label: 'Least count', value: '1 mL' }];
      if (!show) return [...base, hidden];
      const err = seen - vol;
      return [
        ...base,
        { label: 'Actual', value: `${fmt(vol)} mL` },
        { label: 'You read', value: `${fmt(snap(seen, 0.5))} mL`, color: Math.abs(err) < 0.5 ? 'green' : 'orange' },
        { label: 'Parallax error', value: `${err > 0 ? '+' : ''}${fix(err, 0.1)} mL`, color: Math.abs(err) < 0.5 ? undefined : 'orange' },
      ];
    }
  }
}

function formulas(p: SimParams): Formula[] {
  const show = bool(p, 'show');
  switch (inst(p)) {
    case 'vernier': {
      const v = vernierState(p);
      const f: Formula[] = [{ label: 'Least count', tex: `LC = 1\\ \\text{MSD} - 1\\ \\text{VSD} = 1 - \\tfrac{${v.nv - 1}}{${v.nv}} = ${v.lc}\\ \\text{mm}` }];
      if (show) {
        f.push({ label: 'Reading', tex: `\\text{MSR} + k \\times LC = ${tf(v.r.msr)} + ${v.r.k} \\times ${v.lc} = ${tf(v.r.reading)}\\ \\text{mm}` });
        f.push({ label: 'Corrected for zero error', tex: `${tf(v.r.reading)} - (${tf(v.ze)}) = ${tf(v.r.reading - v.ze)}\\ \\text{mm}` });
      }
      return f;
    }
    case 'screw': {
      const v = screwState(p);
      const f: Formula[] = [{ label: 'Least count', tex: `LC = \\frac{\\text{pitch}}{N} = \\frac{${v.pitch}}{${v.n}} = ${v.lc}\\ \\text{mm}` }];
      if (show) {
        f.push({ label: 'Reading', tex: `\\text{PSR} + \\text{CSR} \\times LC = ${tf(v.r.psr)} + ${v.r.csr} \\times ${v.lc} = ${tf(v.r.reading)}\\ \\text{mm}` });
        f.push({ label: 'Corrected for zero error', tex: `${tf(v.r.reading)} - (${tf(v.ze)}) = ${tf(v.r.reading - v.ze)}\\ \\text{mm}` });
      }
      return f;
    }
    case 'ammeter':
    case 'voltmeter': {
      const kind = meterKind(p);
      const full = meterRange(p, kind);
      return [{ label: 'Least count', tex: `LC = \\frac{\\text{range}}{\\text{divisions}} = \\frac{${full}}{50} = ${tf(full / 50)}\\ \\text{${kind === 'ammeter' ? 'A' : 'V'}}` }];
    }
    case 'balance': {
      const m = num(p, 'mass', 200) / 1000;
      return [
        { label: 'Weight', tex: `W = mg = (${tf(m)})(9.8) = ${tf(m * G)}\\ \\text{N}` },
        { label: "Hooke's law: the scale is even because", tex: 'F = kx, \\quad k = \\frac{5\\ \\text{N}}{0.14\\ \\text{m}} = 35.7\\ \\text{N/m}' },
      ];
    }
    case 'thermometer':
      return [{ label: 'Other scales', tex: 'T_K = T_C + 273.15, \\quad T_F = \\tfrac{9}{5}T_C + 32' }];
    default:
      return [{ label: 'Parallax error', tex: '\\text{error} = V_{\\text{read}} - V_{\\text{actual}}\\ (0\\ \\text{with the eye level})' }];
  }
}

export const gaugeSim: SimDef<GS> = {
  label: 'Measuring instruments',
  subject: 'Physics',
  keywords: 'vernier caliper micrometer screw gauge least count zero error ammeter voltmeter meter spring balance newton meter thermometer clinical measuring cylinder meniscus parallax',
  blurb: 'Vernier, screw gauge, meters, balance, thermometer, cylinder',
  display: ['show', 'gap', 'sgap', 'val', 'mass', 'T', 'eye', 'vol'],
  autoplay: true,
  still: (p) => ['vernier', 'screw', 'cylinder'].includes(inst(p)),
  defaults: {
    inst: 'vernier', show: true,
    lc: '0.1', obj: 'ball', gap: 18.4, zev: 0,
    pitch: '0.5', div: '50', sobj: 'wire', sgap: 1.27, zes: 0,
    range: '1', val: 0.62,
    mass: 200,
    thermo: 'lab', liquid: 'mercury', T: 25,
    fluid: 'water', vol: 64.5, eye: 0,
  },
  controls: [
    { key: 'inst', label: 'Instrument', type: 'choice', options: INSTRUMENTS },
    { key: 'show', label: 'Show the reading', type: 'toggle' },
    { key: 'lc', label: 'Least count', type: 'choice', options: [{ value: '0.1', label: '0.1 mm' }, { value: '0.05', label: '0.05 mm' }], show: is('vernier') },
    { key: 'obj', label: 'Between the jaws', type: 'choice', options: Object.entries(V_OBJ).map(([value, o]) => ({ value, label: o.label })), show: is('vernier') },
    { key: 'zev', label: 'Zero error (vernier divisions)', type: 'range', min: -5, max: 5, step: 1, show: is('vernier') },
    { key: 'pitch', label: 'Pitch', type: 'choice', options: [{ value: '0.5', label: '0.5 mm' }, { value: '1', label: '1 mm' }], show: is('screw') },
    { key: 'div', label: 'Thimble divisions', type: 'choice', options: [{ value: '50', label: '50' }, { value: '100', label: '100' }], show: is('screw') },
    { key: 'sobj', label: 'Measuring', type: 'choice', options: Object.entries(S_OBJ).map(([value, o]) => ({ value, label: o.label })), show: is('screw') },
    { key: 'zes', label: 'Zero error (thimble divisions)', type: 'range', min: -10, max: 10, step: 1, show: is('screw') },
    { key: 'range', label: 'Range', type: 'choice', options: [{ value: '1', label: '0–1 A' }, { value: '5', label: '0–5 A' }], show: is('ammeter') },
    { key: 'range', label: 'Range', type: 'choice', options: [{ value: '3', label: '0–3 V' }, { value: '15', label: '0–15 V' }], show: is('voltmeter') },
    { key: 'thermo', label: 'Thermometer', type: 'choice', options: [{ value: 'lab', label: 'Laboratory' }, { value: 'clinical', label: 'Clinical' }], show: is('thermometer') },
    { key: 'liquid', label: 'Liquid', type: 'choice', options: [{ value: 'mercury', label: 'Mercury' }, { value: 'alcohol', label: 'Alcohol' }], show: (p) => is('thermometer')(p) && str(p, 'thermo') !== 'clinical' },
    { key: 'fluid', label: 'Liquid', type: 'choice', options: [{ value: 'water', label: 'Water' }, { value: 'mercury', label: 'Mercury' }], show: is('cylinder') },
  ],
  presets: [
    { label: 'Vernier caliper', params: { inst: 'vernier', obj: 'ball', gap: 18.4, zev: 0, lc: '0.1' } },
    { label: 'Vernier: zero error', params: { inst: 'vernier', obj: 'none', gap: 0, zev: 3, lc: '0.1' } },
    { label: 'Screw gauge', params: { inst: 'screw', sobj: 'wire', sgap: 1.27, zes: 0 } },
    { label: 'Screw gauge: zero error', params: { inst: 'screw', sobj: 'none', sgap: 0, zes: -4 } },
    { label: 'Ammeter', params: { inst: 'ammeter', range: '1', val: 0.62 } },
    { label: 'Voltmeter', params: { inst: 'voltmeter', range: '3', val: 2.3 } },
    { label: 'Spring balance', params: { inst: 'balance', mass: 200 } },
    { label: 'Lab thermometer', params: { inst: 'thermometer', thermo: 'lab', T: 25 } },
    { label: 'Clinical thermometer', params: { inst: 'thermometer', thermo: 'clinical', T: 38.6 } },
    { label: 'Measuring cylinder', params: { inst: 'cylinder', vol: 64.5, eye: 0 } },
  ],
  title: (p) => {
    if (inst(p) === 'thermometer') return str(p, 'thermo') === 'clinical' ? 'Clinical thermometer' : 'Laboratory thermometer';
    return INSTRUMENTS.find((x) => x.value === inst(p))?.label ?? 'Measuring instruments';
  },
  init: (p) => {
    const clinical = str(p, 'thermo') === 'clinical';
    const t0 = clinical ? 35 : 25;
    return { t: 0, done: false, th: 0, w: 0, temp: t0, max: t0 };
  },
  step: (p, s, dt) => {
    s.t += dt;
    const k = inst(p);
    if (k === 'ammeter' || k === 'voltmeter') {
      const full = meterRange(p, meterKind(p));
      const target = meterFraction(num(p, 'val', full * 0.6), full);
      s.w += (-90 * (s.th - target) - 9 * s.w) * dt;
      s.th += s.w * dt;
      if (s.th > 1.04 || s.th < -0.02) {
        s.th = clamp(s.th, -0.02, 1.04);
        s.w = 0;
      }
    } else if (k === 'balance') {
      const F = Math.min(B.full + 0.2, (num(p, 'mass', 200) * G) / 1000);
      s.w += (-45 * (s.th - F) - 2.5 * s.w) * dt;
      s.th += s.w * dt;
      if (s.th < 0) {
        s.th = 0;
        s.w = 0;
      }
    } else if (k === 'thermometer') {
      s.temp += (num(p, 'T', 25) - s.temp) * (1 - Math.exp(-dt / 1.4));
      s.max = Math.max(s.max, s.temp);
    }
  },
  draw: (ctx, p, s, look) => {
    switch (inst(p)) {
      case 'vernier': return drawVernier(ctx, p, look);
      case 'screw': return drawScrew(ctx, p, look);
      case 'ammeter':
      case 'voltmeter': return drawMeter(ctx, p, s, look, meterKind(p));
      case 'balance': return drawBalance(ctx, p, s, look);
      case 'thermometer': return drawThermometer(ctx, p, s, look);
      default: return drawCylinder(ctx, p, look);
    }
  },
  grab: (p, s, x, y) => {
    switch (inst(p)) {
      case 'vernier': return vernierGrab(p, x, y);
      case 'screw': return screwGrab(p, x, y);
      case 'ammeter':
      case 'voltmeter': {
        const full = meterRange(p, meterKind(p));
        return sliderGrab(x, y, M.slider, 'Change the current or voltage', (f) => ({ val: snap(f * full * 1.25, full / 500) }));
      }
      case 'balance': return balanceGrab(p, s, x, y);
      case 'thermometer': {
        const clinical = str(p, 'thermo') === 'clinical';
        const lo = clinical ? 35 : -10;
        const hi = clinical ? 42 : 100;
        return sliderGrab(x, y, 370, 'Change the temperature', (f) => ({ T: snap(lo + f * (hi - lo), clinical ? 0.1 : 0.5) }));
      }
      default: return cylinderGrab(p, x, y);
    }
  },
  readouts,
  formulas,
};
