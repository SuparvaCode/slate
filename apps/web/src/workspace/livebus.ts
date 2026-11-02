/**
 * The link between the board's drawing loop and a Collaborate room, for what is live but not yet
 * on the board: the stroke someone is drawing right now, and where their pointer is.
 *
 * The board calls `localStroke` / `localPointer` as the pen moves; the room sends them every
 * ~30 ms. Strokes and pointers from others arrive here and the board draws them each frame.
 */
import type { StrokeEl } from '../model';

export interface Ghost {
  uid: string;
  name: string;
  color: string;
  /** World coordinates of their pointer, or null when it is off the board. */
  at: [number, number] | null;
  /** The stroke they are drawing, not yet committed. */
  stroke: StrokeEl | null;
  /** When their pointer last moved, for fading the label. */
  seen: number;
}

type Sender = {
  stroke: (s: StrokeEl | null) => void;
  pointer: (x: number, y: number) => void;
};

let sender: Sender | null = null;
let ghosts: Ghost[] = [];
let redraw: (() => void) | null = null;

/** The room registers how to send; null when not in a room. */
export function setSender(s: Sender | null): void {
  sender = s;
  if (!s) setGhosts([]);
}

export const inRoom = (): boolean => sender !== null;

/** The board: the stroke being drawn changed (null when it ends). */
export function localStroke(s: StrokeEl | null): void {
  sender?.stroke(s);
}

/** The board: the pointer moved, in world coordinates. */
export function localPointer(x: number, y: number): void {
  sender?.pointer(x, y);
}

/** The room: others' live strokes and pointers. */
export function setGhosts(list: Ghost[]): void {
  ghosts = list;
  redraw?.();
}

/** The board: what to draw this frame. */
export const currentGhosts = (): Ghost[] => ghosts;

/** The board registers how to ask for a frame. */
export function onGhosts(fn: () => void): () => void {
  redraw = fn;
  return () => {
    if (redraw === fn) redraw = null;
  };
}
