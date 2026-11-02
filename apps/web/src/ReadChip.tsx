import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Icon } from './icons';
import { Tex } from './Tex';

/** A multi-line reading shown on one line, with a bar between the lines. */
const flat = (latex: string) => latex.replace(/\\\\/g, '\\;\\vert\\;');

interface Props {
  /** What the reader took the handwriting to say, as LaTeX. */
  read: string;
  /** Other plausible readings, offered as one-tap fixes. */
  alternatives: string[];
  confidence: number;
  /** True when the user supplied this reading themselves. */
  corrected: boolean;
  style?: CSSProperties;
  /** Sits inside the Work window instead of floating over the board. */
  docked?: boolean;
  /** Solves again from this reading, without reading the handwriting a second time. */
  onPick: (latex: string) => void;
}

/**
 * Sits above the writing and says what the AI thinks it read. A misread is the most common
 * reason for a wrong answer, so it is shown plainly and fixed in one tap.
 */
export function ReadChip({ read, alternatives, confidence, corrected, style, docked, onPick }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(read);

  useEffect(() => {
    setDraft(read);
    setEditing(false);
  }, [read]);

  const unsure = !corrected && (alternatives.length > 0 || confidence < 0.85);
  const label = corrected ? 'You wrote' : unsure ? 'Is this what you wrote?' : 'Read as';

  return (
    <div className={`chip${unsure ? ' unsure' : ''}${docked ? ' docked' : ''}`} style={style} onPointerDown={(e) => e.stopPropagation()}>
      <span className="chip-label">{label}</span>
      {editing ? (
        <form
          className="chip-form"
          onSubmit={(e) => {
            e.preventDefault();
            const value = draft.trim();
            if (value) {
              setEditing(false);
              onPick(value);
            }
          }}
        >
          <input
            autoFocus
            value={draft}
            spellCheck={false}
            aria-label="What you wrote, as LaTeX"
            placeholder="Type what you wrote"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <button className="pill-btn primary" type="submit">
            Solve
          </button>
          <button
            className="pill-btn"
            type="button"
            onClick={() => {
              setDraft(read);
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </form>
      ) : (
        <>
          <span className="chip-read">
            <Tex latex={flat(read)} />
          </span>
          {alternatives.map((alt) => (
            <button key={alt} className="chip-alt" onClick={() => onPick(alt)} title="Solve this instead">
              <Tex latex={flat(alt)} />
            </button>
          ))}
          <button className="chip-edit" onClick={() => setEditing(true)} aria-label="Fix what was read" data-tip="Fix it">
            <Icon name="pen" size={14} />
          </button>
        </>
      )}
    </div>
  );
}
