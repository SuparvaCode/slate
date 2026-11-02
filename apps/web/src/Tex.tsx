import { memo, useMemo } from 'react';
import katex from 'katex';

/** Renders LaTeX with KaTeX. Bad LaTeX shows as red source instead of throwing. */
export const Tex = memo(function Tex({ latex, display = false }: { latex: string; display?: boolean }) {
  const html = useMemo(
    () => katex.renderToString(latex, { throwOnError: false, displayMode: display, strict: 'ignore' }),
    [latex, display],
  );
  return <span className="tex" dangerouslySetInnerHTML={{ __html: html }} />;
});
