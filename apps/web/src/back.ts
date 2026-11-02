/**
 * The Android Back button. Every popup, panel and dialog that is open registers how it closes,
 * and Back closes the newest one first. With nothing open, Back goes from a board to the
 * dashboard, and from the dashboard leaves the app. On the web this does nothing; Esc and the
 * browser's own Back keep working as before.
 */
import { useEffect, useLayoutEffect, useRef } from 'react';

const stack: { close: () => void }[] = [];

/** Registers `close` for Back while `open` is true. */
export function useBack(open: boolean, close: () => void): void {
  const ref = useRef(close);
  useLayoutEffect(() => {
    ref.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const entry = { close: () => ref.current() };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open]);
}

/** Closes the newest open layer. False when nothing was open. */
export function closeTop(): boolean {
  const top = stack[stack.length - 1];
  if (!top) return false;
  // The layer leaves the stack when it actually closes; one that asks first (unsaved work) stays.
  top.close();
  return true;
}

export const isNativeApp = (): boolean =>
  !!(globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

/** Listens for the hardware Back button in the Android app. `onEmpty` runs when nothing is open. */
export function listenNativeBack(onEmpty: () => void): () => void {
  if (!isNativeApp()) return () => {};
  let stop: (() => void) | null = null;
  let done = false;
  void import('@capacitor/app').then(({ App }) =>
    App.addListener('backButton', () => {
      if (!closeTop()) onEmpty();
    }).then((h) => {
      if (done) void h.remove();
      else stop = () => void h.remove();
    }),
  );
  return () => {
    done = true;
    stop?.();
  };
}

export async function exitApp(): Promise<void> {
  const { App } = await import('@capacitor/app');
  await App.exitApp();
}
