import { useMemo } from 'react';
import { textWidth, writeText } from './ink';

/** "Slate" in the app's handwriting, as a static mark. */
export function Wordmark({ height = 28, className }: { height?: number; className?: string }) {
  const size = 40;
  const w = textWidth('Slate') * size + 8;
  const strokes = useMemo(() => writeText('Slate', 4, 34, size, 1), []);
  return (
    <svg
      className={className}
      viewBox={`0 0 ${w.toFixed(1)} 44`}
      height={height}
      width={(height * w) / 44}
      role="img"
      aria-label="Slate"
    >
      <g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={3.2 / size}>
        {strokes.map((s, i) => (
          <path key={i} d={s.d} transform={s.transform} />
        ))}
      </g>
    </svg>
  );
}
