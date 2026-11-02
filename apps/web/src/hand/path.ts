/** Samples the SVG paths used by the handwriting glyphs into point lists. */

export type P2 = [number, number];

const NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

interface Seg {
  cmd: string;
  nums: number[];
}

function parse(d: string): Seg[] {
  const segs: Seg[] = [];
  const re = /([MLCQZmlcqz])([^MLCQZmlcqz]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const nums = (m[2].match(NUM) ?? []).map(Number);
    segs.push({ cmd: m[1], nums });
  }
  return segs;
}

const cubic = (t: number, a: number, b: number, c: number, d: number) => {
  const u = 1 - t;
  return u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
};

/**
 * Samples a path into points, roughly `per` apart in path units, so a stroke stays smooth
 * however large it is drawn.
 */
export function samplePath(d: string, per = 0.014): P2[] {
  const out: P2[] = [];
  let cx = 0;
  let cy = 0;
  const push = (x: number, y: number) => {
    const last = out[out.length - 1];
    if (!last || Math.hypot(x - last[0], y - last[1]) > 1e-6) out.push([x, y]);
  };

  for (const { cmd, nums } of parse(d)) {
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toUpperCase();

    if (c === 'Z') continue;

    if (c === 'M' || c === 'L') {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const x = rel ? cx + nums[i] : nums[i];
        const y = rel ? cy + nums[i + 1] : nums[i + 1];
        if (c === 'M' && i === 0) {
          push(x, y);
        } else {
          const steps = Math.max(2, Math.ceil(Math.hypot(x - cx, y - cy) / per));
          for (let s = 1; s <= steps; s++) push(cx + ((x - cx) * s) / steps, cy + ((y - cy) * s) / steps);
        }
        cx = x;
        cy = y;
      }
      continue;
    }

    if (c === 'C') {
      for (let i = 0; i + 5 < nums.length; i += 6) {
        const [x1, y1, x2, y2, x3, y3] = rel
          ? [cx + nums[i], cy + nums[i + 1], cx + nums[i + 2], cy + nums[i + 3], cx + nums[i + 4], cy + nums[i + 5]]
          : [nums[i], nums[i + 1], nums[i + 2], nums[i + 3], nums[i + 4], nums[i + 5]];
        const approx = Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x2 - x1, y2 - y1) + Math.hypot(x3 - x2, y3 - y2);
        const steps = Math.max(4, Math.ceil(approx / per));
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          push(cubic(t, cx, x1, x2, x3), cubic(t, cy, y1, y2, y3));
        }
        cx = x3;
        cy = y3;
      }
      continue;
    }

    if (c === 'Q') {
      for (let i = 0; i + 3 < nums.length; i += 4) {
        const [x1, y1, x2, y2] = rel
          ? [cx + nums[i], cy + nums[i + 1], cx + nums[i + 2], cy + nums[i + 3]]
          : [nums[i], nums[i + 1], nums[i + 2], nums[i + 3]];
        const approx = Math.hypot(x1 - cx, y1 - cy) + Math.hypot(x2 - x1, y2 - y1);
        const steps = Math.max(4, Math.ceil(approx / per));
        for (let s = 1; s <= steps; s++) {
          const t = s / steps;
          const u = 1 - t;
          push(u * u * cx + 2 * u * t * x1 + t * t * x2, u * u * cy + 2 * u * t * y1 + t * t * y2);
        }
        cx = x2;
        cy = y2;
      }
    }
  }
  return out;
}

const cache = new Map<string, P2[]>();

export function sampledPath(d: string): P2[] {
  let pts = cache.get(d);
  if (!pts) {
    pts = samplePath(d);
    cache.set(d, pts);
  }
  return pts;
}

export const pathLength = (pts: P2[]): number => {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
};
