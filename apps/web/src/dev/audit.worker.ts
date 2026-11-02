/**
 * The simulator audit, run in a worker so a hang can be caught and pinned to its case.
 * The page that drives it is audit.ts; this file receives one simulator kind and reports back.
 *
 * For every simulator, every preset and its defaults, in both themes, it runs the motion, draws
 * at several moments, works every setting to its ends, and taps and drags every part of the
 * card. It reports thrown errors, NaN or ∞ reaching the canvas, broken numbers in readouts,
 * TeX that KaTeX refuses, settings patches of the wrong type, and text that is cut off by the
 * card or piles up on other text. The result is on window.__audit as well as on the page.
 */

import katex from 'katex';
import { BH, BW, withLabelBox } from '../sim/kit';
import { CARD_H, CARD_W, HEAD, SIMS, drawSim, fullParams, lookFor } from '../sim';
import type { SimKind, SimParams } from '../sim';
import type { SimState } from '../sim/kit';
import { PALETTE } from '../theme';

type Level = 'error' | 'warn';
interface Finding { level: Level; kind: SimKind; where: string; what: string }

const findings: Finding[] = [];
const seen = new Set<string>();
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

function report(level: Level, kind: SimKind, where: string, what: string) {
  const key = `${level}|${kind}|${what}`;
  if (seen.has(key)) return;
  seen.add(key);
  const f = { level, kind, where, what };
  findings.push(f);
  post({ type: 'finding', finding: f });
}

// --- a canvas that watches what is drawn on it ----------------------------------------------------

interface TextBox { s: string; x0: number; y0: number; x1: number; y1: number }

const canvas = new OffscreenCanvas(CARD_W, CARD_H);
const raw = canvas.getContext('2d') as unknown as CanvasRenderingContext2D;
let texts: TextBox[] = [];
let badCalls: string[] = [];

const NUMERIC = ['moveTo', 'lineTo', 'arc', 'arcTo', 'ellipse', 'rect', 'roundRect', 'fillRect', 'strokeRect', 'quadraticCurveTo', 'bezierCurveTo', 'translate', 'scale', 'rotate', 'fillText', 'strokeText', 'createLinearGradient', 'createRadialGradient'] as const;
for (const name of NUMERIC) {
  const orig = (raw as unknown as Record<string, (...a: unknown[]) => unknown>)[name].bind(raw);
  (raw as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
    const nums = name === 'fillText' || name === 'strokeText' ? args.slice(1, 3) : args.filter((a) => typeof a === 'number');
    if (nums.some((n) => typeof n === 'number' && !Number.isFinite(n))) badCalls.push(`${name}(${args.map((a) => (typeof a === 'number' ? String(a) : typeof a === 'string' ? JSON.stringify(a.slice(0, 20)) : typeof a)).join(', ')})`);
    if (name === 'fillText') {
      const s = String(args[0]);
      if (/NaN|undefined|Infinity|null|\[object/.test(s)) badCalls.push(`text "${s.slice(0, 60)}"`);
      recordText(s, args[1] as number, args[2] as number);
    }
    // Gradients with non-finite stops throw; let them, the caller reports it.
    return orig(...args);
  };
}

function recordText(s: string, x: number, y: number) {
  if (!s.trim() || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const m = raw.measureText(s);
  const size = Number(/(\d+(?:\.\d+)?)px/.exec(raw.font)?.[1] ?? 12);
  const align = raw.textAlign;
  const base = raw.textBaseline;
  const w = m.width;
  let lx = align === 'center' ? x - w / 2 : align === 'right' || align === 'end' ? x - w : x;
  const top = base === 'middle' ? y - size * 0.5 : base === 'top' || base === 'hanging' ? y : base === 'bottom' || base === 'ideographic' ? y - size : y - size * 0.8;
  const t = raw.getTransform();
  // Corners through the current transform, in card pixels.
  const pts = [[lx, top], [lx + w, top], [lx, top + size], [lx + w, top + size]].map(([px, py]) => [t.a * px + t.c * py + t.e, t.b * px + t.d * py + t.f]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  texts.push({ s, x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
  void lx;
}

// --- running one case ----------------------------------------------------------------------------------

let caseNo = 0;

function drawCase(kind: SimKind, params: SimParams, state: SimState, theme: 'light' | 'dark', where: string) {
  const colors = PALETTE[theme];
  const look = lookFor(colors, colors.ink);
  const def = SIMS[kind];
  texts = [];
  badCalls = [];
  raw.setTransform(1, 0, 0, 1, 0, 0);
  raw.clearRect(0, 0, CARD_W, CARD_H);
  // Draw the simulation by itself in its box, so its text can be checked against the clip.
  raw.save();
  raw.translate(0, HEAD);
  try {
    withLabelBox(BW, BH, () => def.draw(raw, params, state, look));
  } catch (e) {
    report('error', kind, where, `draw threw: ${String((e as Error)?.message ?? e)}`);
  }
  raw.restore();
  for (const b of badCalls) report('error', kind, where, `non-finite or broken value drawn: ${b}`);
  const inBox = texts;
  // Text the card would cut off: past the drawing box by more than 2 px.
  for (const t of inBox) {
    const over = Math.max(0 - t.x0, t.x1 - BW, HEAD - t.y0, t.y1 - (HEAD + BH));
    if (over > 2) report('warn', kind, where, `text cut off by ${Math.round(over)} px: "${t.s.slice(0, 50)}"`);
  }
  // Text piled on other text: overlap of more than 45% of the smaller one.
  for (let i = 0; i < inBox.length; i++) {
    for (let j = i + 1; j < inBox.length; j++) {
      const a = inBox[i];
      const b = inBox[j];
      if (a.s === b.s && Math.abs(a.x0 - b.x0) < 1 && Math.abs(a.y0 - b.y0) < 1) continue;
      const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ix <= 0 || iy <= 0) continue;
      const small = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
      if (small > 0 && (ix * iy) / small > 0.45) report('warn', kind, where, `text overlaps: "${a.s.slice(0, 30)}" and "${b.s.slice(0, 30)}"`);
    }
  }
  // The whole card, as the board draws it: title bar and readout strip.
  texts = [];
  badCalls = [];
  raw.setTransform(1, 0, 0, 1, 0, 0);
  const el = { id: `audit-${caseNo++}`, kind, x: 0, y: 0, w: CARD_W, h: CARD_H, params };
  try {
    drawSim(raw, el, look);
  } catch (e) {
    report('error', kind, where, `card threw: ${String((e as Error)?.message ?? e)}`);
  }
  for (const b of badCalls) report('error', kind, where, `card drew a broken value: ${b}`);
  const title = texts.find((t) => t.y1 <= HEAD + 1 && t.x0 < 40);
  if (title && title.x1 > CARD_W - 130) report('warn', kind, where, `title runs into the buttons: "${title.s}"`);
}

function checkNumbers(kind: SimKind, where: string, obj: unknown, path = 'state', depth = 0) {
  if (depth > 3 || obj === null || obj === undefined) return;
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) report('error', kind, where, `${path} became ${obj}`);
    return;
  }
  if (typeof obj !== 'object') return;
  const entries = Array.isArray(obj) ? obj.slice(0, 60).map((v, i) => [String(i), v] as const) : Object.entries(obj as Record<string, unknown>);
  for (const [k, v] of entries) checkNumbers(kind, where, v, `${path}.${k}`, depth + 1);
}

function checkReadouts(kind: SimKind, params: SimParams, state: SimState, where: string) {
  const def = SIMS[kind];
  try {
    const title = def.title(params);
    if (!title || /NaN|undefined|Infinity|null/.test(title)) report('error', kind, where, `bad title "${title}"`);
  } catch (e) {
    report('error', kind, where, `title threw: ${String((e as Error)?.message ?? e)}`);
  }
  try {
    const rs = def.readouts(params, state);
    for (const r of rs) {
      if (!r.label || /NaN|undefined|Infinity|null|\[object/.test(`${r.label} ${r.value}`)) report('error', kind, where, `bad readout ${r.label}: "${r.value}"`);
      if (r.value === '') report('warn', kind, where, `empty readout "${r.label}"`);
    }
    if (rs.length > 7) report('warn', kind, where, `${rs.length} readouts: the strip will be cramped`);
  } catch (e) {
    report('error', kind, where, `readouts threw: ${String((e as Error)?.message ?? e)}`);
  }
  try {
    for (const f of def.formulas(params)) {
      if (/NaN|undefined|Infinity|null/.test(f.tex)) report('error', kind, where, `formula "${f.label}" has a broken number: ${f.tex.slice(0, 80)}`);
      try {
        katex.renderToString(f.tex, { throwOnError: true, strict: 'ignore' });
      } catch (e) {
        report('error', kind, where, `KaTeX rejects "${f.label}": ${String((e as Error)?.message ?? e).slice(0, 120)}`);
      }
    }
  } catch (e) {
    report('error', kind, where, `formulas threw: ${String((e as Error)?.message ?? e)}`);
  }
}

function validPatch(kind: SimKind, where: string, patch: SimParams | null | undefined, how: string): boolean {
  if (!patch) return false;
  for (const [k, v] of Object.entries(patch)) {
    if (!['number', 'string', 'boolean'].includes(typeof v)) {
      report('error', kind, where, `${how} set ${k} to a ${typeof v}`);
      return false;
    }
    if (typeof v === 'number' && !Number.isFinite(v)) {
      report('error', kind, where, `${how} set ${k} to ${v}`);
      return false;
    }
  }
  return true;
}

/** Runs a setup forward, drawing and checking at a few moments. Returns the state at the end. */
function runCase(kind: SimKind, params: SimParams, theme: 'light' | 'dark', where: string, moments = [0, 0.6, 2.5, 8]): SimState | null {
  const def = SIMS[kind];
  post({ type: 'at', where });
  let s: SimState;
  try {
    s = def.init(params);
  } catch (e) {
    report('error', kind, where, `init threw: ${String((e as Error)?.message ?? e)}`);
    return null;
  }
  let t = 0;
  for (const m of moments) {
    try {
      while (t < m - 1e-9 && !s.done) {
        def.step(params, s, 1 / 240);
        t += 1 / 240;
      }
    } catch (e) {
      report('error', kind, where, `step threw at t = ${t.toFixed(2)} s: ${String((e as Error)?.message ?? e)}`);
      return s;
    }
    checkNumbers(kind, `${where} @${m}s`, s);
    drawCase(kind, params, s, theme, `${where} @${m}s`);
    checkReadouts(kind, params, s, `${where} @${m}s`);
  }
  return s;
}

/** Taps and drags across the whole card, applying and redrawing what each gesture does. */
function handCase(kind: SimKind, params: SimParams, theme: 'light' | 'dark', where: string) {
  const def = SIMS[kind];
  if (!def.grab) return;
  let s: SimState;
  try {
    s = def.init(params);
    for (let i = 0; i < 120; i++) def.step(params, s, 1 / 240);
  } catch {
    return;
  }
  const done = new Set<string>();
  let applied = 0;
  for (let y = 6; y < BH; y += 20) {
    for (let x = 6; x < BW; x += 20) {
      let g;
      try {
        g = def.grab(params, s, x, y);
      } catch (e) {
        report('error', kind, where, `grab threw at (${x}, ${y}): ${String((e as Error)?.message ?? e)}`);
        continue;
      }
      if (!g) continue;
      const results: [string, SimParams | null][] = [];
      if (g.tap) results.push(['tap', g.tap]);
      if (g.drag) {
        for (const [dx, dy] of [[0, 0], [37, 0], [-53, 21], [0, -64], [120, 90], [-300, -300], [800, 800]]) {
          try {
            results.push([`drag (${dx}, ${dy})`, g.drag(x + dx, y + dy)]);
          } catch (e) {
            report('error', kind, where, `drag threw from (${x}, ${y}): ${String((e as Error)?.message ?? e)}`);
          }
        }
      }
      if (g.drop) {
        try {
          results.push(['drop', g.drop(x + 30, y + 10)]);
          results.push(['tap-drop', g.drop(x, y)]);
        } catch (e) {
          report('error', kind, where, `drop threw at (${x}, ${y}): ${String((e as Error)?.message ?? e)}`);
        }
      }
      for (const [how, patch] of results) {
        if (!validPatch(kind, `${where} ${how} at (${x}, ${y})`, patch, how)) continue;
        const key = JSON.stringify(patch);
        if (done.has(key) || applied > 40) continue;
        done.add(key);
        applied++;
        const next = fullParams(kind, { ...params, ...patch });
        runCase(kind, next, theme, `${where} after ${how} at (${x}, ${y})`, [0, 0.5]);
      }
    }
  }
}

/** Every setting at its ends and every option of every choice. */
function controlCases(kind: SimKind, base: SimParams, theme: 'light' | 'dark', where: string) {
  const def = SIMS[kind];
  for (const c of def.controls) {
    if (c.show && !c.show(base)) continue;
    const values: (number | string | boolean)[] = c.type === 'range' ? [c.min, c.max, (c.min + c.max) / 2] : c.type === 'choice' ? c.options.map((o) => o.value) : [true, false];
    for (const v of values) {
      if (c.type === 'range') {
        const steps = (Number(v) - c.min) / c.step;
        if (Math.abs(steps - Math.round(steps)) > 1e-6 && v !== c.max) continue;
      }
      runCase(kind, fullParams(kind, { ...base, [c.key]: v }), theme, `${where} ${c.key} = ${String(v)}`, [0, 1.5]);
    }
  }
}

// --- the run ------------------------------------------------------------------------------------------------

self.onmessage = (ev: MessageEvent<{ kind: SimKind }>) => {
  const kind = ev.data.kind;
  const def = SIMS[kind];
  const t0 = performance.now();
  let setups = 0;
  const slow: [string, number][] = [];
  for (const theme of ['light', 'dark'] as const) {
    const list: { name: string; params: SimParams }[] = [{ name: 'defaults', params: {} }, ...(def.presets ?? []).map((p) => ({ name: `preset "${p.label}"`, params: p.params }))];
    for (const st of list) {
      const params = fullParams(kind, { ...def.defaults, ...st.params });
      const where = `${theme} ${st.name}`;
      const ts = performance.now();
      runCase(kind, params, theme, where);
      if (theme === 'light') {
        controlCases(kind, params, theme, where);
        handCase(kind, params, theme, where);
      }
      setups++;
      slow.push([where, performance.now() - ts]);
    }
  }
  slow.sort((a, b) => b[1] - a[1]);
  post({ type: 'done', kind, setups, ms: performance.now() - t0, slowest: slow.slice(0, 3) });
};
