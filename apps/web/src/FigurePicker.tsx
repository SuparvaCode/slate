import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { FIGURES, FIGURE_GROUPS, placePaths } from './figures';
import type { FigureKind, V } from './figures';
import { SIMS, SIM_KINDS, lookFor } from './sim';
import { PALETTE } from './theme';
import { cardBase, drawDiagramCard } from './diagram/draw';
import { STARTERS, loadMine, loadRecent } from './diagram/library';
import type { LibraryItem } from './diagram/library';
import type { Diagram } from './diagram/types';
import type { SimKind, SimSubject } from './sim';
import { TOOLS } from './tools';
import type { Tool } from './tools';
import { useBack } from './back';
import { ImageSearch } from './ImageSearch';
import type { PlacedImage } from './StudyPanel';

/** The line, shape and text tools, offered here too so a phone's dock can stay short. */
const BASIC: Tool[] = ['rect', 'ellipse', 'diamond', 'line', 'arrow', 'text'];

const W = 60;
const H = 42;
const PAD = 5;

const d = (pts: V[], closed: boolean) =>
  pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + (closed ? ' Z' : '');

/** A small drawing of a figure, made from the same lines the board draws. */
export function FigureThumb({ kind }: { kind: FigureKind }) {
  const def = FIGURES[kind];
  let w = W - PAD * 2;
  let h = w / def.ratio;
  if (h > H - PAD * 2) {
    h = H - PAD * 2;
    w = h * def.ratio;
  }
  const paths = placePaths(kind, (W - w) / 2, (H - h) / 2, w, h);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
      {paths.map((p, i) => {
        if (p.dot > 0) return <circle key={i} cx={p.pts[0][0]} cy={p.pts[0][1]} r={1.9} fill="currentColor" />;
        const last = p.pts[p.pts.length - 1];
        const prev = p.pts[p.pts.length - 2] ?? last;
        const a = Math.atan2(last[1] - prev[1], last[0] - prev[0]);
        const head = 3.6;
        return (
          <g key={i}>
            <path
              d={d(p.pts, p.closed)}
              fill={p.fill && p.closed ? 'currentColor' : 'none'}
              fillOpacity={0.14}
              stroke="currentColor"
              strokeWidth={p.thin ? 0.7 : 1.4}
              strokeDasharray={p.dash ? '2.4 2.4' : undefined}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            {p.arrow && (
              <path
                d={`M${last[0] - head * Math.cos(a - 0.5)} ${last[1] - head * Math.sin(a - 0.5)} L${last[0]} ${last[1]} L${last[0] - head * Math.cos(a + 0.5)} ${last[1] - head * Math.sin(a + 0.5)}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.4}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

interface Props {
  current: FigureKind;
  onPick: (kind: FigureKind) => void;
  /** Switches to a basic drawing tool (rectangle, line...), which also closes the picker. */
  onTool: (t: Tool) => void;
  /** Puts a live simulator on the board. */
  onSim: (kind: SimKind) => void;
  /** Puts a ready-made diagram on the board. */
  onDiagram: (item: LibraryItem) => void;
  /** Opens AI Diagram, with what was searched for as the request. */
  onStudio: (prompt: string) => void;
  /** Puts a picture from the web search on the board. */
  onImage: (img: PlacedImage) => void;
  /** Opens the file picker for a picture of the student's own. */
  onUpload: () => void;
  notify: (msg: string) => void;
  onClose: () => void;
}

export type PickTab = 'shapes' | 'sims' | 'diagrams' | 'images';
const TAB_KEY = 'slate.picker.tab';
const TABS: { id: PickTab; label: string }[] = [
  { id: 'shapes', label: 'Shapes' },
  { id: 'sims', label: 'Simulators' },
  { id: 'diagrams', label: 'Diagrams' },
  { id: 'images', label: 'Images' },
];

/** Opens the picker on this tab next time (the menu's "Search images…" uses it). */
export const pickerTab = (t: PickTab): void => {
  try {
    localStorage.setItem(TAB_KEY, t);
  } catch {
    // storage blocked: the picker opens on its first tab
  }
};

/** Simulator sections, in the order a school timetable usually lists them. */
const SUBJECTS: SimSubject[] = ['Physics', 'Chemistry', 'Biology', 'Maths', 'Computer'];

const has = (q: string, ...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q));

/** Shapes, simulators, ready-made diagrams and pictures, each in its own tab. One search covers the first three. */
export function FigurePicker({ current, onPick, onTool, onSim, onDiagram, onStudio, onImage, onUpload, notify, onClose }: Props) {
  useBack(true, onClose);
  const [tab, setTabState] = useState<PickTab>(() => {
    const t = localStorage.getItem(TAB_KEY);
    return t === 'sims' || t === 'diagrams' || t === 'images' ? t : 'shapes';
  });
  const [query, setQuery] = useState('');
  const [recent] = useState<LibraryItem[]>(() => [...loadRecent().slice(0, 8), ...loadMine()]);
  const setTab = (t: PickTab) => {
    setTabState(t);
    localStorage.setItem(TAB_KEY, t);
  };
  const q = query.trim().toLowerCase();

  const basic = BASIC.filter((t) => has(q, TOOLS[t].label));
  const groups = FIGURE_GROUPS.map((g) => ({
    ...g,
    kinds: g.kinds.filter((k) => has(q, FIGURES[k].label, g.title)),
  })).filter((g) => g.kinds.length > 0);
  const sims = SIM_KINDS.filter((k) => has(q, SIMS[k].label, SIMS[k].blurb, SIMS[k].subject ?? 'Physics', SIMS[k].keywords ?? ''));
  const simGroups = SUBJECTS.map((subject) => ({ subject, kinds: sims.filter((k) => (SIMS[k].subject ?? 'Physics') === subject) })).filter(
    (g) => g.kinds.length > 0,
  );
  const diagrams = [...recent, ...STARTERS].filter((i) => has(q, i.title, i.prompt, i.subject));
  const counts: Record<PickTab, number> = {
    shapes: basic.length + groups.reduce((n, g) => n + g.kinds.length, 0),
    sims: sims.length,
    diagrams: diagrams.length,
    images: 0,
  };
  // A search with nothing in this tab shows the first tab that has matches. The Images tab has
  // its own web search, so it stays as it is.
  const shown: PickTab =
    tab !== 'images' && q && counts[tab] === 0 ? (TABS.find((t) => t.id !== 'images' && counts[t.id] > 0)?.id ?? tab) : tab;

  return (
    <div className="panel figures" role="dialog" aria-label="Shapes, simulators, diagrams and images" onPointerDown={(e) => e.stopPropagation()}>
      <div className="fig-head">
        <div className="fig-tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={shown === t.id} className={shown === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
              {t.label}
              {q && t.id !== 'images' && <em>{counts[t.id]}</em>}
            </button>
          ))}
        </div>
        <button className="tool small" onClick={onClose} aria-label="Close">
          <Icon name="close" size={16} />
        </button>
      </div>
      {shown !== 'images' && <div className="fig-search">
        <Icon name="target" size={15} />
        <input
          value={query}
          placeholder="Search shapes, simulators and diagrams"
          aria-label="Search"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
              if (query) setQuery('');
              else onClose();
            }
          }}
        />
        {query && (
          <button className="tool small" aria-label="Clear search" onClick={() => setQuery('')}>
            <Icon name="close" size={14} />
          </button>
        )}
      </div>}
      <div className="fig-scroll">
        {shown === 'shapes' && (
          <>
            {basic.length > 0 && (
              <section>
                <h4>Draw</h4>
                <div className="fig-grid">
                  {basic.map((t) => (
                    <button key={t} className="fig" onClick={() => onTool(t)} aria-label={TOOLS[t].label} title={TOOLS[t].label}>
                      <i className="fig-ico">
                        <Icon name={TOOLS[t].icon} size={26} />
                      </i>
                      <span>{TOOLS[t].label}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {groups.map((g) => (
              <section key={g.title}>
                <h4>{g.title}</h4>
                <div className="fig-grid">
                  {g.kinds.map((k) => (
                    <button
                      key={k}
                      className={`fig${current === k ? ' on' : ''}`}
                      onClick={() => onPick(k)}
                      aria-label={FIGURES[k].label}
                      title={FIGURES[k].label}
                    >
                      <FigureThumb kind={k} />
                      <span>{FIGURES[k].label}</span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
            {counts.shapes > 0 && <p className="fig-foot">Tap a shape to place it, or drag on the board to size it.</p>}
          </>
        )}
        {shown === 'sims' && simGroups.map((g) => (
          <section key={g.subject}>
            <h4>{g.subject}</h4>
            <div className="sim-grid">
              {g.kinds.map((k) => (
                <button key={k} className="sim-card" onClick={() => onSim(k)} aria-label={SIMS[k].label}>
                  <i className="sim-card-ico">
                    <Icon name="play" size={14} />
                  </i>
                  <span>
                    <b>{SIMS[k].label}</b>
                    <small>{SIMS[k].blurb}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
        {shown === 'diagrams' && (
          <section>
            <button className="fig-ai" onClick={() => onStudio(query.trim())}>
              <i><Icon name="wand" size={16} /></i>
              <span>
                <b>{q ? `Sketch \u201c${query.trim()}\u201d with AI` : 'Describe a diagram for AI to sketch'}</b>
                <small>Solved and checked before it lands on the board</small>
              </span>
            </button>
            <div className="dg-grid">
              {diagrams.map((item) => (
                <button key={item.id} className="dg-card" onClick={() => onDiagram(item)} title={item.prompt || item.title}>
                  <DiagramThumb d={item.diagram} />
                  <span>
                    <b>{item.title}</b>
                    <small>{item.subject === 'Mine' ? 'Saved' : item.subject}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        )}
        {shown === 'images' && <ImageSearch onPlace={onImage} onUpload={onUpload} notify={notify} />}
        {q && shown !== 'images' && counts[shown] === 0 && (
          <div className="fig-empty">
            Nothing matches &ldquo;{query.trim()}&rdquo;.
            <button className="fig-empty-ai" onClick={() => onStudio(query.trim())}>
              <Icon name="wand" size={14} /> Ask AI to sketch it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** A diagram drawn small, for the Diagrams tab. */
function DiagramThumb({ d }: { d: Diagram }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const dark = document.documentElement.dataset.theme === 'dark';
    const colors = PALETTE[dark ? 'dark' : 'light'];
    const [bw, bh] = cardBase(d);
    const s = Math.min((w - 6) / bw, (h - 6) / bh);
    drawDiagramCard(
      ctx,
      { id: 'pick', x: (w - bw * s) / 2, y: (h - bh * s) / 2, w: bw * s, h: bh * s, diagram: d },
      lookFor(colors, colors.ink),
      { chrome: false },
    );
  }, [d]);
  return <canvas ref={ref} className="dg-thumb" aria-hidden="true" />;
}
