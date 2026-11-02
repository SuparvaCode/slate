/**
 * Classroom tools that sit over the board: a timer and stopwatch, a spotlight, a screen shade,
 * a random name picker and a scoreboard, and the menu that opens them and the instruments.
 *
 * Each tool keeps its own state; the board only knows which ones are open. The spotlight lets
 * the pointer through to the board, so a teacher can keep writing inside it.
 */

import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as RKE, PointerEvent as RPE, ReactNode } from 'react';
import { Icon } from '../icons';
import { INST_LABEL } from './instruments';
import type { InstKind } from './instruments';
import './classroom.css';
import { useBack } from '../back';

export type OverlayKind = 'timer' | 'spotlight' | 'shade' | 'picker' | 'scoreboard';

export const OVERLAY_LABEL: Record<OverlayKind, string> = {
  timer: 'Timer', spotlight: 'Spotlight', shade: 'Screen shade', picker: 'Random picker', scoreboard: 'Scoreboard',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Follows the pointer from a pointerdown until it is let go. */
function follow(e: RPE<HTMLElement>, move: (x: number, y: number) => void) {
  const el = e.currentTarget;
  try {
    el.setPointerCapture(e.pointerId);
  } catch {
    // synthetic events have no pointer to capture
  }
  const onMove = (ev: PointerEvent) => move(ev.clientX, ev.clientY);
  const done = () => {
    el.removeEventListener('pointermove', onMove);
    el.removeEventListener('pointerup', done);
    el.removeEventListener('pointercancel', done);
  };
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerup', done);
  el.addEventListener('pointercancel', done);
}

/** A small floating window that can be dragged by its title bar and folded away. */
function Card({ title, x, y, width, onClose, children }: {
  title: string; x: number; y: number; width: number; onClose: () => void; children: ReactNode;
}) {
  const [pos, setPos] = useState({ x, y });
  const [folded, setFolded] = useState(false);
  const grab = (e: RPE<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const ox = e.clientX - pos.x;
    const oy = e.clientY - pos.y;
    follow(e, (cx, cy) => setPos({ x: clamp(cx - ox, 0, window.innerWidth - 90), y: clamp(cy - oy, 0, window.innerHeight - 44) }));
  };
  return (
    <div className="cls-card" style={{ left: pos.x, top: pos.y, width }} role="dialog" aria-label={title} onPointerDown={(e) => e.stopPropagation()}>
      <div className="cls-head" onPointerDown={grab}>
        <span className="cls-title">{title}</span>
        <button className="cls-icon" onClick={() => setFolded((f) => !f)} aria-label={folded ? `Open ${title}` : `Fold ${title}`}>
          <Icon name={folded ? 'plus' : 'minus'} size={14} />
        </button>
        <button className="cls-icon" onClick={onClose} aria-label={`Close ${title}`}>
          <Icon name="close" size={14} />
        </button>
      </div>
      {!folded && <div className="cls-body">{children}</div>}
    </div>
  );
}

// --- timer ---------------------------------------------------------------------------------------

/** Three short beeps. Browsers only allow sound after the page has been used, which a timer always has. */
function beep() {
  try {
    const ac = new AudioContext();
    for (const t of [0, 0.32, 0.64]) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(ac.destination);
      gain.gain.setValueAtTime(0.0001, ac.currentTime + t);
      gain.gain.exponentialRampToValueAtTime(0.3, ac.currentTime + t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t + 0.24);
      osc.start(ac.currentTime + t);
      osc.stop(ac.currentTime + t + 0.28);
    }
    window.setTimeout(() => void ac.close(), 1500);
  } catch {
    // no sound available
  }
}

/** m:ss for a countdown (rounded up, so it reads 0:00 only at the end), m:ss.t for a stopwatch. */
export function clockText(ms: number, stopwatch: boolean): string {
  if (stopwatch) {
    const tenths = Math.floor(Math.max(0, ms) / 100);
    const s = Math.floor(tenths / 10);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}.${tenths % 10}`;
  }
  const s = Math.ceil(Math.max(0, ms) / 1000 - 1e-9);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const PRESETS = [1, 3, 5, 10];

export function ClassTimer({ onClose }: { onClose: () => void }) {
  useBack(true, onClose);
  const [stopwatch, setStopwatch] = useState(false);
  const [total, setTotal] = useState(5 * 60_000);
  const [value, setValue] = useState(5 * 60_000);
  const [running, setRunning] = useState(false);
  const [ringing, setRinging] = useState(false);
  const start = useRef({ t0: 0, v0: 0 });

  useEffect(() => {
    if (!running) return;
    // The value it starts from is read once; ticking does not restart the interval.
    start.current = { t0: performance.now(), v0: value };
    const id = window.setInterval(() => {
      const dt = performance.now() - start.current.t0;
      if (stopwatch) {
        setValue(start.current.v0 + dt);
        return;
      }
      const v = start.current.v0 - dt;
      if (v > 0) setValue(v);
      else {
        setValue(0);
        setRunning(false);
        setRinging(true);
        beep();
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [running, stopwatch]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = (to = stopwatch ? 0 : total) => {
    setRunning(false);
    setRinging(false);
    setValue(to);
  };
  const setMinutes = (m: number) => {
    const ms = clamp(m, 1, 99) * 60_000;
    setTotal(ms);
    reset(ms);
  };
  const low = !stopwatch && running && value < 10_000;

  return (
    <Card title={stopwatch ? 'Stopwatch' : 'Timer'} x={window.innerWidth / 2 - 150} y={70} width={300} onClose={onClose}>
      <div className="cls-seg" role="group" aria-label="Timer mode">
        <button className={!stopwatch ? 'on' : ''} onClick={() => { setStopwatch(false); setRunning(false); setRinging(false); setValue(total); }}>Countdown</button>
        <button className={stopwatch ? 'on' : ''} onClick={() => { setStopwatch(true); setRunning(false); setRinging(false); setValue(0); }}>Stopwatch</button>
      </div>
      <div className={`cls-clock${ringing ? ' ring' : ''}${low ? ' low' : ''}`} role="timer" aria-live="off">
        {clockText(value, stopwatch)}
      </div>
      {!stopwatch && (
        <div className="cls-bar" aria-hidden="true">
          <span style={{ width: `${(value / total) * 100}%` }} />
        </div>
      )}
      {ringing && <p className="cls-note" role="alert">Time is up</p>}
      {!stopwatch && !running && (
        <div className="cls-row">
          <button className="cls-chip" onClick={() => setMinutes(Math.round(total / 60_000) - 1)} aria-label="One minute less">−1</button>
          {PRESETS.map((m) => (
            <button key={m} className={`cls-chip${total === m * 60_000 ? ' on' : ''}`} onClick={() => setMinutes(m)}>{m} min</button>
          ))}
          <button className="cls-chip" onClick={() => setMinutes(Math.round(total / 60_000) + 1)} aria-label="One minute more">+1</button>
        </div>
      )}
      <div className="cls-row">
        <button className="cls-btn primary" onClick={() => { setRinging(false); if (!stopwatch && value <= 0) setValue(total); setRunning((r) => !r); }}>
          {running ? 'Pause' : value === (stopwatch ? 0 : total) ? 'Start' : 'Resume'}
        </button>
        <button className="cls-btn" onClick={() => reset()}>Reset</button>
      </div>
    </Card>
  );
}

// --- spotlight -----------------------------------------------------------------------------------

export function Spotlight({ onClose }: { onClose: () => void }) {
  useBack(true, onClose);
  const [s, setS] = useState(() => ({ x: window.innerWidth / 2, y: window.innerHeight / 2, r: 150 }));
  const [round, setRound] = useState(true);
  const move = (e: RPE<HTMLElement>) => {
    e.stopPropagation();
    const ox = e.clientX - s.x;
    const oy = e.clientY - s.y;
    follow(e, (x, y) => setS((p) => ({ ...p, x: clamp(x - ox, 0, window.innerWidth), y: clamp(y - oy, 0, window.innerHeight) })));
  };
  const size = (e: RPE<HTMLElement>) => {
    e.stopPropagation();
    follow(e, (x, y) => setS((p) => {
      const d = round ? Math.hypot(x - p.x, y - p.y) : Math.max(Math.abs(x - p.x), Math.abs(y - p.y));
      return { ...p, r: clamp(d, 50, 700) };
    }));
  };
  const keys = (e: RKE<HTMLElement>) => {
    const step = e.shiftKey ? 40 : 10;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setS((p) => ({ ...p, r: clamp(p.r + step, 50, 700) }));
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setS((p) => ({ ...p, r: clamp(p.r - step, 50, 700) }));
    else if (e.key === 'Escape') onClose();
    else return;
    e.preventDefault();
  };
  const k = round ? Math.SQRT1_2 : 1;
  return (
    <>
      <div
        className="cls-spot"
        style={{ left: s.x - s.r, top: s.y - s.r, width: s.r * 2, height: s.r * 2, borderRadius: round ? '50%' : 20 }}
        aria-hidden="true"
      />
      <div className="cls-spot-bar" style={{ left: s.x, top: s.y - s.r - 12 }} onPointerDown={(e) => e.stopPropagation()}>
        <button className="cls-chip" onPointerDown={move} aria-label="Move the spotlight" title="Drag to move">
          <Icon name="hand" size={15} />
        </button>
        <button className="cls-chip" onClick={() => setRound((r) => !r)} aria-label={round ? 'Square spotlight' : 'Round spotlight'}>
          {round ? 'Square' : 'Round'}
        </button>
        <button className="cls-chip" onClick={onClose} aria-label="Close the spotlight">
          <Icon name="close" size={14} />
        </button>
      </div>
      <div
        className="cls-spot-size"
        style={{ left: s.x + s.r * k, top: s.y + s.r * k }}
        onPointerDown={size}
        onKeyDown={keys}
        role="slider"
        tabIndex={0}
        aria-label="Spotlight size"
        aria-valuemin={50}
        aria-valuemax={700}
        aria-valuenow={Math.round(s.r)}
      />
    </>
  );
}

// --- screen shade -----------------------------------------------------------------------------------

type Side = 'top' | 'bottom' | 'left' | 'right';
const SIDE_LABEL: Record<Side, string> = { top: 'From top', bottom: 'From bottom', left: 'From left', right: 'From right' };

export function ScreenShade({ onClose }: { onClose: () => void }) {
  useBack(true, onClose);
  const [side, setSide] = useState<Side>('top');
  const [cover, setCover] = useState(0.85);
  const across = side === 'left' || side === 'right';
  const drag = (e: RPE<HTMLElement>) => {
    e.stopPropagation();
    follow(e, (x, y) => {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const f = side === 'top' ? y / H : side === 'bottom' ? 1 - y / H : side === 'left' ? x / W : 1 - x / W;
      setCover(clamp(f, 0, 1));
    });
  };
  const keys = (e: RKE<HTMLElement>) => {
    const grow = side === 'top' || side === 'left' ? ['ArrowDown', 'ArrowRight'] : ['ArrowUp', 'ArrowLeft'];
    const shrink = side === 'top' || side === 'left' ? ['ArrowUp', 'ArrowLeft'] : ['ArrowDown', 'ArrowRight'];
    if (grow.includes(e.key)) setCover((c) => clamp(c + 0.05, 0, 1));
    else if (shrink.includes(e.key)) setCover((c) => clamp(c - 0.05, 0, 1));
    else if (e.key === 'Escape') onClose();
    else return;
    e.preventDefault();
  };
  const style: CSSProperties = across ? { top: 0, bottom: 0, width: `${cover * 100}%` } : { left: 0, right: 0, height: `${cover * 100}%` };
  style[side] = 0;
  return (
    <div className={`cls-shade from-${side}`} style={style} role="region" aria-label="Screen shade" onPointerDown={(e) => e.stopPropagation()}>
      <div className="cls-shade-tools">
        {(Object.keys(SIDE_LABEL) as Side[]).map((k) => (
          <button key={k} className={`cls-chip${k === side ? ' on' : ''}`} onClick={() => setSide(k)}>{SIDE_LABEL[k]}</button>
        ))}
        <button className="cls-chip" onClick={onClose} aria-label="Close the screen shade">
          <Icon name="close" size={14} />
        </button>
      </div>
      <div
        className="cls-shade-handle"
        onPointerDown={drag}
        onKeyDown={keys}
        role="slider"
        tabIndex={0}
        aria-label="Drag to reveal"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(cover * 100)}
      >
        <span className="cls-grip" />
      </div>
    </div>
  );
}

// --- random picker -----------------------------------------------------------------------------------

const SAMPLE = ['Aarav', 'Diya', 'Kabir', 'Meera', 'Rohan', 'Sara', 'Vihaan', 'Zara'];

/** A fair pick: crypto randomness where there is any. */
function randomIndex(n: number): number {
  try {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] % n;
  } catch {
    return Math.floor(Math.random() * n);
  }
}

export function RandomPicker({ onClose }: { onClose: () => void }) {
  useBack(true, onClose);
  const [text, setText] = useState(SAMPLE.join('\n'));
  const [shown, setShown] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [removePicked, setRemovePicked] = useState(true);
  const [picked, setPicked] = useState<string[]>([]);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const names = text.split('\n').map((s) => s.trim()).filter(Boolean);

  const spin = () => {
    if (spinning || !names.length) return;
    setSpinning(true);
    const winner = randomIndex(names.length);
    const steps = 16;
    let k = 0;
    const tick = () => {
      k++;
      if (k < steps) {
        setShown(names[randomIndex(names.length)]);
        timer.current = window.setTimeout(tick, 45 + k * k * 1.8);
        return;
      }
      const name = names[winner];
      setShown(name);
      setSpinning(false);
      setPicked((p) => [...p, name]);
      if (removePicked && names.length > 1) setText(names.filter((_, i) => i !== winner).join('\n'));
    };
    tick();
  };
  const putBack = () => {
    setText([...names, ...picked.filter((p) => !names.includes(p))].join('\n'));
    setPicked([]);
    setShown(null);
  };

  return (
    <Card title="Random picker" x={window.innerWidth - 360} y={90} width={300} onClose={onClose}>
      <div className={`cls-pick${spinning ? ' spinning' : ''}`} aria-live="polite">{shown ?? 'Who is next?'}</div>
      <button className="cls-btn primary wide" onClick={spin} disabled={spinning || !names.length}>
        {spinning ? 'Picking…' : 'Pick a name'}
      </button>
      <label className="cls-label" htmlFor="cls-names">Names, one per line ({names.length})</label>
      <textarea id="cls-names" className="cls-names" value={text} onChange={(e) => setText(e.target.value)} rows={5} spellCheck={false} />
      <label className="cls-check">
        <input type="checkbox" checked={removePicked} onChange={(e) => setRemovePicked(e.target.checked)} />
        Take each picked name off the list
      </label>
      {picked.length > 0 && (
        <div className="cls-picked">
          <span>Picked: {picked.join(', ')}</span>
          <button className="cls-link" onClick={putBack}>Put everyone back</button>
        </div>
      )}
    </Card>
  );
}

// --- scoreboard ----------------------------------------------------------------------------------------

const TEAM_COLORS = ['#ff3b30', '#007aff', '#34c759', '#ff9500', '#af52de', '#ff2d55', '#5ac8fa', '#a2845e'];

export function Scoreboard({ onClose }: { onClose: () => void }) {
  useBack(true, onClose);
  const [teams, setTeams] = useState(() => [{ name: 'Team A', score: 0 }, { name: 'Team B', score: 0 }]);
  const change = (i: number, patch: Partial<{ name: string; score: number }>) =>
    setTeams((ts) => ts.map((t, k) => (k === i ? { ...t, ...patch } : t)));
  const top = Math.max(...teams.map((t) => t.score));
  return (
    <Card title="Scoreboard" x={24} y={90} width={Math.min(560, 120 + teams.length * 110)} onClose={onClose}>
      <div className="cls-teams">
        {teams.map((t, i) => (
          <div key={i} className={`cls-team${t.score === top && top > 0 ? ' lead' : ''}`} style={{ '--team': TEAM_COLORS[i] } as CSSProperties}>
            <input className="cls-team-name" value={t.name} onChange={(e) => change(i, { name: e.target.value })} aria-label={`Team ${i + 1} name`} />
            <div className="cls-score" aria-live="polite">{t.score}</div>
            <div className="cls-row tight">
              <button className="cls-chip" onClick={() => change(i, { score: t.score - 1 })} aria-label={`${t.name}: one point less`}>−</button>
              <button className="cls-chip on" onClick={() => change(i, { score: t.score + 1 })} aria-label={`${t.name}: one point more`}>+</button>
            </div>
          </div>
        ))}
      </div>
      <div className="cls-row">
        <button className="cls-btn" onClick={() => setTeams((ts) => (ts.length < 8 ? [...ts, { name: `Team ${String.fromCharCode(65 + ts.length)}`, score: 0 }] : ts))} disabled={teams.length >= 8}>Add team</button>
        <button className="cls-btn" onClick={() => setTeams((ts) => (ts.length > 2 ? ts.slice(0, -1) : ts))} disabled={teams.length <= 2}>Remove team</button>
        <button className="cls-btn" onClick={() => setTeams((ts) => ts.map((t) => ({ ...t, score: 0 })))}>Reset scores</button>
      </div>
    </Card>
  );
}

// --- the menu -----------------------------------------------------------------------------------------

const INSTRUMENTS: InstKind[] = ['ruler', 'set45', 'set60', 'protractor', 'compass'];
const OVERLAYS: OverlayKind[] = ['timer', 'spotlight', 'shade', 'picker', 'scoreboard'];

const GLYPH: Record<InstKind | OverlayKind, ReactNode> = {
  ruler: <path d="M3.5 15.5l12-12 5 5-12 12zM7.5 11.5l1.8 1.8M10.5 8.5l1.8 1.8M13.5 5.5l1.8 1.8" />,
  set45: <path d="M4 20V4l16 16zM8 16v-4.5l4.5 4.5z" />,
  set60: <path d="M4 20V5l17 15zM8 16v-4l4.5 4z" />,
  protractor: <path d="M3 17a9 9 0 0118 0zM12 17V9M12 17l5.5-5.5" />,
  compass: <path d="M12 3v3M12 6l-6 14M12 6l6 14M9.3 13.5h5.4" />,
  timer: <path d="M12 21a8 8 0 100-16 8 8 0 000 16zM12 9v4l2.5 2.5M10 2.5h4" />,
  spotlight: <path d="M12 16a4 4 0 100-8 4 4 0 000 8zM3 3l3 3M21 3l-3 3M3 21l3-3M21 21l-3-3" />,
  shade: <path d="M4 4h16v9H4zM4 13l2 2h12l2-2M10 19h4" />,
  picker: <path d="M5 6h14M5 12h9M5 18h6M18 14l3 3-3 3" />,
  scoreboard: <path d="M4 5h16v14H4zM12 5v14M7.5 10v4M15 10h2.5v2H15v2h2.5" />,
};

function Glyph({ k }: { k: InstKind | OverlayKind }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPH[k]}
    </svg>
  );
}

export function ClassroomMenu({ open, onInstrument, onOverlay, instrumentCount, onClearInstruments, onClose }: {
  open: OverlayKind[];
  onInstrument: (k: InstKind) => void;
  onOverlay: (k: OverlayKind) => void;
  instrumentCount: number;
  onClearInstruments: () => void;
  onClose: () => void;
}) {
  useBack(true, onClose);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (ref.current?.contains(t) || t?.closest('[data-classroom-toggle]')) return;
      onClose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="panel cls-menu" role="menu" aria-label="Classroom tools">
      <h4>Instruments on the board</h4>
      {INSTRUMENTS.map((k) => (
        <button key={k} role="menuitem" className="cls-item" onClick={() => onInstrument(k)}>
          <Glyph k={k} />
          {INST_LABEL[k]}
        </button>
      ))}
      {instrumentCount > 0 && (
        <button role="menuitem" className="cls-item quiet" onClick={onClearInstruments}>
          <Icon name="trash" size={16} />
          Put away all instruments ({instrumentCount})
        </button>
      )}
      <h4>On the screen</h4>
      {OVERLAYS.map((k) => (
        <button key={k} role="menuitemcheckbox" aria-checked={open.includes(k)} className={`cls-item${open.includes(k) ? ' on' : ''}`} onClick={() => onOverlay(k)}>
          <Glyph k={k} />
          {OVERLAY_LABEL[k]}
          {open.includes(k) && <span className="cls-dot" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
}
