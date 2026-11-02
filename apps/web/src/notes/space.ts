/**
 * Where on the board notes can be written: a clear column in view if there is one, else beside or
 * below what is already there, and, once writing, the next clear spot down that column.
 */
import { visualBounds } from '../model';
import type { Bounds, El } from '../model';

const overlaps = (a: Bounds, b: Bounds) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

function obstacles(elements: El[], gap: number, skip?: (e: El) => boolean): Bounds[] {
  const out: Bounds[] = [];
  for (const e of elements) {
    if (skip?.(e)) continue;
    const b = visualBounds(e);
    out.push({ x: b.x - gap, y: b.y - gap, w: b.w + gap * 2, h: b.h + gap * 2 });
  }
  return out;
}

/** The union of everything on the board, or null when it is empty. */
function contentOf(elements: El[]): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of elements) {
    const b = visualBounds(e);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
}

/**
 * Top-left of a clear area `w` wide and `h` tall for a new set of notes. `view` is the part of the
 * board on screen. Prefers an empty part of the view (no moving at all), then the space to the
 * right of the work already there, then below it. `near` asks for a particular spot first.
 */
export function findColumn(elements: El[], view: Bounds, w: number, h: number, gap: number, near?: [number, number] | null): { x: number; y: number } {
  const obs = obstacles(elements, gap);
  const clear = (x: number, y: number) => !obs.some((o) => overlaps({ x, y, w, h }, o));

  if (near && clear(near[0], near[1])) return { x: near[0], y: near[1] };

  // Scan the view, left to right and top to bottom, for a clear area that fits.
  const margin = gap * 2;
  const stepX = Math.max(gap, w / 6);
  const stepY = Math.max(gap, h / 10);
  const fitsW = view.w - margin * 2 >= w;
  if (fitsW) {
    for (let y = view.y + margin; y + Math.min(h, view.h * 0.6) <= view.y + view.h; y += stepY) {
      for (let x = view.x + margin; x + w <= view.x + view.w - margin; x += stepX) {
        if (clear(x, y)) return { x, y };
      }
    }
  }

  const content = contentOf(elements);
  if (!content) return { x: view.x + margin, y: view.y + margin };

  // Beside the work, starting level with the top of the view (or the work, if lower).
  const right = { x: content.x + content.w + gap * 4, y: Math.max(content.y, view.y + margin) };
  for (let i = 0; i < 60; i++) {
    if (clear(right.x, right.y)) return right;
    right.y += stepY;
  }
  // Below everything: always clear.
  return { x: content.x, y: content.y + content.h + gap * 4 };
}

/**
 * Moves a block down its column until it touches nothing, and returns its top. `skip` leaves out
 * elements that may be written over (none, normally).
 */
export function clearTop(elements: El[], x: number, y: number, w: number, h: number, gap: number, skip?: (e: El) => boolean): number {
  const obs = obstacles(elements, gap, skip);
  let top = y;
  for (let i = 0; i < 400; i++) {
    const box = { x, y: top, w, h };
    const hit = obs.filter((o) => overlaps(box, o));
    if (!hit.length) return top;
    top = Math.max(...hit.map((o) => o.y + o.h)) + 1;
  }
  return top;
}
