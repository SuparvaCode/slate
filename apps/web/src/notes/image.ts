/**
 * Pictures for the board: shrunk to a small JPEG the board can save, and small enough for a shared
 * room, where one element may be at most 60,000 characters.
 */

/** A data URL this long or shorter fits a shared room with room to spare for the element's fields. */
const MAX_CHARS = 52_000;

export interface Shrunk {
  src: string;
  /** Natural size of the original, for the aspect ratio. */
  w: number;
  h: number;
}

async function decode(blob: Blob): Promise<{ draw: CanvasImageSource; w: number; h: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(blob);
      return { draw: bmp, w: bmp.width, h: bmp.height, close: () => bmp.close() };
    } catch {
      // fall back to an <img>, which decodes a few formats createImageBitmap refuses
    }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return { draw: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('That file is not a picture this browser can open.');
  }
}

/** Shrinks a picture to a JPEG data URL of at most about 39 KB, keeping as much detail as fits. */
export async function shrinkImage(blob: Blob): Promise<Shrunk> {
  if (!blob.type.startsWith('image/') || blob.type === 'image/svg+xml') {
    throw new Error('Only photos and pictures (PNG, JPEG, WebP, GIF) can be added.');
  }
  if (blob.size > 25 * 1024 * 1024) throw new Error('That picture is too large (over 25 MB).');
  const img = await decode(blob);
  try {
    if (!img.w || !img.h) throw new Error('That picture is empty.');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    let max = 1100;
    let quality = 0.82;
    let src = '';
    for (let i = 0; i < 10; i++) {
      const k = Math.min(1, max / Math.max(img.w, img.h));
      canvas.width = Math.max(1, Math.round(img.w * k));
      canvas.height = Math.max(1, Math.round(img.h * k));
      // JPEG has no transparency: put see-through parts on white, like paper.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img.draw, 0, 0, canvas.width, canvas.height);
      src = canvas.toDataURL('image/jpeg', quality);
      if (src.length <= MAX_CHARS) break;
      if (quality > 0.56) quality -= 0.09;
      else max = Math.round(max * 0.8);
    }
    return { src, w: img.w, h: img.h };
  } finally {
    img.close();
  }
}

/** The first picture in a paste or a drop, if there is one. */
export function imageFileIn(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/') && item.type !== 'image/svg+xml') {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return Array.from(data.files ?? []).find((f) => f.type.startsWith('image/') && f.type !== 'image/svg+xml') ?? null;
}
