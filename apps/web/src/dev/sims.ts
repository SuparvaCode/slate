/**
 * Dev page for eyeballing every simulator setup partway through its run: /sims.html
 * Add ?dark to see the dark theme.
 */

import { CARD_H, CARD_W, SIMS, drawSim, fullParams, lookFor, runOf, setPlaying, advance } from '../sim';
import type { SimKind, SimParams } from '../sim';
import { PALETTE } from '../theme';

const dark = location.search.includes('dark');
const colors = PALETTE[dark ? 'dark' : 'light'];

const CASES: { kind: SimKind; params: SimParams; t: number }[] = [
  { kind: 'pulley', params: { setup: 'atwood' }, t: 0.7 },
  { kind: 'pulley', params: { setup: 'atwood', massive: true, M: 4 }, t: 0.7 },
  { kind: 'pulley', params: { setup: 'table', m1: 4, m2: 2, mu: 0.3 }, t: 0.8 },
  { kind: 'pulley', params: { setup: 'incline', m1: 2, m2: 3, angle: 30, mu: 0.1 }, t: 0.6 },
  { kind: 'pulley', params: { setup: 'incline', m1: 5, m2: 2, angle: 30, mu: 0.25 }, t: 0.3 },
  { kind: 'pulley', params: { setup: 'tackle', strands: 1, load: 10, effort: 150 }, t: 0.4 },
  { kind: 'pulley', params: { setup: 'tackle', strands: 3, load: 40, effort: 160 }, t: 0.5 },
  { kind: 'pulley', params: { setup: 'tackle', strands: 6, load: 120, effort: 220, eff: 85 }, t: 0.5 },
  { kind: 'incline', params: { angle: 30, mu: 0.1 }, t: 0.6 },
  { kind: 'incline', params: { m: 4, angle: 25, mu: 0.1, push: 60 }, t: 0.6 },
  { kind: 'spring', params: { damping: 1.2 }, t: 1.1 },
  { kind: 'spring', params: { orient: 'horizontal' }, t: 0.4 },
  { kind: 'pendulum', params: { angle: 40, forces: true }, t: 0.5 },
  { kind: 'pendulum', params: { angle: 140, graph: false, energy: false }, t: 0.8 },
  { kind: 'projectile', params: {}, t: 1.4 },
  { kind: 'projectile', params: { angle: 20, h0: 30, v0: 15, drag: true }, t: 1.6 },
  { kind: 'circuit', params: { setup: 'series', count: 3 }, t: 0.5 },
  { kind: 'circuit', params: { setup: 'parallel', count: 3, broken: '2' }, t: 0.5 },
  { kind: 'circuit', params: { setup: 'mixed', load: 'resistor', r1: 4, r2: 6, r3: 12 }, t: 0.5 },
  { kind: 'circuit', params: { setup: 'rc' }, t: 1.5 },
  { kind: 'optics', params: { setup: 'lens', u: 45 }, t: 0 },
  { kind: 'optics', params: { setup: 'lens', u: 9 }, t: 0 },
  { kind: 'optics', params: { setup: 'concave', u: 30 }, t: 0 },
  { kind: 'optics', params: { setup: 'mirror-concave', u: 40 }, t: 0 },
  { kind: 'optics', params: { setup: 'mirror-convex', u: 30 }, t: 0 },
  { kind: 'optics', params: { setup: 'snell', n1: 1.5, n2: 1, i: 30 }, t: 0 },
  { kind: 'optics', params: { setup: 'snell', n1: 1.5, n2: 1, i: 50 }, t: 0 },
];

// ?kind=logic shows that simulator's defaults and every preset instead.
// Add &p={"setup":"tackle"} for one exact setup and &t=1.5 for the moment to show it at.
const q = new URLSearchParams(location.search);
const only = q.get('kind') as SimKind | null;
if (only && SIMS[only]) {
  const t = Number(q.get('t') ?? 0.8);
  CASES.length = 0;
  if (q.get('p')) CASES.push({ kind: only, params: JSON.parse(q.get('p')!), t });
  else {
    CASES.push({ kind: only, params: {}, t });
    for (const pr of SIMS[only].presets ?? []) CASES.push({ kind: only, params: pr.params, t });
  }
}

const COLS = Math.min(3, CASES.length);
const S = CASES.length === 1 ? Math.min(1.4, (window.innerWidth - 40) / CARD_W) : 0.62;
const GAP = 18;
const W = COLS * (CARD_W * S + GAP) + GAP;
const H = Math.ceil(CASES.length / COLS) * (CARD_H * S + GAP + 18) + GAP;

const canvas = document.createElement('canvas');
const dpr = window.devicePixelRatio || 1;
canvas.style.width = `${W}px`;
canvas.style.height = `${H}px`;
canvas.width = W * dpr;
canvas.height = H * dpr;
document.body.style.background = dark ? '#1c1c1e' : '#fbfbfd';
document.body.append(canvas);
const ctx = canvas.getContext('2d')!;
ctx.scale(dpr, dpr);

CASES.forEach((c, i) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const x = GAP + col * (CARD_W * S + GAP);
  const y = GAP + 18 + row * (CARD_H * S + GAP + 18);
  const el = {
    id: `case-${i}`, kind: c.kind, x, y, w: CARD_W * S, h: CARD_H * S,
    params: fullParams(c.kind, { ...SIMS[c.kind].defaults, ...c.params }),
  };
  if (c.t > 0) {
    setPlaying(el, true);
    for (let k = 0; k < Math.round(c.t * 30); k++) advance(el, 1 / 30);
  }
  void runOf(el);
  drawSim(ctx, el, lookFor(colors, colors.ink));
  ctx.fillStyle = dark ? '#a1a1a6' : '#6e6e73';
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText(`${i + 1}. ${c.kind} ${JSON.stringify(c.params)}`, x, y - 6);
});
