import { useEffect, useState } from 'react';
import { Icon } from './icons';
import type { SimEl } from './model';
import { SIMS, commitRun, isStill, resetPatch, resetRun, runOf, setPlaying, setSpeed, stepOnce } from './sim';
import type { Control, SimParams } from './sim';
import { Tex } from './Tex';
import { fetchMolecule } from './api';
import { molFromStructure } from './sim/molecule';
import { useBack } from './back';

const SPEEDS = [0.25, 0.5, 1, 2];

interface Props {
  el: SimEl;
  /** Live: part of a slider drag (one undo step per drag). Otherwise a single change. */
  onParams: (patch: SimParams, live: boolean) => void;
  /** Ends a slider drag. */
  onCommit: () => void;
  /** Asks the board to keep animating after play. */
  onRun: () => void;
  onClose: () => void;
}

function fmtValue(c: Extract<Control, { type: 'range' }>, v: number) {
  const digits = c.step >= 1 ? 0 : c.step >= 0.1 ? 1 : c.step >= 0.01 ? 2 : 3;
  return `${v.toFixed(digits)}${c.unit ? ` ${c.unit}` : ''}`;
}

/** Settings, transport and working for one simulator. */
export function SimPanel({ el, onParams, onCommit, onRun, onClose }: Props) {
  useBack(true, onClose);
  const def = SIMS[el.kind];
  const [, setTick] = useState(0);
  // The motion runs outside React; refresh a few times a second so the buttons and time stay true.
  useEffect(() => {
    const t = window.setInterval(() => setTick((n) => n + 1), 200);
    return () => window.clearInterval(t);
  }, []);
  const run = runOf(el);
  const p = el.params;
  const controls = def.controls.filter((c) => !c.show || c.show(p));
  const formulas = def.formulas(p);

  /** Saves a paused run's progress into its settings, for simulators that keep it there. */
  const keep = () => {
    const patch = commitRun(el);
    if (patch) onParams(patch, false);
  };

  const play = () => {
    const pausing = run.playing;
    setPlaying(el, !pausing);
    if (pausing) keep();
    onRun();
    setTick((n) => n + 1);
  };

  const [query, setQuery] = useState('');
  const [looking, setLooking] = useState<'idle' | 'busy' | string>('idle');
  const lookUp = async () => {
    const name = query.trim();
    if (!name || looking === 'busy') return;
    setLooking('busy');
    try {
      const found = await fetchMolecule(name);
      onParams({ ...molFromStructure(found), name: found.name }, false);
      setLooking('idle');
      setQuery('');
    } catch (err) {
      setLooking(err instanceof Error ? err.message : 'Not found.');
    }
  };

  return (
    <div className="panel sim-panel" role="dialog" aria-label={`${def.label} settings`} onPointerDown={(e) => e.stopPropagation()}>
      <div className="sim-head">
        <span className="sim-ico">
          <Icon name="atom" size={16} />
        </span>
        <div className="sim-name">
          <b>{def.label}</b>
          <span>{def.title(p)}</span>
        </div>
        <button className="tool small" onClick={onClose} aria-label="Close settings">
          <Icon name="close" size={16} />
        </button>
      </div>

      {!isStill(el) && (
      <>
      <div className="sim-transport">
        <button className="sim-play" onClick={play} aria-label={run.playing ? 'Pause' : 'Play'}>
          <Icon name={run.playing ? 'pause' : 'play'} size={18} />
          <span>{run.playing ? 'Pause' : run.state.done ? 'Replay' : run.state.t > 0 ? 'Resume' : 'Play'}</span>
        </button>
        <button
          className="tool small"
          onClick={() => {
            setPlaying(el, false);
            stepOnce(el);
            keep();
            onRun();
            setTick((n) => n + 1);
          }}
          aria-label="Step forward"
          data-tip="Step forward"
          disabled={run.state.done}
        >
          <Icon name="stepf" size={16} />
        </button>
        <button
          className="tool small"
          onClick={() => {
            resetRun(el);
            const back = resetPatch(el);
            if (back) onParams(back, false);
            onRun();
            setTick((n) => n + 1);
          }}
          aria-label="Reset"
          data-tip="Back to the start"
        >
          <Icon name="retry" size={16} />
        </button>
        <div className="seg sim-speed" role="radiogroup" aria-label="Speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={run.speed === s ? 'on' : ''}
              role="radio"
              aria-checked={run.speed === s}
              onClick={() => {
                setSpeed(el, s);
                setTick((n) => n + 1);
              }}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
      <div className="sim-time">t = {run.state.t.toFixed(2)} s{run.state.done ? ' · finished' : ''}</div>
      </>
      )}

      <div className="sim-scroll">
        {el.kind === 'molecule' && (
          <section>
            <h4>Any compound</h4>
            <form
              className="sim-lookup"
              onSubmit={(e) => {
                e.preventDefault();
                void lookUp();
              }}
            >
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Name, e.g. paracetamol"
                aria-label="Compound name"
              />
              <button type="submit" className="toggle-chip" disabled={!query.trim() || looking === 'busy'}>
                {looking === 'busy' ? 'Finding…' : 'Draw'}
              </button>
            </form>
            {looking !== 'idle' && looking !== 'busy' && <p className="sim-lookup-error">{looking}</p>}
          </section>
        )}
        {def.presets && def.presets.length > 0 && (
          <section>
            <h4>Try</h4>
            <div className="sim-presets">
              {def.presets.map((pr) => (
                <button key={pr.label} className="toggle-chip" onClick={() => onParams(pr.params, false)}>
                  {pr.label}
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <h4>Settings</h4>
          {controls.map((c) => {
            if (c.type === 'range') {
              const v = typeof p[c.key] === 'number' ? (p[c.key] as number) : c.min;
              return (
                <label key={c.key} className="sim-range">
                  <span className="sim-row">
                    <span>{c.label}</span>
                    <b>{fmtValue(c, v)}</b>
                  </span>
                  <input
                    type="range"
                    min={c.min}
                    max={c.max}
                    step={c.step}
                    value={v}
                    onChange={(e) => onParams({ [c.key]: Number(e.target.value) }, true)}
                    onPointerUp={onCommit}
                    onKeyUp={onCommit}
                    onBlur={onCommit}
                  />
                </label>
              );
            }
            if (c.type === 'choice') {
              // Choices whose values look like numbers are stored as numbers.
              const cur = String(p[c.key]);
              return (
                <div key={c.key} className="sim-choice">
                  <span>{c.label}</span>
                  <div className="seg wrap" role="radiogroup" aria-label={c.label}>
                    {c.options.map((o) => (
                      <button
                        key={o.value}
                        className={cur === o.value ? 'on' : ''}
                        role="radio"
                        aria-checked={cur === o.value}
                        onClick={() =>
                          onParams({ [c.key]: typeof p[c.key] === 'number' ? Number(o.value) : o.value }, false)
                        }
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }
            const on = p[c.key] === true;
            return (
              <button
                key={c.key}
                className={`switch-btn sim-toggle${on ? ' on' : ''}`}
                role="switch"
                aria-checked={on}
                onClick={() => onParams({ [c.key]: !on }, false)}
              >
                <span>{c.label}</span>
                <i className="switch" />
              </button>
            );
          })}
        </section>

        {formulas.length > 0 && (
          <section>
            <h4>Working</h4>
            <div className="sim-formulas">
              {formulas.map((f) => (
                <div key={f.label} className="sim-formula">
                  <span>{f.label}</span>
                  <Tex latex={f.tex} display />
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
