/**
 * Magnetism and electromagnetic induction: magnets and their field lines, the field round a
 * wire and inside a solenoid, a magnet pushed through a coil, a generator, and a charge
 * circling in a field.
 *
 * Magnet field lines are traced numerically from a pair of poles per magnet, so the pattern is
 * the real one for any position the magnets are dragged to. Wire, solenoid and induction numbers
 * use the textbook formulas in SI units.
 */

import { BH, BW, arrow, label, line, num, plot, str, text, tf, fmt } from './kit.ts';
import type { Formula, Look, Readout, SimDef, SimGrab, SimParams, SimState } from './kit.ts';

export const MU0 = 4e-7 * Math.PI;
const E = 1.602176634e-19;
const U = 1.66053907e-27;

// --- the physics ----------------------------------------------------------------------------------

/** Field at distance r (m) from a long straight wire carrying I (A), in tesla. */
export const wireField = (I: number, r: number) => (MU0 * I) / (2 * Math.PI * r);
/** Field inside a long solenoid: N turns over length L (m), current I (A), core permeability μr. */
export const solenoidField = (N: number, L: number, I: number, mur = 1) => (MU0 * mur * N * I) / L;
/** Flux of a dipole of moment m (A m²) through a loop of radius a, the dipole on the axis at distance d (m). */
export const loopFlux = (m: number, a: number, d: number) => (MU0 * m * a * a) / (2 * Math.pow(a * a + d * d, 1.5));
/** EMF in an N-turn coil as the dipole moves along the axis at v (m/s), d measured from the coil. Faraday and Lenz. */
export function inducedEmf(N: number, m: number, a: number, d: number, v: number): number {
  const dPhi = (-3 * MU0 * m * a * a * d) / (2 * Math.pow(a * a + d * d, 2.5));
  return -N * dPhi * v;
}
/** A generator coil: N turns of area A (m²) turning at ω (rad/s) in B (T), angle ωt from the face-on position. */
export const generatorEmf = (N: number, B: number, A: number, w: number, t: number) => N * B * A * w * Math.sin(w * t);
/** Radius of the circle a charge q (C) of mass m (kg) moving at v (m/s) follows in B (T). */
export const gyroRadius = (m: number, v: number, q: number, B: number) => (m * v) / (Math.abs(q) * B);

// --- magnets as poles --------------------------------------------------------------------------------

interface Pole { x: number; y: number; q: number }

const BAR_L = 140;
const BAR_H = 30;
const PAIR_L = 116;
const SOL = { x0: 170, x1: 390, y: 180, r: 50 };

interface Magnet { x: number; y: number; len: number; /** N end on the right. */ right: boolean }

function magnetsOf(p: SimParams): Magnet[] {
  const setup = str(p, 'setup', 'bar');
  if (setup === 'bar') return [{ x: num(p, 'mx', 280), y: num(p, 'my', 190), len: BAR_L, right: str(p, 'flip') !== 'yes' }];
  if (setup === 'pair') {
    const attract = str(p, 'mode', 'attract') === 'attract';
    return [
      { x: 140, y: 190, len: PAIR_L, right: true },
      { x: num(p, 'm2x', 420), y: 190, len: PAIR_L, right: attract },
    ];
  }
  return [];
}

function polesOf(p: SimParams): Pole[] {
  if (str(p, 'setup') === 'solenoid') {
    const right = str(p, 'dir', 'down') === 'down';
    const out: Pole[] = [];
    for (let k = -4; k <= 4; k++) {
      const y = SOL.y + k * 10;
      out.push({ x: right ? SOL.x1 : SOL.x0, y, q: 1 / 9 }, { x: right ? SOL.x0 : SOL.x1, y, q: -1 / 9 });
    }
    return out;
  }
  return magnetsOf(p).flatMap((m) => {
    const h = m.len / 2 - 10;
    return [{ x: m.x + (m.right ? h : -h), y: m.y, q: 1 }, { x: m.x + (m.right ? -h : h), y: m.y, q: -1 }];
  });
}

export function poleField(poles: Pole[], x: number, y: number): [number, number] {
  let bx = 0;
  let by = 0;
  for (const p of poles) {
    const dx = x - p.x;
    const dy = y - p.y;
    const r2 = dx * dx + dy * dy + 4;
    const k = p.q / (r2 * Math.sqrt(r2));
    bx += k * dx;
    by += k * dy;
  }
  return [bx, by];
}

/**
 * A field line from (x, y), followed with midpoint steps of 3 px until it reaches a pole of the
 * other kind or leaves the box. `dir` −1 follows the field backwards (from a south pole).
 */
function trace(poles: Pole[], x: number, y: number, dir = 1): { pts: [number, number][]; sunk: boolean } {
  const sinks = poles.filter((p) => p.q * dir < 0);
  const pts: [number, number][] = [[x, y]];
  for (let i = 0; i < 700; i++) {
    const [ax, ay] = poleField(poles, x, y);
    const a = (Math.hypot(ax, ay) || 1) * dir;
    const [bx, by] = poleField(poles, x + (1.5 * ax) / a, y + (1.5 * ay) / a);
    const b = (Math.hypot(bx, by) || 1) * dir;
    x += (3 * bx) / b;
    y += (3 * by) / b;
    pts.push([x, y]);
    if (x < -60 || x > BW + 60 || y < -60 || y > BH + 60) return { pts, sunk: false };
    if (sinks.some((s) => Math.hypot(x - s.x, y - s.y) < 4)) return { pts, sunk: true };
  }
  return { pts, sunk: false };
}

const lineMemo = new Map<string, [number, number][][]>();
function fieldLines(p: SimParams): [number, number][][] {
  const key = ['setup', 'mx', 'my', 'flip', 'm2x', 'mode', 'dir'].map((k) => String(p[k])).join('|');
  let got = lineMemo.get(key);
  if (got) return got;
  const poles = polesOf(p);
  got = [];
  if (str(p, 'setup') === 'solenoid') {
    const right = str(p, 'dir', 'down') === 'down';
    for (const s of poles.filter((q) => q.q > 0)) {
      got.push(trace(poles, s.x + (right ? 4 : -4), s.y).pts);
    }
    for (const s of [poles[0], poles[poles.length - 2]]) {
      for (const t of [-1.2, -0.6, 0.6, 1.2]) {
        const a = (right ? 0 : Math.PI) + t * (s.y < SOL.y ? 1 : -1) * (right ? -1 : 1);
        got.push(trace(poles, s.x + Math.cos(a) * 5, s.y + Math.sin(a) * 5).pts);
      }
    }
  } else {
    for (const s of poles.filter((q) => q.q > 0)) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + Math.PI / 16;
        got.push(trace(poles, s.x + Math.cos(a) * 5, s.y + Math.sin(a) * 5).pts);
      }
    }
    // Lines that come in to a south pole from outside the box: traced back from it, kept only if they
    // leave (the rest are the lines already drawn from N), and turned round so the arrows follow the field.
    for (const s of poles.filter((q) => q.q < 0)) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + Math.PI / 16;
        const back = trace(poles, s.x + Math.cos(a) * 5, s.y + Math.sin(a) * 5, -1);
        if (!back.sunk) got.push(back.pts.reverse());
      }
    }
  }
  lineMemo.set(key, got);
  if (lineMemo.size > 24) lineMemo.delete(lineMemo.keys().next().value!);
  return got;
}

/** Where the field is zero between two repelling magnets, if they repel. */
function neutralPoint(p: SimParams): [number, number] | null {
  if (str(p, 'setup') !== 'pair' || str(p, 'mode', 'attract') !== 'repel') return null;
  const [a, b] = magnetsOf(p);
  const poles = polesOf(p);
  let best: [number, number] | null = null;
  let bm = Infinity;
  for (let x = a.x + a.len / 2 + 2; x < b.x - b.len / 2 - 2; x += 1) {
    const [bx, by] = poleField(poles, x, a.y);
    const m = Math.hypot(bx, by);
    if (m < bm) {
      bm = m;
      best = [x, a.y];
    }
  }
  return best;
}

// --- running state ---------------------------------------------------------------------------------

interface MS extends SimState {
  /** Induction: magnet centre (px) and speed (px/s). */
  x: number;
  v: number;
  emf: number;
  hist: [number, number][];
  /** Charge: angle round its circle, slowed down to be watchable. */
  phi: number;
}

/** Induction layout: 1 px = 0.5 mm. */
const IND = { xc: 330, y: 140, a: 0.02, px: 0.0005, mag: 100, m: 2 };
const AMP = 170;

function inductionX(p: SimParams, t: number): [number, number] {
  const w = 2 * Math.PI * num(p, 'freq', 0.5);
  return [IND.xc + AMP * Math.sin(w * t - Math.PI / 2), AMP * w * Math.cos(w * t - Math.PI / 2)];
}

/**
 * The pole the coil's left face becomes while the magnet moves (Lenz's law), or null when it is
 * still. `right` is true when the magnet's N end is on its right.
 */
export function coilPoles(x: number, v: number, right: boolean): 'N' | 'S' | null {
  if (Math.abs(v) < 1) return null;
  const onLeft = x < IND.xc;
  const approaching = onLeft === v > 0;
  // The magnet's end facing the coil.
  const facingN = onLeft ? right : !right;
  const nearN = approaching ? facingN : !facingN;
  const leftN = onLeft ? nearN : !nearN;
  return leftN ? 'N' : 'S';
}

/** Full scale for the galvanometer and graph: the peak EMF, a quarter more for headroom. */
function inductionPeak(p: SimParams): number {
  const speed = str(p, 'motion', 'auto') === 'hand' ? 0.4 : AMP * 2 * Math.PI * num(p, 'freq', 0.5) * IND.px;
  return 1.25 * Math.abs(inducedEmf(num(p, 'turns', 200), IND.m, IND.a, -IND.a / 2, speed));
}

function inductionEmf(p: SimParams, x: number, v: number): number {
  const m = IND.m * (str(p, 'flip') === 'yes' ? -1 : 1);
  return inducedEmf(num(p, 'turns', 200), m, IND.a, (x - IND.xc) * IND.px, v * IND.px);
}

const GEN = { A: 0.01 };
const PARTICLES: Record<string, { label: string; m: number; q: number }> = {
  proton: { label: 'Proton', m: 1.007 * U, q: E },
  antiproton: { label: 'Antiproton', m: 1.007 * U, q: -E },
  alpha: { label: 'Alpha particle', m: 4.002 * U, q: 2 * E },
};

// --- drawing helpers ----------------------------------------------------------------------------------

function chevron(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, color: string, s = 5) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.moveTo(-s, -s * 0.8);
  ctx.lineTo(s * 0.6, 0);
  ctx.lineTo(-s, s * 0.8);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.8;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

function drawLines(ctx: CanvasRenderingContext2D, lines: [number, number][][], look: Look) {
  const color = look.dark ? '#6e6e73' : '#aeaeb2';
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.3;
  for (const pts of lines) {
    if (pts.length < 6) continue;
    ctx.beginPath();
    ctx.moveTo(...pts[0]);
    for (const q of pts) ctx.lineTo(...q);
    ctx.stroke();
    const i = Math.min(pts.length - 2, Math.max(4, Math.floor(pts.length * 0.4)));
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    if (x1 > 4 && x1 < BW - 4 && y1 > 4 && y1 < BH - 4) chevron(ctx, x1, y1, Math.atan2(y2 - y1, x2 - x1), color);
  }
  ctx.restore();
}

function drawMagnet(ctx: CanvasRenderingContext2D, m: Magnet, look: Look, h = BAR_H) {
  const red = look.red;
  const blue = look.blue;
  const x0 = m.x - m.len / 2;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x0, m.y - h / 2, m.len, h, 5);
  ctx.clip();
  ctx.fillStyle = m.right ? blue : red;
  ctx.fillRect(x0, m.y - h / 2, m.len / 2, h);
  ctx.fillStyle = m.right ? red : blue;
  ctx.fillRect(m.x, m.y - h / 2, m.len / 2, h);
  ctx.restore();
  text(ctx, m.right ? 'S' : 'N', x0 + 14, m.y + 0.5, { size: 15, weight: 750, color: '#ffffff', align: 'center' });
  text(ctx, m.right ? 'N' : 'S', x0 + m.len - 14, m.y + 0.5, { size: 15, weight: 750, color: '#ffffff', align: 'center' });
}

function drawCompass(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, look: Look, r = 17) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = look.card;
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 5;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = look.ink;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.translate(x, y);
  ctx.rotate(a);
  const L = r - 3;
  ctx.beginPath();
  ctx.moveTo(L, 0);
  ctx.lineTo(0, -3.6);
  ctx.lineTo(0, 3.6);
  ctx.closePath();
  ctx.fillStyle = look.red;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-L, 0);
  ctx.lineTo(0, -3.6);
  ctx.lineTo(0, 3.6);
  ctx.closePath();
  ctx.fillStyle = look.dark ? '#d1d1d6' : '#8e8e93';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 1.8, 0, Math.PI * 2);
  ctx.fillStyle = look.ink;
  ctx.fill();
  ctx.restore();
}

function compassAngle(p: SimParams): number {
  const [bx, by] = poleField(polesOf(p), num(p, 'cx', 120), num(p, 'cy', 90));
  if (str(p, 'setup') === 'solenoid') {
    // Inside the coil the field runs from the S end to the N end.
    const x = num(p, 'cx', 120);
    const y = num(p, 'cy', 90);
    if (x > SOL.x0 && x < SOL.x1 && Math.abs(y - SOL.y) < SOL.r - 6) return str(p, 'dir', 'down') === 'down' ? 0 : Math.PI;
  }
  return Math.atan2(by, bx);
}

// --- each setup ---------------------------------------------------------------------------------------

function drawMagnets(ctx: CanvasRenderingContext2D, p: SimParams, look: Look) {
  drawLines(ctx, fieldLines(p), look);
  for (const m of magnetsOf(p)) drawMagnet(ctx, m, look);
  const np = neutralPoint(p);
  if (np) {
    line(ctx, np[0] - 6, np[1] - 6 - 40, np[0] + 6, np[1] + 6 - 40, look.orange, 2.4);
    line(ctx, np[0] - 6, np[1] + 6 - 40, np[0] + 6, np[1] - 6 - 40, look.orange, 2.4);
    line(ctx, np[0], np[1] - 30, np[0], np[1] - 4, look.orange, 1.2, [3, 3]);
    label(ctx, 'Neutral point', np[0], np[1] - 58, look, { color: look.orange });
  }
  drawCompass(ctx, num(p, 'cx', 120), num(p, 'cy', 90), compassAngle(p), look);
  text(ctx, 'Drag the compass or a magnet', 12, BH - 12, { size: 10.5, color: look.faint });
}

function drawSolenoid(ctx: CanvasRenderingContext2D, p: SimParams, look: Look) {
  const right = str(p, 'dir', 'down') === 'down';
  drawLines(ctx, fieldLines(p), look);
  const muted = look.dark ? '#6e6e73' : '#aeaeb2';
  if (str(p, 'core') === 'iron') {
    ctx.fillStyle = look.dark ? '#48484a' : '#d1d1d6';
    ctx.fillRect(SOL.x0 - 14, SOL.y - 20, SOL.x1 - SOL.x0 + 28, 40);
  }
  // Inside: a uniform field from the S end to the N end.
  for (const dy of [-30, -15, 0, 15, 30]) {
    line(ctx, SOL.x0 + 4, SOL.y + dy, SOL.x1 - 4, SOL.y + dy, muted, 1.3);
    chevron(ctx, (SOL.x0 + SOL.x1) / 2, SOL.y + dy, right ? 0 : Math.PI, muted);
  }
  const turns = 12;
  const w = (SOL.x1 - SOL.x0) / turns;
  ctx.strokeStyle = look.orange;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let k = 0; k <= turns; k++) {
    const x = SOL.x0 + k * w;
    ctx.beginPath();
    ctx.ellipse(x, SOL.y, 9, SOL.r, 0, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
  }
  for (const k of [3, 6, 9]) arrow(ctx, SOL.x0 + k * w + 10, SOL.y + (right ? -14 : 14), SOL.x0 + k * w + 10, SOL.y + (right ? 14 : -14), look.orange, { w: 2 });
  label(ctx, 'I', SOL.x0 + 3 * w + 24, SOL.y, look, { color: look.orange, size: 13 });
  text(ctx, right ? 'S' : 'N', SOL.x0 - 30, SOL.y, { size: 18, weight: 750, color: right ? look.blue : look.red, align: 'center' });
  text(ctx, right ? 'N' : 'S', SOL.x1 + 30, SOL.y, { size: 18, weight: 750, color: right ? look.red : look.blue, align: 'center' });
  drawCompass(ctx, num(p, 'cx', 120), num(p, 'cy', 90), compassAngle(p), look);
  text(ctx, 'Right-hand grip: fingers along the current, thumb points to N · drag the compass', 12, BH - 12, { size: 10.5, color: look.faint });
}

const WIRE = { x: 280, y: 190, px: 0.0005 };

function drawWire(ctx: CanvasRenderingContext2D, p: SimParams, look: Look) {
  const out = str(p, 'dir', 'out') === 'out';
  const muted = look.dark ? '#6e6e73' : '#aeaeb2';
  for (const r of [40, 80, 125, 170]) {
    ctx.beginPath();
    ctx.arc(WIRE.x, WIRE.y, r, 0, Math.PI * 2);
    ctx.strokeStyle = muted;
    ctx.lineWidth = 1.3;
    ctx.stroke();
    for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
      const x = WIRE.x + Math.cos(a + 0.4) * r;
      const y = WIRE.y + Math.sin(a + 0.4) * r;
      chevron(ctx, x, y, a + 0.4 + (out ? -Math.PI / 2 : Math.PI / 2), muted);
    }
  }
  // Small compasses round the wire.
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    drawCompass(ctx, WIRE.x + Math.cos(a) * 102, WIRE.y + Math.sin(a) * 102, a + (out ? -Math.PI / 2 : Math.PI / 2), look, 10);
  }
  ctx.beginPath();
  ctx.arc(WIRE.x, WIRE.y, 15, 0, Math.PI * 2);
  ctx.fillStyle = look.card;
  ctx.fill();
  ctx.strokeStyle = look.orange;
  ctx.lineWidth = 2.6;
  ctx.stroke();
  if (out) {
    ctx.beginPath();
    ctx.arc(WIRE.x, WIRE.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = look.orange;
    ctx.fill();
  } else {
    line(ctx, WIRE.x - 7, WIRE.y - 7, WIRE.x + 7, WIRE.y + 7, look.orange, 2.6);
    line(ctx, WIRE.x - 7, WIRE.y + 7, WIRE.x + 7, WIRE.y - 7, look.orange, 2.6);
  }
  const px = num(p, 'px', 400);
  const py = num(p, 'py', 120);
  const a = Math.atan2(py - WIRE.y, px - WIRE.x) + (out ? -Math.PI / 2 : Math.PI / 2);
  arrow(ctx, px, py, px + Math.cos(a) * 34, py + Math.sin(a) * 34, look.violet, { w: 2.6, tag: 'B', look });
  ctx.beginPath();
  ctx.arc(px, py, 6, 0, Math.PI * 2);
  ctx.fillStyle = look.violet;
  ctx.fill();
  line(ctx, WIRE.x, WIRE.y, px, py, look.violet, 1, [3, 4]);
  text(ctx, out ? 'Current out of the page (•): field anticlockwise' : 'Current into the page (×): field clockwise', 12, BH - 12, { size: 10.5, color: look.faint });
  text(ctx, 'Drag the probe', BW - 12, BH - 12, { size: 10.5, color: look.faint, align: 'right' });
}

function wireReading(p: SimParams) {
  const r = Math.max(1, Math.hypot(num(p, 'px', 400) - WIRE.x, num(p, 'py', 120) - WIRE.y)) * WIRE.px;
  return { r, B: wireField(num(p, 'I', 10), r) };
}

function drawInduction(ctx: CanvasRenderingContext2D, p: SimParams, s: MS, look: Look) {
  const x = s.x;
  const right = str(p, 'flip') !== 'yes';
  const coilW = 60;
  const loops = 9;
  ctx.lineCap = 'round';
  // Back halves of the coil, then the magnet, then the front halves, so it passes through.
  const coil = (front: boolean) => {
    ctx.strokeStyle = front ? look.orange : look.dark ? '#7a5a2a' : '#f2c48d';
    ctx.lineWidth = 3;
    for (let k = 0; k < loops; k++) {
      const cx = IND.xc - coilW / 2 + (k * coilW) / (loops - 1);
      ctx.beginPath();
      ctx.ellipse(cx, IND.y, 10, 48, 0, front ? -Math.PI / 2 : Math.PI / 2, front ? Math.PI / 2 : (3 * Math.PI) / 2);
      ctx.stroke();
    }
  };
  coil(false);
  drawMagnet(ctx, { x, y: IND.y, len: IND.mag, right }, look, 26);
  coil(true);

  // Leads to the galvanometer.
  const gx = 470;
  const gy = 300;
  ctx.strokeStyle = look.orange;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(IND.xc + coilW / 2, IND.y + 46);
  ctx.lineTo(IND.xc + coilW / 2, gy + 30);
  ctx.lineTo(gx - 30, gy + 30);
  ctx.moveTo(IND.xc - coilW / 2, IND.y + 46);
  ctx.lineTo(IND.xc - coilW / 2, gy + 44);
  ctx.lineTo(gx + 30, gy + 44);
  ctx.lineTo(gx + 30, gy + 30);
  ctx.stroke();

  // Galvanometer: centre-zero, full scale ±Vmax.
  const vmax = inductionPeak(p);
  ctx.beginPath();
  ctx.roundRect(gx - 54, gy - 50, 108, 80, 10);
  ctx.fillStyle = look.dark ? '#2c2c2e' : '#f6f6f8';
  ctx.fill();
  ctx.strokeStyle = look.cardEdge;
  ctx.lineWidth = 1.2;
  ctx.stroke();
  for (let k = -5; k <= 5; k++) {
    const a = -Math.PI / 2 + k * 0.13;
    line(ctx, gx + Math.cos(a) * 38, gy + 14 + Math.sin(a) * 38, gx + Math.cos(a) * (k % 5 ? 43 : 47), gy + 14 + Math.sin(a) * (k % 5 ? 43 : 47), look.muted, 1.2);
  }
  text(ctx, '0', gx, gy - 40, { size: 9, color: look.muted, align: 'center' });
  const f = Math.max(-1, Math.min(1, s.emf / vmax));
  const na = -Math.PI / 2 + f * 0.65;
  line(ctx, gx, gy + 14, gx + Math.cos(na) * 46, gy + 14 + Math.sin(na) * 46, look.red, 2);
  ctx.beginPath();
  ctx.arc(gx, gy + 14, 3, 0, Math.PI * 2);
  ctx.fillStyle = look.ink;
  ctx.fill();
  text(ctx, 'G', gx + 40, gy + 20, { size: 11, weight: 700, color: look.muted, align: 'center' });

  // Lenz: the face nearest the magnet repels a pole coming in and attracts one going away.
  const leftFace = coilPoles(x, s.v, right);
  if (leftFace && Math.abs(s.emf) > vmax * 0.04) {
    const lx = IND.xc - coilW / 2 - 22;
    const rx = IND.xc + coilW / 2 + 22;
    text(ctx, leftFace, lx, IND.y - 64, { size: 15, weight: 750, color: leftFace === 'N' ? look.red : look.blue, align: 'center' });
    text(ctx, leftFace === 'N' ? 'S' : 'N', rx, IND.y - 64, { size: 15, weight: 750, color: leftFace === 'N' ? look.blue : look.red, align: 'center' });
  }
  const tMax = 4;
  const pts = s.hist.map(([t, e]) => [t - (s.t - tMax), e] as [number, number]).filter(([t]) => t >= 0);
  plot(ctx, 16, 236, 230, 100, pts, { tMax, vMax: vmax, color: look.green, look, title: 'EMF', unit: 'V' });
  text(ctx, str(p, 'motion', 'auto') === 'hand' ? 'Drag the magnet through the coil' : 'Drag the magnet to move it by hand', 12, BH - 12, { size: 10.5, color: look.faint });
}

function drawGenerator(ctx: CanvasRenderingContext2D, p: SimParams, s: MS, look: Look) {
  const w = 2 * Math.PI * num(p, 'freq', 0.5);
  const th = w * s.t;
  const muted = look.dark ? '#6e6e73' : '#aeaeb2';
  for (const y of [130, 160, 190, 220, 250]) {
    line(ctx, 150, y, 410, y, muted, 1.2, [5, 5]);
    chevron(ctx, 280, y, 0, muted);
  }
  ctx.fillStyle = look.red;
  ctx.beginPath();
  ctx.roundRect(70, 100, 80, 180, 8);
  ctx.fill();
  ctx.fillStyle = look.blue;
  ctx.beginPath();
  ctx.roundRect(410, 100, 80, 180, 8);
  ctx.fill();
  text(ctx, 'N', 110, 190, { size: 22, weight: 750, color: '#ffffff', align: 'center' });
  text(ctx, 'S', 450, 190, { size: 22, weight: 750, color: '#ffffff', align: 'center' });
  // The coil turns about a vertical axle; seen from the front its width is W sin θ.
  const half = 92 * Math.sin(th);
  const front = Math.cos(th) >= 0;
  line(ctx, 280, 108, 280, 318, look.muted, 2);
  ctx.beginPath();
  ctx.rect(280 - Math.abs(half), 126, 2 * Math.abs(half), 128);
  ctx.strokeStyle = front ? look.orange : look.dark ? '#a8742f' : '#e6a85a';
  ctx.lineWidth = 4;
  ctx.stroke();
  // Slip rings (AC) or a split-ring commutator (DC), with brushes.
  const dc = str(p, 'output', 'ac') === 'dc';
  ctx.strokeStyle = look.ink;
  ctx.lineWidth = 2;
  for (const [y, k] of [[290, 0], [306, 1]] as [number, number][]) {
    ctx.beginPath();
    if (dc && k === 0) {
      ctx.ellipse(280, 298, 18, 6, 0, th % Math.PI, (th % Math.PI) + Math.PI * 0.9);
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(280, 298, 18, 6, 0, (th % Math.PI) + Math.PI, (th % Math.PI) + Math.PI * 1.9);
    } else if (!dc) ctx.ellipse(280, y, 16, 5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  line(ctx, 250, 298, 262, 298, look.muted, 4);
  line(ctx, 298, 298, 310, 298, look.muted, 4);
  text(ctx, dc ? 'Split-ring commutator: DC' : 'Slip rings: AC', 280, 336, { size: 11, weight: 600, color: look.muted, align: 'center' });
  const N = num(p, 'turns', 100);
  const B = num(p, 'B', 0.2);
  const peak = N * B * GEN.A * w;
  const tMax = Math.max(2, 2 / num(p, 'freq', 0.5));
  const pts = s.hist.map(([t, e]) => [t - (s.t - tMax), e] as [number, number]).filter(([t]) => t >= 0);
  plot(ctx, 330, 8, 220, 80, pts, { tMax, vMax: peak * 1.1 || 1, color: look.green, look, title: 'EMF', unit: 'V', positive: dc });
}

function drawCharge(ctx: CanvasRenderingContext2D, p: SimParams, s: MS, look: Look) {
  const part = PARTICLES[str(p, 'particle', 'proton')] ?? PARTICLES.proton;
  const B = num(p, 'B', 10) / 1000;
  const v = num(p, 'v', 1) * 1e5;
  const r = gyroRadius(part.m, v, part.q, B);
  const k = Math.min(1500, 150 / r);
  const R = r * k;
  const muted = look.dark ? '#5a5a5e' : '#c7c7cc';
  for (let x = 20; x < BW; x += 40) for (let y = 20; y < BH - 20; y += 40) {
    line(ctx, x - 3.5, y - 3.5, x + 3.5, y + 3.5, muted, 1.4);
    line(ctx, x - 3.5, y + 3.5, x + 3.5, y - 3.5, muted, 1.4);
  }
  const cx = BW / 2;
  const cy = BH / 2 - 6;
  const pos = part.q > 0;
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = look.muted;
  ctx.lineWidth = 1.4;
  ctx.setLineDash([5, 5]);
  ctx.stroke();
  ctx.setLineDash([]);
  // Starts at the bottom (positive) or top (negative) moving right; the force points to the centre.
  const a = pos ? Math.PI / 2 - s.phi : -Math.PI / 2 + s.phi;
  const x = cx + Math.cos(a) * R;
  const y = cy + Math.sin(a) * R;
  const tx = pos ? Math.sin(a) : -Math.sin(a);
  const ty = pos ? -Math.cos(a) : Math.cos(a);
  arrow(ctx, x, y, x + tx * 44, y + ty * 44, look.blue, { w: 2.4, tag: 'v', look });
  arrow(ctx, x, y, x + (cx - x) / R * 38, y + (cy - y) / R * 38, look.red, { w: 2.4, tag: 'F', look });
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fillStyle = pos ? look.red : look.blue;
  ctx.fill();
  text(ctx, pos ? '+' : '−', x, y + 0.5, { size: 12, weight: 800, color: '#ffffff', align: 'center' });
  // Scale bar.
  // About half the radius, rounded down to 1, 2 or 5 × 10ⁿ.
  const e = Math.pow(10, Math.floor(Math.log10(r * 0.5)));
  const m = (r * 0.5) / e;
  const bar = (m >= 5 ? 5 : m >= 2 ? 2 : 1) * e;
  const barPx = bar * k;
  line(ctx, BW - 20 - barPx, BH - 16, BW - 20, BH - 16, look.ink, 2);
  text(ctx, `${fmt(bar * 100)} cm`, BW - 20 - barPx / 2, BH - 27, { size: 10, color: look.muted, align: 'center' });
  text(ctx, 'B into the page (×) · motion slowed down', 12, BH - 12, { size: 10.5, color: look.faint });
}

// --- editing by hand ----------------------------------------------------------------------------------------

function grab(p: SimParams, _s: MS, x: number, y: number): SimGrab | null {
  const setup = str(p, 'setup', 'bar');
  const clampX = (v: number) => Math.max(20, Math.min(BW - 20, v));
  const clampY = (v: number) => Math.max(20, Math.min(BH - 24, v));
  if (setup === 'bar' || setup === 'pair' || setup === 'solenoid') {
    if (Math.hypot(x - num(p, 'cx', 120), y - num(p, 'cy', 90)) < 22) {
      return { hint: 'Drag the compass', drag: (bx, by) => ({ cx: clampX(bx), cy: clampY(by) }) };
    }
    const ms = magnetsOf(p);
    const m = ms[ms.length - 1];
    if (m && Math.abs(x - m.x) < m.len / 2 && Math.abs(y - m.y) < BAR_H / 2 + 4) {
      const dx = x - m.x;
      const dy = y - m.y;
      if (setup === 'bar') return { hint: 'Drag the magnet', drag: (bx, by) => ({ mx: Math.max(80, Math.min(BW - 80, bx - dx)), my: Math.max(30, Math.min(BH - 40, by - dy)) }) };
      return { hint: 'Drag the magnet', drag: (bx) => ({ m2x: Math.max(140 + PAIR_L + 16, Math.min(BW - 60, bx - dx)) }) };
    }
    return null;
  }
  if (setup === 'wire') {
    if (Math.hypot(x - num(p, 'px', 400), y - num(p, 'py', 120)) < 16) {
      return { hint: 'Drag the probe', drag: (bx, by) => {
        const d = Math.hypot(bx - WIRE.x, by - WIRE.y);
        const k = d < 24 ? 24 / (d || 1) : 1;
        return { px: clampX(WIRE.x + (bx - WIRE.x) * k), py: clampY(WIRE.y + (by - WIRE.y) * k) };
      } };
    }
    return null;
  }
  if (setup === 'induction') {
    const mx = str(p, 'motion', 'auto') === 'hand' ? num(p, 'mx', IND.xc - AMP) : NaN;
    const near = Number.isNaN(mx) ? Math.abs(y - IND.y) < 18 && x > 40 && x < BW - 40 : Math.abs(x - mx) < IND.mag / 2 && Math.abs(y - IND.y) < 18;
    if (!near) return null;
    return { hint: 'Drag the magnet', drag: (bx) => ({ motion: 'hand', mx: Math.max(IND.xc - AMP - 20, Math.min(IND.xc + AMP + 20, bx)) }) };
  }
  return null;
}

// --- readouts and working ----------------------------------------------------------------------------------

const deg = (a: number) => {
  const d = Math.round((-a * 180) / Math.PI);
  return `${((d % 360) + 360) % 360}°`;
};

function readouts(p: SimParams, s: MS): Readout[] {
  const setup = str(p, 'setup', 'bar');
  if (setup === 'bar' || setup === 'pair') {
    const [bx, by] = poleField(polesOf(p), num(p, 'cx', 120), num(p, 'cy', 90));
    const rel = Math.hypot(bx, by) / (1 / (40 * 40));
    const out: Readout[] = [
      { label: 'Needle points', value: deg(Math.atan2(by, bx)), color: 'red' },
      { label: 'Field (relative)', value: fmt(rel, 2) },
    ];
    if (setup === 'pair') out.unshift({ label: 'Facing poles', value: str(p, 'mode', 'attract') === 'attract' ? 'N and S: attract' : 'N and N: repel' });
    const np = neutralPoint(p);
    if (np) out.push({ label: 'Neutral point', value: 'Marked ✕', color: 'orange' });
    return out;
  }
  if (setup === 'wire') {
    const { r, B } = wireReading(p);
    return [
      { label: 'Current', value: `${fmt(num(p, 'I', 10))} A` },
      { label: 'Distance', value: `${fmt(r * 100)} cm` },
      { label: 'B', value: `${fmt(B * 1e6)} μT`, color: 'violet' },
      { label: 'Field turns', value: str(p, 'dir', 'out') === 'out' ? 'Anticlockwise' : 'Clockwise' },
    ];
  }
  if (setup === 'solenoid') {
    const L = num(p, 'len', 10) / 100;
    const mur = str(p, 'core') === 'iron' ? 200 : 1;
    const B = solenoidField(num(p, 'turns', 200), L, num(p, 'I', 2), mur);
    return [
      { label: 'Turns per metre', value: fmt(num(p, 'turns', 200) / L) },
      { label: 'B inside', value: B >= 0.1 ? `${fmt(B)} T` : `${fmt(B * 1000)} mT`, color: 'violet' },
      { label: 'North end', value: str(p, 'dir', 'down') === 'down' ? 'Right' : 'Left', color: 'red' },
      { label: 'Core', value: mur > 1 ? 'Soft iron' : 'Air' },
    ];
  }
  if (setup === 'induction') {
    const m = IND.m * (str(p, 'flip') === 'yes' ? -1 : 1);
    const phi = loopFlux(m, IND.a, (s.x - IND.xc) * IND.px);
    return [
      { label: 'Speed', value: `${fmt(Math.abs(s.v) * IND.px, 2)} m/s` },
      { label: 'Flux per turn', value: `${fmt(phi * 1e6, 3)} μWb` },
      { label: 'EMF', value: `${fmt(s.emf * 1000, 3)} mV`, color: 'green' },
      { label: 'Magnet', value: Math.abs(s.v) < 1 ? 'Still: no EMF' : (s.x < IND.xc) === (s.v > 0) ? 'Approaching' : 'Leaving' },
    ];
  }
  if (setup === 'generator') {
    const w = 2 * Math.PI * num(p, 'freq', 0.5);
    const peak = num(p, 'turns', 100) * num(p, 'B', 0.2) * GEN.A * w;
    return [
      { label: 'Angle', value: `${Math.round(((w * s.t * 180) / Math.PI) % 360)}°` },
      { label: 'EMF now', value: `${fmt(s.emf, 3)} V`, color: 'green' },
      { label: 'Peak', value: `${fmt(peak, 3)} V` },
      { label: 'RMS', value: `${fmt(peak / Math.SQRT2, 3)} V` },
      { label: 'Frequency', value: `${fmt(num(p, 'freq', 0.5))} Hz` },
    ];
  }
  const part = PARTICLES[str(p, 'particle', 'proton')] ?? PARTICLES.proton;
  const B = num(p, 'B', 10) / 1000;
  const v = num(p, 'v', 1) * 1e5;
  const r = gyroRadius(part.m, v, part.q, B);
  const T = (2 * Math.PI * part.m) / (Math.abs(part.q) * B);
  return [
    { label: 'Radius', value: `${fmt(r * 100)} cm`, color: 'blue' },
    { label: 'Period', value: `${fmt(T * 1e6)} μs` },
    { label: 'Turns', value: part.q > 0 ? 'Anticlockwise' : 'Clockwise' },
    { label: 'Force', value: `${fmt(Math.abs(part.q) * v * B * 1e15, 3)} fN`, color: 'red' },
  ];
}

function formulas(p: SimParams): Formula[] {
  const setup = str(p, 'setup', 'bar');
  if (setup === 'wire') {
    const { r, B } = wireReading(p);
    return [{
      label: 'Field round a long straight wire',
      tex: `B = \\frac{\\mu_0 I}{2\\pi r} = \\frac{(4\\pi\\times10^{-7})(${tf(num(p, 'I', 10))})}{2\\pi(${tf(r, 3)})} = ${tf(B * 1e6)}\\ \\mu\\text{T}`,
    }];
  }
  if (setup === 'solenoid') {
    const N = num(p, 'turns', 200);
    const L = num(p, 'len', 10) / 100;
    const iron = str(p, 'core') === 'iron';
    const B = solenoidField(N, L, num(p, 'I', 2), iron ? 200 : 1);
    return [{
      label: iron ? 'Inside a solenoid with a soft-iron core (μr taken as 200)' : 'Inside a long solenoid',
      tex: `B = ${iron ? '\\mu_r' : ''}\\mu_0 \\frac{N}{L} I = ${iron ? '200\\,' : ''}(4\\pi\\times10^{-7})\\frac{${N}}{${tf(L)}}(${tf(num(p, 'I', 2))}) = ${tf(B * 1000)}\\ \\text{mT}`,
    }];
  }
  if (setup === 'induction') {
    return [
      { label: "Faraday's law (the minus sign is Lenz's law)", tex: '\\varepsilon = -N\\frac{d\\Phi}{dt}' },
      { label: 'Flux of the magnet through one turn, distance d along the axis', tex: '\\Phi = \\frac{\\mu_0 m a^2}{2(a^2 + d^2)^{3/2}}' },
    ];
  }
  if (setup === 'generator') {
    const w = 2 * Math.PI * num(p, 'freq', 0.5);
    const N = num(p, 'turns', 100);
    const B = num(p, 'B', 0.2);
    return [
      { label: 'EMF of a coil turning in a field', tex: '\\varepsilon = NBA\\omega\\sin\\omega t' },
      { label: 'Peak', tex: `\\varepsilon_0 = (${N})(${tf(B)})(${tf(GEN.A)})(${tf(w)}) = ${tf(N * B * GEN.A * w)}\\ \\text{V}` },
    ];
  }
  if (setup === 'charge') {
    const part = PARTICLES[str(p, 'particle', 'proton')] ?? PARTICLES.proton;
    const B = num(p, 'B', 10) / 1000;
    const v = num(p, 'v', 1) * 1e5;
    return [
      { label: 'Magnetic force gives the centripetal force', tex: 'qvB = \\frac{mv^2}{r} \\Rightarrow r = \\frac{mv}{qB}' },
      { label: part.label, tex: `r = \\frac{(${tf(part.m * 1e27)}\\times10^{-27})(${tf(v / 1e5)}\\times10^{5})}{(${tf(Math.abs(part.q) / E)}\\times1.6\\times10^{-19})(${tf(B)})} = ${tf(gyroRadius(part.m, v, part.q, B) * 100)}\\ \\text{cm}` },
      { label: 'Period does not depend on speed', tex: 'T = \\frac{2\\pi m}{qB}' },
    ];
  }
  return [
    { label: 'Field lines', tex: '\\text{leave N, enter S, never cross}' },
    { label: 'A compass needle lines up with the field', tex: '\\vec{B}\\ \\text{points along the needle, S}\\to\\text{N}' },
  ];
}

// --- the simulator ---------------------------------------------------------------------------------------------

const SETUPS = [
  { value: 'bar', label: 'Bar magnet' },
  { value: 'pair', label: 'Two magnets' },
  { value: 'wire', label: 'Straight wire' },
  { value: 'solenoid', label: 'Solenoid' },
  { value: 'induction', label: 'Induction' },
  { value: 'generator', label: 'Generator' },
  { value: 'charge', label: 'Charge in a field' },
];
const is = (...k: string[]) => (p: SimParams) => k.includes(str(p, 'setup', 'bar'));

export const magnetSim: SimDef<MS> = {
  label: 'Magnetism',
  subject: 'Physics',
  keywords: 'magnet magnetic field lines compass bar magnet solenoid electromagnet wire right hand rule induction faraday lenz coil galvanometer generator dynamo ac dc charge cyclotron fleming',
  blurb: 'Field lines, compass, solenoid, induction and a generator',
  display: ['cx', 'cy', 'px', 'py', 'mx', 'my', 'm2x'],
  autoplay: true,
  defaults: {
    setup: 'bar', flip: 'no', mode: 'attract', dir: 'down', core: 'air', motion: 'auto', output: 'ac', particle: 'proton',
    cx: 120, cy: 90, mx: 280, my: 190, m2x: 420, px: 400, py: 120,
    I: 10, turns: 200, len: 10, freq: 0.5, B: 0.2, v: 1,
  },
  controls: [
    { key: 'setup', label: 'Setup', type: 'choice', options: SETUPS },
    { key: 'flip', label: 'Magnet', type: 'choice', options: [{ value: 'no', label: 'N on the right' }, { value: 'yes', label: 'N on the left' }], show: is('bar', 'induction') },
    { key: 'mode', label: 'Facing poles', type: 'choice', options: [{ value: 'attract', label: 'N – S (attract)' }, { value: 'repel', label: 'N – N (repel)' }], show: is('pair') },
    { key: 'dir', label: 'Current', type: 'choice', options: [{ value: 'out', label: 'Out of the page' }, { value: 'in', label: 'Into the page' }], show: is('wire') },
    { key: 'dir', label: 'Current on the front', type: 'choice', options: [{ value: 'down', label: 'Downwards' }, { value: 'up', label: 'Upwards' }], show: is('solenoid') },
    { key: 'I', label: 'Current', type: 'range', min: 0.5, max: 20, step: 0.5, unit: 'A', show: is('wire', 'solenoid') },
    { key: 'turns', label: 'Turns', type: 'range', min: 10, max: 500, step: 10, show: is('solenoid', 'induction', 'generator') },
    { key: 'len', label: 'Length', type: 'range', min: 5, max: 30, step: 1, unit: 'cm', show: is('solenoid') },
    { key: 'core', label: 'Core', type: 'choice', options: [{ value: 'air', label: 'Air' }, { value: 'iron', label: 'Soft iron' }], show: is('solenoid') },
    { key: 'motion', label: 'Magnet moves', type: 'choice', options: [{ value: 'auto', label: 'In and out' }, { value: 'hand', label: 'By hand' }], show: is('induction') },
    { key: 'freq', label: 'Frequency', type: 'range', min: 0.1, max: 2, step: 0.05, unit: 'Hz', show: (p) => is('generator')(p) || (is('induction')(p) && str(p, 'motion') !== 'hand') },
    { key: 'B', label: 'Field', type: 'range', min: 0.05, max: 1, step: 0.05, unit: 'T', show: is('generator') },
    { key: 'output', label: 'Output', type: 'choice', options: [{ value: 'ac', label: 'AC (slip rings)' }, { value: 'dc', label: 'DC (commutator)' }], show: is('generator') },
    { key: 'particle', label: 'Particle', type: 'choice', options: Object.entries(PARTICLES).map(([value, d]) => ({ value, label: d.label })), show: is('charge') },
    { key: 'v', label: 'Speed', type: 'range', min: 0.2, max: 3, step: 0.1, unit: '×10⁵ m/s', show: is('charge') },
    { key: 'B', label: 'Field', type: 'range', min: 5, max: 50, step: 1, unit: 'mT', show: is('charge') },
  ],
  presets: [
    { label: 'Bar magnet', params: { setup: 'bar', mx: 280, my: 190 } },
    { label: 'Attracting magnets', params: { setup: 'pair', mode: 'attract' } },
    { label: 'Repelling: neutral point', params: { setup: 'pair', mode: 'repel' } },
    { label: 'Wire: right-hand rule', params: { setup: 'wire' } },
    { label: 'Electromagnet', params: { setup: 'solenoid', core: 'iron' } },
    { label: 'Magnet through a coil', params: { setup: 'induction', motion: 'auto' } },
    { label: 'AC generator', params: { setup: 'generator', output: 'ac' } },
    { label: 'DC dynamo', params: { setup: 'generator', output: 'dc' } },
    { label: 'Proton circling', params: { setup: 'charge', particle: 'proton', B: 10 } },
  ],
  title: (p) => {
    const s = str(p, 'setup', 'bar');
    if (s === 'charge') return `${(PARTICLES[str(p, 'particle', 'proton')] ?? PARTICLES.proton).label} in a magnetic field`;
    if (s === 'generator') return str(p, 'output') === 'dc' ? 'DC dynamo' : 'AC generator';
    return SETUPS.find((x) => x.value === s)?.label ?? 'Magnetism';
  },
  init: (p) => {
    const hand = str(p, 'motion', 'auto') === 'hand';
    const x = hand ? num(p, 'mx', IND.xc - AMP) : inductionX(p, 0)[0];
    return { t: 0, done: false, x, v: 0, emf: 0, hist: [], phi: 0 };
  },
  step: (p, s, dt) => {
    s.t += dt;
    const setup = str(p, 'setup', 'bar');
    if (setup === 'induction') {
      if (str(p, 'motion', 'auto') === 'hand') {
        const x = num(p, 'mx', IND.xc - AMP);
        const raw = (x - s.x) / dt;
        s.v += (raw - s.v) * Math.min(1, dt / 0.06);
        s.x = x;
      } else {
        [s.x, s.v] = inductionX(p, s.t);
      }
      s.emf = inductionEmf(p, s.x, s.v);
    } else if (setup === 'generator') {
      const w = 2 * Math.PI * num(p, 'freq', 0.5);
      const e = generatorEmf(num(p, 'turns', 100), num(p, 'B', 0.2), GEN.A, w, s.t);
      s.emf = str(p, 'output', 'ac') === 'dc' ? Math.abs(e) : e;
    } else if (setup === 'charge') {
      s.phi += dt * Math.PI * 0.5;
      return;
    } else return;
    const last = s.hist[s.hist.length - 1];
    if (!last || s.t - last[0] >= 1 / 60) {
      s.hist.push([s.t, s.emf]);
      const keep = setup === 'generator' ? Math.max(2, 2 / num(p, 'freq', 0.5)) + 0.5 : 4.5;
      while (s.hist.length && s.hist[0][0] < s.t - keep) s.hist.shift();
    }
  },
  draw: (ctx, p, s, look) => {
    const setup = str(p, 'setup', 'bar');
    if (setup === 'bar' || setup === 'pair') drawMagnets(ctx, p, look);
    else if (setup === 'solenoid') drawSolenoid(ctx, p, look);
    else if (setup === 'wire') drawWire(ctx, p, look);
    else if (setup === 'induction') drawInduction(ctx, p, s, look);
    else if (setup === 'generator') drawGenerator(ctx, p, s, look);
    else drawCharge(ctx, p, s, look);
  },
  grab,
  readouts,
  formulas,
};
