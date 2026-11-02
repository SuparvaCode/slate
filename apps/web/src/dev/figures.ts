/**
 * Dev page for eyeballing every figure with the real board renderer: /figures.html
 */

import { FIGURES, FIGURE_GROUPS } from '../figures';
import type { FigureEl } from '../model';
import { drawElement } from '../render';
import { PALETTE } from '../theme';

const COLS = 5;
const CELL_W = 220;
const CELL_H = 150;
const PAD = 30;
const colors = PALETTE.light;

const rows = FIGURE_GROUPS.reduce((n, g) => n + 1 + Math.ceil(g.kinds.length / COLS), 0);
const W = COLS * CELL_W + PAD * 2;
const H = rows * CELL_H * 0.9 + PAD * 2 + 40;

const canvas = document.createElement('canvas');
const dpr = window.devicePixelRatio || 1;
canvas.style.width = `${W}px`;
canvas.style.height = `${H}px`;
canvas.width = W * dpr;
canvas.height = H * dpr;
document.body.append(canvas);

const ctx = canvas.getContext('2d')!;
ctx.scale(dpr, dpr);
ctx.fillStyle = '#fbfbfd';
ctx.fillRect(0, 0, W, H);

let y = PAD;
for (const group of FIGURE_GROUPS) {
  ctx.fillStyle = '#6e6e73';
  ctx.font = '600 13px system-ui, sans-serif';
  ctx.fillText(group.title.toUpperCase(), PAD, y + 12);
  y += 30;
  group.kinds.forEach((kind, i) => {
    const def = FIGURES[kind];
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const boxH = 90;
    let w = def.ratio >= 1 ? 130 : 130 * def.ratio;
    let h = w / def.ratio;
    if (h > boxH) {
      h = boxH;
      w = h * def.ratio;
    }
    const cx = PAD + col * CELL_W + CELL_W / 2;
    const top = y + row * CELL_H * 0.9;
    const el: FigureEl = {
      id: kind, type: 'figure', kind, x: cx - w / 2, y: top + (boxH - h) / 2, w, h,
      color: 'ink', size: 3, fill: true,
    };
    drawElement(ctx, el, colors);
    ctx.fillStyle = '#8e8e93';
    ctx.font = '12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(def.label, cx, top + boxH + 22);
    ctx.textAlign = 'left';
  });
  y += Math.ceil(group.kinds.length / COLS) * CELL_H * 0.9 + 6;
}
