/**
 * Names a slate from what is on it, like a chat app titles a chat: after the student has written
 * for a while, or as soon as the AI has answered something on it. A title the student typed is
 * never replaced, and rough boards never rename their slate. In a room only the host's copy asks,
 * and the title is shared with everyone.
 */
import { onBoardShown, type Board } from '../board';
import type { El } from '../model';
import { renderRegion, selectionBox } from '../render';
import { PALETTE } from '../theme';
import { askTitle } from './assist';
import { currentView } from './key';
import { isHost, roomState, setRoomTitle } from './room';
import { getSlate, renameSlate } from './slates';

const MIN_ELEMENTS = 6;
const IDLE_MS = 20_000;
const RETRY_MS = 4 * 60_000;
/** Automatic titles per slate per visit; each one costs an assist credit. */
const MAX_TRIES = 3;
const MAX_IMAGE_CHARS = 1_900_000;

const tried = new Map<string, { at: number; count: number; n: number }>();
let busy = false;

/** Text already read from the board: questions the AI answered, and typed text. */
function hintsOf(els: El[]): string[] {
  const out = new Set<string>();
  for (const e of els) {
    if (e.type === 'ai' && e.status === 'done') {
      const r = e.response?.result;
      const t = (r?.latex || r?.text || '').trim();
      if (t) out.add(t.slice(0, 200));
    } else if (e.type === 'text' && e.text.trim()) {
      out.add(e.text.trim().slice(0, 200));
    } else if (e.type === 'diagram' && e.prompt) {
      out.add(e.prompt.slice(0, 200));
    }
    if (out.size >= 6) break;
  }
  return [...out];
}

async function run(b: Board, soon: boolean) {
  if (busy) return;
  const v = currentView();
  if (v.sub || b.key.includes('.sub.')) return;
  const s = getSlate(v.slate);
  if (!s || s.named) return;
  const room = roomState();
  if (room.status === 'live' && room.slateId === s.id && !isHost()) return;

  const els = b.elements;
  const hints = hintsOf(els);
  const last = tried.get(s.id);
  if (last && last.n >= MAX_TRIES) return;
  if (!soon && els.length < MIN_ELEMENTS) return;
  if (last && Date.now() - last.at < RETRY_MS) return;
  // Retitle only once the board has grown a good deal since the last title.
  if (last && els.length < last.count * 1.5 + 4) return;

  let image: string | null = null;
  // Two or more readings say enough; otherwise the model looks at the board.
  if (hints.length < 2) {
    const box = selectionBox(els);
    if (box) {
      const png = renderRegion(els, box, PALETTE.light);
      if (png.length < MAX_IMAGE_CHARS) image = png;
    }
  }
  if (!image && !hints.length) return;

  busy = true;
  tried.set(s.id, { at: Date.now(), count: els.length, n: (last?.n ?? 0) + 1 });
  try {
    const title = await askTitle(image, hints);
    if (title && title !== 'Untitled slate' && !getSlate(s.id)?.named) {
      renameSlate(s.id, title, false);
      if (room.status === 'live' && room.slateId === s.id) void setRoomTitle(title);
    }
  } catch {
    // out of credits or offline: keep the current title
  } finally {
    busy = false;
  }
}

let off: (() => void) | null = null;
onBoardShown((b) => {
  off?.();
  let timer = 0;
  let answers = b.elements.filter((e) => e.type === 'ai' && e.status === 'done').length;
  const unsub = b.subscribe(() => {
    const done = b.elements.filter((e) => e.type === 'ai' && e.status === 'done').length;
    const answered = done > answers;
    answers = done;
    clearTimeout(timer);
    timer = window.setTimeout(() => void run(b, answered), answered ? 2500 : IDLE_MS);
  });
  off = () => {
    clearTimeout(timer);
    unsub();
  };
});
