import { getStroke } from 'perfect-freehand';
import type { StrokeEl } from './model';

/** Filled outline for a raw point list, used for AI handwriting. */
export function freehandPath(
  points: readonly (readonly [number, number, number])[],
  size: number,
  last = true,
): Path2D {
  const path = new Path2D();
  if (points.length < 2) return path;
  const outline = getStroke(points.map((p) => [p[0], p[1], p[2]]), {
    size,
    thinning: 0.72,
    smoothing: 0.52,
    streamline: 0.18,
    simulatePressure: false,
    last,
  });
  if (outline.length > 1) {
    path.moveTo(outline[0][0], outline[0][1]);
    for (let i = 0; i < outline.length; i++) {
      const [ax, ay] = outline[i];
      const [bx, by] = outline[(i + 1) % outline.length];
      path.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
    }
    path.closePath();
  }
  return path;
}

const pathCache = new WeakMap<StrokeEl, Path2D>();

/**
 * Filled outline of a stroke. Pass live=true for the stroke still being drawn: it is mutated
 * as points arrive, so it must not be cached.
 */
export function strokePath(stroke: StrokeEl, live = false): Path2D {
  if (!live) {
    const cached = pathCache.get(stroke);
    if (cached) return cached;
  }
  const highlight = stroke.kind === 'highlight';
  const outline = getStroke(stroke.points, {
    size: stroke.size,
    thinning: highlight ? 0 : 0.6,
    smoothing: 0.5,
    streamline: highlight ? 0.6 : 0.45,
    simulatePressure: stroke.simulate && !highlight,
    last: !live,
  });
  const path = new Path2D();
  if (outline.length > 1) {
    path.moveTo(outline[0][0], outline[0][1]);
    for (let i = 0; i < outline.length; i++) {
      const [ax, ay] = outline[i];
      const [bx, by] = outline[(i + 1) % outline.length];
      path.quadraticCurveTo(ax, ay, (ax + bx) / 2, (ay + by) / 2);
    }
    path.closePath();
  }
  if (!live) pathCache.set(stroke, path);
  return path;
}
