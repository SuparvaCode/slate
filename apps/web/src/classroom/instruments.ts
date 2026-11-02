/**
 * Geometry instruments that sit on the board: a ruler, two set squares, a protractor and a
 * compass, at true size (1 cm on a scale is 1 cm on a 96 dpi screen at 100% zoom), so they
 * measure what is drawn on the board.
 *
 * They live in world coordinates, apart from the board's elements, and are drawn over the ink.
 * A pen stroke started on one of their straight edges is ruled along it; the compass draws an
 * arc as its pencil is swung. Nothing here touches the DOM, so it can be tested in Node.
 */

export const CM = 96 / 2.54;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

export type InstKind = 'ruler' | 'set45' | 'set60' | 'protractor' | 'compass';

interface Base {
  id: string;
  /** Ruler: the zero mark on its measuring edge. Set square: the right-angle corner. Protractor: its centre. Compass: the needle. */
  x: number;
  y: number;
  /** Turn in radians. For the compass, the direction from the needle to the pencil. */
  a: number;
}
export interface Ruler extends Base { kind: 'ruler'; /** Length of the scale, cm. */ len: number }
export interface SetSquare extends Base { kind: 'set45' | 'set60'; /** Longer leg, cm. */ size: number }
export interface Protractor extends Base { kind: 'protractor'; full: boolean; /** Measuring arm, degrees anticlockwise from the baseline. */ arm: number }
export interface Compass extends Base { kind: 'compass'; /** Needle to pencil, world units. */ r: number }
export type Instrument = Ruler | SetSquare | Protractor | Compass;

export type InstPart = 'move' | 'rotate' | 'edge' | 'arm' | 'pencil' | 'hinge' | 'close';

export type P = [number, number];
export interface Edge { p: P; q: P }

export interface InstLook {
  ink: string;
  accent: string;
  dark: boolean;
}

/** Ruler width, protractor radius and the strip under its baseline. */
const RULER_W = 3.2 * CM;
export const PROT_R = 5.5 * CM;
const STRIP = 0.6 * CM;
const KNOB = 0.42 * CM;
const CLOSE = 0.3 * CM;

// --- frames ------------------------------------------------------------------------------------

export function toLocal(i: Base, x: number, y: number): P {
  const c = Math.cos(i.a);
  const s = Math.sin(i.a);
  const dx = x - i.x;
  const dy = y - i.y;
  return [dx * c + dy * s, -dx * s + dy * c];
}

export function toWorld(i: Base, lx: number, ly: number): P {
  const c = Math.cos(i.a);
  const s = Math.sin(i.a);
  return [i.x + lx * c - ly * s, i.y + lx * s + ly * c];
}

const legs = (i: SetSquare): [number, number] => {
  const L = i.size * CM;
  return [L, i.kind === 'set45' ? L : L * Math.tan(30 * DEG)];
};

// --- placing --------------------------------------------------------------------------------------

/** A new instrument centred on (cx, cy). */
export function newInstrument(kind: InstKind, cx: number, cy: number, id: string): Instrument {
  switch (kind) {
    case 'ruler':
      return { id, kind, len: 30, x: cx - 15 * CM, y: cy - RULER_W / 2, a: 0 };
    case 'set45':
      return { id, kind, size: 12, x: cx - 4 * CM, y: cy + 4 * CM, a: 0 };
    case 'set60':
      return { id, kind, size: 14, x: cx - 4.7 * CM, y: cy + 1.35 * CM, a: 0 };
    case 'protractor':
      return { id, kind, full: false, arm: 60, x: cx, y: cy + PROT_R / 2, a: 0 };
    default:
      return { id, kind: 'compass', r: 4 * CM, x: cx - 2 * CM, y: cy + 2 * CM, a: 0 };
  }
}

/** The point an instrument turns about. */
export function centreOf(i: Instrument): P {
  if (i.kind === 'ruler') return toWorld(i, (i.len * CM) / 2, RULER_W / 2);
  if (i.kind === 'set45' || i.kind === 'set60') {
    const [L, h] = legs(i);
    return toWorld(i, L / 3, -h / 3);
  }
  return [i.x, i.y];
}

// --- straight edges and ruling along them ---------------------------------------------------------

export function edgesOf(i: Instrument): Edge[] {
  const w = (lx: number, ly: number) => toWorld(i, lx, ly);
  switch (i.kind) {
    case 'ruler': {
      const x0 = -0.5 * CM;
      const x1 = (i.len + 0.5) * CM;
      return [{ p: w(x0, 0), q: w(x1, 0) }, { p: w(x0, RULER_W), q: w(x1, RULER_W) }];
    }
    case 'set45':
    case 'set60': {
      const [L, h] = legs(i);
      const a = w(0, 0);
      const b = w(L, 0);
      const c = w(0, -h);
      return [{ p: a, q: b }, { p: a, q: c }, { p: b, q: c }];
    }
    case 'protractor':
      return i.full ? [] : [{ p: w(-PROT_R - 0.3 * CM, STRIP), q: w(PROT_R + 0.3 * CM, STRIP) }];
    default:
      return [];
  }
}

function along(e: Edge, x: number, y: number) {
  const dx = e.q[0] - e.p[0];
  const dy = e.q[1] - e.p[1];
  const t = ((x - e.p[0]) * dx + (y - e.p[1]) * dy) / (dx * dx + dy * dy || 1);
  return { t, dx, dy };
}

export function distToEdge(e: Edge, x: number, y: number): number {
  const { t, dx, dy } = along(e, x, y);
  const k = Math.max(0, Math.min(1, t));
  return Math.hypot(e.p[0] + dx * k - x, e.p[1] + dy * k - y);
}

/** The point on the edge nearest (x, y), kept within the edge's ends. */
export function projectOn(e: Edge, x: number, y: number): P {
  const { t, dx, dy } = along(e, x, y);
  const k = Math.max(0, Math.min(1, t));
  return [e.p[0] + dx * k, e.p[1] + dy * k];
}

/** The straight edge within `tol` of (x, y), nearest first, or null. */
export function nearestEdge(i: Instrument, x: number, y: number, tol: number): Edge | null {
  let best: Edge | null = null;
  let bd = tol;
  for (const e of edgesOf(i)) {
    const d = distToEdge(e, x, y);
    if (d <= bd) {
      bd = d;
      best = e;
    }
  }
  return best;
}

/** Where a pen point lands when it starts within `tol` of a straight edge, or null if it is not near one. */
export function snapToEdge(pt: P, i: Instrument, tol: number): P | null {
  const e = nearestEdge(i, pt[0], pt[1], tol);
  return e ? projectOn(e, pt[0], pt[1]) : null;
}

// --- the compass ------------------------------------------------------------------------------------

export function compassParts(c: Compass) {
  const ux = Math.cos(c.a);
  const uy = Math.sin(c.a);
  const pencil: P = [c.x + c.r * ux, c.y + c.r * uy];
  const leg = Math.max(3.6 * CM, c.r * 0.62);
  const rise = Math.sqrt(Math.max(0, leg * leg - (c.r / 2) ** 2));
  // The hinge sits on whichever side of the legs is up on the screen.
  let nx = -uy;
  let ny = ux;
  if (ny > 0 || (ny === 0 && nx > 0)) {
    nx = -nx;
    ny = -ny;
  }
  const hinge: P = [(c.x + pencil[0]) / 2 + nx * rise, (c.y + pencil[1]) / 2 + ny * rise];
  const top: P = [hinge[0] + nx * 0.9 * CM, hinge[1] + ny * 0.9 * CM];
  const close: P = [top[0] + ux * 0.95 * CM, top[1] + uy * 0.95 * CM];
  return { pencil, hinge, top, close, n: [nx, ny] as P };
}

/** Points along the arc a compass pencil traces from angle a0 to a1 (either way round), about 2 units apart. */
export function compassArc(pivot: P, r: number, a0: number, a1: number): P[] {
  const n = Math.max(1, Math.ceil((Math.abs(a1 - a0) * r) / 2));
  return Array.from({ length: n + 1 }, (_, k) => {
    const a = a0 + ((a1 - a0) * k) / n;
    return [pivot[0] + r * Math.cos(a), pivot[1] + r * Math.sin(a)] as P;
  });
}

/** The shortest signed turn from angle a to angle b. */
export const turnBetween = (a: number, b: number) => ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;

// --- the protractor --------------------------------------------------------------------------------

/** The angle of (x, y) seen from the protractor's centre, degrees anticlockwise from its baseline. */
export function protractorAngle(i: Protractor, x: number, y: number): number {
  const [lx, ly] = toLocal(i, x, y);
  const d = Math.atan2(-ly, lx) / DEG;
  if (i.full) return Math.round((d + 360) % 360) % 360;
  if (d < 0) return d < -90 ? 180 : 0;
  return Math.round(d);
}

// --- knobs ------------------------------------------------------------------------------------------

/** Local positions of the turn and close knobs. */
function knobs(i: Instrument): { rotate?: P; close?: P } {
  switch (i.kind) {
    case 'ruler':
      return { rotate: [i.len * CM - 0.9 * CM, 2.35 * CM], close: [0.4 * CM, 2.35 * CM] };
    case 'set45':
    case 'set60': {
      const [L] = legs(i);
      return { rotate: [L * 0.62, -0.95 * CM], close: [1.75 * CM, -1.75 * CM] };
    }
    case 'protractor':
      return { rotate: [PROT_R * 0.45, -0.8 * CM], close: [-PROT_R * 0.45, -0.8 * CM] };
    default:
      return {};
  }
}

function inTriangle(pts: P[], x: number, y: number, tol: number): boolean {
  // Signed distances to each side, positive inside for either winding.
  let sign = 0;
  for (let k = 0; k < 3; k++) {
    const [ax, ay] = pts[k];
    const [bx, by] = pts[(k + 1) % 3];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const d = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / len;
    if (!sign) sign = Math.sign(((bx - ax) * (pts[(k + 2) % 3][1] - ay) - (by - ay) * (pts[(k + 2) % 3][0] - ax))) || 1;
    if (d * sign < -tol) return false;
  }
  return true;
}

function distToSegment(p: P, q: P, x: number, y: number) {
  return distToEdge({ p, q }, x, y);
}

/** The part of an instrument at world point (x, y), with the board at zoom z, or null. */
export function instrumentHit(i: Instrument, x: number, y: number, z: number): InstPart | null {
  const tol = 10 / z;
  if (i.kind === 'compass') {
    const c = compassParts(i);
    if (Math.hypot(x - c.close[0], y - c.close[1]) <= CLOSE + tol * 0.6) return 'close';
    if (Math.hypot(x - c.pencil[0], y - c.pencil[1]) <= 0.55 * CM + tol * 0.5) return 'pencil';
    if (Math.hypot(x - i.x, y - i.y) <= 0.55 * CM + tol * 0.5) return 'move';
    if (distToSegment(c.hinge, c.top, x, y) <= 0.5 * CM + tol * 0.5) return 'hinge';
    if (distToSegment([i.x, i.y], c.hinge, x, y) <= 0.3 * CM + tol || distToSegment(c.hinge, c.pencil, x, y) <= 0.3 * CM + tol) return 'move';
    return null;
  }
  const [lx, ly] = toLocal(i, x, y);
  const k = knobs(i);
  if (k.close && Math.hypot(lx - k.close[0], ly - k.close[1]) <= CLOSE + tol * 0.6) return 'close';
  if (k.rotate && Math.hypot(lx - k.rotate[0], ly - k.rotate[1]) <= KNOB + tol * 0.6) return 'rotate';
  if (i.kind === 'protractor') {
    const a = -i.arm * DEG;
    const ax = Math.cos(a);
    const ay = Math.sin(a);
    const t = lx * ax + ly * ay;
    const off = Math.abs(-lx * ay + ly * ax);
    if (t > PROT_R * 0.3 && t < PROT_R + 1.2 * CM && off <= 0.25 * CM + tol) return 'arm';
  }
  if (nearestEdge(i, x, y, tol)) return 'edge';
  switch (i.kind) {
    case 'ruler':
      return lx >= -0.5 * CM - tol && lx <= (i.len + 0.5) * CM + tol && ly >= -tol && ly <= RULER_W + tol ? 'move' : null;
    case 'set45':
    case 'set60': {
      const [L, h] = legs(i);
      return inTriangle([[0, 0], [L, 0], [0, -h]], lx, ly, tol) ? 'move' : null;
    }
    default: {
      const d = Math.hypot(lx, ly);
      if (i.full) return d <= PROT_R + tol ? 'move' : null;
      return (ly <= 0 && d <= PROT_R + tol) || (ly >= 0 && ly <= STRIP + tol && Math.abs(lx) <= PROT_R + tol) ? 'move' : null;
    }
  }
}

// --- dragging ---------------------------------------------------------------------------------------

/** Turns snap to whole degrees, and to multiples of 15° within 2° of one. */
export function snapAngle(a: number): number {
  const d = a / DEG;
  const fifteen = Math.round(d / 15) * 15;
  return (Math.abs(d - fifteen) < 2 ? fifteen : Math.round(d)) * DEG;
}

/** The instrument after its `part` is dragged from `from` to `to` (both world points, from the start of the drag). */
export function dragInstrument(start: Instrument, part: InstPart, from: P, to: P): Instrument {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  if (part === 'move' || part === 'edge') return { ...start, x: start.x + dx, y: start.y + dy };
  if (start.kind === 'compass') {
    if (part === 'pencil') return { ...start, a: Math.atan2(to[1] - start.y, to[0] - start.x) };
    if (part === 'hinge') {
      return { ...start, r: Math.max(0.5 * CM, Math.hypot(to[0] - start.x, to[1] - start.y)), a: Math.atan2(to[1] - start.y, to[0] - start.x) };
    }
    return start;
  }
  if (part === 'arm' && start.kind === 'protractor') return { ...start, arm: protractorAngle(start, to[0], to[1]) };
  if (part === 'rotate') {
    const [cx, cy] = centreOf(start);
    const turn = Math.atan2(to[1] - cy, to[0] - cx) - Math.atan2(from[1] - cy, from[0] - cx);
    const a = snapAngle(start.a + turn);
    const d = a - start.a;
    const ox = start.x - cx;
    const oy = start.y - cy;
    return { ...start, a, x: cx + ox * Math.cos(d) - oy * Math.sin(d), y: cy + ox * Math.sin(d) + oy * Math.cos(d) };
  }
  return start;
}

/** How far an instrument is turned, 0 to 359 degrees anticlockwise, as a protractor would read it. */
export const tilt = (i: Instrument) => Math.round((((-i.a / DEG) % 360) + 360) % 360) % 360;

// --- outline, turning ---------------------------------------------------------------------------

/** The outline of an instrument in world points: its selection ring, and where its bar goes. */
export function instOutline(i: Instrument): P[] {
  const w = (lx: number, ly: number) => toWorld(i, lx, ly);
  switch (i.kind) {
    case 'ruler':
      return [w(-0.5 * CM, 0), w((i.len + 0.5) * CM, 0), w((i.len + 0.5) * CM, RULER_W), w(-0.5 * CM, RULER_W)];
    case 'set45':
    case 'set60': {
      const [L, h] = legs(i);
      return [w(0, 0), w(L, 0), w(0, -h)];
    }
    case 'protractor': {
      if (i.full) return Array.from({ length: 48 }, (_, k) => w(Math.cos((k / 48) * TAU) * PROT_R, Math.sin((k / 48) * TAU) * PROT_R));
      const arc = Array.from({ length: 25 }, (_, k) => w(Math.cos(Math.PI + (k / 24) * Math.PI) * PROT_R, Math.sin(Math.PI + (k / 24) * Math.PI) * PROT_R));
      return [w(-PROT_R, STRIP), ...arc, w(PROT_R, STRIP)];
    }
    default: {
      const c = compassParts(i);
      const pts: P[] = [[i.x, i.y], c.hinge, c.top, c.pencil, c.close];
      const pad = 0.5 * CM;
      const x0 = Math.min(...pts.map((p) => p[0])) - pad;
      const x1 = Math.max(...pts.map((p) => p[0])) + pad;
      const y0 = Math.min(...pts.map((p) => p[1])) - pad;
      const y1 = Math.max(...pts.map((p) => p[1])) + pad;
      return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    }
  }
}

/** The instrument turned by `da` radians about its centre (the compass swings its pencil round the needle). */
export function turnInstrument(i: Instrument, da: number): Instrument {
  if (i.kind === 'compass') return { ...i, a: i.a + da };
  const [cx, cy] = centreOf(i);
  const ox = i.x - cx;
  const oy = i.y - cy;
  const c = Math.cos(da);
  const s = Math.sin(da);
  return { ...i, a: i.a + da, x: cx + ox * c - oy * s, y: cy + ox * s + oy * c };
}

/** A dashed ring round the instrument the user last touched. */
export function drawInstrumentSelection(ctx: CanvasRenderingContext2D, i: Instrument, z: number, look: InstLook) {
  const pts = instOutline(i);
  ctx.save();
  ctx.beginPath();
  pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.strokeStyle = look.accent;
  ctx.lineWidth = 2.5 / z;
  ctx.lineJoin = 'round';
  ctx.setLineDash([8 / z, 5 / z]);
  ctx.stroke();
  ctx.restore();
}

// --- saving -----------------------------------------------------------------------------------------

const KEY = 'slate.instruments';
const KINDS: InstKind[] = ['ruler', 'set45', 'set60', 'protractor', 'compass'];

export function loadInstruments(): Instrument[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((i) => i && KINDS.includes(i.kind) && [i.x, i.y, i.a].every((v) => typeof v === 'number' && Number.isFinite(v))).slice(0, 12);
  } catch {
    return [];
  }
}

export function saveInstruments(list: Instrument[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage full or blocked: instruments just are not kept
  }
}

// --- drawing ------------------------------------------------------------------------------------------

const FONT = '-apple-system, "SF Pro Text", "Segoe UI", system-ui, sans-serif';

function body(look: InstLook) {
  return {
    fill: look.dark ? 'rgba(120, 170, 255, 0.16)' : 'rgba(0, 122, 255, 0.07)',
    edge: look.dark ? 'rgba(140, 185, 255, 0.85)' : 'rgba(0, 100, 220, 0.7)',
  };
}

function knob(ctx: CanvasRenderingContext2D, x: number, y: number, kind: 'rotate' | 'close', z: number, look: InstLook) {
  const r = kind === 'rotate' ? KNOB : CLOSE;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = kind === 'rotate' ? look.accent : look.dark ? '#48484a' : '#ffffff';
  ctx.fill();
  ctx.strokeStyle = kind === 'rotate' ? look.accent : look.dark ? '#8e8e93' : '#aeaeb2';
  ctx.lineWidth = 1 / z;
  ctx.stroke();
  ctx.strokeStyle = kind === 'rotate' ? '#ffffff' : look.ink;
  ctx.lineWidth = Math.max(1.4 / z, r * 0.14);
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (kind === 'rotate') {
    ctx.arc(x, y, r * 0.5, -Math.PI * 0.15, Math.PI * 1.35);
    ctx.stroke();
    const ex = x + r * 0.5 * Math.cos(-Math.PI * 0.15);
    const ey = y + r * 0.5 * Math.sin(-Math.PI * 0.15);
    ctx.beginPath();
    ctx.moveTo(ex - r * 0.28, ey - r * 0.12);
    ctx.lineTo(ex, ey);
    ctx.lineTo(ex + r * 0.05, ey - r * 0.3);
  } else {
    const k = r * 0.38;
    ctx.moveTo(x - k, y - k);
    ctx.lineTo(x + k, y + k);
    ctx.moveTo(x - k, y + k);
    ctx.lineTo(x + k, y - k);
  }
  ctx.stroke();
}

function words(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', weight = 600) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, x, y);
}

function drawRuler(ctx: CanvasRenderingContext2D, i: Ruler, z: number, look: InstLook) {
  const b = body(look);
  const L = i.len * CM;
  ctx.beginPath();
  ctx.roundRect(-0.5 * CM, 0, L + CM, RULER_W, 0.15 * CM);
  ctx.fillStyle = b.fill;
  ctx.fill();
  ctx.strokeStyle = b.edge;
  ctx.lineWidth = 1.5 / z;
  ctx.stroke();
  ctx.strokeStyle = look.ink;
  ctx.lineCap = 'butt';
  for (let mm = 0; mm <= i.len * 10; mm++) {
    const x = (mm * CM) / 10;
    const h = mm % 10 === 0 ? 0.65 * CM : mm % 5 === 0 ? 0.45 * CM : 0.28 * CM;
    ctx.lineWidth = (mm % 10 === 0 ? 1.3 : 0.9) / z;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    if (mm % 10 === 0) words(ctx, String(mm / 10), x, 0.98 * CM, 0.34 * CM, look.ink);
  }
  words(ctx, 'cm', L + 0.1 * CM, 0.98 * CM, 0.26 * CM, look.ink, 'left', 500);
  words(ctx, `${tilt(i)}°`, L / 2, 2.35 * CM, 0.36 * CM, look.accent, 'center', 650);
  const k = knobs(i);
  knob(ctx, k.rotate![0], k.rotate![1], 'rotate', z, look);
  knob(ctx, k.close![0], k.close![1], 'close', z, look);
}

function drawSetSquare(ctx: CanvasRenderingContext2D, i: SetSquare, z: number, look: InstLook) {
  const b = body(look);
  const [L, h] = legs(i);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(L, 0);
  ctx.lineTo(0, -h);
  ctx.closePath();
  ctx.fillStyle = b.fill;
  ctx.fill();
  ctx.strokeStyle = b.edge;
  ctx.lineWidth = 1.5 / z;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // A cut-out in the middle, like the real thing.
  const inset = 2.4 * CM;
  if (h > inset * 2.4) {
    const k = (L - inset * (1 + L / h)) / L;
    ctx.beginPath();
    ctx.moveTo(inset * 0.55, -inset * 0.55);
    ctx.lineTo(inset * 0.55 + L * k * 0.8, -inset * 0.55);
    ctx.lineTo(inset * 0.55, -inset * 0.55 - h * k * 0.8);
    ctx.closePath();
    ctx.strokeStyle = b.edge;
    ctx.lineWidth = 1 / z;
    ctx.stroke();
  }
  ctx.strokeStyle = look.ink;
  for (let mm = 0; mm <= Math.floor(L / (CM / 10)); mm++) {
    const x = (mm * CM) / 10;
    if (x > L - 0.3 * CM) break;
    const th = mm % 10 === 0 ? 0.55 * CM : mm % 5 === 0 ? 0.38 * CM : 0.22 * CM;
    ctx.lineWidth = (mm % 10 === 0 ? 1.2 : 0.8) / z;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, -th);
    ctx.stroke();
    if (mm % 10 === 0 && mm > 0) words(ctx, String(mm / 10), x, -0.82 * CM, 0.3 * CM, look.ink);
  }
  const acute = i.kind === 'set45' ? ['45°', '45°'] : ['30°', '60°'];
  words(ctx, '90°', 0.55 * CM, -0.42 * CM, 0.26 * CM, look.accent, 'left');
  words(ctx, acute[0], L - 1.55 * CM, -0.4 * CM, 0.28 * CM, look.accent);
  words(ctx, acute[1], 0.62 * CM, -h + 1.9 * CM, 0.28 * CM, look.accent, 'left');
  words(ctx, `${tilt(i)}°`, L * 0.62, -1.75 * CM, 0.3 * CM, look.accent, 'center', 650);
  const k = knobs(i);
  knob(ctx, k.rotate![0], k.rotate![1], 'rotate', z, look);
  knob(ctx, k.close![0], k.close![1], 'close', z, look);
}

function drawProtractor(ctx: CanvasRenderingContext2D, i: Protractor, z: number, look: InstLook) {
  const b = body(look);
  const R = PROT_R;
  ctx.beginPath();
  if (i.full) ctx.arc(0, 0, R, 0, TAU);
  else {
    ctx.moveTo(-R, STRIP);
    ctx.lineTo(-R, 0);
    ctx.arc(0, 0, R, Math.PI, TAU);
    ctx.lineTo(R, STRIP);
    ctx.closePath();
  }
  ctx.fillStyle = b.fill;
  ctx.fill();
  ctx.strokeStyle = b.edge;
  ctx.lineWidth = 1.5 / z;
  ctx.stroke();
  const max = i.full ? 359 : 180;
  ctx.strokeStyle = look.ink;
  for (let d = 0; d <= max; d++) {
    const a = -d * DEG;
    const len = d % 10 === 0 ? 0.6 * CM : d % 5 === 0 ? 0.42 * CM : 0.24 * CM;
    ctx.lineWidth = (d % 10 === 0 ? 1.2 : 0.75) / z;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * R, Math.sin(a) * R);
    ctx.lineTo(Math.cos(a) * (R - len), Math.sin(a) * (R - len));
    ctx.stroke();
    if (d % 10 !== 0) continue;
    words(ctx, String(d), Math.cos(a) * (R - 0.95 * CM), Math.sin(a) * (R - 0.95 * CM), 0.26 * CM, look.ink);
    if (!i.full) words(ctx, String(180 - d), Math.cos(a) * (R - 1.45 * CM), Math.sin(a) * (R - 1.45 * CM), 0.21 * CM, look.dark ? '#a1a1a6' : '#6e6e73', 'center', 500);
  }
  // Baseline and centre mark.
  ctx.strokeStyle = look.ink;
  ctx.lineWidth = 1 / z;
  ctx.beginPath();
  ctx.moveTo(-R, 0);
  ctx.lineTo(R, 0);
  ctx.moveTo(0, -0.35 * CM);
  ctx.lineTo(0, 0.35 * CM);
  ctx.stroke();
  // The measuring arm and the angle it makes.
  const a = -i.arm * DEG;
  ctx.strokeStyle = look.accent;
  ctx.lineWidth = 2 / z;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(Math.cos(a) * (R + 1 * CM), Math.sin(a) * (R + 1 * CM));
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(Math.cos(a) * (R + 1 * CM), Math.sin(a) * (R + 1 * CM), 0.22 * CM, 0, TAU);
  ctx.fillStyle = look.accent;
  ctx.fill();
  if (i.arm > 0) {
    ctx.beginPath();
    ctx.arc(0, 0, 1.2 * CM, 0, a, true);
    ctx.lineWidth = 1.4 / z;
    ctx.stroke();
  }
  const mid = a / 2;
  words(ctx, `${i.arm}°`, Math.cos(mid) * 2 * CM, Math.sin(mid) * 2 * CM, 0.38 * CM, look.accent, 'center', 700);
  const k = knobs(i);
  knob(ctx, k.rotate![0], k.rotate![1], 'rotate', z, look);
  knob(ctx, k.close![0], k.close![1], 'close', z, look);
}

function drawCompass(ctx: CanvasRenderingContext2D, c: Compass, z: number, look: InstLook) {
  const p = compassParts(c);
  const metal = look.dark ? '#aeaeb2' : '#8e8e93';
  ctx.lineCap = 'round';
  // The circle it would draw, faintly.
  ctx.beginPath();
  ctx.arc(c.x, c.y, c.r, 0, TAU);
  ctx.strokeStyle = look.dark ? 'rgba(140,185,255,0.25)' : 'rgba(0,100,220,0.18)';
  ctx.lineWidth = 1 / z;
  ctx.setLineDash([6 / z, 6 / z]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = metal;
  ctx.lineWidth = 0.2 * CM;
  ctx.beginPath();
  ctx.moveTo(c.x, c.y);
  ctx.lineTo(p.hinge[0], p.hinge[1]);
  ctx.lineTo(p.pencil[0], p.pencil[1]);
  ctx.stroke();
  // Handle on top of the hinge.
  ctx.strokeStyle = look.ink;
  ctx.lineWidth = 0.26 * CM;
  ctx.beginPath();
  ctx.moveTo(p.hinge[0], p.hinge[1]);
  ctx.lineTo(p.top[0], p.top[1]);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(p.hinge[0], p.hinge[1], 0.28 * CM, 0, TAU);
  ctx.fillStyle = look.accent;
  ctx.fill();
  // Needle and pencil point.
  ctx.beginPath();
  ctx.arc(c.x, c.y, 0.16 * CM, 0, TAU);
  ctx.fillStyle = look.ink;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(p.pencil[0], p.pencil[1], 0.22 * CM, 0, TAU);
  ctx.fillStyle = look.accent;
  ctx.fill();
  ctx.lineWidth = 1 / z;
  ctx.strokeStyle = look.dark ? '#ffffff' : '#1d1d1f';
  ctx.stroke();
  const mx = (c.x + p.pencil[0]) / 2 - p.n[0] * 0.55 * CM;
  const my = (c.y + p.pencil[1]) / 2 - p.n[1] * 0.55 * CM;
  words(ctx, `r = ${(c.r / CM).toFixed(1)} cm`, mx, my, 0.34 * CM, look.accent, 'center', 650);
  knob(ctx, p.close[0], p.close[1], 'close', z, look);
}

/** Draws an instrument in world coordinates; the context already has the board's camera applied. */
export function drawInstrument(ctx: CanvasRenderingContext2D, i: Instrument, z: number, look: InstLook) {
  ctx.save();
  if (i.kind === 'compass') drawCompass(ctx, i, z, look);
  else {
    ctx.translate(i.x, i.y);
    ctx.rotate(i.a);
    if (i.kind === 'ruler') drawRuler(ctx, i, z, look);
    else if (i.kind === 'protractor') drawProtractor(ctx, i, z, look);
    else drawSetSquare(ctx, i, z, look);
  }
  ctx.restore();
}

export const INST_CURSOR: Record<InstPart, string> = {
  move: 'grab', edge: 'crosshair', rotate: 'alias', arm: 'grab', pencil: 'crosshair', hinge: 'grab', close: 'pointer',
};

export const INST_LABEL: Record<InstKind, string> = {
  ruler: 'Ruler', set45: 'Set square 45°', set60: 'Set square 30°–60°', protractor: 'Protractor', compass: 'Compass',
};
