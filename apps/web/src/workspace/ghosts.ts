/** Draws other people's live strokes and pointers in a Collaborate room, in world coordinates. */
import type { Colors } from '../render';
import { drawElement } from '../render';
import { currentGhosts } from './livebus';

const FADE_MS = 4000;

export function drawGhosts(ctx: CanvasRenderingContext2D, z: number, colors: Colors, onBoard: (id: string) => boolean): void {
  const now = performance.now();
  for (const g of currentGhosts()) {
    // A finished stroke stays until the committed copy arrives, so it never blinks out.
    if (g.stroke && !onBoard(g.stroke.id)) drawElement(ctx, g.stroke, colors, { live: true });
    if (!g.at) continue;
    const age = now - g.seen;
    if (age > FADE_MS) continue;
    const alpha = age < FADE_MS - 600 ? 1 : (FADE_MS - age) / 600;
    const color = colors[g.color as keyof Colors] ?? g.color;
    const [x, y] = g.at;
    const s = 1 / z;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.scale(s, s);
    // Pointer arrow.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 16);
    ctx.lineTo(4.5, 12);
    ctx.lineTo(8, 19);
    ctx.lineTo(10.5, 18);
    ctx.lineTo(7, 11.2);
    ctx.lineTo(12.5, 11.2);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.fill();
    ctx.stroke();
    // Name tag.
    ctx.font = '600 11.5px -apple-system, "Segoe UI", system-ui, sans-serif';
    const w = ctx.measureText(g.name).width + 14;
    const tx = 12;
    const ty = 19;
    ctx.beginPath();
    ctx.roundRect(tx, ty, w, 20, 10);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(g.name, tx + 7, ty + 10.5);
    ctx.restore();
  }
}
