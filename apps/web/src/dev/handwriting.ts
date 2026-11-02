/**
 * Dev page for eyeballing the handwriting: /handwriting.html
 *
 * Top half: the built-in alphabet, used for characters the user has not written yet.
 * Bottom half: proof that learned letterforms are reused — ink is "written" with a
 * deliberately odd crossed 7, learned, then replayed in a new answer.
 */

import { CAP } from '../hand/glyphs';
import { emptyBank, learnFrom } from '../hand/learn';
import type { Bank } from '../hand/learn';
import { DEFAULT_STYLE, seedFrom, writeAnswer } from '../hand/writer';
import { freehandPath } from '../ink';
import type { StrokeEl } from '../model';

const SAMPLES: [string, 'latex' | 'text'][] = [
  ['15', 'latex'],
  ['9396', 'latex'],
  ['x = 2, 3', 'latex'],
  ['\\frac{3}{4}', 'latex'],
  ['x^2 + 5x - 14', 'latex'],
  ['\\sqrt{2} \\approx 1.414', 'latex'],
  ['0123456789', 'text'],
  ['abcdefghijklmnopqrstuvwxyz', 'text'],
  ['+ - = × ÷ ± ≈ ≠ ≤ ≥ π θ', 'text'],
];

const W = 1180;
const ROW = 86;
const PAD = 26;

const canvas = document.createElement('canvas');
const dpr = window.devicePixelRatio || 1;
const H = (SAMPLES.length + 5) * ROW + PAD * 2;
canvas.style.width = `${W}px`;
canvas.style.height = `${H}px`;
canvas.width = W * dpr;
canvas.height = H * dpr;
document.body.append(canvas);

const ctx = canvas.getContext('2d')!;
ctx.scale(dpr, dpr);
ctx.fillStyle = '#fbfbfd';
ctx.fillRect(0, 0, W, H);

function write(
  source: string, kind: 'latex' | 'text', x: number, baseline: number, cap: number,
  seed: number, bank?: Bank,
) {
  const fontSize = cap / CAP;
  const penWidth = Math.max(2, cap * 0.1);
  const written = writeAnswer(source, kind, { ...DEFAULT_STYLE, fontSize, penWidth, seed, bank });
  ctx.save();
  ctx.fillStyle = '#1d1d1f';
  ctx.translate(x, baseline - written.ascent);
  for (const stroke of written.strokes) ctx.fill(freehandPath(stroke, penWidth));
  ctx.restore();
  return written;
}

const label = (text: string, y: number) => {
  ctx.fillStyle = '#8e8e93';
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText(text, PAD, y);
};

const guide = (y: number) => {
  ctx.strokeStyle = '#e8e8ee';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, y + 0.5);
  ctx.lineTo(W - PAD, y + 0.5);
  ctx.stroke();
};

// --- built-in alphabet ------------------------------------------------------

label('BUILT-IN HAND — used for characters not yet seen from the user', PAD + 12);
let y = PAD + 58;
for (const [source, kind] of SAMPLES) {
  guide(y);
  const a = write(source, kind, PAD, y, 32, seedFrom(source));
  write(source, kind, PAD + a.w + 44, y, 20, seedFrom(source + 'b'));
  y += ROW;
}

// --- learned from the user ---------------------------------------------------

/** Stroke element shaped like the canvas produces, standing in for real pen input. */
const mk = (pts: [number, number][], size = 5): StrokeEl => ({
  id: Math.random().toString(36).slice(2),
  type: 'stroke',
  kind: 'pen',
  color: 'ink',
  size,
  simulate: false,
  points: pts.map(([x, yy]) => [x, yy, 0.62]),
});

const seg = (x0: number, y0: number, x1: number, y1: number, n = 12): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => [x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n]);
const ring = (cx: number, cy: number, r: number, n = 26): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => [cx + r * Math.cos((i / n) * 2 * Math.PI), cy + r * Math.sin((i / n) * 2 * Math.PI)]);

// "7 + 8 =" where the 7 is crossed through — something the built-in hand never does.
const ink: StrokeEl[] = [
  mk(seg(250, 282, 296, 282)), mk(seg(296, 282, 274, 330)), mk(seg(256, 308, 290, 304)),
  mk(seg(324, 308, 362, 308)), mk(seg(343, 289, 343, 327)),
  mk(ring(404, 295, 13)), mk(ring(404, 318, 15)),
  mk(seg(438, 300, 476, 300)), mk(seg(438, 318, 476, 318)),
];

const bank = emptyBank();
const captured = learnFrom(bank, ink, '7 + 8 =');

y += 16;
label(`LEARNED FROM THE USER — captured ${captured.join(' ')} from a crossed 7`, y - 14);
y += 30;

// The user's own ink, as drawn.
guide(y);
ctx.save();
ctx.fillStyle = '#1d1d1f';
const minX = Math.min(...ink.flatMap((s) => s.points.map((p) => p[0])));
const maxY = Math.max(...ink.flatMap((s) => s.points.map((p) => p[1])));
ctx.translate(PAD - minX, y - maxY);
for (const s of ink) ctx.fill(freehandPath(s.points, s.size));
ctx.restore();
ctx.fillStyle = '#8e8e93';
ctx.font = '11px system-ui, sans-serif';
ctx.fillText('← what the user wrote', PAD + 250, y - 8);
y += ROW;

// The same characters written back, now in the user's hand. The 7s should be crossed.
guide(y);
const w1 = write('7 + 8 = 78', 'latex', PAD, y, 32, seedFrom('learned'), bank);
ctx.fillStyle = '#8e8e93';
ctx.fillText('← written by the AI using the learned 7, 8, + and =', PAD + w1.w + 20, y - 8);
y += ROW;

// Side by side at the same seed: built-in vs learned.
guide(y);
const b1 = write('78', 'latex', PAD, y, 32, 5);
ctx.fillStyle = '#8e8e93';
ctx.fillText('built-in', PAD, y + 20);
const b2 = write('78', 'latex', PAD + b1.w + 70, y, 32, 5, bank);
ctx.fillStyle = '#8e8e93';
ctx.fillText('learned (crossed 7)', PAD + b1.w + 70, y + 20);
void b2;
