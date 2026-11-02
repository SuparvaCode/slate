/**
 * Turns one block of study notes into pen strokes, the way a teacher writes on a board: lines
 * wrapped to the column, key words underlined, formulas boxed, tables ruled by hand, checklists
 * with drawn boxes, and simple labelled sketches.
 *
 * Letters and maths come from the handwriting layout (hand/), so notes read like the AI's answers.
 * Everything else (underlines, boxes, table rules, sketch shapes) is drawn here as wobbly strokes.
 * The result is cached: a block is written once and the strokes reused on every repaint.
 */
import { hasGlyph } from '../hand/glyphs';
import { layoutLatex } from '../hand/layout';
import { DEFAULT_STYLE, writeAnswer } from '../hand/writer';
import type { HandStroke, Written } from '../hand/writer';
import type { Block, Shape } from './types';

export interface ComposeStyle {
  /** Letter size (em), in world units. */
  fontSize: number;
  penWidth: number;
  /** Width to wrap lines to, in world units. */
  wrap: number;
  seed: number;
}

type P2 = [number, number];

/** Repeatable randomness, so a block is drawn the same way every time (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// --- text ------------------------------------------------------------------------------------

/** Characters the hand cannot draw, swapped for ones it can; anything else is left out. */
const SWAP: Record<string, string> = {
  '&': '+', '"': "'", '“': "'", '”': "'", '‘': "'", '’': "'", ';': ',', '—': '-', '–': '-', '−': '-',
  '…': '...', '•': '·', '×': '×', ' ': ' ', '_': ' ', '#': '', '@': '', '~': '-', '`': "'",
};

function plain(text: string): string {
  let out = '';
  for (const ch of text) {
    const c = SWAP[ch] ?? ch;
    for (const d of c) if (d === ' ' || hasGlyph(d)) out += d;
  }
  return out;
}

interface Word {
  /** What is written: plain letters, or LaTeX for maths. */
  src: string;
  /** Width at size 1 (em). */
  w: number;
  /** Underlined, because the model starred it. */
  emph: boolean;
  /** Written right after the previous word, with no space (punctuation after maths). */
  glue: boolean;
}

const widthEm = (src: string) => (src.trim() ? layoutLatex(src).w : 0);

/** Splits a line of notes into words: $...$ is maths, *...* is underlined. */
export function wordsOf(text: string): Word[] {
  const out: Word[] = [];
  const parts = text.replace(/\s+/g, ' ').split(/(\$[^$]+\$)/g);
  let emph = false;
  let spaceBefore = true;
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith('$') && part.endsWith('$') && part.length > 2) {
      const src = part.slice(1, -1).trim();
      if (src) out.push({ src, w: widthEm(src), emph, glue: !spaceBefore && out.length > 0 });
      spaceBefore = false;
      continue;
    }
    // Plain text: stars toggle underlining, spaces separate words.
    let cur = '';
    let curGlue = !spaceBefore && out.length > 0;
    let curEmph = emph;
    const flush = () => {
      const src = plain(cur).trim();
      if (src) out.push({ src, w: widthEm(src), emph: curEmph, glue: curGlue });
      cur = '';
    };
    for (const ch of part) {
      if (ch === '*') {
        flush();
        curGlue = out.length > 0 && !/\s$/.test(part.slice(0, part.indexOf(ch)));
        emph = !emph;
        curEmph = emph;
        continue;
      }
      if (ch === ' ') {
        flush();
        curGlue = false;
        curEmph = emph;
        continue;
      }
      if (!cur) curEmph = emph;
      cur += ch;
    }
    flush();
    spaceBefore = /\s$/.test(part);
  }
  return out;
}

const SPACE_EM = 0.34;

/** Greedy line breaking: as many words on a line as fit in `max` em. */
function wrapWords(words: Word[], max: number): Word[][] {
  const lines: Word[][] = [];
  let line: Word[] = [];
  let w = 0;
  for (const word of words) {
    const add = (line.length && !word.glue ? SPACE_EM : 0) + word.w;
    if (line.length && w + add > max && !word.glue) {
      lines.push(line);
      line = [word];
      w = word.w;
    } else {
      line.push(word);
      w += add;
    }
  }
  if (line.length) lines.push(line);
  return lines;
}

// --- a sheet that collects strokes --------------------------------------------------------------

class Sheet {
  strokes: HandStroke[] = [];
  lengths: number[] = [];
  readonly rand: () => number;
  private n = 0;

  readonly st: ComposeStyle;

  constructor(st: ComposeStyle) {
    this.st = st;
    this.rand = rng(st.seed);
  }

  /** A seed for the next piece of writing, so each line varies but repeats exactly. */
  nextSeed(): number {
    this.n += 1;
    return (this.st.seed + this.n * 7919) >>> 0;
  }

  /** Copies written strokes in at (dx, dy); `w` is cached and must not be changed. */
  put(w: Written, dx: number, dy: number) {
    w.strokes.forEach((s, i) => {
      this.strokes.push(s.map(([x, y, p]) => [x + dx, y + dy, p] as [number, number, number]));
      this.lengths.push(w.lengths[i]);
    });
  }

  /** A hand-drawn stroke through `pts`, with pressure that bites in and lifts off. */
  pen(pts: P2[], grip = 0.72) {
    if (pts.length < 2) return;
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    if (len <= 0) return;
    let run = 0;
    const stroke: HandStroke = pts.map((p, i) => {
      if (i > 0) run += Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]);
      const t = run / len;
      const ends = Math.min(1, t / 0.08, (1 - t) / 0.1) ** 0.5;
      return [p[0], p[1], 0.18 + 0.7 * grip * ends];
    });
    this.strokes.push(stroke);
    this.lengths.push(len);
  }

  /** A slightly bowed, slightly wavering line, as a hand draws one with no ruler. */
  seg(x1: number, y1: number, x2: number, y2: number, grip = 0.7) {
    const fs = this.st.fontSize;
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (len < 0.5) return;
    const steps = Math.max(4, Math.ceil(len / (fs * 0.08)));
    const bow = (this.rand() - 0.5) * Math.min(len * 0.035, fs * 0.22);
    const nx = -(y2 - y1) / len;
    const ny = (x2 - x1) / len;
    const wav = this.rand() * 6;
    const pts: P2[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const off = Math.sin(Math.PI * t) * bow + Math.sin(t * 9 + wav) * fs * 0.012;
      pts.push([x1 + (x2 - x1) * t + nx * off, y1 + (y2 - y1) * t + ny * off]);
    }
    this.pen(pts, grip);
  }

  arrowHead(x: number, y: number, angle: number, size: number) {
    const a = 0.5;
    this.seg(x - size * Math.cos(angle - a), y - size * Math.sin(angle - a), x, y, 0.75);
    this.seg(x, y, x - size * Math.cos(angle + a), y - size * Math.sin(angle + a), 0.75);
  }

  /** An arc from a0 to a1 (radians, clockwise on screen), optionally ending in an arrow. */
  arc(cx: number, cy: number, r: number, a0: number, a1: number, arrow = false) {
    const fs = this.st.fontSize;
    const span = a1 - a0;
    const steps = Math.max(10, Math.ceil((Math.abs(span) * r) / (fs * 0.08)));
    const wob = this.rand() * 6;
    const pts: P2[] = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (span * i) / steps;
      const rr = r * (1 + Math.sin(a * 3 + wob) * 0.018);
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
    this.pen(pts);
    if (arrow) {
      const end = a1;
      const tangent = end + (span >= 0 ? Math.PI / 2 : -Math.PI / 2);
      this.arrowHead(cx + r * Math.cos(end), cy + r * Math.sin(end), tangent, Math.max(fs * 0.35, r * 0.18));
    }
  }

  /** A closed loop, overshooting a little where it meets itself. */
  circle(cx: number, cy: number, r: number) {
    const start = this.rand() * Math.PI * 2;
    this.arc(cx, cy, r, start, start + Math.PI * 2.08);
  }

  dot(x: number, y: number) {
    const r = Math.max(this.st.penWidth * 0.5, this.st.fontSize * 0.05);
    this.pen([[x - r, y], [x, y - r], [x + r, y], [x, y + r], [x - r * 0.8, y]], 1);
  }

  /** A rounded box drawn in one pass, starting top-left and closing past the start. */
  box(x0: number, y0: number, x1: number, y1: number, round = 0.25) {
    const fs = this.st.fontSize;
    const r = Math.min(fs * round * 2, (y1 - y0) / 3, (x1 - x0) / 3);
    const pts: P2[] = [];
    const line = (ax: number, ay: number, bx: number, by: number) => {
      const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay) / (fs * 0.1)));
      for (let i = 1; i <= n; i++) pts.push([ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n]);
    };
    const corner = (cx: number, cy: number, a: number) => {
      for (let i = 1; i <= 5; i++) {
        const t = a + (Math.PI / 2) * (i / 5);
        pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
      }
    };
    pts.push([x0 + r, y0]);
    line(x0 + r, y0, x1 - r, y0);
    corner(x1 - r, y0 + r, -Math.PI / 2);
    line(x1, y0 + r, x1, y1 - r);
    corner(x1 - r, y1 - r, 0);
    line(x1 - r, y1, x0 + r, y1);
    corner(x0 + r, y1 - r, Math.PI / 2);
    line(x0, y1 - r, x0, y0 + r);
    corner(x0 + r, y0 + r, Math.PI);
    line(x0 + r, y0, x0 + r + fs * 0.7, y0 + fs * 0.03);
    const wob = this.rand() * 9;
    this.pen(pts.map(([x, y], i) => [x + Math.sin(i * 0.31 + wob) * fs * 0.018, y + Math.cos(i * 0.27 + wob) * fs * 0.018]), 0.7);
  }

  star(cx: number, cy: number, r: number) {
    const pts: P2[] = [];
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.42 : r;
      pts.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
    }
    this.pen(pts, 0.8);
  }

  /** Writes LaTeX (or plain letters) with its first baseline at (x, baseline). Returns the width. */
  write(src: string, x: number, baseline: number, size: number, box = false): Written | null {
    if (!src.trim()) return null;
    const w = writeAnswer(src, 'latex', {
      ...DEFAULT_STYLE,
      fontSize: size,
      penWidth: this.st.penWidth * Math.sqrt(size / this.st.fontSize),
      seed: this.nextSeed(),
      box,
    });
    if (!w.strokes.length) return null;
    this.put(w, x, baseline - w.ascent);
    return w;
  }

  /**
   * Writes wrapped text starting at (x, top), underlining starred words. Returns the y of the
   * bottom of the last line and the widest line, in world units.
   */
  paragraph(text: string, x: number, top: number, size: number, maxW: number): { bottom: number; w: number } {
    const lines = wrapWords(wordsOf(text), Math.max(4, maxW / size));
    const step = size * 1.45;
    let baseline = top + size * 0.82;
    let widest = 0;
    for (const line of lines) {
      let src = '';
      let cx = 0;
      const runs: { x0: number; x1: number }[] = [];
      line.forEach((word, i) => {
        const gap = i > 0 && !word.glue ? SPACE_EM : 0;
        src += (i > 0 && !word.glue ? ' ' : '') + word.src;
        const x0 = cx + gap;
        cx = x0 + word.w;
        if (word.emph) {
          const last = runs[runs.length - 1];
          if (last && i > 0 && line[i - 1].emph) last.x1 = cx;
          else runs.push({ x0, x1: cx });
        }
      });
      const w = this.write(src, x, baseline, size);
      const drawn = w ? w.w : cx * size;
      widest = Math.max(widest, drawn);
      // The layout's width and the written width differ a little (slant, jitter); stretch to fit.
      const k = cx > 0 ? drawn / (cx * size) : 1;
      for (const r of runs) {
        const y = baseline + size * 0.2 + (this.rand() - 0.5) * size * 0.04;
        this.seg(x + (r.x0 * k - 0.05) * size, y, x + (r.x1 * k + 0.08) * size, y + (this.rand() - 0.5) * size * 0.06, 0.62);
      }
      baseline += step;
    }
    return { bottom: baseline - step + size * 0.38, w: widest };
  }
}

// --- blocks ------------------------------------------------------------------------------------

function title(sh: Sheet, b: Extract<Block, { t: 'title' }>) {
  const fs = sh.st.fontSize;
  const size = fs * 1.55;
  const { bottom, w } = sh.paragraph(b.text, 0, 0, size, sh.st.wrap);
  const y = bottom + fs * 0.12;
  sh.seg(-fs * 0.1, y, w + fs * 0.25, y + fs * 0.04, 0.8);
  sh.seg(fs * 0.15, y + fs * 0.24, w * 0.85, y + fs * 0.22, 0.7);
  if (b.sub) sh.paragraph(b.sub, 0, y + fs * 0.5, fs * 0.72, sh.st.wrap);
}

function heading(sh: Sheet, text: string) {
  const fs = sh.st.fontSize;
  const { bottom, w } = sh.paragraph(text, 0, 0, fs * 1.18, sh.st.wrap);
  sh.seg(-fs * 0.05, bottom + fs * 0.08, w + fs * 0.15, bottom + fs * 0.1, 0.78);
}

function formula(sh: Sheet, b: Extract<Block, { t: 'f' }>) {
  const fs = sh.st.fontSize;
  let top = 0;
  if (b.label) top = sh.paragraph(`${b.label}:`, 0, 0, fs * 0.74, sh.st.wrap).bottom + fs * 0.3;
  sh.write(b.latex, fs * 0.5, top + fs * 1.15, fs * 1.12, true);
}

function list(sh: Sheet, items: string[], check: boolean, numbered = false) {
  const fs = sh.st.fontSize;
  const indent = fs * (numbered ? 1.5 : 1.3);
  let top = 0;
  items.forEach((item, i) => {
    const mid = top + fs * 0.55;
    if (numbered) sh.write(`${i + 1}.`, 0, top + fs * 0.82, fs);
    else if (check) {
      const s = fs * 0.55;
      sh.box(fs * 0.1, mid - s * 0.62, fs * 0.1 + s, mid + s * 0.38, 0.08);
    } else sh.dot(fs * 0.4, mid);
    top = sh.paragraph(item, indent, top, fs, sh.st.wrap - indent).bottom + fs * 0.32;
  });
}

function table(sh: Sheet, b: Extract<Block, { t: 'table' }>) {
  const fs = sh.st.fontSize;
  const cols = b.head.length;
  const cells = [b.head, ...b.rows].map((r) => r.map((c) => wordsOf(c).map((w) => w.src).join(' ')));
  const em = cells[0].map((_, j) => Math.max(...cells.map((r) => widthEm(r[j] ?? ''))) + 1.1);
  const totalEm = em.reduce((a, c) => a + c, 0);
  // Narrow columns: shrink the whole table rather than break the cells.
  const size = Math.max(fs * 0.55, Math.min(fs * 0.92, sh.st.wrap / totalEm));
  const xs = [0];
  for (const w of em) xs.push(xs[xs.length - 1] + w * size);
  const rowH = size * 1.65;
  const H = rowH * cells.length;
  const W = xs[cols];
  cells.forEach((row, i) => {
    row.forEach((cell, j) => {
      sh.write(cell, xs[j] + size * 0.5, i * rowH + rowH * 0.66, size);
    });
    // Rule under each row as it is finished, the way a table is drawn by hand.
    if (i === 0) {
      sh.seg(0, rowH, W, rowH + size * 0.03, 0.82);
      sh.seg(0, rowH + size * 0.12, W, rowH + size * 0.14, 0.6);
    } else if (i < cells.length - 1) sh.seg(0, (i + 1) * rowH, W, (i + 1) * rowH, 0.45);
  });
  sh.box(-size * 0.05, -size * 0.05, W, H, 0.05);
  for (let j = 1; j < cols; j++) sh.seg(xs[j], 0, xs[j] + size * 0.02, H, 0.6);
}

function sketch(sh: Sheet, b: Extract<Block, { t: 'sketch' }>) {
  const fs = sh.st.fontSize;
  const W = Math.min(sh.st.wrap, fs * 22);
  const s = W / 100;
  const X = (v: number) => v * s;
  const Y = (v: number) => v * s;
  const labels: Extract<Shape, { s: 'label' }>[] = [];
  for (const sp of b.shapes) {
    switch (sp.s) {
      case 'line':
        sh.seg(X(sp.x1), Y(sp.y1), X(sp.x2), Y(sp.y2));
        break;
      case 'arrow': {
        sh.seg(X(sp.x1), Y(sp.y1), X(sp.x2), Y(sp.y2), 0.78);
        const a = Math.atan2(Y(sp.y2) - Y(sp.y1), X(sp.x2) - X(sp.x1));
        sh.arrowHead(X(sp.x2), Y(sp.y2), a, Math.max(fs * 0.4, s * 3));
        break;
      }
      case 'dash': {
        const len = Math.hypot(X(sp.x2) - X(sp.x1), Y(sp.y2) - Y(sp.y1));
        const n = Math.max(2, Math.floor(len / (fs * 0.55)));
        for (let i = 0; i < n; i += 1) {
          const t0 = i / n;
          const t1 = (i + 0.55) / n;
          sh.seg(X(sp.x1 + (sp.x2 - sp.x1) * t0), Y(sp.y1 + (sp.y2 - sp.y1) * t0), X(sp.x1 + (sp.x2 - sp.x1) * t1), Y(sp.y1 + (sp.y2 - sp.y1) * t1), 0.5);
        }
        break;
      }
      case 'circle':
        sh.circle(X(sp.x), Y(sp.y), sp.r * s);
        break;
      case 'rect':
        sh.box(X(sp.x), Y(sp.y), X(sp.x + sp.w), Y(sp.y + sp.h), 0.04);
        break;
      case 'arc':
        sh.arc(X(sp.x), Y(sp.y), sp.r * s, (sp.a0 * Math.PI) / 180, (sp.a1 * Math.PI) / 180, sp.arrow);
        break;
      case 'dot':
        sh.dot(X(sp.x), Y(sp.y));
        break;
      case 'label':
        labels.push(sp);
        break;
    }
  }
  // Labels last, as a teacher labels a finished drawing.
  const ls = fs * 0.78;
  for (const l of labels) {
    const src = wordsOf(l.text).map((w) => w.src).join(' ');
    const w = widthEm(src) * ls;
    sh.write(src, Math.max(0, Math.min(W - w, X(l.x) - w / 2)), Y(l.y) + ls * 0.36, ls);
  }
  if (b.caption) {
    const cs = fs * 0.72;
    const src = wordsOf(b.caption).map((w) => w.src).join(' ');
    const w = Math.min(W, widthEm(src) * cs);
    sh.paragraph(b.caption, Math.max(0, (W - w) / 2), Y(60) + fs * 0.6, cs, W);
  }
}

function example(sh: Sheet, b: Extract<Block, { t: 'ex' }>) {
  const fs = sh.st.fontSize;
  const label = sh.paragraph('*Example*', 0, 0, fs, sh.st.wrap);
  const q = sh.paragraph(b.q, label.w + fs * 0.45, 0, fs, sh.st.wrap - label.w - fs * 0.45);
  sh.write(b.steps.join(' \\\\ '), fs * 1.1, q.bottom + fs * 1.25, fs, true);
}

function keyPoint(sh: Sheet, text: string) {
  const fs = sh.st.fontSize;
  const pad = fs * 0.5;
  const textX = fs * 1.75;
  sh.star(pad + fs * 0.45, pad + fs * 0.5, fs * 0.42);
  const { bottom, w } = sh.paragraph(text, textX, pad, fs, sh.st.wrap - textX - pad * 2);
  sh.box(0, 0, textX + w + pad * 1.2, bottom + pad, 0.3);
}

function practice(sh: Sheet, items: string[]) {
  const fs = sh.st.fontSize;
  const label = sh.paragraph('*Try these*', 0, 0, fs * 1.05, sh.st.wrap);
  const before = sh.strokes.length;
  list(sh, items, false, true);
  // Shift the list below the label.
  const dy = label.bottom + fs * 0.4;
  for (let i = before; i < sh.strokes.length; i++) sh.strokes[i] = sh.strokes[i].map(([x, y, p]) => [x, y + dy, p]);
}

// --- composing ---------------------------------------------------------------------------------

export interface Composed extends Written {}

const cache = new Map<string, Composed>();

const EMPTY: Composed = { strokes: [], lengths: [], total: 0, w: 0, h: 0, ascent: 0 };

/** The strokes for a block, with the writing's top-left at (0, 0). */
export function compose(block: Block, st: ComposeStyle): Composed {
  const key = `${JSON.stringify(block)}|${st.fontSize.toFixed(2)}|${st.penWidth.toFixed(2)}|${Math.round(st.wrap)}|${st.seed}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const sh = new Sheet(st);
  switch (block.t) {
    case 'title':
      title(sh, block);
      break;
    case 'h':
      heading(sh, block.text);
      break;
    case 'p':
      sh.paragraph(block.text, 0, 0, st.fontSize, st.wrap);
      break;
    case 'f':
      formula(sh, block);
      break;
    case 'list':
      list(sh, block.items, !!block.check);
      break;
    case 'table':
      table(sh, block);
      break;
    case 'sketch':
      sketch(sh, block);
      break;
    case 'ex':
      example(sh, block);
      break;
    case 'key':
      keyPoint(sh, block.text);
      break;
    case 'q':
      practice(sh, block.items);
      break;
  }
  if (!sh.strokes.length) return EMPTY;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of sh.strokes) {
    for (const [x, y] of s) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  const strokes = sh.strokes.map((s) => s.map(([x, y, p]) => [x - minX, y - minY, p] as [number, number, number]));
  const out: Composed = {
    strokes,
    lengths: sh.lengths,
    total: sh.lengths.reduce((a, b) => a + b, 0),
    w: maxX - minX,
    h: maxY - minY,
    ascent: 0,
  };
  if (cache.size > 400) cache.clear();
  cache.set(key, out);
  return out;
}

/**
 * How long writing a block takes: a brisk teacher's pace, so the pen is seen moving but a whole
 * section is not a long wait. No block takes more than 6 seconds; 2× and Fast go quicker.
 */
export function composeMs(c: Composed, fontSize: number): number {
  const ems = c.total / Math.max(1, fontSize);
  return Math.min(6000, Math.max(400, (ems / 19) * 1000));
}

/** Plain words of a block, for telling the AI what has already been written. */
export function blockText(b: Block): string {
  switch (b.t) {
    case 'title':
      return b.text;
    case 'h':
    case 'p':
    case 'key':
      return b.text.replace(/\*/g, '');
    case 'f':
      return `${b.label ? `${b.label}: ` : ''}${b.latex}`;
    case 'list':
    case 'q':
      return b.items.join('; ');
    case 'table':
      return `table ${b.head.join('/')}`;
    case 'sketch':
      return `sketch: ${b.caption}`;
    case 'ex':
      return `example: ${b.q}`;
  }
}
