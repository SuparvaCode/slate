/** Lays out text as handwriting strokes for the onboarding hero, using the app's own pen glyphs. */
import { GLYPHS } from '../hand/glyphs';
import { samplePath } from '../hand/path';

export interface InkStroke {
  d: string;
  /** SVG transform that places the em-unit glyph path. */
  transform: string;
  /** Length in viewBox units, used to time the pen. */
  len: number;
  /** Gap before this stroke starts, in ms (longer between characters and words). */
  gap: number;
}

const lengthOf = (d: string) => {
  const pts = samplePath(d);
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return len;
};

export function textWidth(text: string): number {
  return [...text].reduce((w, ch) => w + (GLYPHS[ch]?.w ?? 0.3), 0);
}

/**
 * Strokes for `text` with its left end at x and baseline at y, at `size` units per em.
 * `variant` picks an alternate letter shape where the glyph has one, so repeats look hand-made.
 */
export function writeText(text: string, x: number, y: number, size: number, variant = 0): InkStroke[] {
  const out: InkStroke[] = [];
  let cx = x;
  let gap = 0;
  [...text].forEach((ch, i) => {
    const g = GLYPHS[ch];
    if (!g || ch === ' ') {
      cx += (g?.w ?? 0.3) * size;
      gap += 140;
      return;
    }
    const pick = g.alt && (i + variant) % 3 !== 0 ? g.alt[(i + variant) % g.alt.length] : null;
    const paths = pick?.d ?? g.d;
    const w = pick?.w ?? g.w;
    paths.forEach((d, k) => {
      out.push({
        d,
        transform: `translate(${cx.toFixed(2)} ${y}) scale(${size})`,
        len: lengthOf(d) * size,
        gap: gap + (k === 0 ? 70 : 40),
      });
      gap = 0;
    });
    cx += w * size;
  });
  return out;
}
