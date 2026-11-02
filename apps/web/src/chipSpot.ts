export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const GAP = 8;

const hit = (a: Rect, b: Rect) =>
  a.x < b.x + b.w + GAP && a.x + a.w + GAP > b.x && a.y < b.y + b.h + GAP && a.y + a.h + GAP > b.y;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Where the floating "Read as" chip goes, in screen pixels.
 *
 * It must never sit on the writing or on the answer. It tries above the writing, below
 * everything, then to the right and to the left, and takes the first spot that is on screen and
 * clear of both. When the writing fills the screen there may be no such spot; the chip then
 * goes under the top bar, and `clear` is false so the caller knows it overlaps.
 */
export function chipSpot(
  writing: Rect,
  answer: Rect | null,
  viewport: { w: number; h: number },
  size = { w: 400, h: 44 },
  top = 64,
  bottomReserved = 150,
  /** Other answers on screen, which the chip must not cover either. */
  others: Rect[] = [],
): { left: number; top: number; clear: boolean } {
  const all: Rect[] = answer ? [writing, answer] : [writing];
  const x0 = Math.min(...all.map((r) => r.x));
  const x1 = Math.max(...all.map((r) => r.x + r.w));
  const y1 = Math.max(...all.map((r) => r.y + r.h));

  const maxLeft = Math.max(12, viewport.w - size.w - 12);
  const maxTop = viewport.h - bottomReserved - size.h;
  const candidates = [
    { left: clamp(writing.x, 12, maxLeft), top: writing.y - size.h - GAP - 2 }, // above the writing
    { left: clamp(writing.x, 12, maxLeft), top: y1 + GAP + 4 }, // below everything
    { left: x1 + GAP + 4, top: writing.y }, // right of everything
    { left: x0 - size.w - GAP - 4, top: writing.y }, // left of everything
  ];

  for (const c of candidates) {
    const box: Rect = { x: c.left, y: c.top, w: size.w, h: size.h };
    const onScreen = c.left >= 12 && c.left + size.w <= viewport.w - 12 && c.top >= top && c.top <= maxTop;
    if (onScreen && !all.some((r) => hit(box, r)) && !others.some((r) => hit(box, r))) return { left: c.left, top: c.top, clear: true };
  }
  return { left: clamp(writing.x, 12, maxLeft), top, clear: false };
}
