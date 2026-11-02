import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';
import type { IconName } from './icons';
import { Tex } from './Tex';
import { clearMemory, entryText, loadMemory, onMemory, topicCounts } from './memory';
import type { MemoryEntry, Subject } from './memory';
import './progress.css';
import { useBack } from './back';

interface Props {
  onClose: () => void;
  /** Opens AI Diagram with a request for the next step in a topic. */
  onPractice: (prompt: string) => void;
}

const KIND_ICON: Record<MemoryEntry['kind'], IconName> = { solve: 'sparkle', diagram: 'wand', sim: 'play' };
const KIND_LABEL: Record<MemoryEntry['kind'], string> = { solve: 'Solved', diagram: 'Diagram', sim: 'Simulator' };
const SUBJECTS: Subject[] = ['Physics', 'Maths', 'Chemistry', 'General'];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function ago(t: number, now: number): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : d < 7 ? `${d} days ago` : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** What this board has covered: topics by subject, recent work, and a way to keep going. */
export function ProgressPanel({ onClose, onPractice }: Props) {
  useBack(true, onClose);
  const [list, setList] = useState<MemoryEntry[]>(loadMemory);
  const [confirm, setConfirm] = useState(false);
  const [now] = useState(() => Date.now());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => onMemory(() => setList(loadMemory())), []);

  useEffect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as Element | null;
      // The toolbar button toggles the panel itself, so a press on it is not "outside".
      if (ref.current?.contains(t) || t?.closest?.('.topright')) return;
      onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key);
    };
  }, [onClose]);

  const topics = topicCounts(list);
  const total = list.reduce((n, m) => n + m.times, 0);
  const max = Math.max(1, ...topics.map((t) => t.count));
  const groups = SUBJECTS.map((s) => ({ s, topics: topics.filter((t) => t.subject === s) })).filter((g) => g.topics.length > 0);

  const practice = (topic: string) => {
    const last = list.find((m) => m.topic === topic);
    const name = topic === 'Other' ? 'practice' : topic.toLowerCase();
    onPractice(last ? `A ${name} diagram one step harder than: ${entryText(last)}` : `A ${name} diagram for practice`);
  };

  return (
    <div ref={ref} className="pg-panel" role="dialog" aria-label="Board progress">
      <header className="pg-head">
        <div>
          <h3>This board</h3>
          <p>{total ? `${plural(total, 'thing')} worked on, across ${plural(topics.length, 'topic')}` : 'Nothing worked on yet'}</p>
        </div>
        <button className="tool small" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </header>

      {list.length === 0 ? (
        <div className="pg-empty">
          <div className="pg-empty-ico"><Icon name="progress" size={22} /></div>
          <p>
            Solve a question, place a diagram or open a simulator, and it is recorded here by topic. The AI reads a
            short summary of it, so new answers and diagrams build on what you have already done.
          </p>
        </div>
      ) : (
        <div className="pg-scroll">
          {groups.map((g) => (
            <section key={g.s} className="pg-group">
              <h4>{g.s}</h4>
              {g.topics.map((t) => (
                <div key={t.topic} className="pg-topic">
                  <div className="pg-topic-main">
                    <div className="pg-topic-row">
                      <b>{t.topic}</b>
                      <span>{t.count}</span>
                    </div>
                    <div className="pg-bar"><i style={{ width: `${Math.max(8, (t.count / max) * 100)}%` }} /></div>
                  </div>
                  <button className="pg-next" onClick={() => practice(t.topic)} title={`Sketch the next ${t.topic.toLowerCase()} diagram`}>
                    <Icon name="wand" size={13} /> Next
                  </button>
                </div>
              ))}
            </section>
          ))}

          <section className="pg-group">
            <h4>Recent</h4>
            <ul className="pg-recent">
              {list.slice(0, 12).map((m) => (
                <li key={m.id}>
                  <i className={`pg-kind ${m.kind}`}><Icon name={KIND_ICON[m.kind]} size={13} /></i>
                  <div className="pg-item">
                    <div className="pg-title">
                      {m.tex ? <Tex latex={m.title} /> : m.title}
                      {m.result && (
                        <span className="pg-result">
                          {' '}→ <Tex latex={m.result} />
                        </span>
                      )}
                    </div>
                    <div className="pg-meta">
                      {KIND_LABEL[m.kind]} · {m.topic}
                      {m.times > 1 ? ` · ${m.times} times` : ''} · {ago(m.at, now)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}

      {list.length > 0 && (
        <footer className="pg-foot">
          <span>Kept in this browser. The AI gets a short summary with each request.</span>
          {confirm ? (
            <span className="pg-confirm">
              <button className="pg-link danger" onClick={() => { clearMemory(); setConfirm(false); }}>Clear it</button>
              <button className="pg-link" onClick={() => setConfirm(false)}>Keep</button>
            </span>
          ) : (
            <button className="pg-link" onClick={() => setConfirm(true)}>Clear</button>
          )}
        </footer>
      )}
    </div>
  );
}
