/**
 * The AI teacher at the board: plans a set of notes, finds a clear part of the board, moves there,
 * and writes the notes by hand one block at a time, with margin notes beside each section.
 *
 * It can be paused, asked a question part-way (the answer goes in the margin where it stopped),
 * stopped, and continued later. Where it stopped is read back from the notes on the board itself,
 * so continuing still works after a reload, or after the student moved the notes.
 */
import { boardKey } from '../workspace/key';
import type { Bounds, ColorKey, El, NoteEl } from '../model';
import { uid } from '../model';
import { askTeacher, planStream, writeSection } from './api';
import { blockText, compose, composeMs } from './compose';
import { clearTop, findColumn } from './space';
import { markStudied, mergeProfile, scheduleReviews } from './study';
import type { Block, Plan, PlanSection, Profile, SectionOut, VideoRef, WebSource } from './types';

/** Screen pixels the camera keeps clear around a framed area (PAD in App's frameRegion). */
const FRAME_PAD = 28;

export interface WriterHost {
  elements(): El[];
  add(el: NoteEl): void;
  /** The part of the board on screen where writing can be seen, in world units. */
  view(): Bounds;
  zoom(): number;
  /** Brings a region into view; returns how long the move takes, in ms. */
  frame(b: Bounds): number;
  /** Runs the pen over an element for `ms`, starting after `delay`. */
  write(id: string, ms: number, delay: number): void;
  /** Ends a running pen animation at once. */
  finish(id: string): void;
  /** What this board has covered, so notes can build on it. */
  context(): string;
  profile(): Profile | null;
  onFinished?(plan: Plan): void;
}

export type Phase = 'idle' | 'planning' | 'writing' | 'paused' | 'asking' | 'done' | 'error';
export type Speed = 1 | 2 | 4;

export interface StageView {
  key: string;
  label: string;
  done: boolean;
}

export interface WriterState {
  phase: Phase;
  stages: StageView[];
  plan: Plan | null;
  sources: WebSource[];
  video: VideoRef | null;
  profile: Profile | null;
  subject: string;
  topic: string;
  /** The section being written: planned sections first, then any extra ones asked for. */
  section: number;
  sections: PlanSection[];
  /** What failed, shown with a way to try again. */
  error: string;
  /** What the teacher says before answering a question. */
  reply: string;
  asking: string;
  speed: Speed;
  /** True while the AI is writing the next section and nothing is being drawn yet. */
  waiting: boolean;
  /** Notes on this board that stopped before the end and can be continued. */
  resumable: { title: string; left: number } | null;
}

/** What is saved after every block, so writing can continue from exactly there. */
interface Saved {
  id: string;
  plan: Plan;
  extras: PlanSection[];
  fs: number;
  pen: number;
  wrap: number;
  sideW: number;
  section: number;
  out: SectionOut | null;
  next: number;
  sideNext: number;
}

interface Geo {
  colX: number;
  mainY: number;
  sideX: number;
  sideY: number;
}

const KEY = () => `slate.notes.session.v1:${boardKey()}`;

const COLOR: Partial<Record<Block['t'], ColorKey>> = { h: 'blue', key: 'red', title: 'ink' };

const initial = (): WriterState => ({
  phase: 'idle', stages: [], plan: null, sources: [], video: null, profile: null, subject: '', topic: '',
  section: 0, sections: [], error: '', reply: '', asking: '', speed: 2, waiting: false, resumable: null,
});

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export class NotesWriter {
  private host: WriterHost;
  private state: WriterState = initial();
  private listeners = new Set<() => void>();
  private s: Saved | null = null;
  private g: Geo | null = null;
  /** Bumped by every start, stop and continue; a loop from an older run quietly ends. */
  private run = 0;
  private ctrl: AbortController | null = null;
  private wake: (() => void) | null = null;
  private hurry: (() => void) | null = null;
  private writingId: string | null = null;
  private busy: Promise<void> = Promise.resolve();
  private prefetched = new Map<number, Promise<SectionOut>>();

  constructor(host: WriterHost) {
    this.host = host;
    this.s = this.load();
    if (this.s) this.state.resumable = this.resumableOf(this.s);
  }

  // --- for React ---------------------------------------------------------------------------

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  get = () => this.state;

  private set(patch: Partial<WriterState>) {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn();
  }

  // --- saving ------------------------------------------------------------------------------

  private load(): Saved | null {
    try {
      const raw = localStorage.getItem(KEY());
      const s = raw ? (JSON.parse(raw) as Saved) : null;
      return s && s.plan && Array.isArray(s.plan.sections) ? { ...s, extras: s.extras ?? [] } : null;
    } catch {
      return null;
    }
  }

  private persist() {
    if (!this.s) return;
    try {
      localStorage.setItem(KEY(), JSON.stringify(this.s));
    } catch {
      // storage full: writing goes on, it just cannot be continued after a reload
    }
  }

  private all(s: Saved) {
    return [...s.plan.sections, ...s.extras];
  }

  private resumableOf(s: Saved): WriterState['resumable'] {
    const left = this.all(s).length - s.section;
    return left > 0 ? { title: s.plan.title, left } : null;
  }

  // --- where the writing is --------------------------------------------------------------------

  /** The notes this session has on the board. */
  private mine(): NoteEl[] {
    const id = this.s?.id;
    return this.host.elements().filter((e): e is NoteEl => e.type === 'note' && e.session === id);
  }

  /** Reads the column and where it stopped from the notes on the board. Null when there are none. */
  private geoFromBoard(s: Saved): Geo | null {
    const notes = this.mine();
    const main = notes.filter((n) => !n.side);
    if (!main.length) return null;
    const last = main.reduce((a, b) => (b.y + b.h > a.y + a.h ? b : a));
    const side = notes.filter((n) => n.side);
    const gap = s.fs * 2;
    return {
      colX: last.x,
      mainY: last.y + last.h + s.fs * 0.8,
      sideX: side.length ? side[side.length - 1].x : last.x + s.wrap + gap,
      sideY: side.length ? Math.max(...side.map((n) => n.y + n.h)) + s.fs * 0.8 : last.y,
    };
  }

  /** Letter size, line width and a clear place on the board for a new set of notes. */
  private layout(at: [number, number] | null): { fs: number; pen: number; wrap: number; sideW: number; g: Geo } {
    const z = this.host.zoom();
    const view = this.host.view();
    // About 19 screen pixels a letter: easy to read without zooming, small enough for a page.
    const fs = clamp(19 / z, 4, 200);
    // The camera keeps FRAME_PAD screen pixels clear on each side, and framing adds a letter of
    // margin: columns that fill more than what is left would make it zoom out to fit.
    const avail = view.w - (FRAME_PAD * 2) / z - fs * 3;
    const wrap = Math.min(fs * 34, Math.max(fs * 16, avail * 0.62));
    const room = avail - wrap - fs * 2;
    const sideW = room >= fs * 14 ? Math.min(fs * 15, room) : 0;
    const total = wrap + (sideW ? sideW + fs * 2 : 0);
    const pos = findColumn(this.host.elements(), view, total, Math.min(view.h * 0.85, fs * 30), fs * 1.2, at);
    return {
      fs, pen: Math.max(0.6, fs * 0.085), wrap, sideW,
      g: { colX: pos.x, mainY: pos.y, sideX: pos.x + wrap + fs * 2, sideY: pos.y },
    };
  }

  // --- waiting -----------------------------------------------------------------------------------

  /** Waits while paused or answering a question. False when this run was stopped or replaced. */
  private async gate(run: number): Promise<boolean> {
    while (run === this.run && (this.state.phase === 'paused' || this.state.phase === 'asking')) {
      await new Promise<void>((r) => (this.wake = r));
    }
    return run === this.run;
  }

  private wait(ms: number): Promise<void> {
    return new Promise((r) => {
      const t = window.setTimeout(done, ms);
      function done() {
        window.clearTimeout(t);
        r();
      }
      this.hurry = done;
    });
  }

  // --- writing one block ---------------------------------------------------------------------------

  /**
   * Writes one block. `placed` runs as soon as the block is on the board, before the pen has
   * finished, so a reload part-way through never writes the same block twice.
   */
  private async put(
    block: Block,
    where: { side: boolean; section: number; index: number; answer?: boolean; top?: number; placed?: () => void },
  ): Promise<void> {
    const s = this.s!;
    const g = this.g!;
    const side = where.side && s.sideW > 0;
    const width = side ? s.sideW : s.wrap;
    // Margin notes are a touch smaller, like an aside written in the margin.
    const fs = side ? s.fs * 0.86 : s.fs;
    // The seed is kept on the element, so the board redraws exactly the strokes measured here.
    const seed = Math.floor(Math.random() * 2 ** 31);
    const pen = side ? s.pen * 0.9 : s.pen;
    const c = compose(block, { fontSize: fs, penWidth: pen, wrap: width, seed });
    if (!c.strokes.length) {
      where.placed?.();
      return;
    }
    const x = side ? g.sideX : g.colX;
    const before = block.t === 'h' ? s.fs * 0.9 : block.t === 'title' ? 0 : s.fs * 0.15;
    const want = side ? Math.max(g.sideY, where.top ?? g.sideY) : g.mainY + before;
    const y = clearTop(this.host.elements(), x, want, c.w, c.h, s.fs * 0.35);
    const color: ColorKey = where.answer ? 'violet' : where.side ? 'green' : COLOR[block.t] ?? 'ink';
    const el: NoteEl = {
      id: uid(), type: 'note', color, size: 5, x, y, w: c.w, h: c.h,
      fontSize: fs, penWidth: pen, wrap: width, seed,
      block, session: s.id, section: where.section, index: where.index,
      ...(where.side ? { side: true } : {}), ...(where.answer ? { answer: true } : {}), col: x,
    };
    this.host.add(el);
    where.placed?.();
    // Keep a little of what came before in view, the way you step back from the board. The area
    // never exceeds what is visible, so the camera pans along with the pen instead of zooming out:
    // a block taller than the screen shows its top, where the writing starts.
    const total = s.wrap + (s.sideW ? s.sideW + s.fs * 2 : 0);
    const view = this.host.view();
    const room = (FRAME_PAD * 2 + 4) / this.host.zoom();
    const delay = this.host.frame({
      x: g.colX - s.fs * 0.5,
      y: y - s.fs * 2.5,
      w: Math.min(total + s.fs, view.w - room),
      h: Math.min(c.h + s.fs * 3.5, view.h - room),
    });
    const ms = composeMs(c, fs) / this.state.speed;
    this.writingId = el.id;
    this.host.write(el.id, ms, delay);
    let release!: () => void;
    this.busy = new Promise((r) => (release = r));
    await this.wait(delay + ms);
    this.host.finish(el.id);
    this.writingId = null;
    release();
    if (side) g.sideY = y + c.h + s.fs * 0.7;
    else {
      g.mainY = y + c.h + s.fs * 0.55;
      if (!s.sideW) g.sideY = g.mainY;
    }
  }

  // --- the writing loop --------------------------------------------------------------------------------

  private written(): string {
    return this.mine().slice(-12).map((n) => blockText(n.block)).join(' | ').slice(0, 1100);
  }

  private section(s: Saved, i: number, signal: AbortSignal): Promise<SectionOut> {
    const hit = this.prefetched.get(i);
    if (hit) {
      this.prefetched.delete(i);
      return hit;
    }
    const all = this.all(s);
    const custom = i >= s.plan.sections.length ? all[i] : null;
    const lineChars = Math.round(s.wrap / (s.fs * 0.5));
    return writeSection(s.plan, custom ? 0 : i, lineChars, this.written(), '', custom, signal);
  }

  private prefetch(s: Saved, i: number, signal: AbortSignal) {
    if (i >= this.all(s).length || this.prefetched.has(i)) return;
    const p = this.section(s, i, signal);
    // A failed prefetch is asked for again when its turn comes.
    p.catch(() => this.prefetched.delete(i));
    this.prefetched.set(i, p);
  }

  private async loop(run: number) {
    const s = this.s!;
    const signal = this.ctrl!.signal;
    try {
      while (s.section < this.all(s).length) {
        if (!(await this.gate(run))) return;
        this.set({ phase: 'writing', section: s.section, sections: this.all(s), error: '' });
        if (!s.out) {
          this.set({ waiting: true });
          s.out = await this.section(s, s.section, signal);
          if (run !== this.run) return;
          this.set({ waiting: false });
          s.next = 0;
          s.sideNext = 0;
          this.persist();
        }
        this.prefetch(s, s.section + 1, signal);
        const top = this.g!.mainY;
        while (s.next < s.out.blocks.length) {
          if (!(await this.gate(run))) return;
          const out = s.out;
          await this.put(out.blocks[s.next], {
            side: false, section: s.section, index: s.next,
            placed: () => {
              s.next += 1;
              this.persist();
            },
          });
          if (run !== this.run) return;
        }
        while (s.sideNext < s.out.side.length) {
          if (!(await this.gate(run))) return;
          await this.put(s.out.side[s.sideNext], {
            side: true, section: s.section, index: 100 + s.sideNext, top,
            placed: () => {
              s.sideNext += 1;
              this.persist();
            },
          });
          if (run !== this.run) return;
        }
        s.section += 1;
        s.out = null;
        this.persist();
      }
      this.set({ phase: 'done', section: s.section, resumable: null });
      scheduleReviews(s.plan);
      markStudied();
      this.host.onFinished?.(s.plan);
    } catch (e) {
      if (run !== this.run || signal.aborted) return;
      this.set({ phase: 'error', waiting: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // --- what the panel can ask for -------------------------------------------------------------------

  /** Plans a new set of notes and writes it. `at` asks for the notes to start at a board point. */
  async start(req: { prompt: string; video?: string | null; transcript?: string; at?: [number, number] | null }) {
    this.halt();
    const run = ++this.run;
    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.prefetched.clear();
    this.set({ ...initial(), speed: this.state.speed, phase: 'planning', profile: this.host.profile() });
    markStudied();
    let plan: Plan | null = null;
    let failed = '';
    const stages: StageView[] = [];
    try {
      await planStream(
        { prompt: req.prompt, profile: this.host.profile(), context: this.host.context(), video: req.video ?? null, transcript: req.transcript ?? '' },
        (ev) => {
          if (run !== this.run) return;
          switch (ev.type) {
            case 'stage':
              stages.forEach((st) => (st.done = true));
              stages.push({ key: ev.stage, label: ev.label, done: false });
              this.set({ stages: stages.map((st) => ({ ...st })) });
              break;
            case 'profile':
              mergeProfile(ev.profile);
              this.set({ profile: ev.profile, subject: ev.subject, topic: ev.topic });
              break;
            case 'sources':
              this.set({ sources: ev.sources });
              break;
            case 'video':
              this.set({ video: ev.video });
              break;
            case 'plan':
              plan = ev.plan;
              break;
            case 'error':
              failed = ev.message;
              break;
          }
        },
        ctrl.signal,
      );
    } catch (e) {
      if (run !== this.run || ctrl.signal.aborted) return;
      failed = e instanceof Error ? e.message : String(e);
    }
    if (run !== this.run) return;
    if (!plan) {
      this.set({ phase: 'error', error: failed || 'The notes could not be planned.', stages: stages.map((st) => ({ ...st })) });
      return;
    }
    const p: Plan = plan;
    stages.forEach((st) => (st.done = true));
    const lay = this.layout(req.at ?? null);
    this.s = { id: uid(), plan: p, extras: [], fs: lay.fs, pen: lay.pen, wrap: lay.wrap, sideW: lay.sideW, section: 0, out: null, next: 0, sideNext: 0 };
    this.g = lay.g;
    this.persist();
    this.set({ plan: p, sources: p.sources.length ? p.sources : this.state.sources, sections: this.all(this.s), stages: stages.map((st) => ({ ...st })), phase: 'writing' });

    // The title, first: "Rotational motion" with "ICSE · Class 10 · Physics" under it.
    const sub = [p.profile.board, p.profile.grade && `Class ${p.profile.grade}`, p.subject].filter(Boolean).join(' · ');
    await this.put({ t: 'title', text: p.title, sub }, { side: false, section: -1, index: 0 });
    if (run !== this.run) return;
    void this.loop(run);
  }

  /** Continues notes that stopped part-way, from the last block on the board. */
  resume() {
    const s = this.s ?? this.load();
    if (!s) return;
    if (this.state.phase === 'paused') {
      this.set({ phase: 'writing' });
      this.wake?.();
      return;
    }
    this.halt();
    const run = ++this.run;
    this.ctrl = new AbortController();
    this.s = s;
    this.g = this.geoFromBoard(s);
    if (!this.g) {
      // The notes were erased: start the remaining sections in a new clear place.
      const lay = this.layout(null);
      this.g = lay.g;
    }
    // A section that was half written when it stopped carries on from its next block.
    this.set({ phase: 'writing', plan: s.plan, sources: s.plan.sources, profile: s.plan.profile, resumable: null, error: '', sections: this.all(s), section: s.section, video: s.plan.video ?? null });
    markStudied();
    void this.loop(run);
  }

  pause() {
    if (this.state.phase === 'writing') this.set({ phase: 'paused' });
  }

  /** Stops writing. The notes so far stay, and "Continue" picks up where it stopped. */
  stop() {
    this.halt();
    this.run++;
    this.set({ phase: 'idle', waiting: false, resumable: this.s ? this.resumableOf(this.s) : null, reply: '', asking: '' });
  }

  /** Ends the current block at once and cancels requests in flight. */
  private halt() {
    this.ctrl?.abort();
    this.ctrl = null;
    this.prefetched.clear();
    if (this.writingId) this.host.finish(this.writingId);
    this.hurry?.();
    this.wake?.();
  }

  setSpeed(speed: Speed) {
    this.set({ speed });
    // Instant: finish the block being written now.
    if (speed === 4 && this.writingId) {
      this.host.finish(this.writingId);
      this.hurry?.();
    }
  }

  /** "More examples", "Practice questions"...: one more section after the planned ones. */
  more(sec: PlanSection) {
    const s = this.s;
    if (!s) return;
    s.extras = [...s.extras, sec].slice(-6);
    this.persist();
    // Finished or stopped: carry on from the end. Writing: the loop picks the new section up itself.
    if (this.state.phase === 'done' || this.state.phase === 'idle' || this.state.phase === 'error') {
      this.resume();
    } else {
      this.set({ sections: this.all(s) });
    }
  }

  retry() {
    if (this.s && this.state.plan) this.resume();
  }

  /**
   * A short answer about work the student marked on the board, written beside it. This is not a
   * notes run: there is no plan, no sections and no page — just the one column of blocks the
   * teacher answers with, so a small question gets a small explanation.
   */
  async explain(input: { question: string; context: string; at: [number, number] }): Promise<string> {
    const q = input.question.trim();
    if (!q) return '';
    if (this.state.phase === 'planning') throw new Error('The notes are still being planned; ask again in a moment.');
    if (this.state.phase === 'asking') throw new Error('An answer is already being written; wait for it to finish.');
    const was = this.state.phase;
    this.set({ phase: 'asking', asking: q, reply: '' });
    // A block already being written finishes first; the writing loop waits at its next block.
    await this.busy;
    try {
      const res = await askTeacher({
        question: q,
        title: this.s?.plan.title ?? '',
        heading: '',
        written: input.context.slice(0, 1200),
        profile: this.s?.plan.profile ?? this.host.profile(),
      });
      this.set({ reply: res.reply });
      await this.aside(res.blocks, input.at);
      return res.reply;
    } finally {
      // The notes loop may have finished (or moved on) while this was written; its phase is the
      // true one then, so only a phase still set to "asking" goes back to `was`.
      if ((this.state.phase as Phase) === 'asking') this.set({ phase: was, asking: '' });
      else this.set({ asking: '' });
      this.wake?.();
    }
  }

  /** Writes answer blocks in their own column at `at`, in the answer colour. */
  private async aside(blocks: Block[], at: [number, number]): Promise<void> {
    if (!blocks.length) return;
    const fs = clamp(19 / this.host.zoom(), 4, 200);
    const wrap = fs * 26;
    const prevS = this.s;
    const prevG = this.g;
    // A session id of its own keeps a notes run from taking these blocks as its own.
    this.s = {
      id: `aside-${uid()}`,
      plan: null as unknown as Plan,
      extras: [],
      fs,
      pen: Math.max(0.6, fs * 0.085),
      wrap,
      sideW: 0,
      section: 0,
      out: null,
      next: 0,
      sideNext: 0,
    };
    this.g = { colX: at[0], mainY: at[1], sideX: at[0] + wrap, sideY: at[1] };
    try {
      for (let i = 0; i < blocks.length; i += 1) {
        await this.put(blocks[i], { side: false, section: 0, index: i, answer: true });
      }
    } finally {
      this.s = prevS;
      this.g = prevG;
    }
  }

  /** A question asked part-way: written in the margin where the notes stopped, then writing goes on. */
  async ask(question: string) {
    const s = this.s;
    const q = question.trim();
    if (!s || !q || this.state.phase === 'asking' || this.state.phase === 'planning') return;
    const was = this.state.phase;
    this.set({ phase: 'asking', asking: q, reply: '' });
    await this.busy;
    if (!this.g) this.g = this.geoFromBoard(s) ?? this.layout(null).g;
    const heading = this.all(s)[Math.min(s.section, this.all(s).length - 1)]?.heading ?? '';
    try {
      const res = await askTeacher({ question: q, title: s.plan.title, heading, written: this.written(), profile: s.plan.profile });
      this.set({ reply: res.reply });
      const top = Math.max(this.g.mainY - s.fs * 6, this.g.sideY);
      let i = 0;
      for (const b of [{ t: 'p' as const, text: `*Q:* ${q}` }, ...res.blocks]) {
        await this.put(b, { side: true, section: s.section, index: 200 + i++, answer: true, top });
      }
    } catch (e) {
      this.set({ reply: e instanceof Error ? e.message : String(e) });
    }
    this.set({ phase: was, asking: '' });
    this.wake?.();
  }

  /** Forgets the notes in progress on this board (the writing on the board stays). */
  forget() {
    this.stop();
    this.s = null;
    try {
      localStorage.removeItem(KEY());
    } catch {
      // ignore
    }
    this.set({ ...initial(), speed: this.state.speed });
  }
}

