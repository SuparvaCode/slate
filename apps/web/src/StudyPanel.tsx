/**
 * The AI study panel: ask for notes and watch the teacher plan and write them; summarise a YouTube
 * video; find pictures and put them on the board; and keep the study habit going.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { fetchVideo, searchVideos, youtubeId } from './notes/api';
import type { Shrunk } from './notes/image';
import type { NotesWriter, Speed } from './notes/session';
import {
  clearProfile, completeReview, dayLabel, dueReviews, loadProfile, mergeProfile, nextReview, onStudy, profileLabel, recentDays, streak,
} from './notes/study';
import type { VideoDetails, VideoHit } from './notes/types';
import './study.css';
import { useBack } from './back';

export type StudyTab = 'notes' | 'video' | 'habit';

export interface PlacedImage extends Shrunk {
  title?: string;
  source?: string;
}

interface Props {
  writer: NotesWriter;
  tab: StudyTab;
  onTab: (t: StudyTab) => void;
  /** A board point the notes or picture should go near (from the board's menu). */
  at: [number, number] | null;
  collapsed: boolean;
  onCollapse: (c: boolean) => void;
  onClose: () => void;
  /** Writes revision notes from what is already on the board; missing when the board is empty. */
  onSummariseBoard?: () => void;
  /** Work marked on the board that a typed question is about, answered beside it, not as notes. */
  ask?: { digest: string; at: [number, number]; label: string } | null;
  onClearAsk?: () => void;
  notify: (msg: string) => void;
}

// --- icons (kept here so this panel does not touch the shared icon set) ------------------------------

const PATH: Record<string, ReactNode> = {
  notes: <path d="M5 19.5l.8-3.6L16.4 5.3a2 2 0 012.9 2.9L8.7 18.8zM14.4 7.3l2.9 2.9" />,
  video: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="3.2" />
      <path d="M10.5 9.5v5l4.3-2.5z" fill="currentColor" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2.6" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="M4 17l4.8-4.6 3.4 3.1 2.6-2.3L20 17.5" />
    </>
  ),
  flame: <path d="M12 20.5c-3.6 0-6-2.4-6-5.6 0-3.7 3.3-5.3 3.6-9.4 2.4 1.5 3.6 3.6 3.7 5.6 1-.6 1.6-1.6 1.8-2.8 1.8 1.7 2.9 4 2.9 6.4 0 3.4-2.5 5.8-6 5.8z" />,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  min: <path d="M6 12h12" />,
  max: <path d="M7 15l5-5 5 5" />,
  pause: <path d="M9 6.5v11M15 6.5v11" strokeWidth={2.4} />,
  play: <path d="M8 6v12l10-6z" fill="currentColor" />,
  stop: <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M15.5 15.5L20 20" />
    </>
  ),
  upload: <path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19h14" />,
  check: <path d="M5.5 12.5l4 4 9-9" />,
  send: <path d="M5 12h12M12.5 6.5L18 12l-5.5 5.5" />,
  link: <path d="M10 14a4 4 0 005.7 0l2.8-2.8a4 4 0 00-5.7-5.7L11.5 6.8M14 10a4 4 0 00-5.7 0l-2.8 2.8a4 4 0 005.7 5.7l1.3-1.3" />,
  globe: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M4 12h16M12 4c2.4 2.3 3.5 5 3.5 8s-1.1 5.7-3.5 8c-2.4-2.3-3.5-5-3.5-8s1.1-5.7 3.5-8z" />
    </>
  ),
};

function I({ n, size = 18 }: { n: keyof typeof PATH; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATH[n]}
    </svg>
  );
}

const Spinner = ({ size = 16 }: { size?: number }) => <span className="st-spin" style={{ width: size, height: size }} aria-hidden="true" />;

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

const duration = (s: number) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '');

const useStudy = () => {
  const [, setN] = useState(0);
  useEffect(() => onStudy(() => setN((n) => n + 1)), []);
};

// --- the panel -------------------------------------------------------------------------------------

export function StudyPanel(props: Props) {
  const { writer, tab, onTab, collapsed, onCollapse, onClose } = props;
  useBack(!collapsed, () => onCollapse(true));
  const st = useSyncExternalStore(writer.subscribe, writer.get);
  useStudy();
  const busy = st.phase === 'planning' || st.phase === 'writing' || st.phase === 'asking';

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === 'Escape' && !(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA'))) onCollapse(true);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onCollapse]);

  if (collapsed) {
    const label =
      st.phase === 'planning' ? 'Planning notes…'
      : st.phase === 'writing' ? `Writing ${st.sections[st.section]?.heading ?? 'notes'}`
      : st.phase === 'paused' ? 'Notes paused'
      : st.phase === 'asking' ? 'Answering your question…'
      : st.phase === 'done' ? 'Notes finished'
      : 'AI study';
    return (
      <div className="st-pill" role="status">
        <button className="st-pill-main" onClick={() => onCollapse(false)} aria-label="Open AI study">
          {busy ? <Spinner size={14} /> : <span className="st-spark">✦</span>}
          <span className="st-pill-label">{label}</span>
          {st.phase === 'writing' && st.sections.length > 0 && (
            <span className="st-pill-count">{Math.min(st.section + 1, st.sections.length)}/{st.sections.length}</span>
          )}
        </button>
        {st.phase === 'writing' && (
          <button className="st-icon" onClick={() => writer.pause()} aria-label="Pause writing"><I n="pause" size={16} /></button>
        )}
        {st.phase === 'paused' && (
          <button className="st-icon" onClick={() => writer.resume()} aria-label="Continue writing"><I n="play" size={16} /></button>
        )}
        {(busy || st.phase === 'paused') && (
          <button className="st-icon" onClick={() => writer.stop()} aria-label="Stop writing"><I n="stop" size={14} /></button>
        )}
      </div>
    );
  }

  return (
    <div className="sp-panel" role="dialog" aria-label="AI study" onPointerDown={(e) => e.stopPropagation()}>
      <div className="sp-head">
        <div className="st-tabs" role="tablist">
          {([
            ['notes', 'notes', 'Notes'],
            ['video', 'video', 'YouTube'],
            ['habit', 'flame', 'Habit'],
          ] as const).map(([t, icon, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={`st-tab${tab === t ? ' on' : ''}`} onClick={() => onTab(t)}>
              <I n={icon} size={16} />
              <span>{label}</span>
              {t === 'notes' && busy && <i className="st-dot" />}
            </button>
          ))}
        </div>
        <button className="st-icon" onClick={() => onCollapse(true)} aria-label="Minimise" data-tip="Minimise (Esc)"><I n="min" /></button>
        <button className="st-icon" onClick={onClose} aria-label="Close"><I n="close" /></button>
      </div>
      <div className="sp-body">
        {tab === 'notes' && <NotesTab {...props} />}
        {tab === 'video' && <VideoTab {...props} />}
        {tab === 'habit' && <HabitTab {...props} />}
      </div>
    </div>
  );
}

// --- notes -------------------------------------------------------------------------------------------

const MORE = [
  { heading: 'More examples', goal: 'Two more worked examples at exam level, different from the ones already written.', label: 'More examples' },
  { heading: 'Practice questions', goal: 'Five exam-style questions from easy to hard, then their short answers.', label: 'Practice questions' },
  { heading: 'Quick recap', goal: 'A one-glance recap: key definitions, every formula with its unit, and a checklist to tick.', label: 'One-page recap' },
  { heading: 'In simpler words', goal: 'Explain the hardest idea again in simpler words with an everyday example and a sketch.', label: 'Explain simpler' },
];

function suggestions(): string[] {
  const p = loadProfile();
  const who = p && (p.board || p.grade) ? `${p.board ? `${p.board} ` : ''}${p.grade ? `class ${p.grade} ` : ''}` : '';
  if (!who) {
    return [
      'Complete notes for class 10 rotational motion ICSE',
      'CBSE class 9 atoms and molecules notes',
      'Revise quadratic equations with examples',
    ];
  }
  const subject = p?.subjects[0] ?? 'Physics';
  return [`Complete ${who}${subject} notes on `, `Important questions for ${who}${subject}`, `Revise formulas for ${who}${subject}`];
}

function NotesTab({ writer, at, notify, onSummariseBoard, ask: askFocus, onClearAsk }: Props) {
  const st = useSyncExternalStore(writer.subscribe, writer.get);
  const [prompt, setPrompt] = useState('');
  const [question, setQuestion] = useState('');
  const [markedQ, setMarkedQ] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  const markedBox = useRef<HTMLInputElement>(null);
  const profile = loadProfile();
  const running = st.phase !== 'idle';

  useEffect(() => {
    if (!running) box.current?.focus();
  }, [running]);

  // Opening "Ask about this…" puts the cursor in its question, not in the notes prompt.
  useEffect(() => {
    if (askFocus) markedBox.current?.focus();
  }, [askFocus]);

  const askMarked = (e: FormEvent) => {
    e.preventDefault();
    const q = markedQ.trim();
    if (!q || !askFocus) return;
    setMarkedQ('');
    void writer
      .explain({ question: q, context: askFocus.digest, at: askFocus.at })
      .then((reply) => {
        if (reply) notify(reply);
      })
      .catch((err: unknown) => notify(err instanceof Error ? err.message : String(err)));
  };

  const marked = askFocus ? (
    <div className="st-marked">
      <div className="st-marked-head">
        <span className="st-marked-what" title={askFocus.digest}>
          <b>About what you marked:</b> {askFocus.label}
        </span>
        {onClearAsk && (
          <button type="button" className="st-icon" onClick={onClearAsk} aria-label="Stop asking about the marked part">
            <I n="close" size={14} />
          </button>
        )}
      </div>
      <form className="st-ask" onSubmit={askMarked}>
        <input
          ref={markedBox}
          value={markedQ}
          onChange={(e) => setMarkedQ(e.target.value)}
          placeholder={st.phase === 'asking' ? 'Answering…' : 'Ask a question about it…'}
          disabled={st.phase === 'asking'}
          maxLength={400}
        />
        <button
          className="st-go small"
          type="submit"
          disabled={!markedQ.trim() || st.phase === 'asking'}
          aria-label="Ask about the marked part"
        >
          {st.phase === 'asking' ? <Spinner size={14} /> : <I n="send" size={16} />}
        </button>
      </form>
      {st.phase === 'asking' && <p className="st-hint"><Spinner size={12} /> {st.reply || 'Writing the answer beside your work…'}</p>}
    </div>
  ) : null;

  const go = (e?: FormEvent) => {
    e?.preventDefault();
    const p = prompt.trim();
    if (p.length < 3) {
      notify('Say what you would like notes on, like "class 10 ICSE rotational motion".');
      return;
    }
    void writer.start({ prompt: p, at });
  };

  const ask = (e: FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (!q) return;
    setQuestion('');
    void writer.ask(q);
  };

  // After the notes: whatever the student types becomes one more section of the same notes.
  const [followUp, setFollowUp] = useState('');
  const more = (e: FormEvent) => {
    e.preventDefault();
    const text = followUp.trim();
    if (text.length < 3) return;
    setFollowUp('');
    const heading = text.split(/\s+/).slice(0, 5).join(' ').replace(/[.?!,:;]+$/, '').slice(0, 60);
    writer.more({ heading: heading.charAt(0).toUpperCase() + heading.slice(1), goal: text.slice(0, 250) });
  };

  if (!running) {
    return (
      <>
        {marked}
        <form className="st-compose" onSubmit={go}>
        <h3 className="st-title">What should we study?</h3>
        <p className="st-sub">
          Ask for notes and your AI teacher looks up the latest syllabus, finds space on the board and writes them by hand.
          {profile && profileLabel(profile) && <> Personalised for <b>{profileLabel(profile)}</b>.</>}
        </p>
        <div className="st-field">
          <textarea
            ref={box}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) go(e);
            }}
            placeholder="I want complete notes for class 10 rotational motion, ICSE"
            rows={3}
            maxLength={600}
          />
          <button className="st-go" type="submit" disabled={prompt.trim().length < 3} aria-label="Write notes">
            <I n="send" />
          </button>
        </div>
        <div className="st-chips">
          {suggestions().map((s) => (
            <button type="button" key={s} className="st-chip" onClick={() => { setPrompt(s); box.current?.focus(); }}>{s}</button>
          ))}
        </div>
        {onSummariseBoard && (
          <button type="button" className="sp-btn st-wide" onClick={onSummariseBoard}>✦ Summarise this board into revision notes</button>
        )}
        {st.resumable && (
          <div className="st-resume">
            <div>
              <b>{st.resumable.title}</b>
              <span>{st.resumable.left} {st.resumable.left === 1 ? 'section' : 'sections'} left</span>
            </div>
            <button type="button" className="sp-btn primary" onClick={() => writer.resume()}>Continue</button>
            <button type="button" className="sp-btn ghost" onClick={() => writer.forget()}>Dismiss</button>
          </div>
        )}
        {at && <p className="st-hint">The notes will start where you opened the menu.</p>}
        </form>
      </>
    );
  }

  const planning = st.phase === 'planning';
  const total = st.sections.length;
  const pct = st.phase === 'done' ? 100 : total ? Math.round((st.section / total) * 100) : 0;

  return (
    <div className="st-run">
      {marked}
      <div className="st-runhead">
        <div className="st-runtitle">
          <h3>{st.plan?.title ?? (st.topic || 'Getting ready…')}</h3>
          <div className="st-badges">
            {profileLabel(st.profile) && <span className="st-badge">{profileLabel(st.profile)}</span>}
            {st.subject && <span className="st-badge soft">{st.subject}</span>}
            {st.video && <span className="st-badge soft">{st.video.captions ? 'From the video’s words' : 'From the video’s topic'}</span>}
            {st.plan?.demo && <span className="st-badge warn" title="This server runs in demo mode: these are sample notes, not written by the AI.">Demo notes</span>}
          </div>
        </div>
      </div>

      {(planning || st.phase === 'error' || st.stages.length > 0) && !st.plan && (
        <ol className="st-stages">
          {st.stages.map((s, i) => (
            <li key={`${s.key}${i}`} className={s.done ? 'done' : 'now'}>
              <span className="st-stage-ico">{s.done ? <I n="check" size={14} /> : <Spinner size={14} />}</span>
              <span>{s.label}</span>
            </li>
          ))}
          {planning && st.stages.length === 0 && (
            <li className="now"><span className="st-stage-ico"><Spinner size={14} /></span><span>Connecting…</span></li>
          )}
        </ol>
      )}
      {planning && <Relax label={st.video ? 'Reading the whole video and planning' : 'Planning your notes'} />}
      {st.phase === 'writing' && st.waiting && (
        <Relax label={`Thinking through ${st.sections[st.section]?.heading ?? 'the next part'}`} />
      )}

      {st.sources.length > 0 && (
        <details className="st-sources" open={planning}>
          <summary><I n="globe" size={14} /> {st.sources.length} sources checked</summary>
          <ul>
            {st.sources.slice(0, 6).map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noopener noreferrer">
                  <span className="st-src-host">{host(s.url)}</span>
                  <span className="st-src-title">{s.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}

      {total > 0 && (
        <>
          <div className="st-progress" aria-label={`${pct}% written`}><i style={{ width: `${pct}%` }} /></div>
          <ol className="st-sections">
            {st.sections.map((s, i) => {
              const state = i < st.section || st.phase === 'done' ? 'done' : i === st.section ? 'now' : 'todo';
              return (
                <li key={`${s.heading}${i}`} className={state}>
                  <span className="st-sec-ico">
                    {state === 'done' ? <I n="check" size={13} /> : state === 'now' && (st.phase === 'writing' || st.phase === 'asking') ? <Spinner size={12} /> : i + 1}
                  </span>
                  <span className="st-sec-name">{s.heading}</span>
                </li>
              );
            })}
          </ol>
        </>
      )}

      {st.phase === 'error' && (
        <div className="sp-error" role="alert">
          <p>{st.error}</p>
          <div className="sp-row">
            {st.plan ? (
              <button className="sp-btn primary" onClick={() => writer.retry()}>Try again</button>
            ) : (
              <button className="sp-btn primary" onClick={() => writer.stop()}>Back</button>
            )}
            <button className="sp-btn ghost" onClick={() => writer.stop()}>Stop</button>
          </div>
        </div>
      )}

      {(st.phase === 'writing' || st.phase === 'paused' || st.phase === 'asking') && (
        <>
          <div className="st-controls">
            {st.phase === 'paused' ? (
              <button className="sp-btn primary" onClick={() => writer.resume()}><I n="play" size={14} /> Continue</button>
            ) : (
              <button className="sp-btn" onClick={() => writer.pause()} disabled={st.phase === 'asking'}><I n="pause" size={14} /> Pause</button>
            )}
            <button className="sp-btn ghost" onClick={() => writer.stop()}><I n="stop" size={12} /> Stop</button>
            <div className="st-speed" role="radiogroup" aria-label="Writing speed">
              {([1, 2, 4] as Speed[]).map((v) => (
                <button key={v} role="radio" aria-checked={st.speed === v} className={st.speed === v ? 'on' : ''} onClick={() => writer.setSpeed(v)}>
                  {v === 4 ? 'Fast' : `${v}×`}
                </button>
              ))}
            </div>
          </div>
          <form className="st-ask" onSubmit={ask}>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder={st.phase === 'asking' ? 'Answering…' : 'Stop and ask: “why is torque bigger far from the hinge?”'}
              disabled={st.phase === 'asking'}
              maxLength={400}
            />
            <button className="st-go small" type="submit" disabled={!question.trim() || st.phase === 'asking'} aria-label="Ask">
              {st.phase === 'asking' ? <Spinner size={14} /> : <I n="send" size={16} />}
            </button>
          </form>
          {st.phase === 'asking' && <p className="st-hint"><Spinner size={12} /> {st.reply || `Writing the answer to “${st.asking}” in the margin…`}</p>}
          {st.phase !== 'asking' && st.reply && <p className="st-hint">{st.reply}</p>}
        </>
      )}

      {st.phase === 'done' && (
        <div className="st-done">
          <p className="st-habit">✦ {st.plan?.habit || 'Nice work. Come back tomorrow to keep your streak going.'}</p>
          <p className="st-label">Keep going</p>
          <div className="st-chips">
            {MORE.map((m) => (
              <button key={m.heading} className="st-chip" onClick={() => writer.more({ heading: m.heading, goal: m.goal })}>{m.label}</button>
            ))}
          </div>
          <form className="st-ask" onSubmit={more}>
            <input
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              placeholder="Ask for more: “add numericals on power”"
              maxLength={250}
            />
            <button className="st-go small" type="submit" disabled={followUp.trim().length < 3} aria-label="Add to these notes">
              <I n="send" size={16} />
            </button>
          </form>
          <NextRevision />
          <div className="sp-row">
            <button className="sp-btn" onClick={() => writer.forget()}>New notes</button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Small things to do while the AI thinks, so a long wait feels like a breather, not a stall. */
const RELAX_TIPS = [
  'Breathe in for 4, hold for 4, out for 4.',
  'Try saying the last formula out loud without looking.',
  'Roll your shoulders back and sit up straight.',
  'Sip some water. Your brain is mostly water too.',
  'Look at something far away for 20 seconds to rest your eyes.',
  'Guess what the next section will cover, then check.',
];

/** Shown while the AI plans or writes a section: a slow breathing ring and a changing tip. */
function Relax({ label }: { label: string }) {
  const [tip, setTip] = useState(() => Math.floor(Math.random() * RELAX_TIPS.length));
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setSecs((s) => s + 1), 1000);
    const r = window.setInterval(() => setTip((i) => (i + 1) % RELAX_TIPS.length), 7000);
    return () => {
      window.clearInterval(t);
      window.clearInterval(r);
    };
  }, []);
  return (
    <div className="st-relax" role="status" aria-live="polite">
      <span className="st-breathe" aria-hidden="true" />
      <div className="st-relax-text">
        <b>{label}{secs >= 3 ? ` · ${secs}s` : ''}</b>
        <span key={tip} className="st-relax-tip">{RELAX_TIPS[tip]}</span>
      </div>
    </div>
  );
}

function NextRevision() {
  const next = nextReview();
  if (!next) return null;
  return <p className="st-hint">Revision quiz on <b>{next.review.topic}</b> is due {dayLabel(next.day)}.</p>;
}

// --- YouTube -----------------------------------------------------------------------------------------

function VideoTab({ writer, at, onTab, notify }: Props) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<VideoHit[] | null>(null);
  const [video, setVideo] = useState<VideoDetails | null>(null);
  const [transcript, setTranscript] = useState('');
  const [focus, setFocus] = useState('');
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => () => ctrl.current?.abort(), []);

  const open = async (link: string) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    setVideo(null);
    try {
      setVideo(await fetchVideo(link, c.signal));
      setResults(null);
    } catch (e) {
      if (!c.signal.aborted) notify(e instanceof Error ? e.message : String(e));
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    if (youtubeId(q)) {
      void open(q);
      return;
    }
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLoading(true);
    setVideo(null);
    try {
      setResults(await searchVideos(q, c.signal));
    } catch (err) {
      if (!c.signal.aborted) notify(err instanceof Error ? err.message : String(err));
    } finally {
      if (!c.signal.aborted) setLoading(false);
    }
  };

  const summarise = () => {
    if (!video) return;
    void writer.start({ prompt: focus.trim(), video: video.id, transcript: transcript.trim(), at });
    onTab('notes');
  };

  return (
    <div className="st-video">
      <h3 className="st-title">Summarise a video</h3>
      <p className="st-sub">Paste a YouTube link, or search for a lesson. The AI turns it into handwritten summary notes on your board.</p>
      <form className="st-search" onSubmit={submit}>
        <I n={youtubeId(input) ? 'link' : 'search'} size={16} />
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="youtube.com/watch?v=…  or  “moment of force class 10”" maxLength={300} autoFocus />
        <button className="sp-btn primary" type="submit" disabled={!input.trim() || loading}>{loading ? <Spinner size={14} /> : youtubeId(input) ? 'Open' : 'Search'}</button>
      </form>

      {loading && !video && (
        <div className="st-vlist" aria-hidden="true">
          {[0, 1, 2].map((i) => <div key={i} className="st-vcard skel"><i className="st-vthumb" /><span><i /><i /></span></div>)}
        </div>
      )}

      {results && !video && (
        results.length ? (
          <div className="st-vlist">
            {results.map((v) => (
              <button key={v.id} className="st-vcard" onClick={() => void open(v.url)}>
                <img className="st-vthumb" src={v.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
                <span><b>{v.title}</b></span>
              </button>
            ))}
          </div>
        ) : <p className="st-hint">No videos found. Try other words, or paste a link.</p>
      )}

      {video && (
        <div className="st-vpick">
          <div className="st-vhero">
            <img src={video.thumb} alt="" referrerPolicy="no-referrer" />
            {video.length > 0 && <span className="st-vlen">{duration(video.length)}</span>}
          </div>
          <b className="st-vtitle">{video.title}</b>
          <span className="st-vch">{video.channel}</span>
          {video.captions ? (
            <p className="st-ok"><I n="check" size={14} /> Captions found. The summary follows what is said in the video.</p>
          ) : (
            <div className="st-warn">
              <p>
                YouTube didn’t share this video’s captions. For a summary of exactly what is said, open the video, choose
                <b> ⋯ › Show transcript</b>, copy it and paste it here. Or skip this and the AI summarises from the title and the web.
              </p>
              <textarea value={transcript} onChange={(e) => setTranscript(e.target.value)} rows={4} placeholder="Paste the transcript (optional)" maxLength={30000} />
            </div>
          )}
          <input className="st-plain" value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="Anything to focus on? (optional) e.g. “only the numericals”" maxLength={300} />
          <div className="sp-row">
            <button className="sp-btn primary" onClick={summarise}>Summarise into notes</button>
            <button className="sp-btn ghost" onClick={() => setVideo(null)}>Back</button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- habit -------------------------------------------------------------------------------------------

const BOARDS = ['ICSE', 'ISC', 'CBSE', 'IGCSE', 'IB', 'State board', 'JEE', 'NEET'];

function HabitTab({ writer, onTab }: Props) {
  useStudy();
  const s = streak();
  const days = recentDays(7);
  const due = dueReviews();
  const next = nextReview();
  const p = loadProfile();
  const [board, setBoard] = useState(p?.board ?? '');
  const [grade, setGrade] = useState(p?.grade ?? '');

  const quiz = (r: (typeof due)[number]) => {
    const who = [r.review.profile.board, r.review.profile.grade && `class ${r.review.profile.grade}`].filter(Boolean).join(' ');
    void writer.start({ prompt: `Quick revision quiz with answers on ${r.review.topic} (${r.review.title}) for ${who}. Revision ${r.step + 1} of 3.` });
    completeReview(r.review.id);
    onTab('notes');
  };

  const saved = (p?.board ?? '') === board && (p?.grade ?? '') === grade;
  const [justSaved, setJustSaved] = useState(false);
  useEffect(() => {
    if (!justSaved) return;
    const t = setTimeout(() => setJustSaved(false), 1800);
    return () => clearTimeout(t);
  }, [justSaved]);

  return (
    <div className="st-habit-tab">
      <section className="st-streak">
        <div className="st-streak-top">
          <span className={`st-flame${s.today ? ' lit' : ''}`}><I n="flame" size={28} /></span>
          <div>
            <b>{s.days} {s.days === 1 ? 'day' : 'days'}</b>
            <span>{s.today ? 'You studied today. Keep it up!' : s.days ? 'Study today to keep your streak.' : 'Write notes on any topic to start a streak.'}</span>
          </div>
        </div>
        <ol className="st-week" aria-label="Last 7 days">
          {days.map((d, i) => (
            <li key={d.day} className={`${d.studied ? 'on' : ''}${i === days.length - 1 ? ' today' : ''}`} title={d.day} aria-label={`${d.day}${d.studied ? ', studied' : ''}`}>
              <i>{d.studied && <I n="check" size={13} />}</i>
              {d.label}
            </li>
          ))}
        </ol>
      </section>

      <section className="st-block">
        <h4 className="st-label">Revision</h4>
        {due.length ? (
          <ul className="st-due">
            {due.map((r) => (
              <li key={r.review.id}>
                <div>
                  <b>{r.review.topic}</b>
                  <span>Revision {r.step + 1} of 3 · {r.review.subject}</span>
                </div>
                <button className="sp-btn primary" onClick={() => quiz(r)}>Quiz me</button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="st-empty-card">
            {next ? (
              <p>Nothing due today. Next up: <b>{next.review.topic}</b> {dayLabel(next.day)}.</p>
            ) : (
              <p>After each set of notes you get a short quiz 1, 3 and 7 days later, so it sticks.</p>
            )}
          </div>
        )}
      </section>

      <section className="st-block">
        <h4 className="st-label">About you</h4>
        <p className="st-hint st-hint-block">Notes and quizzes follow your board and class. The AI also picks these up from your requests.</p>
        <form
          className="st-profile"
          onSubmit={(e) => {
            e.preventDefault();
            if (!board && !grade) clearProfile();
            else mergeProfile({ board, grade, subjects: p?.subjects ?? [] });
            setJustSaved(true);
          }}
        >
          <label>
            <span>Board</span>
            <select value={board} onChange={(e) => setBoard(e.target.value)}>
              <option value="">Not set</option>
              {BOARDS.map((b) => <option key={b} value={b}>{b}</option>)}
              {board && !BOARDS.includes(board) && <option value={board}>{board}</option>}
            </select>
          </label>
          <label>
            <span>Class</span>
            <input value={grade} onChange={(e) => setGrade(e.target.value.replace(/[^0-9a-zA-Z ]/g, '').slice(0, 12))} placeholder="e.g. 10" />
          </label>
          <button type="submit" className={`sp-btn${saved ? '' : ' primary'}`} disabled={saved && !justSaved}>
            {justSaved ? <><I n="check" size={15} /> Saved</> : 'Save'}
          </button>
        </form>
        {p?.subjects.length ? <p className="st-hint st-hint-block">Subjects: {p.subjects.join(', ')}</p> : null}
      </section>
    </div>
  );
}
