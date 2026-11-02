import type { AiEl } from './model';
import { haptic } from './haptics';

/** Fired on window after every copy, so the copy layer can show its toast. */
export const COPIED_EVENT = 'slate:copied';

function fallbackCopy(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;font-size:16px';
  document.body.appendChild(ta);
  const active = document.activeElement as HTMLElement | null;
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  active?.focus?.({ preventScroll: true });
  return ok;
}

/** Copies plain text, with a fallback for browsers without the async clipboard, a toast and a haptic. */
export async function copyText(text: string, opts: { quiet?: boolean } = {}): Promise<boolean> {
  const value = text.trim();
  if (!value) return false;
  let ok = false;
  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      ok = true;
    }
  } catch {
    ok = false;
  }
  if (!ok) ok = fallbackCopy(value);
  haptic(ok ? 'success' : 'error');
  if (!opts.quiet) window.dispatchEvent(new CustomEvent(COPIED_EVENT, { detail: { ok } }));
  return ok;
}

/** The LaTeX source of an answer on the board: its columns, steps, or the answer alone. */
export function latexOfAi(el: AiEl): string {
  const r = el.response?.result;
  if (!r) return '';
  const columns = (r.columns ?? []).filter((c) => c.lines.length > 0);
  if (columns.length >= 2) {
    return columns.map((c) => [c.heading, ...c.lines].filter(Boolean).join('\n')).join('\n\n');
  }
  if (r.steps?.length) return r.steps.join('\n');
  return r.answer_latex || r.answer_text || '';
}

/**
 * The text of a rendered element, with each KaTeX formula turned back into its LaTeX source.
 * A lone formula comes back bare; formulas inside prose come back as `$...$`.
 */
export function textOfNode(node: Element): string {
  const explicit = node.getAttribute('data-copy');
  if (explicit) return explicit;
  const formulas = node.querySelectorAll('.katex');
  const tex = (k: Element) => k.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim() ?? '';
  if (formulas.length === 1) {
    const only = formulas[0];
    // The formula is the whole element, give or take whitespace.
    const rest = (node.textContent ?? '').replace(only.textContent ?? '', '').trim();
    if (!rest) return tex(only);
  }
  const clone = node.cloneNode(true) as Element;
  clone.querySelectorAll('.katex').forEach((k) => {
    const src = tex(k);
    k.replaceWith(document.createTextNode(src ? `$${src}$` : ''));
  });
  // Block children become separate lines.
  clone.querySelectorAll('li, p, div, br').forEach((b) => b.after(document.createTextNode('\n')));
  return (clone.textContent ?? '')
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

/** True when the node holds formulas, so the menu can say "Copy LaTeX". */
export const hasTex = (node: Element) => !!node.querySelector('.katex') || node.hasAttribute('data-copy-tex');
