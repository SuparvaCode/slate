import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from './icons';
import { copyText } from './copy';
import type { AiEl } from './model';
import { ReadChip } from './ReadChip';
import { Tex } from './Tex';
import type { CalcResult, Verification, Work, WorkItem } from './types';
import { useBack } from './back';

const OP_LABEL: Record<string, string> = {
  evaluate: 'Evaluate', simplify: 'Simplify', expand: 'Expand', factor: 'Factor', solve: 'Solve',
  diff: 'Differentiate', integrate: 'Integrate', limit: 'Limit', series: 'Series',
  numeric: 'Decimal value', check: 'Check equal',
};

const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/** A short plain-language description of what a calculator call was asked to do. */
function detailOf(op: string, a: Record<string, unknown>): string {
  const v = str(a.var);
  switch (op) {
    case 'solve':
      return v ? `for ${v}` : '';
    case 'diff':
      return `${v ? `d/d${v}` : ''}${Number(a.order) > 1 ? `, order ${a.order}` : ''}`;
    case 'integrate':
      return a.lower !== undefined ? `from ${str(a.lower)} to ${str(a.upper)}${v ? ` in ${v}` : ''}` : v ? `d${v}` : '';
    case 'limit':
      return `${v || 'x'} → ${str(a.point) || '0'}`;
    case 'series':
      return `about ${str(a.point) || '0'}${a.order ? `, ${a.order} terms` : ''}`;
    case 'numeric':
      return a.order ? `${a.order} digits` : '';
    case 'check':
      return a.other ? `= ${str(a.other)} ?` : '';
    default:
      return '';
  }
}

const BADGES: Record<Verification, { cls: string; icon: 'check' | 'calc' | 'alert'; text: string; tip: string }> = {
  checked: { cls: 'ok', icon: 'check', text: 'Checked', tip: 'A calculator check confirmed this answer' },
  computed: { cls: 'computed', icon: 'calc', text: 'Computed', tip: 'The calculator produced this answer' },
  none: { cls: 'unchecked', icon: 'alert', text: 'Not checked', tip: 'No calculation confirmed this answer' },
};

function Badge({ level }: { level: Verification }) {
  const b = BADGES[level];
  return (
    <span className={`badge ${b.cls}`} title={b.tip}>
      <Icon name={b.icon} size={12} />
      {b.text}
    </span>
  );
}

function Spinner() {
  return <span className="spin" aria-hidden="true" />;
}

function CalcOut({ op, result }: { op: string; result: CalcResult }) {
  if (result.error) {
    return (
      <div className="calc-out err">
        <Icon name="alert" size={13} /> {result.error}
      </div>
    );
  }
  if (op === 'check') {
    return (
      <div className={`calc-out ${result.equal ? 'ok' : 'err'}`}>
        <Icon name={result.equal ? 'check' : 'alert'} size={13} />
        {result.equal ? ' Equal' : ' Not equal'}
        {result.note && <span className="faint"> · {result.note}</span>}
      </div>
    );
  }
  return (
    <div className="calc-out">
      <span className="eq">=</span>
      {result.latex ? <Tex latex={result.latex} /> : <code>{result.result}</code>}
      {result.approx && <span className="approx">≈ {result.approx}</span>}
    </div>
  );
}

function Item({ item }: { item: WorkItem }) {
  if (item.kind === 'think') return <p className="think">{item.text.trim()}</p>;
  if (item.kind === 'wait') {
    return (
      <div className="wait">
        <Icon name="clock" size={13} /> Waited {item.seconds}s for the {item.reason.toLowerCase()}
      </div>
    );
  }
  const detail = detailOf(item.op, item.args);
  return (
    <div className="calc">
      <div className="calc-head">
        <Icon name="calc" size={13} />
        <span className="calc-op">{OP_LABEL[item.op] ?? item.op}</span>
        {item.ms !== undefined && <span className="calc-ms">{item.ms} ms</span>}
      </div>
      <div className="calc-in">
        <code>{str(item.args.expr)}</code>
        {detail && <span className="calc-detail">{detail}</span>}
      </div>
      {item.result ? (
        <CalcOut op={item.op} result={item.result} />
      ) : (
        <div className="calc-out faint">
          <Spinner /> Calculating
        </div>
      )}
    </div>
  );
}

function phaseText(w: Work, now: number): string {
  const secs = ((now - w.startedAt) / 1000).toFixed(1);
  switch (w.phase) {
    case 'reading':
      return 'Reading your writing';
    case 'thinking':
      return 'Thinking';
    case 'calculating':
      return 'Calculating';
    case 'waiting':
      return 'Waiting for the rate limit';
    case 'writing':
      return 'Writing on the board';
    case 'done':
      return w.answer ? `Done in ${(w.answer.ms / 1000).toFixed(1)}s` : 'Done';
    case 'error':
      return `Stopped after ${secs}s`;
  }
}

interface Props {
  work?: Work;
  el?: AiEl;
  rect: { x: number; y: number; w: number; h: number };
  collapsed: boolean;
  onClose: () => void;
  onCollapse: () => void;
  onReset: () => void;
  onMove: (pos: { x: number; y: number }) => void;
  onRetry?: () => void;
  onFeedback?: (correct: boolean) => void;
  onShow?: () => void;
  /** Re-solves from the reading the user picked or typed. */
  onPickRead?: (latex: string) => void;
  /** Asks the teacher to explain one step of the solution in more detail. */
  onExplainStep?: (index: number) => void;
  typeset?: boolean;
  boxed?: boolean;
  onStyle?: (patch: { typeset?: boolean; boxed?: boolean }) => void;
}

/** The floating window that shows how an answer was worked out. */
export function WorkWindow({
  work, el, rect, collapsed, onClose, onCollapse, onReset, onMove, onRetry, onFeedback, onShow,
  typeset, boxed, onStyle, onPickRead, onExplainStep,
}: Props) {
  useBack(!collapsed, onClose);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const dragFrom = useRef<{ dx: number; dy: number } | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  const running = !!work && work.phase !== 'done' && work.phase !== 'error';

  // A live clock while working, so the elapsed time in the title moves.
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(t);
  }, [running]);

  // Follow new steps as they arrive, unless the user has scrolled up to read.
  useLayoutEffect(() => {
    const s = scroller.current;
    if (s && stick.current) s.scrollTop = s.scrollHeight;
  }, [work]);

  const onTitleDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic events have no active pointer
    }
    dragFrom.current = { dx: e.clientX - rect.x, dy: e.clientY - rect.y };
    setDrag({ x: rect.x, y: rect.y });
  };
  const onTitleMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragFrom.current;
    if (d) setDrag({ x: e.clientX - d.dx, y: e.clientY - d.dy });
  };
  const onTitleUp = () => {
    if (dragFrom.current && drag) onMove(drag);
    dragFrom.current = null;
    setDrag(null);
  };

  const copy = () => {
    const a = work?.answer;
    if (!a) return;
    const cols = (a.columns ?? []).filter((c) => c.lines.length > 0);
    const text = cols.length >= 2
      ? cols.map((c) => [c.heading, ...c.lines].filter(Boolean).join('\n')).join('\n\n')
      : a.steps.length ? a.steps.join('\n') : a.latex;
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };

  const x = drag?.x ?? rect.x;
  const y = drag?.y ?? rect.y;
  const answer = work?.answer;

  return (
    <div
      className={`work${collapsed ? ' collapsed' : ''}${drag ? ' dragging' : ''}`}
      style={{ left: x, top: y, width: rect.w, height: rect.h }}
      role="dialog"
      aria-label="Work"
      onPointerDown={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <div
        className="work-title"
        onPointerDown={onTitleDown}
        onPointerMove={onTitleMove}
        onPointerUp={onTitleUp}
        onPointerCancel={onTitleUp}
        onDoubleClick={(e) => !(e.target as HTMLElement).closest('button') && onCollapse()}
      >
        <div className="lights">
          <button className="light red" onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 12 12"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5" /></svg>
          </button>
          <button className="light yellow" onClick={onCollapse} aria-label={collapsed ? 'Expand' : 'Minimise'}>
            <svg viewBox="0 0 12 12"><path d="M3 6h6" /></svg>
          </button>
          <button className="light green" onClick={onReset} aria-label="Reset window">
            <svg viewBox="0 0 12 12"><path d="M3.6 8.4V4.6h3.8M8.4 3.6v3.8H4.6" /></svg>
          </button>
        </div>
        <div className="work-name">Work</div>
        <div className={`work-phase ${work?.phase ?? 'idle'}`}>
          {running && <Spinner />}
          {work?.phase === 'done' && answer?.verification === 'checked' && <Icon name="check" size={13} />}
          {work?.phase === 'error' && <Icon name="alert" size={13} />}
          <span>{work ? phaseText(work, now) : 'Idle'}</span>
        </div>
      </div>

      {!collapsed && (
        <>
          <div
            className="work-body"
            ref={scroller}
            onScroll={(e) => {
              const s = e.currentTarget;
              stick.current = s.scrollHeight - s.scrollTop - s.clientHeight < 40;
            }}
          >
            {!work ? (
              <div className="work-empty">
                <Icon name="sparkle" size={26} />
                <div className="title">No work yet</div>
                <div>
                  Choose <b>Solve</b> and circle your writing. Every step and calculation appears here
                  while the answer is written on the board.
                </div>
              </div>
            ) : (
              <>
                <section>
                  <div className="sec-head">
                    <span>Read</span>
                    <span className={`mode-tag ${work.mode}`}>{work.mode === 'solution' ? 'Solution' : 'Answer'}</span>
                  </div>
                  {work.read ? (
                    <>
                      {work.read.latex && onPickRead ? (
                        <ReadChip
                          docked
                          read={work.read.latex}
                          alternatives={work.read.alternatives}
                          confidence={work.read.confidence}
                          corrected={work.read.corrected}
                          onPick={onPickRead}
                        />
                      ) : (
                        <div className="read-tex">
                          {work.read.latex ? <Tex latex={work.read.latex} display /> : work.read.text || <span className="faint">Nothing readable</span>}
                        </div>
                      )}
                      {work.read.uncertain.length > 0 && (
                        <div className="warn">Unsure about {work.read.uncertain.join('; ')}</div>
                      )}
                      <div className="meta">
                        {work.read.model.split('/').pop()} · {(work.read.ms / 1000).toFixed(1)}s
                      </div>
                    </>
                  ) : (
                    <div className="faint row">
                      <Spinner /> Reading your handwriting
                    </div>
                  )}
                </section>

                {work.items.length > 0 && (
                  <section>
                    <div className="sec-head">
                      <span>Working</span>
                      <span className="faint">
                        {work.items.filter((i) => i.kind === 'calc').length} calculations
                      </span>
                    </div>
                    <div className="timeline">
                      {work.items.map((item, i) => (
                        <Item key={i} item={item} />
                      ))}
                    </div>
                  </section>
                )}

                {answer && (
                  <section className="answer">
                    <div className="sec-head">
                      <span>{answer.steps.length || answer.columns?.length ? 'Solution' : 'Answer'}</span>
                      <Badge level={answer.verification ?? (answer.verified ? 'computed' : 'none')} />
                      <button className="card-copy" onClick={copy} aria-label="Copy answer as LaTeX">
                        <Icon name={copied ? 'check' : 'copy'} size={14} />
                        <span>{copied ? 'Copied' : 'Copy'}</span>
                      </button>
                    </div>
                    {answer.columns && answer.columns.length >= 2 ? (
                      <div className="wcols">
                        {answer.columns.map((c, i) => (
                          <div className="wcol" key={i}>
                            {c.heading && <div className="whead">{c.heading}</div>}
                            {c.lines.map((line, j) => (
                              <div className="wline" key={j}>
                                <Tex latex={line} />
                              </div>
                            ))}
                          </div>
                        ))}
                      </div>
                    ) : answer.steps.length > 0 ? (
                      <ol className="steps">
                        {answer.steps.map((s, i) => (
                          <li key={i}>
                            <Tex latex={s} />
                            {onExplainStep && !running && (
                              <button className="step-ask" onClick={() => onExplainStep(i)} aria-label={`Explain step ${i + 1}`} data-tip="Explain this step">
                                ?
                              </button>
                            )}
                          </li>
                        ))}
                      </ol>
                    ) : answer.latex ? (
                      <div className="answer-tex">
                        <Tex latex={answer.latex} display />
                      </div>
                    ) : (
                      <div className="faint">Nothing to write for this.</div>
                    )}
                    {answer.note && <p className="note">{answer.note}</p>}
                    {onStyle && (
                      <div className="style-row">
                        <div className="seg" role="radiogroup" aria-label="Answer style">
                          <button className={typeset ? '' : 'on'} role="radio" aria-checked={!typeset} onClick={() => onStyle({ typeset: false })}>
                            Handwritten
                          </button>
                          <button className={typeset ? 'on' : ''} role="radio" aria-checked={!!typeset} onClick={() => onStyle({ typeset: true })}>
                            Typeset
                          </button>
                        </div>
                        <button
                          className={`toggle-chip${boxed ? ' on' : ''}`}
                          role="switch"
                          aria-checked={!!boxed}
                          onClick={() => onStyle({ boxed: !boxed })}
                        >
                          Box
                        </button>
                      </div>
                    )}
                  </section>
                )}

                {work.phase === 'error' && (
                  <section className="failed">
                    <div className="sec-head">
                      <span>Couldn't solve</span>
                    </div>
                    <p>{work.error}</p>
                  </section>
                )}
              </>
            )}
          </div>

          {work && (
            <div className="work-foot">
              {answer?.saved && onFeedback && !el?.feedback ? (
                <div className="fb">
                  <span>Correct?</span>
                  <button className="pill-btn" onClick={() => onFeedback(true)}>Yes</button>
                  <button className="pill-btn" onClick={() => onFeedback(false)}>No</button>
                </div>
              ) : (
                <div className="fb faint">
                  {el?.feedback ? `Marked ${el.feedback === 'correct' ? 'correct' : 'wrong'}` : ''}
                </div>
              )}
              <div className="foot-actions">
                {answer && (
                  <button className="tool small" onClick={copy} aria-label="Copy LaTeX" data-tip={copied ? 'Copied' : 'Copy LaTeX'}>
                    <Icon name={copied ? 'check' : 'copy'} size={17} />
                  </button>
                )}
                {onShow && (
                  <button className="tool small" onClick={onShow} aria-label="Show on board" data-tip="Show on board">
                    <Icon name="target" size={17} />
                  </button>
                )}
                {onRetry && !running && (
                  <button className="tool small" onClick={onRetry} aria-label="Solve again" data-tip="Solve again">
                    <Icon name="retry" size={17} />
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
