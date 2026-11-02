import { memo, useLayoutEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { AiEl } from './model';
import { Tex } from './Tex';

interface Props {
  el: AiEl;
  color: string;
  onMeasure: (id: string, w: number, h: number) => void;
}

/** An answer drawn as typeset maths (KaTeX) instead of handwriting. */
export const TypesetNote = memo(function TypesetNote({ el, color, onMeasure }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const report = () => onMeasure(el.id, node.offsetWidth, node.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(node);
    return () => ro.disconnect();
  }, [el.id, el.response, el.fontSize, el.boxed, onMeasure]);

  const r = el.response?.result;
  if (!r) return null;

  const columns = (r.columns ?? []).filter((c) => c.lines.length > 0);
  const steps = r.steps ?? [];
  const style: CSSProperties = { left: el.x, top: el.y - el.ascent, fontSize: el.fontSize * 0.8, color };
  const fresh = el.doneAt !== undefined && Date.now() - el.doneAt < 2500;
  const cls = `tnote${fresh ? ' fresh' : ''}`;

  if (columns.length >= 2) {
    const last = columns.length - 1;
    return (
      <div ref={ref} className={`${cls} cols`} style={style}>
        {columns.map((c, i) => (
          <div className="tcol" key={i}>
            {c.heading && <div className="thead">{c.heading}</div>}
            {c.lines.map((line, j) => (
              <div
                key={j}
                className={`tline${el.boxed && i === last && j === c.lines.length - 1 ? ' boxed' : ''}`}
              >
                <Tex latex={line} />
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }

  const lines = steps.length ? steps : r.answer_latex ? [r.answer_latex] : [];
  return (
    <div ref={ref} className={cls} style={style}>
      {lines.length > 0
        ? lines.map((line, i) => (
            <div key={i} className={`tline${el.boxed && i === lines.length - 1 ? ' boxed' : ''}`}>
              <Tex latex={line} />
            </div>
          ))
        : r.answer_text && <div className={`tline${el.boxed ? ' boxed' : ''}`}>{r.answer_text}</div>}
    </div>
  );
});
