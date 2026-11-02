/**
 * Human body systems: the heart through one cardiac cycle with its ECG, the double circulation,
 * breathing, and a nerve impulse travelling along a neuron.
 *
 * The heart runs in real time (a cycle at 75 beats a minute lasts 0.8 s). The circulation and
 * the nerve impulse are slowed down so they can be followed, and say so on the card.
 * Tap a part of the heart to name it.
 */

import { BH, arrow, label, line, num, plot, str, text, fmt, bool } from './kit.ts';
import type { Formula, Look, Readout, SimDef, SimGrab, SimParams, SimState } from './kit.ts';

// --- the cardiac cycle -------------------------------------------------------------------------------

export interface CyclePhase {
  name: string;
  /** Atrioventricular (tricuspid and mitral) valves open. */
  av: boolean;
  /** Semilunar (pulmonary and aortic) valves open. */
  sl: boolean;
  /** How hard the atria and the ventricles are squeezing, 0 to 1. */
  atria: number;
  vent: number;
}

/** Seconds into a cycle at 75 beats a minute. A faster heart squeezes systole up; diastole takes the rest. */
const EV = { p: 0.04, aStart: 0.06, aEnd: 0.16, qrs: 0.19, avClose: 0.2, slOpen: 0.25, t: 0.42, slClose: 0.48, avOpen: 0.54 };

/** How much the systolic events are squeezed for a cycle of T seconds (1 at 75 beats a minute). */
export const systoleScale = (T: number) => Math.min(Math.sqrt(T / 0.8), T / 0.6);

const bump = (x: number, a: number, b: number) => (x <= a || x >= b ? 0 : Math.sin((Math.PI * (x - a)) / (b - a)));
const gauss = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));

/** Time into the cycle, in 75-beats-a-minute seconds. */
function cycleTime(t: number, T: number) {
  return ((((t % T) + T) % T)) / systoleScale(T);
}

export function cardiacPhase(t: number, T: number): CyclePhase {
  const u = cycleTime(t, T);
  const vent = u >= EV.avClose && u < EV.avOpen ? Math.sin((Math.PI * (u - EV.avClose)) / (EV.avOpen - EV.avClose)) : 0;
  // The atria squeeze from aStart to aEnd; the phase lasts until the AV valves shut.
  if (u >= EV.aStart && u < EV.avClose) return { name: 'Atrial systole', av: true, sl: false, atria: bump(u, EV.aStart, EV.aEnd), vent: 0 };
  if (u >= EV.avClose && u < EV.slOpen) return { name: 'Isovolumetric contraction', av: false, sl: false, atria: 0, vent };
  if (u >= EV.slOpen && u < EV.slClose) return { name: 'Ventricular ejection', av: false, sl: true, atria: 0, vent };
  if (u >= EV.slClose && u < EV.avOpen) return { name: 'Isovolumetric relaxation', av: false, sl: false, atria: 0, vent };
  return { name: 'Ventricular filling', av: true, sl: false, atria: 0, vent: 0 };
}

/** The ECG at time t, in millivolts: P wave, QRS complex and T wave. */
export function ecg(t: number, T: number): number {
  const u = cycleTime(t, T);
  return 0.15 * gauss(u, EV.p, 0.018) - 0.12 * gauss(u, 0.175, 0.006) + gauss(u, EV.qrs, 0.007)
    - 0.25 * gauss(u, 0.205, 0.007) + 0.3 * gauss(u, EV.t, 0.035);
}

/** "lub" as the AV valves shut, "dub" as the semilunar valves shut. */
export function heartSound(t: number, T: number): 'lub' | 'dub' | null {
  const u = cycleTime(t, T);
  if (u >= EV.avClose && u < EV.avClose + 0.07) return 'lub';
  if (u >= EV.slClose && u < EV.slClose + 0.07) return 'dub';
  return null;
}

/** Litres a minute. */
export const cardiacOutput = (hr: number, svMl: number) => (hr * svMl) / 1000;

const PHASE_ORDER = ['Atrial systole', 'Isovolumetric contraction', 'Ventricular ejection', 'Isovolumetric relaxation', 'Ventricular filling'];

// --- breathing ---------------------------------------------------------------------------------------

/** How far into a breath: 0 breathed out, 1 fully in. Breathing in takes 40% of each breath. */
export function breath(t: number, perMin: number): { f: number; inhaling: boolean } {
  const T = 60 / perMin;
  const u = (((t % T) + T) % T) / T;
  if (u < 0.4) return { f: (1 - Math.cos((Math.PI * u) / 0.4)) / 2, inhaling: true };
  return { f: (1 + Math.cos((Math.PI * (u - 0.4)) / 0.6)) / 2, inhaling: false };
}

// --- the nerve impulse ---------------------------------------------------------------------------------

/** Membrane potential (mV) a time `ms` after the impulse reaches a point: up to +40, down past −70, back. */
export function apShape(ms: number): number {
  if (ms < 0 || ms > 5) return -70;
  if (ms < 1) return -70 + (110 * (1 - Math.cos(Math.PI * ms))) / 2;
  if (ms < 2.5) return 40 - (120 * (1 - Math.cos((Math.PI * (ms - 1)) / 1.5))) / 2;
  return -80 + (10 * (1 - Math.cos((Math.PI * (ms - 2.5)) / 2.5))) / 2;
}

export function apStage(ms: number): string {
  if (ms < 0 || ms > 5) return 'Resting';
  if (ms < 1) return 'Depolarising: Na⁺ rushes in';
  if (ms < 2.3) return 'Repolarising: K⁺ flows out';
  return 'Hyperpolarised: recovering';
}

const NEU = { x0: 140, x1: 470, y: 250, node: 40, period: 2, unmyelinated: 1.4, hop: 0.045, msPerS: 10, probe: 330 };

/** On-screen seconds after firing at which the impulse reaches x. Myelin makes it jump from node to node. */
function arrival(x: number, myelin: boolean): number {
  const d = Math.max(0, x - NEU.x0);
  return myelin ? Math.floor(d / NEU.node) * NEU.hop : (d / (NEU.x1 - NEU.x0)) * NEU.unmyelinated;
}

const potential = (x: number, t: number, myelin: boolean) => apShape(((t % NEU.period) - arrival(x, myelin)) * NEU.msPerS);

// --- the parts of the heart you can tap --------------------------------------------------------------------

interface HPart { id: string; name: string; does: string; x: number; y: number; rx: number; ry: number }
const HP = (id: string, name: string, does: string, x: number, y: number, rx: number, ry: number): HPart => ({ id, name, does, x, y, rx, ry });

const HEART_PARTS: HPart[] = [
  HP('tri', 'Tricuspid valve', 'Stops blood flowing back from the right ventricle into the right atrium', 145, 197, 16, 9),
  HP('mitral', 'Mitral (bicuspid) valve', 'Stops blood flowing back from the left ventricle into the left atrium', 275, 197, 16, 9),
  HP('pulv', 'Pulmonary valve', 'Stops blood flowing back into the right ventricle', 198, 200, 8, 8),
  HP('aov', 'Aortic valve', 'Stops blood flowing back into the left ventricle', 224, 200, 8, 8),
  HP('septum', 'Septum', 'Muscle wall that keeps oxygenated and deoxygenated blood apart', 209, 262, 7, 40),
  HP('ra', 'Right atrium', 'Collects deoxygenated blood from the body through the vena cava', 145, 150, 42, 38),
  HP('la', 'Left atrium', 'Collects oxygenated blood from the lungs through the pulmonary veins', 275, 150, 42, 38),
  HP('rv', 'Right ventricle', 'Pumps deoxygenated blood to the lungs', 150, 262, 50, 52),
  HP('lv', 'Left ventricle', 'Pumps oxygenated blood all round the body: the thickest wall', 272, 262, 54, 52),
  HP('vc', 'Vena cava', 'Brings deoxygenated blood back from the body', 125, 60, 10, 50),
  HP('ivc', 'Vena cava (inferior)', 'Brings deoxygenated blood back from the lower body', 66, 172, 36, 9),
  HP('pa', 'Pulmonary artery', 'Carries deoxygenated blood to the lungs', 120, 84, 60, 9),
  HP('pv', 'Pulmonary vein', 'Brings oxygenated blood back from the lungs', 346, 140, 26, 9),
  HP('aorta', 'Aorta', 'Carries oxygenated blood to the body at high pressure', 256, 36, 34, 14),
];

function heartPartAt(x: number, y: number): HPart | null {
  return HEART_PARTS.find((q) => ((x - q.x) / (q.rx + 3)) ** 2 + ((y - q.y) / (q.ry + 3)) ** 2 <= 1) ?? null;
}

// --- drawing helpers ---------------------------------------------------------------------------------------

type Pt = [number, number];

const muscle = (look: Look) => (look.dark ? '#d07070' : '#b8494a');
const tint = (look: Look, red: boolean) => (red
  ? look.dark ? 'rgba(255,69,58,0.32)' : 'rgba(255,59,48,0.16)'
  : look.dark ? 'rgba(10,132,255,0.34)' : 'rgba(0,122,255,0.16)');

function arcPts(cx: number, cy: number, r: number, a0: number, a1: number, n = 14): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r] as Pt;
  });
}

function polyline(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
}

function tube(ctx: CanvasRenderingContext2D, pts: Pt[], color: string, edge: string, w = 14) {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  polyline(ctx, pts);
  ctx.strokeStyle = edge;
  ctx.lineWidth = w + 3;
  ctx.stroke();
  polyline(ctx, pts);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
  ctx.restore();
}

/** Moving dashes along a path while blood flows through it. */
function flow(ctx: CanvasRenderingContext2D, pts: Pt[], t: number, on: boolean) {
  if (!on) return;
  ctx.save();
  polyline(ctx, pts);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2.4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([6, 10]);
  ctx.lineDashOffset = -t * 70;
  ctx.stroke();
  ctx.restore();
}

/** Two flaps across a passage. Open, they swing along the flow: `dir` 1 opens downwards, −1 upwards. */
function valve(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, open: boolean, dir: number, look: Look) {
  const a = open ? 1.2 : 0;
  ctx.save();
  ctx.strokeStyle = look.ink;
  ctx.lineWidth = 2.6;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const x0 = x + (side * w) / 2;
    const ang = side < 0 ? a * dir : Math.PI - a * dir;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x0 + Math.cos(ang) * (w / 2 - 1), y + Math.sin(ang) * (w / 2 - 1));
    ctx.stroke();
  }
  ctx.restore();
}

function ventriclePath(ctx: CanvasRenderingContext2D, cx: number, top: number, w: number, h: number, apex: number) {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y1 = top + h;
  const ax = cx + apex;
  ctx.beginPath();
  ctx.moveTo(x0 + 12, top);
  ctx.lineTo(x1 - 12, top);
  ctx.quadraticCurveTo(x1, top, x1, top + 12);
  ctx.bezierCurveTo(x1, y1 - 30, ax + 24, y1, ax, y1);
  ctx.bezierCurveTo(ax - 24, y1, x0, y1 - 30, x0, top + 12);
  ctx.quadraticCurveTo(x0, top, x0 + 12, top);
  ctx.closePath();
}

const history = (s: BS, tMax: number): [number, number][] =>
  s.hist.map(([t, v]) => [t - (s.t - tMax), v] as [number, number]).filter(([t]) => t >= 0);

// --- the heart ---------------------------------------------------------------------------------------------

const ATRIUM_BOTTOM = 188;
const VENT_TOP = 207;

function drawHeart(ctx: CanvasRenderingContext2D, p: SimParams, s: BS, look: Look) {
  const T = 60 / num(p, 'hr', 75);
  const ph = cardiacPhase(s.t, T);
  const blue = look.dark ? '#3b82c4' : '#4a90d9';
  const red = look.dark ? '#d9534f' : '#d9443f';
  const blueEdge = look.dark ? '#1f5a94' : '#2c6cb0';
  const redEdge = look.dark ? '#a83430' : '#a82e2a';

  // Vessels behind the chambers. The aorta arches over the pulmonary artery.
  const svc: Pt[] = [[125, 8], [125, 116]];
  const ivc: Pt[] = [[24, 172], [106, 172]];
  const paL: Pt[] = [[198, 209], [198, 84], [56, 84]];
  const paR: Pt[] = [[198, 84], [378, 84]];
  const pv: Pt[] = [[378, 140], [318, 140]];
  const aorta: Pt[] = [[224, 209], [224, 58], ...arcPts(256, 58, 32, Math.PI, 2 * Math.PI), [288, 80]];
  tube(ctx, paR, blue, blueEdge);
  tube(ctx, paL, blue, blueEdge);
  tube(ctx, svc, blue, blueEdge);
  tube(ctx, ivc, blue, blueEdge);
  tube(ctx, pv, red, redEdge);
  tube(ctx, aorta, red, redEdge);

  const ka = 1 - 0.14 * ph.atria;
  const kv = 1 - 0.16 * ph.vent;
  const wall = muscle(look);
  // Atria: the floor stays put, the walls squeeze in.
  for (const [cx, red2] of [[145, false], [275, true]] as [number, boolean][]) {
    const w = 84 * ka;
    const h = 76 * ka;
    ctx.beginPath();
    ctx.roundRect(cx - w / 2, ATRIUM_BOTTOM - h, w, h, 18);
    ctx.fillStyle = tint(look, red2);
    ctx.fill();
    ctx.strokeStyle = wall;
    ctx.lineWidth = 3.5;
    ctx.stroke();
  }
  // Ventricles: the top stays put; the left one has the thick wall.
  for (const [cx, w0, apex, red2, lw] of [[150, 104, 28, false, 4], [272, 112, -28, true, 9]] as [number, number, number, boolean, number][]) {
    ventriclePath(ctx, cx, VENT_TOP, w0 * kv, 110 * kv, apex * kv);
    ctx.fillStyle = tint(look, red2);
    ctx.fill();
    ctx.strokeStyle = wall;
    ctx.lineWidth = lw;
    ctx.stroke();
  }
  // Passages from each atrium into its ventricle, with the AV valves in them.
  for (const [cx, red2] of [[145, false], [275, true]] as [number, boolean][]) {
    ctx.fillStyle = look.card;
    ctx.fillRect(cx - 15, ATRIUM_BOTTOM - 3, 30, VENT_TOP - ATRIUM_BOTTOM + 6);
    ctx.fillStyle = tint(look, red2);
    ctx.fillRect(cx - 15, ATRIUM_BOTTOM - 3, 30, VENT_TOP - ATRIUM_BOTTOM + 6);
    line(ctx, cx - 15, ATRIUM_BOTTOM - 2, cx - 15, VENT_TOP + 2, wall, 3);
    line(ctx, cx + 15, ATRIUM_BOTTOM - 2, cx + 15, VENT_TOP + 2, wall, 3);
    valve(ctx, cx, 197, 30, ph.av, 1, look);
  }
  valve(ctx, 198, 202, 14, ph.sl, -1, look);
  valve(ctx, 224, 202, 14, ph.sl, -1, look);

  flow(ctx, svc, s.t, true);
  flow(ctx, ivc, s.t, true);
  flow(ctx, pv, s.t, true);
  flow(ctx, [[145, 140], [145, 262]], s.t, ph.av);
  flow(ctx, [[275, 140], [275, 262]], s.t, ph.av);
  flow(ctx, [[150, 280], [198, 214], ...paL.slice(1)], s.t, ph.sl);
  flow(ctx, paR, s.t, ph.sl);
  flow(ctx, [[262, 280], [224, 214], ...aorta.slice(1)], s.t, ph.sl);

  for (const [t, x, y] of [['RA', 145, 150], ['LA', 275, 150], ['RV', 150, 268], ['LV', 268, 268]] as [string, number, number][]) {
    label(ctx, t, x, y, look, { size: 12, weight: 700 });
  }
  const small = { size: 9.5, color: look.muted } as const;
  label(ctx, 'from body', 160, 14, look, small);
  label(ctx, 'from body', 46, 158, look, small);
  label(ctx, 'to lungs', 74, 70, look, small);
  label(ctx, 'to lungs', 360, 98, look, small);
  label(ctx, 'from lungs', 352, 154, look, small);
  label(ctx, 'to body', 316, 76, look, small);

  const sel = HEART_PARTS.find((q) => q.id === str(p, 'sel'));
  if (sel) {
    ctx.beginPath();
    ctx.ellipse(sel.x, sel.y, sel.rx + 5, sel.ry + 5, 0, 0, Math.PI * 2);
    ctx.strokeStyle = look.violet;
    ctx.lineWidth = 2.4;
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // The cycle, step by step, and the ECG under it.
  PHASE_ORDER.forEach((name, i) => {
    const on = name === ph.name;
    const y = 30 + i * 21;
    if (on) {
      ctx.fillStyle = look.dark ? 'rgba(10,132,255,0.3)' : 'rgba(0,122,255,0.13)';
      ctx.beginPath();
      ctx.roundRect(392, y - 9, 162, 18, 5);
      ctx.fill();
    }
    text(ctx, name, 398, y, { size: 10.5, weight: on ? 700 : 500, color: on ? look.ink : look.muted });
  });
  const sound = heartSound(s.t, T);
  if (sound) label(ctx, sound === 'lub' ? '“lub”' : '“dub”', 472, 146, look, { size: 13, color: look.orange });
  plot(ctx, 392, 160, 162, 96, history(s, 3), { tMax: 3, vMax: 1.15, color: look.green, look, title: 'ECG', unit: 'mV' });
  text(ctx, 'P: atria · QRS: ventricles · T: recovery', 392, 268, { size: 9.5, color: look.muted });

  text(ctx, sel ? `${sel.name}: ${sel.does}` : 'Tap any part of the heart to name it · the left side is on the right of the picture', 14, BH - 12,
    { size: 10.5, weight: sel ? 650 : 500, color: sel ? look.violet : look.faint });
}

// --- the double circulation --------------------------------------------------------------------------------

const PUL: Pt[] = [[248, 154], [248, 118], [176, 118], [176, 54], [200, 54], [360, 54], [384, 54], [384, 118], [312, 118], [312, 154]];
const SYS: Pt[] = [[312, 230], [312, 262], [424, 262], [424, 328], [360, 328], [200, 328], [136, 328], [136, 262], [248, 262], [248, 230]];

function measure(pts: Pt[]) {
  const seg = pts.slice(1).map((q, i) => Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]));
  return { seg, total: seg.reduce((a, b) => a + b, 0) };
}

function pointAt(pts: Pt[], f: number): Pt {
  const { seg, total } = measure(pts);
  let d = (((f % 1) + 1) % 1) * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i]) {
      const k = d / (seg[i] || 1);
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
    }
    d -= seg[i];
  }
  return pts[pts.length - 1];
}

/** Fraction along a loop where it is halfway through its capillaries (segment 4 to 5 in both loops). */
function capillaryMid(pts: Pt[]) {
  const { seg, total } = measure(pts);
  return (seg[0] + seg[1] + seg[2] + seg[3] + seg[4] / 2) / total;
}

function splitAt(pts: Pt[], f: number): [Pt[], Pt[]] {
  const m = pointAt(pts, f);
  const { seg, total } = measure(pts);
  let d = f * total;
  let i = 0;
  while (i < seg.length - 1 && d > seg[i]) d -= seg[i++];
  return [[...pts.slice(0, i + 1), m], [m, ...pts.slice(i + 1)]];
}

function drawCirculation(ctx: CanvasRenderingContext2D, p: SimParams, s: BS, look: Look) {
  const red = look.red;
  const blue = look.blue;
  for (const [y, name, sub] of [[26, 'Lungs', 'gas exchange: blood picks up O₂'], [300, 'Body organs', 'cells take O₂, give CO₂']] as [number, string, string][]) {
    ctx.beginPath();
    ctx.roundRect(200, y, 160, 56, 14);
    ctx.fillStyle = look.dark ? '#2c2c2e' : '#f6f6f8';
    ctx.fill();
    ctx.strokeStyle = look.cardEdge;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    text(ctx, name, 280, y + 14, { size: 12, weight: 700, color: look.ink, align: 'center' });
    text(ctx, sub, 280, y + 44, { size: 9.5, color: look.muted, align: 'center' });
  }
  ctx.beginPath();
  ctx.roundRect(222, 154, 52, 76, 10);
  ctx.fillStyle = tint(look, false);
  ctx.fill();
  ctx.strokeStyle = muscle(look);
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(286, 154, 52, 76, 10);
  ctx.fillStyle = tint(look, true);
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.stroke();
  text(ctx, 'Right', 248, 186, { size: 11, weight: 700, color: look.ink, align: 'center' });
  text(ctx, 'side', 248, 200, { size: 10, color: look.muted, align: 'center' });
  text(ctx, 'Left', 312, 186, { size: 11, weight: 700, color: look.ink, align: 'center' });
  text(ctx, 'side', 312, 200, { size: 10, color: look.muted, align: 'center' });
  text(ctx, 'Heart', 280, 244, { size: 10, weight: 650, color: look.muted, align: 'center' });

  const loops: [Pt[], string, string][] = [[PUL, blue, red], [SYS, red, blue]];
  for (const [pts, before, after] of loops) {
    const mid = capillaryMid(pts);
    const [a, b] = splitAt(pts, mid);
    for (const [part, color] of [[a, before], [b, after]] as [Pt[], string][]) {
      polyline(ctx, part);
      ctx.strokeStyle = color;
      ctx.lineWidth = 6;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    for (const f of [0.12, 0.36, 0.64, 0.88]) {
      const [x1, y1] = pointAt(pts, f);
      const [x2, y2] = pointAt(pts, f + 0.012);
      arrow(ctx, x1, y1, x2 + (x2 - x1) * 2, y2 + (y2 - y1) * 2, f < mid ? before : after, { w: 2.5 });
    }
    // Blood cells going round, faster with a faster heart.
    const speed = (num(p, 'hr', 75) / 75) * 0.07;
    for (let i = 0; i < 14; i++) {
      const f = (i / 14 + s.t * speed) % 1;
      const [x, y] = pointAt(pts, f);
      ctx.beginPath();
      ctx.arc(x, y, 4.2, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = f < mid ? before : after;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
  text(ctx, 'Pulmonary circulation', 14, 40, { size: 11.5, weight: 700, color: look.ink });
  text(ctx, 'heart → lungs → heart', 14, 56, { size: 10.5, color: look.muted });
  text(ctx, 'Systemic circulation', 14, 290, { size: 11.5, weight: 700, color: look.ink });
  text(ctx, 'heart → body → heart', 14, 306, { size: 10.5, color: look.muted });
  for (const [y, color, t] of [[150, red, 'Oxygenated'], [170, blue, 'Deoxygenated']] as [number, string, string][]) {
    line(ctx, 444, y, 464, y, color, 6);
    text(ctx, t, 470, y, { size: 10.5, color: look.ink });
  }
  text(ctx, 'Blood passes through the heart twice for every trip round the body · slowed down', 14, BH - 12, { size: 10.5, color: look.faint });
}

// --- breathing -------------------------------------------------------------------------------------------

function drawBreathing(ctx: CanvasRenderingContext2D, p: SimParams, s: BS, look: Look) {
  const b = breath(s.t, num(p, 'br', 12));
  const f = b.f;
  const tv = num(p, 'tv', 500);
  const cx = 190;
  // Ribs lift and swing out a little on the way in.
  ctx.save();
  ctx.strokeStyle = look.dark ? '#a1a1a6' : '#aeaeb2';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const y = 110 + i * 30 - f * (4 + i * 1.5);
    const w = 118 + i * 6 + f * 8;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * 10, y - 6);
      ctx.quadraticCurveTo(cx + side * w, y - 14, cx + side * (w - 6), y + 22);
      ctx.stroke();
    }
  }
  ctx.restore();
  line(ctx, cx, 96, cx, 290, look.dark ? '#a1a1a6' : '#aeaeb2', 7);
  // Lungs.
  for (const side of [-1, 1]) {
    const k = 1 + 0.13 * f;
    ctx.beginPath();
    const lx = cx + side * 62;
    ctx.ellipse(lx, 190, 46 * k, 92 * k, side * -0.08, 0, Math.PI * 2);
    ctx.fillStyle = look.dark ? 'rgba(255,120,140,0.45)' : 'rgba(255,140,160,0.55)';
    ctx.fill();
    ctx.strokeStyle = look.dark ? '#e0708a' : '#c45070';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // Trachea and bronchi.
  ctx.strokeStyle = look.dark ? '#d1d1d6' : '#8e8e93';
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx, 20);
  ctx.lineTo(cx, 116);
  ctx.moveTo(cx, 116);
  ctx.quadraticCurveTo(cx - 20, 130, cx - 52, 156);
  ctx.moveTo(cx, 116);
  ctx.quadraticCurveTo(cx + 20, 130, cx + 52, 156);
  ctx.stroke();
  // Diaphragm: a dome when relaxed, flatter and lower when it contracts.
  const base = 300 + 12 * f;
  const dome = 46 * (1 - f) + 10;
  ctx.beginPath();
  ctx.moveTo(cx - 150, base);
  ctx.quadraticCurveTo(cx, base - 2 * dome, cx + 150, base);
  ctx.strokeStyle = muscle(look);
  ctx.lineWidth = 7;
  ctx.stroke();
  label(ctx, 'Diaphragm', cx + 110, base + 18, look, { color: muscle(look) });
  arrow(ctx, cx, b.inhaling ? 20 : 74, cx, b.inhaling ? 74 : 20, look.blue, { w: 2.6, tag: b.inhaling ? 'air in' : 'air out', look });
  arrow(ctx, cx - 70, base - dome - 6, cx - 70, base - dome + (b.inhaling ? 22 : -22), muscle(look), { w: 2.4 });

  plot(ctx, 364, 30, 188, 104, history(s, 12), { tMax: 12, vMax: tv * 1.15, color: look.blue, look, title: 'Volume breathed in', unit: 'mL', positive: true });
  const lines = b.inhaling
    ? ['Breathing in', 'Diaphragm contracts and flattens', 'Intercostal muscles lift the ribs', 'Chest volume up, pressure down', 'Air flows in']
    : ['Breathing out', 'Diaphragm relaxes into a dome', 'Ribs fall back down and in', 'Chest volume down, pressure up', 'Air flows out'];
  lines.forEach((t, i) => text(ctx, t, 368, 170 + i * 19, { size: i ? 10.5 : 12.5, weight: i ? 500 : 700, color: i ? look.ink : look.blue }));
}

// --- the neuron -------------------------------------------------------------------------------------------

function vColor(v: number, look: Look) {
  const k = Math.max(0, Math.min(1, (v + 80) / 120));
  const lerp = (a: number, b: number) => Math.round(a + (b - a) * k);
  const rest = look.dark ? [90, 140, 220] : [70, 120, 200];
  const hot = [255, 120, 40];
  return `rgb(${lerp(rest[0], hot[0])},${lerp(rest[1], hot[1])},${lerp(rest[2], hot[2])})`;
}

function drawNeuron(ctx: CanvasRenderingContext2D, p: SimParams, s: BS, look: Look) {
  const myelin = bool(p, 'myelin');
  const { x0, x1, y } = NEU;
  const ink = look.dark ? '#d1d1d6' : '#636366';
  // Dendrites into the cell body.
  ctx.strokeStyle = ink;
  ctx.lineCap = 'round';
  for (const [a, len] of [[2.5, 60], [3.0, 70], [3.6, 58], [4.1, 66], [1.9, 54]] as [number, number][]) {
    const ex = 100 + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(100, y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.lineWidth = 1.6;
    for (const d of [-0.5, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex + Math.cos(a + d) * 22, ey + Math.sin(a + d) * 22);
      ctx.stroke();
    }
  }
  // The axon, coloured by its membrane potential.
  const t = s.t;
  for (let x = x0; x < x1; x += 3) {
    const exposed = !myelin || (x - x0) % NEU.node < 6 || x - x0 < 4;
    line(ctx, x, y, x + 3.2, y, exposed ? vColor(potential(x, t, myelin), look) : vColor(-70, look), 6);
  }
  if (myelin) {
    for (let x = x0 + 6; x < x1 - 4; x += NEU.node) {
      ctx.beginPath();
      ctx.roundRect(x, y - 11, NEU.node - 6, 22, 10);
      ctx.fillStyle = look.dark ? 'rgba(255,240,200,0.5)' : 'rgba(255,236,190,0.95)';
      ctx.fill();
      ctx.strokeStyle = look.dark ? '#c9a24a' : '#d0a040';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }
  ctx.beginPath();
  ctx.arc(100, y, 30, 0, Math.PI * 2);
  ctx.fillStyle = look.dark ? '#3a3a52' : '#e6e6f5';
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(96, y - 2, 11, 0, Math.PI * 2);
  ctx.fillStyle = look.dark ? '#7a6aa8' : '#a898d8';
  ctx.fill();
  // Axon terminals.
  for (const dy of [-26, -9, 9, 26]) {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y);
    ctx.quadraticCurveTo(x1 + 24, y + dy * 0.4, x1 + 44, y + dy);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x1 + 47, y + dy, 5, 0, Math.PI * 2);
    ctx.fillStyle = vColor(potential(x1, t, myelin), look);
    ctx.fill();
  }
  // Where the impulse is, with what the ions are doing.
  const tc = t % NEU.period;
  let front = -1;
  for (let x = x0; x <= x1; x += 2) if (arrival(x, myelin) <= tc && (tc - arrival(x, myelin)) * NEU.msPerS < 1) front = x;
  if (front > 0) {
    label(ctx, 'Na⁺ in', front, y - 38, look, { color: look.orange, size: 10.5 });
    arrow(ctx, front, y - 28, front, y - 12, look.orange, { w: 1.8 });
    const back = front - (myelin ? NEU.node : 34);
    if (back > x0 + 4) {
      label(ctx, 'K⁺ out', back, y + 42, look, { color: look.blue, size: 10.5 });
      arrow(ctx, back, y + 12, back, y + 30, look.blue, { w: 1.8 });
    }
  }
  const px = NEU.probe;
  line(ctx, px, y - 70, px, y - 14, look.violet, 1.6);
  ctx.beginPath();
  ctx.arc(px, y - 12, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = look.violet;
  ctx.fill();
  label(ctx, 'Electrode', px, y - 80, look, { color: look.violet, size: 10 });
  for (const [x, t2] of [[100, 'Cell body'], [60, 'Dendrites'], [x1 + 30, 'Terminals']] as [number, string][]) label(ctx, t2, x, x === 60 ? y - 84 : y + 54, look, { size: 10, color: look.muted });
  if (myelin) label(ctx, 'Myelin sheath · gaps are nodes of Ranvier', (x0 + x1) / 2, y + 74, look, { size: 10, color: look.muted });
  plot(ctx, 306, 22, 246, 108, history(s, 4), { tMax: 4, vMax: 90, color: look.violet, look, title: 'Membrane potential at the electrode', unit: 'mV' });
  text(ctx, myelin ? 'The impulse jumps from node to node (saltatory conduction) · slowed down' : 'No myelin: the impulse creeps along the whole membrane · slowed down', 14, BH - 12, { size: 10.5, color: look.faint });
}

// --- the simulator ----------------------------------------------------------------------------------------------

interface BS extends SimState {
  hist: [number, number][];
}

const SETUPS = [
  { value: 'heart', label: 'Heart' },
  { value: 'circulation', label: 'Double circulation' },
  { value: 'breathing', label: 'Breathing' },
  { value: 'neuron', label: 'Nerve impulse' },
];
const setupOf = (p: SimParams) => str(p, 'setup', 'heart');
const is = (...k: string[]) => (p: SimParams) => k.includes(setupOf(p));

export const heartSim: SimDef<BS> = {
  label: 'Body systems',
  subject: 'Biology',
  keywords: 'heart cardiac cycle atrium ventricle valve ecg heartbeat pulse blood circulation double circulation artery vein lungs breathing diaphragm ventilation respiration neuron nerve impulse action potential myelin synapse',
  blurb: 'Beating heart with ECG, circulation, breathing, nerve impulse',
  display: ['sel'],
  autoplay: true,
  defaults: { setup: 'heart', hr: 75, sv: 70, sel: '', br: 12, tv: 500, myelin: true },
  controls: [
    { key: 'setup', label: 'Show', type: 'choice', options: SETUPS },
    { key: 'hr', label: 'Heart rate', type: 'range', min: 40, max: 180, step: 1, unit: 'bpm', show: is('heart', 'circulation') },
    { key: 'sv', label: 'Stroke volume', type: 'range', min: 40, max: 120, step: 5, unit: 'mL', show: is('heart') },
    { key: 'br', label: 'Breathing rate', type: 'range', min: 6, max: 30, step: 1, unit: '/min', show: is('breathing') },
    { key: 'tv', label: 'Tidal volume', type: 'range', min: 300, max: 1500, step: 50, unit: 'mL', show: is('breathing') },
    { key: 'myelin', label: 'Myelinated axon', type: 'toggle', show: is('neuron') },
  ],
  presets: [
    { label: 'Heart at rest', params: { setup: 'heart', hr: 75, sv: 70 } },
    { label: 'During exercise', params: { setup: 'heart', hr: 150, sv: 100 } },
    { label: "Athlete's heart", params: { setup: 'heart', hr: 50, sv: 105 } },
    { label: 'Double circulation', params: { setup: 'circulation', hr: 75 } },
    { label: 'Breathing at rest', params: { setup: 'breathing', br: 12, tv: 500 } },
    { label: 'Deep breathing', params: { setup: 'breathing', br: 8, tv: 1400 } },
    { label: 'Myelinated nerve', params: { setup: 'neuron', myelin: true } },
    { label: 'Unmyelinated nerve', params: { setup: 'neuron', myelin: false } },
  ],
  title: (p) => SETUPS.find((x) => x.value === setupOf(p))?.label ?? 'Body systems',
  init: () => ({ t: 0, done: false, hist: [] }),
  step: (p, s, dt) => {
    s.t += dt;
    const setup = setupOf(p);
    let v: number | null = null;
    let keep = 3;
    if (setup === 'heart') v = ecg(s.t, 60 / num(p, 'hr', 75));
    else if (setup === 'breathing') {
      v = breath(s.t, num(p, 'br', 12)).f * num(p, 'tv', 500);
      keep = 12;
    } else if (setup === 'neuron') {
      v = potential(NEU.probe, s.t, bool(p, 'myelin'));
      keep = 4;
    }
    if (v === null) return;
    const last = s.hist[s.hist.length - 1];
    if (!last || s.t - last[0] >= 1 / 120) {
      s.hist.push([s.t, v]);
      while (s.hist.length && s.hist[0][0] < s.t - keep - 0.5) s.hist.shift();
    }
  },
  draw: (ctx, p, s, look) => {
    const setup = setupOf(p);
    if (setup === 'heart') drawHeart(ctx, p, s, look);
    else if (setup === 'circulation') drawCirculation(ctx, p, s, look);
    else if (setup === 'breathing') drawBreathing(ctx, p, s, look);
    else drawNeuron(ctx, p, s, look);
  },
  grab: (p, _s, x, y): SimGrab | null => {
    if (setupOf(p) !== 'heart') return null;
    const part = heartPartAt(x, y);
    if (!part) return null;
    return { cursor: 'pointer', tap: { sel: str(p, 'sel') === part.id ? '' : part.id }, hint: part.name };
  },
  readouts: (p, s): Readout[] => {
    const setup = setupOf(p);
    if (setup === 'heart') {
      const hr = num(p, 'hr', 75);
      const ph = cardiacPhase(s.t, 60 / hr);
      return [
        { label: 'Heart rate', value: `${fmt(hr)} bpm` },
        { label: 'Phase', value: ph.name, color: 'blue' },
        { label: 'AV valves', value: ph.av ? 'Open' : 'Shut' },
        { label: 'Semilunar', value: ph.sl ? 'Open' : 'Shut' },
        { label: 'Cardiac output', value: `${fmt(cardiacOutput(hr, num(p, 'sv', 70)), 3)} L/min`, color: 'red' },
      ];
    }
    if (setup === 'circulation') {
      const hr = num(p, 'hr', 75);
      return [
        { label: 'Heart rate', value: `${fmt(hr)} bpm` },
        { label: 'Circuits', value: 'Pulmonary and systemic' },
        { label: 'Through the heart', value: 'Twice per trip' },
        { label: 'Highest pressure', value: 'Aorta (left side)', color: 'red' },
      ];
    }
    if (setup === 'breathing') {
      const b = breath(s.t, num(p, 'br', 12));
      const tv = num(p, 'tv', 500);
      return [
        { label: 'Now', value: b.inhaling ? 'Breathing in' : 'Breathing out', color: 'blue' },
        { label: 'Lung volume', value: `${fmt((2400 + tv * b.f) / 1000, 3)} L` },
        { label: 'Rate', value: `${fmt(num(p, 'br', 12))} /min` },
        { label: 'Ventilation', value: `${fmt((num(p, 'br', 12) * tv) / 1000, 3)} L/min`, color: 'green' },
      ];
    }
    const myelin = bool(p, 'myelin');
    const ms = ((s.t % NEU.period) - arrival(NEU.probe, myelin)) * NEU.msPerS;
    return [
      { label: 'Resting potential', value: '−70 mV' },
      { label: 'At the electrode', value: `${Math.round(apShape(ms))} mV`, color: 'violet' },
      { label: 'Stage', value: apStage(ms) },
      { label: 'Real speed', value: myelin ? 'up to 120 m/s' : 'about 1 m/s', color: myelin ? 'green' : 'orange' },
    ];
  },
  formulas: (p): Formula[] => {
    const setup = setupOf(p);
    if (setup === 'heart') {
      const hr = num(p, 'hr', 75);
      const sv = num(p, 'sv', 70);
      return [
        { label: 'Cardiac output', tex: `CO = HR \\times SV = ${hr} \\times ${sv}\\ \\text{mL} = ${fmt(cardiacOutput(hr, sv), 3)}\\ \\text{L/min}` },
        { label: 'One heartbeat lasts', tex: `T = \\frac{60}{HR} = \\frac{60}{${hr}} = ${fmt(60 / hr, 3)}\\ \\text{s}` },
      ];
    }
    if (setup === 'breathing') {
      const br = num(p, 'br', 12);
      const tv = num(p, 'tv', 500);
      return [
        { label: 'Minute ventilation', tex: `V_E = f \\times V_T = ${br} \\times ${tv}\\ \\text{mL} = ${fmt((br * tv) / 1000, 3)}\\ \\text{L/min}` },
        { label: "Boyle's law: bigger chest, lower pressure", tex: 'pV = \\text{constant}' },
      ];
    }
    if (setup === 'neuron') return [{ label: 'Speed of the impulse', tex: 'v = \\frac{d}{t}' }, { label: 'Ions', tex: '\\text{Na}^+\\ \\text{in (depolarise)}, \\quad \\text{K}^+\\ \\text{out (repolarise)}' }];
    return [{ label: 'Blood flow', tex: '\\text{body} \\to \\text{RA} \\to \\text{RV} \\to \\text{lungs} \\to \\text{LA} \\to \\text{LV} \\to \\text{body}' }];
  },
};
