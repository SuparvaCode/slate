/**
 * Sharing from inside the Android app. A WebView has no download and often no `navigator.share`,
 * so in the app the phone's own share sheet is used (which can also save the file); on the web
 * the browser's share sheet, then the clipboard, then a download.
 */
import { isNativeApp } from '../back';

/** A picture was handed to the share sheet (or downloaded), or why it could not be. */
export type SharePngResult = { ok: true } | { ok: false; reason: string };

function reasonOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  return 'unknown error';
}

/** Reads a blob as base64 without building a huge string through a spread (which can throw). */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error('the picture could not be read'));
    reader.onload = () => {
      const url = String(reader.result ?? '');
      const comma = url.indexOf(',');
      if (comma < 0) reject(new Error('the picture could not be read'));
      else resolve(url.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

/** Shares a link or text. True when something took it (sheet, share or clipboard). */
export async function shareText(opts: { title: string; text?: string; url?: string }): Promise<boolean> {
  if (isNativeApp()) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title: opts.title, text: opts.text, url: opts.url, dialogTitle: opts.title });
      return true;
    } catch {
      return false; // the user closed the sheet, or no app took it
    }
  }
  if (navigator.share) {
    try {
      await navigator.share({ title: opts.title, text: opts.text, url: opts.url });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Shares a picture: in the app it is written to the cache the FileProvider exposes and handed to
 * the share sheet (Save to Files/Photos is in it); on the web it is downloaded. Unlike before,
 * a failure comes back with a reason so the board can say what went wrong instead of nothing
 * happening at all.
 */
export async function sharePng(blob: Blob, filename = 'slate.png'): Promise<SharePngResult> {
  if (isNativeApp()) {
    let written: { uri: string };
    try {
      const [{ Filesystem, Directory }, data] = await Promise.all([
        import('@capacitor/filesystem'),
        blobToBase64(blob),
      ]);
      written = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
    } catch (err) {
      return { ok: false, reason: `the picture could not be saved (${reasonOf(err)})` };
    }
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({
        title: 'Slate board',
        files: [written.uri],
        dialogTitle: 'Share or save picture',
      });
      return { ok: true };
    } catch (err) {
      // Closing the sheet rejects as well; that is not a failure worth showing.
      if (/cancel/i.test(reasonOf(err))) return { ok: true };
      return { ok: false, reason: `the share sheet could not open (${reasonOf(err)})` };
    }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: reasonOf(err) };
  }
}
