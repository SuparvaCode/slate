/**
 * The simulator registry and the board card every simulator is drawn in: a title bar with
 * play, reset and settings buttons, the simulation, and a strip of live readings under it.
 *
 * Settings live on the board element (so they save and undo). The moving state lives here,
 * per element, and starts over whenever the settings change.
 */

import { circuitSim } from './circuit';
import { BH, BW, SIM_FONT, fmt, withLabelBox } from './kit';
import type { Look, SimDef, SimGrab, SimParams, SimState } from './kit';
import { inclineSim, pendulumSim, projectileSim, springSim } from './mechanics';
import { opticsSim } from './optics';
import { pulleySim } from './pulley';
import { magnetSim } from './magnetism';
import { wavesSim } from './waves';
import { gaugeSim } from './gauge';
import { logicSim } from './logic';
import { algoSim } from './algo';
import { periodicSim } from './periodic';
import { titrationSim } from './titration';
import { cellSim } from './cell';
import { heartSim } from './heart';
import { grapherSim } from './grapher';
import { geometrySim } from './geometry';
import { moleculeSim } from './molecule';

export type SimKind =
  | 'pulley' | 'incline' | 'spring' | 'pendulum' | 'projectile' | 'circuit' | 'optics'
  | 'magnet' | 'waves' | 'gauge' | 'logic' | 'algo' | 'periodic' | 'titration' | 'cell' | 'heart' | 'grapher' | 'geometry' | 'molecule';

export const SIMS: Record<SimKind, SimDef<SimState>> = {
  pulley: pulleySim as unknown as SimDef<SimState>,
  incline: inclineSim as unknown as SimDef<SimState>,
  spring: springSim as unknown as SimDef<SimState>,
  pendulum: pendulumSim as unknown as SimDef<SimState>,
  projectile: projectileSim as unknown as SimDef<SimState>,
  circuit: circuitSim as unknown as SimDef<SimState>,
  optics: opticsSim as unknown as SimDef<SimState>,
  magnet: magnetSim as unknown as SimDef<SimState>,
  waves: wavesSim as unknown as SimDef<SimState>,
  gauge: gaugeSim as unknown as SimDef<SimState>,
  logic: logicSim as unknown as SimDef<SimState>,
  algo: algoSim as unknown as SimDef<SimState>,
  periodic: periodicSim as unknown as SimDef<SimState>,
  titration: titrationSim as unknown as SimDef<SimState>,
  cell: cellSim as unknown as SimDef<SimState>,
  heart: heartSim as unknown as SimDef<SimState>,
  grapher: grapherSim as unknown as SimDef<SimState>,
  geometry: geometrySim as unknown as SimDef<SimState>,
  molecule: moleculeSim as unknown as SimDef<SimState>,
};

export const SIM_KINDS = Object.keys(SIMS) as SimKind[];
export const isSimKind = (k: unknown): k is SimKind => typeof k === 'string' && k in SIMS;

/** The parts of a board element this module needs; the full type lives in model.ts. */
export interface SimLike {
  id: string;
  kind: SimKind;
  x: number;
  y: number;
  w: number;
  h: number;
  params: SimParams;
}

// --- card geometry (base units) ----------------------------------------------------

export const HEAD = 38;
export const STRIP = 50;
export const CARD_W = BW;
export const CARD_H = HEAD + BH + STRIP;
export const CARD_RATIO = CARD_W / CARD_H;

/** Fills in any setting a saved board is missing, and drops ones the simulator no longer has. */
export function fullParams(kind: SimKind, params: SimParams | undefined): SimParams {
  const def = SIMS[kind].defaults;
  const out: SimParams = { ...def };
  if (params) {
    for (const k of Object.keys(def)) {
      const v = params[k];
      if (typeof v === typeof def[k]) out[k] = v;
    }
  }
  return out;
}

// --- running state ------------------------------------------------------------------------

export interface Run {
  key: string;
  state: SimState;
  playing: boolean;
  speed: number;
}

const runs = new Map<string, Run>();

/** Settings that only change what is drawn, so changing them never restarts the motion. */
const DISPLAY = new Set(['forces', 'motion', 'components', 'graph', 'energy', 'trail', 'vectors', 'ideal', 'rays', 'values', 'meters']);

const keyOf = (el: SimLike) =>
  `${el.kind}|${JSON.stringify(Object.entries(el.params).filter(([k]) => !DISPLAY.has(k) && !SIMS[el.kind].display?.includes(k)))}`;

/** The live state for an element, started over if its settings changed. */
export function runOf(el: SimLike): Run {
  const key = keyOf(el);
  const def = SIMS[el.kind];
  // Self-starting simulators run unless the setup is still: a still one would only keep the board redrawing.
  const auto = !!def.autoplay && !def.still?.(el.params);
  let run = runs.get(el.id);
  if (!run) {
    run = { key, state: def.init(el.params), playing: auto, speed: 1 };
    runs.set(el.id, run);
  } else if (run.key !== key) {
    run.key = key;
    run.state = def.init(el.params);
    if (def.autoplay) run.playing = auto;
    else if (def.still?.(el.params)) run.playing = false;
  }
  return run;
}

/** The settings a paused or finished run wants saved, if any (see SimDef.commit). */
export function commitRun(el: SimLike): SimParams | null {
  const def = SIMS[el.kind];
  const run = runs.get(el.id);
  if (!def.commit || !run) return null;
  const patch = def.commit(el.params, run.state);
  if (!patch || Object.entries(patch).every(([k, v]) => el.params[k] === v)) return null;
  return patch;
}

/** The settings "Back to the start" restores, if they differ from the current ones. */
export function resetPatch(el: SimLike): SimParams | null {
  const patch = SIMS[el.kind].resetParams;
  if (!patch || Object.entries(patch).every(([k, v]) => el.params[k] === v)) return null;
  return patch;
}

export function resetRun(el: SimLike) {
  const run = runOf(el);
  run.state = SIMS[el.kind].init(el.params);
}

export function setPlaying(el: SimLike, on: boolean) {
  const run = runOf(el);
  if (on && run.state.done) run.state = SIMS[el.kind].init(el.params);
  run.playing = on;
}

export function setSpeed(el: SimLike, speed: number) {
  runOf(el).speed = speed;
}

/** Forgets the motion of simulators no longer on the board. */
export function pruneRuns(alive: Set<string>) {
  for (const id of runs.keys()) if (!alive.has(id)) runs.delete(id);
}

/** Advances a playing simulator by `wall` seconds of real time. Returns false once it stops. */
export function advance(el: SimLike, wall: number): boolean {
  const run = runOf(el);
  if (!run.playing) return false;
  const def = SIMS[el.kind];
  let left = Math.min(0.1, wall) * run.speed;
  const H = 1 / 240;
  while (left > 1e-9 && !run.state.done) {
    const dt = Math.min(H, left);
    def.step(el.params, run.state, dt);
    left -= dt;
  }
  if (run.state.done) run.playing = false;
  return run.playing;
}

export const anyPlaying = (ids: Iterable<string>) => {
  for (const id of ids) if (runs.get(id)?.playing) return true;
  return false;
};

/** Steps one frame (1/30 s) while paused, for looking closely. */
export function stepOnce(el: SimLike) {
  const run = runOf(el);
  if (run.state.done) return;
  const def = SIMS[el.kind];
  for (let i = 0; i < 8; i++) def.step(el.params, run.state, 1 / 240);
}

// --- drawing --------------------------------------------------------------------------------

export function lookFor(colors: Record<string, string>, line: string): Look {
  const hex = colors.ink.replace('#', '');
  const lum = parseInt(hex.slice(0, 2), 16) * 0.3 + parseInt(hex.slice(2, 4), 16) * 0.59 + parseInt(hex.slice(4, 6), 16) * 0.11;
  const dark = lum > 128;
  return {
    line,
    ink: colors.ink,
    muted: dark ? '#a1a1a6' : '#6e6e73',
    faint: dark ? '#636366' : '#aeaeb2',
    card: dark ? '#242426' : '#ffffff',
    cardEdge: dark ? '#3a3a3c' : '#ececf0',
    red: colors.red,
    blue: colors.blue,
    green: colors.green,
    orange: colors.orange,
    violet: colors.violet,
    yellow: colors.yellow,
    dark,
  };
}

/** Where the card's base box sits inside the element: uniform scale, centred. */
export function cardFrame(el: SimLike) {
  const s = Math.min(el.w / CARD_W, el.h / CARD_H);
  return { s, ox: el.x + (el.w - CARD_W * s) / 2, oy: el.y + (el.h - CARD_H * s) / 2 };
}

export type SimButton = 'play' | 'reset' | 'settings';
const BUTTONS: { name: SimButton; x: number }[] = [
  { name: 'settings', x: CARD_W - 24 },
  { name: 'reset', x: CARD_W - 58 },
  { name: 'play', x: CARD_W - 94 },
];
const BTN_R = 14;

/** A setup with no motion: only the settings button shows. */
export const isStill = (el: SimLike) => !!SIMS[el.kind].still?.(el.params);
const buttonsFor = (el: SimLike) => (isStill(el) ? BUTTONS.filter((b) => b.name === 'settings') : BUTTONS);

/** Which title-bar button, if any, a board point is on. */
export function simButtonAt(el: SimLike, wx: number, wy: number): SimButton | null {
  const f = cardFrame(el);
  const bx = (wx - f.ox) / f.s;
  const by = (wy - f.oy) / f.s;
  if (by < 0 || by > HEAD) return null;
  for (const b of buttonsFor(el)) if (Math.hypot(bx - b.x, by - HEAD / 2) <= BTN_R + 3) return b.name;
  return null;
}

/** The hand-operable part of a simulator at a board point, if any. */
export function simGrabAt(el: SimLike, wx: number, wy: number): SimGrab | null {
  const def = SIMS[el.kind];
  if (!def.grab) return null;
  const f = cardFrame(el);
  const x = (wx - f.ox) / f.s;
  const y = (wy - f.oy) / f.s - HEAD;
  if (x < 0 || x > BW || y < 0 || y > BH) return null;
  return def.grab(el.params, runOf(el).state, x, y);
}

/** A board point in a simulator's drawing box. */
export function simPoint(el: SimLike, wx: number, wy: number): [number, number] {
  const f = cardFrame(el);
  return [(wx - f.ox) / f.s, (wy - f.oy) / f.s - HEAD];
}

const ROLE: Record<string, keyof Look> = {
  red: 'red', blue: 'blue', green: 'green', orange: 'orange', violet: 'violet',
};

function drawButton(ctx: CanvasRenderingContext2D, name: SimButton, x: number, y: number, look: Look, run: Run) {
  ctx.save();
  const primary = name === 'play';
  ctx.beginPath();
  ctx.arc(x, y, BTN_R, 0, Math.PI * 2);
  ctx.fillStyle = primary ? look.blue : look.cardEdge;
  ctx.fill();
  const fg = primary ? '#ffffff' : look.ink;
  ctx.fillStyle = fg;
  ctx.strokeStyle = fg;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (name === 'play') {
    if (run.playing) {
      ctx.fillRect(x - 5, y - 6, 3.6, 12);
      ctx.fillRect(x + 1.4, y - 6, 3.6, 12);
    } else if (run.state.done) {
      ctx.beginPath();
      ctx.arc(x, y, 5.5, -Math.PI * 0.8, Math.PI * 0.75);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - 6.5, y - 7.5);
      ctx.lineTo(x - 5, y - 2.5);
      ctx.lineTo(x - 0.5, y - 4.5);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x - 3.5, y - 6.5);
      ctx.lineTo(x + 6.5, y);
      ctx.lineTo(x - 3.5, y + 6.5);
      ctx.closePath();
      ctx.fill();
    }
  } else if (name === 'reset') {
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 5.5);
    ctx.lineTo(x - 6, y + 5.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 6, y - 6);
    ctx.lineTo(x - 2.5, y);
    ctx.lineTo(x + 6, y + 6);
    ctx.closePath();
    ctx.fill();
  } else {
    for (const dy of [-4.5, 0, 4.5]) {
      ctx.beginPath();
      ctx.moveTo(x - 6, y + dy);
      ctx.lineTo(x + 6, y + dy);
      ctx.stroke();
    }
    ctx.fillStyle = look.cardEdge;
    ctx.strokeStyle = fg;
    ctx.lineWidth = 1.6;
    for (const [dx, dy] of [[2.5, -4.5], [-2.5, 0], [1.5, 4.5]]) {
      ctx.beginPath();
      ctx.arc(x + dx, y + dy, 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawStrip(ctx: CanvasRenderingContext2D, el: SimLike, run: Run, look: Look) {
  const items = SIMS[el.kind].readouts(el.params, run.state);
  const y0 = HEAD + BH;
  ctx.save();
  ctx.fillStyle = look.dark ? '#1f1f21' : '#f6f6f8';
  ctx.fillRect(0, y0, CARD_W, STRIP);
  ctx.strokeStyle = look.cardEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, y0);
  ctx.lineTo(CARD_W, y0);
  ctx.stroke();
  // Each cell is as wide as its text; everything shrinks together if it would not fit.
  const PAD = 18;
  ctx.font = `600 12.5px ${SIM_FONT}`;
  const widths = items.map((it) => {
    ctx.font = `600 12.5px ${SIM_FONT}`;
    const v = ctx.measureText(it.value).width;
    ctx.font = `500 10px ${SIM_FONT}`;
    return Math.max(v, ctx.measureText(it.label.toUpperCase()).width) + PAD;
  });
  const total = widths.reduce((a, b) => a + b, 0);
  const k = Math.min(1, (CARD_W - 24) / total);
  let x = 12 + Math.max(0, (CARD_W - 24 - total * k) / 2) * 0;
  items.forEach((it, i) => {
    ctx.font = `500 ${10 * k}px ${SIM_FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = look.muted;
    ctx.fillText(it.label.toUpperCase(), x, y0 + 16);
    ctx.font = `650 ${12.5 * k}px ${SIM_FONT}`;
    const role = it.color ? ROLE[it.color] : undefined;
    ctx.fillStyle = role ? (look[role] as string) : look.ink;
    ctx.fillText(it.value, x, y0 + 34);
    x += widths[i] * k;
  });
  ctx.restore();
}

/** Draws a simulator card. `selected` brightens the border. */
export function drawSim(ctx: CanvasRenderingContext2D, el: SimLike, look: Look) {
  const def = SIMS[el.kind];
  const run = runOf(el);
  const f = cardFrame(el);
  ctx.save();
  ctx.translate(f.ox, f.oy);
  ctx.scale(f.s, f.s);

  ctx.save();
  ctx.shadowColor = look.dark ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.08)';
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.roundRect(0, 0, CARD_W, CARD_H, 16);
  ctx.fillStyle = look.card;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, CARD_W, CARD_H, 16);
  ctx.clip();

  // Title bar.
  ctx.fillStyle = look.dark ? '#2c2c2e' : '#fafafc';
  ctx.fillRect(0, 0, CARD_W, HEAD);
  ctx.strokeStyle = look.cardEdge;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, HEAD);
  ctx.lineTo(CARD_W, HEAD);
  ctx.stroke();
  ctx.font = `650 13.5px ${SIM_FONT}`;
  ctx.fillStyle = look.ink;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(def.title(el.params), 16, HEAD / 2);
  const still = isStill(el);
  const status = still ? '' : run.playing ? `${run.speed === 1 ? '' : `${fmt(run.speed)}× · `}t = ${fmt(run.state.t, 2)} s` : run.state.done ? 'Finished' : run.state.t > 0 ? 'Paused' : '';
  if (status) {
    ctx.font = `500 11px ${SIM_FONT}`;
    ctx.fillStyle = look.muted;
    ctx.textAlign = 'right';
    ctx.fillText(status, CARD_W - 118, HEAD / 2);
  }
  for (const b of buttonsFor(el)) drawButton(ctx, b.name, b.x, HEAD / 2, look, run);

  // The simulation itself, clipped to its area.
  ctx.save();
  ctx.translate(0, HEAD);
  ctx.beginPath();
  ctx.rect(0, 0, BW, BH);
  ctx.clip();
  withLabelBox(BW, BH, () => def.draw(ctx, el.params, run.state, look));
  ctx.restore();

  drawStrip(ctx, el, run, look);
  ctx.restore();

  ctx.beginPath();
  ctx.roundRect(0.5, 0.5, CARD_W - 1, CARD_H - 1, 16);
  ctx.strokeStyle = look.cardEdge;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

export type { Control, Formula, SimGrab, SimParams, SimSubject } from './kit';
