import { useEffect, useMemo } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';
import { haptic } from './haptics';

export const LONG_PRESS_MS = 450;
export const LONG_PRESS_SLOP = 8; // px the pointer may wander before the press stops counting

export interface LongPressInfo {
  x: number;
  y: number;
  pointerType: string;
  target: Element;
}

export interface LongPressOptions {
  ms?: number;
  slop?: number;
  /** Which pointers count. All of them by default. */
  pointers?: ReadonlyArray<'mouse' | 'touch' | 'pen'>;
  /** Play the long-press haptic when it fires. On by default. */
  haptics?: boolean;
}

/**
 * Press-and-hold detection shared by the hook and the DOM-level copy layer. While the press is
 * held the element gets `data-pressing`, which the CSS uses for the press-scale; when it fires,
 * the element gets `data-pressed-long` until the click that follows is swallowed.
 */
export function createLongPress(onLongPress: (info: LongPressInfo) => void, opts: LongPressOptions = {}) {
  const ms = opts.ms ?? LONG_PRESS_MS;
  const slop = opts.slop ?? LONG_PRESS_SLOP;
  let handler = onLongPress;
  let timer = 0;
  let start: { id: number; x: number; y: number; el: Element; type: string } | null = null;
  /**
   * The press that fired, so the click ending it can be swallowed. Only a click on that same
   * element counts, and only until shortly after the finger lifts: a tap on the menu the press
   * opened must go through.
   */
  let firedOn: { id: number; el: Element; until: number } | null = null;
  const AFTER_UP_MS = 400;
  const live = () => !!firedOn && performance.now() < firedOn.until;

  const clear = () => {
    window.clearTimeout(timer);
    timer = 0;
    start?.el.removeAttribute('data-pressing');
    start = null;
  };

  const down = (e: PointerEvent | ReactPointerEvent, el: Element) => {
    const type = e.pointerType as 'mouse' | 'touch' | 'pen';
    if (opts.pointers && !opts.pointers.includes(type)) return;
    if (type === 'mouse' && e.button !== 0) return;
    if (!e.isPrimary) {
      clear();
      return;
    }
    clear();
    firedOn = null;
    start = { id: e.pointerId, x: e.clientX, y: e.clientY, el, type };
    el.setAttribute('data-pressing', '');
    timer = window.setTimeout(() => {
      const s = start;
      if (!s) return;
      // Held until the pointer lifts; `up` then starts the short grace period.
      firedOn = { id: s.id, el: s.el, until: Infinity };
      s.el.removeAttribute('data-pressing');
      start = null;
      if (opts.haptics !== false) haptic('longPress');
      handler({ x: s.x, y: s.y, pointerType: s.type, target: s.el });
    }, ms);
  };

  const move = (e: PointerEvent | ReactPointerEvent) => {
    if (start && e.pointerId === start.id && Math.hypot(e.clientX - start.x, e.clientY - start.y) > slop) clear();
  };

  const up = (e: PointerEvent | ReactPointerEvent) => {
    if (start && e.pointerId === start.id) clear();
    if (firedOn && firedOn.id === e.pointerId && firedOn.until === Infinity) {
      firedOn.until = performance.now() + AFTER_UP_MS;
    }
  };

  /** Swallows the click that ends a press which already fired, and no other click. */
  const click = (e: MouseEvent | ReactMouseEvent) => {
    if (!firedOn) return;
    const mine = live() && e.target instanceof Node && firedOn.el.contains(e.target);
    firedOn = null;
    if (!mine) return;
    e.preventDefault();
    e.stopPropagation();
  };

  return {
    down,
    move,
    up,
    click,
    cancel: clear,
    /** Runs the action now, as a right-click does. */
    trigger: (info: LongPressInfo) => handler(info),
    /** Swaps the action without losing a press in progress. */
    setHandler: (fn: (info: LongPressInfo) => void) => {
      handler = fn;
    },
    /** A press fired and its click has not been swallowed yet. */
    get fired() {
      return live();
    },
  };
}

/**
 * React handlers for press-and-hold on an element: ~450 ms still, cancelled by moving more than
 * 8 px, for touch, pen and mouse. The click after a long press is swallowed so the button's own
 * action does not also run; a right-click runs the long-press action too.
 */
export function useLongPress(
  onLongPress: ((info: LongPressInfo) => void) | undefined,
  opts: LongPressOptions = {},
) {
  const enabled = !!onLongPress;
  const { ms, slop, haptics } = opts;
  const lp = useMemo(() => createLongPress(() => {}, { ms, slop, haptics }), [ms, slop, haptics]);
  useEffect(() => {
    lp.setHandler((info) => onLongPress?.(info));
  }, [lp, onLongPress]);
  useEffect(() => () => lp.cancel(), [lp]);

  return useMemo(() => {
    if (!enabled) return {};
    return {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => lp.down(e, e.currentTarget),
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => lp.move(e),
      onPointerUp: (e: ReactPointerEvent<HTMLElement>) => lp.up(e),
      onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => lp.up(e),
      onPointerLeave: (e: ReactPointerEvent<HTMLElement>) => lp.up(e),
      onClickCapture: (e: ReactMouseEvent<HTMLElement>) => lp.click(e),
      onContextMenu: (e: ReactMouseEvent<HTMLElement>) => {
        e.preventDefault();
        // A touch long press also raises contextmenu on Android; the timer has handled that one.
        if (lp.fired) return;
        lp.cancel();
        lp.trigger({ x: e.clientX, y: e.clientY, pointerType: 'mouse', target: e.currentTarget });
      },
    };
  }, [enabled, lp]);
}
