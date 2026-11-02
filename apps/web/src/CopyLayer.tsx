import { useCallback, useEffect, useState } from 'react';
import { ContextMenu } from './ContextMenu';
import type { MenuSpec } from './ContextMenu';
import { COPIED_EVENT, copyText, hasTex, textOfNode } from './copy';
import { createLongPress } from './gestures';
import type { Theme } from './theme';

/**
 * Readable text in the panels: answers, steps, LaTeX, notes and panel text. Native selection is
 * off everywhere, so these get a Copy menu on long-press (touch, pen) or right-click (mouse).
 * Anything can opt in with `data-copy="text to copy"` or a bare `data-copy-target`.
 */
const COPY_SELECTOR = [
  '[data-copy]',
  '[data-copy-target]',
  '.work-body .steps li',
  '.work-body .wline',
  '.work-body .whead',
  '.work-body .answer-tex',
  '.work-body .read-tex',
  '.work-body .note',
  '.work-body .think',
  '.work-body .calc',
  '.work-body .failed p',
  '.chip-read',
  '.pg-title',
  '.pg-topic-row',
  '.sim-scroll p',
  '.details',
].join(', ');

const targetOf = (t: EventTarget | null): Element | null => {
  if (!(t instanceof Element)) return null;
  if (t.closest('button, input, textarea, select, [contenteditable="true"], canvas')) return null;
  return t.closest(COPY_SELECTOR);
};

export function CopyLayer({ theme }: { theme: Theme }) {
  const [menu, setMenu] = useState<MenuSpec | null>(null);
  const [toast, setToast] = useState<{ ok: boolean; n: number } | null>(null);
  const close = useCallback(() => setMenu(null), []);

  useEffect(() => {
    const open = (el: Element, x: number, y: number) => {
      const text = textOfNode(el);
      if (!text) return;
      el.setAttribute('data-copy-active', '');
      const label = hasTex(el) ? 'Copy LaTeX' : 'Copy';
      setMenu({
        x: x + 6,
        y: y + 6,
        groups: [[{ label, icon: 'copy', run: () => void copyText(text) }]],
      });
      window.setTimeout(() => el.removeAttribute('data-copy-active'), 600);
    };

    let pressed: Element | null = null;
    const lp = createLongPress(
      ({ x, y }) => {
        if (pressed) open(pressed, x, y);
      },
      { pointers: ['touch', 'pen'] },
    );
    const down = (e: PointerEvent) => {
      const el = targetOf(e.target);
      pressed = el;
      if (el) lp.down(e, el);
    };
    const move = (e: PointerEvent) => lp.move(e);
    const up = (e: PointerEvent) => lp.up(e);
    const click = (e: MouseEvent) => lp.click(e);
    const ctx = (e: MouseEvent) => {
      const el = targetOf(e.target);
      if (!el) return;
      e.preventDefault();
      // The touch long press has already opened it; Android sends contextmenu as well.
      if (lp.fired) return;
      open(el, e.clientX, e.clientY);
    };
    const copied = (e: Event) => {
      const ok = (e as CustomEvent<{ ok: boolean }>).detail?.ok ?? true;
      setToast((t) => ({ ok, n: (t?.n ?? 0) + 1 }));
    };

    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('click', click, true);
    document.addEventListener('contextmenu', ctx);
    window.addEventListener(COPIED_EVENT, copied);
    return () => {
      lp.cancel();
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('contextmenu', ctx);
      window.removeEventListener(COPIED_EVENT, copied);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 1400);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <>
      {menu && <ContextMenu spec={menu} theme={theme} onClose={close} />}
      {toast && (
        <div key={toast.n} className={`copy-toast${toast.ok ? '' : ' err'}`} role="status" aria-live="polite">
          {toast.ok ? 'Copied' : "Couldn't copy"}
        </div>
      )}
    </>
  );
}
