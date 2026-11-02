import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import { useLongPress } from './gestures';
import { haptic } from './haptics';
import { COLOR_KEYS, SIZES } from './model';
import type { ColorKey } from './model';
import { ERASER_RADII } from './eraser';
import { COLOR_LABELS, PALETTE } from './theme';
import type { Theme } from './theme';
import { TOOLS } from './tools';
import type { Tool } from './tools';
import { useBack } from './back';

const GROUPS: Tool[][] = [
  ['select', 'hand'],
  ['pen', 'highlight', 'eraser'],
  ['rect', 'ellipse', 'diamond', 'line', 'arrow', 'text', 'figure'],
];

/** Tools that live in the Shapes picker as well, so narrow screens can hide them from the dock. */
export const BASIC_SHAPES: Tool[] = ['rect', 'ellipse', 'diamond', 'line', 'arrow'];

/** Tools whose options a long press opens. */
const HOLD_TOOLS: Tool[] = ['pen', 'highlight', 'eraser', 'rect', 'ellipse', 'diamond', 'line', 'arrow', 'text'];

const tip = (label: string, key?: string) => (key ? `${label}  ${key}` : label);

interface DockProps {
  tool: Tool;
  onTool: (t: Tool) => void;
  solution: boolean;
  onSolution: () => void;
  /** Opens or closes the shapes picker. */
  onShapes: () => void;
  /** Press and hold a tool: its options menu, anchored at the button. */
  onToolMenu?: (t: Tool, anchor: DOMRect) => void;
}

interface ToolButtonProps {
  t: Tool;
  active: boolean;
  /** Shapes button: the current tool is one it offers ('shape') or text, which phones hide from the dock. */
  holds?: 'shape' | 'text';
  onPick: () => void;
  onHold?: (anchor: DOMRect) => void;
}

/** A dock tool. A tap picks it; press and hold (or right-click) opens its options. */
function ToolButton({ t, active, holds, onPick, onHold }: ToolButtonProps) {
  const info = TOOLS[t];
  const press = useLongPress(onHold ? ({ target }) => onHold(target.getBoundingClientRect()) : undefined);
  return (
    <button
      className={`tool t-${t}${active ? ' active' : ''}${holds ? ` holds-${holds}` : ''}${BASIC_SHAPES.includes(t) ? ' basic-shape' : ''}`}
      onClick={() => {
        haptic('select');
        onPick();
      }}
      aria-label={info.label}
      aria-pressed={active}
      aria-haspopup={onHold ? 'menu' : undefined}
      data-tip={tip(info.label, info.key)}
      {...press}
    >
      <Icon name={info.icon} />
    </button>
  );
}

export function Dock({ tool, onTool, solution, onSolution, onShapes, onToolMenu }: DockProps) {
  return (
    <div className="panel dock" role="toolbar" aria-label="Tools">
      {/* On narrow screens the tools scroll sideways while Solve stays put at the end. */}
      <div className="dock-tools">
      {GROUPS.map((group, i) => (
        <div className="group" key={i}>
          {group.map((t) => (
            <ToolButton
              key={t}
              t={t}
              active={tool === t}
              holds={t !== 'figure' ? undefined : BASIC_SHAPES.includes(tool) ? 'shape' : tool === 'text' ? 'text' : undefined}
              onPick={() => (t === 'figure' ? onShapes() : onTool(t))}
              onHold={onToolMenu && HOLD_TOOLS.includes(t) ? (r) => onToolMenu(t, r) : undefined}
            />
          ))}
        </div>
      ))}
      </div>
      <div className="sep" />
      <div className="dock-ai">
      <button
        className={`solve${tool === 'solve' ? ' active' : ''}`}
        onClick={() => {
          haptic('select');
          onTool('solve');
        }}
        aria-label="Solve"
        data-tip={tip('Circle writing to solve it', 'S')}
      >
        <Icon name="sparkle" />
        <span>Solve</span>
      </button>
      <button
        className={`switch-btn${solution ? ' on' : ''}`}
        onClick={() => {
          haptic('tap');
          onSolution();
        }}
        role="switch"
        aria-checked={solution}
        aria-label="Solution"
        data-tip={tip(solution ? 'Writing every step' : 'Writing the answer only', 'Shift S')}
      >
        <Icon name="steps" size={18} />
        <span>Solution</span>
        <i className="switch" />
      </button>
      </div>
    </div>
  );
}

interface StyleProps {
  theme: Theme;
  color: ColorKey;
  sizeIdx: number;
  fill: boolean;
  showFill: boolean;
  onColor: (c: ColorKey) => void;
  onSize: (i: number) => void;
  onFill: (f: boolean) => void;
}

export function StylePanel({ theme, color, sizeIdx, fill, showFill, onColor, onSize, onFill }: StyleProps) {
  const colors = PALETTE[theme];
  // Phones show one row of colours and a single size button that opens the sizes.
  const [sizesOpen, setSizesOpen] = useState(false);
  const pickRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!sizesOpen) return;
    const down = (e: PointerEvent) => {
      if (!pickRef.current?.contains(e.target as Node)) setSizesOpen(false);
    };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [sizesOpen]);
  const sizeButtons = (closeAfter: boolean) =>
    SIZES.map((s, i) => (
      <button
        key={s}
        className={`size${sizeIdx === i ? ' on' : ''}`}
        onClick={() => {
          haptic('tap');
          onSize(i);
          if (closeAfter) setSizesOpen(false);
        }}
        role="radio"
        aria-checked={sizeIdx === i}
        aria-label={SIZE_LABELS[i]}
        data-tip={SIZE_LABELS[i]}
      >
        <i style={{ width: 4 + i * 3.5, height: 4 + i * 3.5 }} />
      </button>
    ));
  return (
    <div className="panel style-panel ink-style" onPointerDown={(e) => e.stopPropagation()}>
      <div className="swatches" role="radiogroup" aria-label="Color">
        {COLOR_KEYS.map((c) => (
          <button
            key={c}
            className={`swatch${color === c ? ' on' : ''}`}
            style={{ '--c': colors[c] } as React.CSSProperties}
            onClick={() => {
              haptic('tap');
              onColor(c);
            }}
            role="radio"
            aria-checked={color === c}
            aria-label={COLOR_LABELS[c]}
            data-tip={COLOR_LABELS[c]}
          />
        ))}
      </div>
      <div className="sep" />
      <div className="sizes" role="radiogroup" aria-label="Size">
        {sizeButtons(false)}
      </div>
      <div className="size-pick" ref={pickRef}>
        <button
          className={`size cur${sizesOpen ? ' open' : ''}`}
          onClick={() => setSizesOpen((v) => !v)}
          aria-label={`Size: ${SIZE_LABELS[sizeIdx]}`}
          aria-haspopup="true"
          aria-expanded={sizesOpen}
        >
          <i style={{ width: 4 + sizeIdx * 3.5, height: 4 + sizeIdx * 3.5 }} />
        </button>
        {sizesOpen && (
          <div className="panel size-pop" role="radiogroup" aria-label="Size">
            {sizeButtons(true)}
          </div>
        )}
      </div>
      {showFill && (
        <>
          <div className="sep" />
          <button
            className={`tool small${fill ? ' active' : ''}`}
            onClick={() => onFill(!fill)}
            aria-pressed={fill}
            aria-label="Fill"
            data-tip="Fill"
          >
            <Icon name="fill" size={18} />
          </button>
        </>
      )}
    </div>
  );
}

const SIZE_LABELS = ['Small', 'Medium', 'Large', 'Extra large'];

interface EraserProps {
  mode: 'part' | 'stroke';
  sizeIdx: number;
  onMode: (m: 'part' | 'stroke') => void;
  onSize: (i: number) => void;
}

export function EraserPanel({ mode, sizeIdx, onMode, onSize }: EraserProps) {
  return (
    <div className="panel style-panel" onPointerDown={(e) => e.stopPropagation()}>
      <div className="seg" role="radiogroup" aria-label="Eraser mode">
        <button
          className={mode === 'part' ? 'on' : ''}
          role="radio"
          aria-checked={mode === 'part'}
          onClick={() => onMode('part')}
          data-tip="Rubs out only what it touches"
        >
          Part
        </button>
        <button
          className={mode === 'stroke' ? 'on' : ''}
          role="radio"
          aria-checked={mode === 'stroke'}
          onClick={() => onMode('stroke')}
          data-tip="Removes a whole stroke or shape"
        >
          Stroke
        </button>
      </div>
      <div className="sep" />
      <div className="sizes" role="radiogroup" aria-label="Eraser size">
        {ERASER_RADII.map((r, i) => (
          <button
            key={r}
            className={`size${sizeIdx === i ? ' on' : ''}`}
            onClick={() => {
              haptic('tap');
              onSize(i);
            }}
            role="radio"
            aria-checked={sizeIdx === i}
            aria-label={['Small', 'Medium', 'Large', 'Extra large'][i]}
            data-tip={['Small', 'Medium', 'Large', 'Extra large'][i]}
          >
            <i style={{ width: 5 + i * 4.5, height: 5 + i * 4.5 }} />
          </button>
        ))}
      </div>
    </div>
  );
}

interface ZoomProps {
  zoom: number;
  onIn: () => void;
  onOut: () => void;
  onReset: () => void;
  onFit: () => void;
}

export function ZoomControls({ zoom, onIn, onOut, onReset, onFit }: ZoomProps) {
  return (
    <div className="panel zoom">
      <button className="tool small" onClick={onOut} aria-label="Zoom out" data-tip="Zoom out  Ctrl −">
        <Icon name="minus" size={18} />
      </button>
      <button className="zoom-pct" onClick={onReset} aria-label="Reset zoom" data-tip="Reset to 100%  Ctrl 0">
        {Math.round(zoom * 100)}%
      </button>
      <button className="tool small" onClick={onIn} aria-label="Zoom in" data-tip="Zoom in  Ctrl +">
        <Icon name="plus" size={18} />
      </button>
      <div className="sep" />
      <button className="tool small" onClick={onFit} aria-label="Fit to content" data-tip="Fit to content  Shift 1">
        <Icon name="fit" size={18} />
      </button>
    </div>
  );
}

interface TopLeftProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}

export function History({ canUndo, canRedo, onUndo, onRedo }: TopLeftProps) {
  return (
    <div className="panel history">
      <button className="tool small below" onClick={onUndo} disabled={!canUndo} aria-label="Undo" data-tip="Undo  Ctrl Z">
        <Icon name="undo" size={18} />
      </button>
      <button className="tool small below" onClick={onRedo} disabled={!canRedo} aria-label="Redo" data-tip="Redo  Ctrl Shift Z">
        <Icon name="redo" size={18} />
      </button>
    </div>
  );
}

interface StatusProps {
  apiDown: boolean;
  mock: boolean;
  model: string | null;
  accuracy: { rated: number; correct: number } | null;
  /** How many of the user's own letters the AI can now write. */
  handLetters: number;
}

export function Status({ apiDown, mock, model, accuracy, handLetters }: StatusProps) {
  const rated = accuracy && accuracy.rated > 0 ? `${accuracy.correct}/${accuracy.rated} read right` : null;
  // Which model answers is not the student's concern; the chip only shows when something is off.
  if (!apiDown && !mock && model) return null;
  return (
    <div className={`panel status${apiDown ? ' down' : ''}`}>
      <span className="dot" />
      {apiDown ? (
        <span>AI offline</span>
      ) : (
        <span>
          {mock ? 'Demo mode' : 'Connecting'}
          {handLetters > 0 && (
            <span className="faint" data-tip={'Answers are written using your own letterforms'}>
              {' '}· writing your {handLetters} {handLetters === 1 ? 'letter' : 'letters'}
            </span>
          )}
          {rated && <span className="faint"> · {rated}</span>}
        </span>
      )}
    </div>
  );
}

interface TopRightProps {
  /** What a finger does on a touch screen. */
  fingers: 'draw' | 'pan';
  onFingers: () => void;
  workOpen: boolean;
  /** A solve is running; shown as a dot when the Work window is closed. */
  working: boolean;
  onWork: () => void;
  theme: Theme;
  onTheme: () => void;
  onExport: () => void;
  onClear: () => void;
  empty: boolean;
  /** The board progress panel. */
  progressOpen: boolean;
  onProgress: () => void;
  /** The classroom tools menu: instruments, timer, spotlight and the rest. */
  classroomOpen: boolean;
  onClassroom: () => void;
  /** The AI study panel: notes, YouTube summaries, images, study habit. */
  studyOpen?: boolean;
  /** The AI teacher is planning or writing; shown as a dot. */
  studyBusy?: boolean;
  onStudy?: () => void;
}

export function TopRight({
  fingers, onFingers, workOpen, working, onWork, theme, onTheme, onExport, onClear, empty, progressOpen, onProgress,
  classroomOpen, onClassroom, studyOpen, studyBusy, onStudy,
}: TopRightProps) {
  const [confirming, setConfirming] = useState(false);
  const [more, setMore] = useState(false);
  const [moreClear, setMoreClear] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  useBack(more, () => setMore(false));
  useEffect(() => {
    setMoreClear(false);
    if (!more) return;
    const down = (e: PointerEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMore(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMore(false);
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key);
    };
  }, [more]);
  const pick = (fn: () => void) => () => {
    setMore(false);
    fn();
  };
  // Some touch screens (and device emulation) report no touch points but do report a coarse pointer.
  const touchy =
    typeof navigator !== 'undefined' &&
    (navigator.maxTouchPoints > 0 || (typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches));
  useEffect(() => {
    if (!confirming) return;
    const t = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(t);
  }, [confirming]);

  return (
    <div className="panel topright">
      {touchy && (
        <>
          <button
            className={`tool small below${fingers === 'draw' ? ' on' : ''}`}
            onClick={onFingers}
            aria-label="Finger drawing"
            aria-pressed={fingers === 'draw'}
            data-tip={fingers === 'draw' ? 'Fingers draw. Tap to let them only move the board' : 'Fingers move the board. Tap to let them draw'}
          >
            <Icon name="touch" size={18} />
          </button>
          <div className="sep" />
        </>
      )}
      {onStudy && (
        <button
          className={`tool small below study-btn${studyOpen ? ' on' : ''}`}
          onClick={onStudy}
          aria-label="AI study"
          aria-pressed={!!studyOpen}
          data-tip="AI study notes, YouTube summaries, images  N"
        >
          <Icon name="sparkle" size={18} />
          {studyBusy && !studyOpen && <i className="activity" />}
        </button>
      )}
      <button
        className={`tool small below${classroomOpen ? ' on' : ''}`}
        onClick={onClassroom}
        aria-label="Classroom tools"
        aria-expanded={classroomOpen}
        data-classroom-toggle
        data-tip="Ruler, protractor, compass, timer, spotlight…"
      >
        <Icon name="ruler" size={18} />
      </button>
      <button
        className={`tool small below tr-extra${progressOpen ? ' on' : ''}`}
        onClick={onProgress}
        aria-label="Board progress"
        aria-pressed={progressOpen}
        data-tip="What this board has covered"
      >
        <Icon name="progress" size={18} />
      </button>
      <button
        className={`tool small below tr-extra${workOpen ? ' on' : ''}`}
        onClick={onWork}
        aria-label="Work window"
        aria-pressed={workOpen}
        data-tip={workOpen ? 'Hide work  W' : 'Show work  W'}
      >
        <Icon name="work" size={18} />
        {working && !workOpen && <i className="activity" />}
      </button>
      <div className="sep tr-extra" />
      <button
        className="tool small below tr-extra"
        onClick={onTheme}
        aria-label="Toggle theme"
        data-tip={theme === 'dark' ? 'Light mode' : 'Dark mode'}
      >
        <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
      </button>
      <button className="tool small below tr-extra" onClick={onExport} disabled={empty} aria-label="Export PNG" data-tip="Export as PNG">
        <Icon name="download" size={18} />
      </button>
      {confirming ? (
        <button
          className="pill-btn danger tr-extra"
          onClick={() => {
            setConfirming(false);
            onClear();
          }}
        >
          Clear board?
        </button>
      ) : (
        <button
          className="tool small below tr-extra"
          onClick={() => setConfirming(true)}
          disabled={empty}
          aria-label="Clear board"
          data-tip="Clear board"
        >
          <Icon name="trash" size={18} />
        </button>
      )}
      <div className="tr-more" ref={moreRef}>
        <button
          className={`tool small below${more ? ' on' : ''}`}
          onClick={() => setMore((v) => !v)}
          aria-label="More"
          aria-haspopup="menu"
          aria-expanded={more}
        >
          <Icon name="more" size={18} />
          {working && !workOpen && <i className="activity" />}
        </button>
        {more && (
          <div className="menu tr-menu" role="menu">
            <div className="menu-group">
              <button role="menuitem" className="menu-item" onClick={pick(onProgress)}>
                <span className="menu-ico"><Icon name="progress" size={16} /></span>
                <span className="menu-label">{progressOpen ? 'Hide board progress' : 'Board progress'}</span>
              </button>
              <button role="menuitem" className="menu-item" onClick={pick(onWork)}>
                <span className="menu-ico"><Icon name="work" size={16} /></span>
                <span className="menu-label">{workOpen ? 'Hide work' : 'Show work'}</span>
              </button>
            </div>
            <div className="menu-group">
              <button role="menuitem" className="menu-item" onClick={pick(onTheme)}>
                <span className="menu-ico"><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} /></span>
                <span className="menu-label">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
              </button>
              <button role="menuitem" className="menu-item" disabled={empty} onClick={pick(onExport)}>
                <span className="menu-ico"><Icon name="download" size={16} /></span>
                <span className="menu-label">Export as PNG</span>
              </button>
              <button
                role="menuitem"
                className="menu-item danger"
                disabled={empty}
                onClick={() => {
                  if (!moreClear) {
                    setMoreClear(true);
                    return;
                  }
                  setMore(false);
                  onClear();
                }}
              >
                <span className="menu-ico"><Icon name="trash" size={16} /></span>
                <span className="menu-label">{moreClear ? 'Tap again to clear the board' : 'Clear board'}</span>
              </button>
            </div>
            <div className="menu-group">
              <button role="menuitem" className="menu-item" onClick={pick(() => window.dispatchEvent(new Event('slate:settings')))}>
                <span className="menu-ico"><Icon name="sliders" size={16} /></span>
                <span className="menu-label">Settings</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
