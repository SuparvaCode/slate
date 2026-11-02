import { boundsOf, quantizeStroke } from './model';
import type { Pt, StrokeEl } from './model';

/**
 * Rubs out part of a stroke, the way a real eraser does.
 *
 * Returns null when the eraser (a circle of radius `r` at cx, cy) does not touch the stroke,
 * so callers can keep the original element unchanged. Otherwise returns what is left: zero
 * pieces if the whole stroke was rubbed out, or one or more pieces on either side of the cut.
 * The first piece keeps the stroke's id so anything that refers to it still finds it.
 */
export function cutStroke(
  stroke: StrokeEl, cx: number, cy: number, r: number, newId: () => string,
): StrokeEl[] | null {
  const rad = r + stroke.size * 0.25;
  const b = boundsOf(stroke);
  if (cx < b.x - rad || cx > b.x + b.w + rad || cy < b.y - rad || cy > b.y + b.h + rad) return null;

  const pts = stroke.points;
  const pieces: Pt[][] = [];
  let run: Pt[] = [];
  let touched = false;

  const flush = () => {
    // A single leftover point would be a dot of ink nobody drew; drop it.
    if (run.length >= 2) pieces.push(run);
    run = [];
  };
  const consider = (p: Pt) => {
    if (Math.hypot(p[0] - cx, p[1] - cy) <= rad) {
      touched = true;
      flush();
    } else {
      run.push(p);
    }
  };

  // Long gaps between samples would let the eraser jump over a stroke, so they are filled in.
  const step = Math.max(rad * 0.6, 0.5);
  consider(pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const c = pts[i];
    const n = Math.ceil(Math.hypot(c[0] - a[0], c[1] - a[1]) / step);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      consider([a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t]);
    }
    consider(c);
  }
  flush();

  if (!touched) return null;
  return pieces.map((points, i) => quantizeStroke({ ...stroke, id: i === 0 ? stroke.id : newId(), points }));
}

/** Eraser radii in screen pixels for the four sizes. */
export const ERASER_RADII = [6, 12, 22, 40];
