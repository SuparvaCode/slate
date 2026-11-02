/**
 * Automated audit of every simulator: /audit.html (or /audit.html?kind=logic for one).
 *
 * Each simulator is audited in its own worker (audit.worker.ts) so the page stays responsive and
 * a simulator that hangs is caught: if a worker reports nothing for 15 s it is stopped and the
 * case it was on is recorded. The result is on window.__audit; progress on window.__progress.
 */

import { SIMS } from '../sim';
import type { SimKind } from '../sim';

interface Finding { level: 'error' | 'warn'; kind: string; where: string; what: string }

const QUIET_MS = 15_000;
const findings: Finding[] = [];
const timing: Record<string, { setups: number; ms: number; slowest: [string, number][] }> = {};
const progress = { kind: '', at: '', lastAt: 0, done: [] as string[] };
(window as unknown as { __progress: unknown }).__progress = progress;

const out = document.createElement('pre');
document.body.append(out);
const show = (head: string) => {
  out.textContent = `${head}\n\n${findings.map((f) => `${f.level.toUpperCase().padEnd(5)} ${f.kind.padEnd(11)} ${f.what}\n      ${f.where}`).join('\n')}`;
};

function auditKind(kind: SimKind): Promise<void> {
  return new Promise((resolve) => {
    const w = new Worker(new URL('./audit.worker.ts', import.meta.url), { type: 'module' });
    progress.kind = kind;
    progress.at = 'starting';
    progress.lastAt = performance.now();
    const finish = () => {
      window.clearInterval(watch);
      w.terminate();
      progress.done.push(kind);
      resolve();
    };
    const watch = window.setInterval(() => {
      if (performance.now() - progress.lastAt < QUIET_MS) return;
      findings.push({ level: 'error', kind, where: progress.at, what: `hung: nothing for ${QUIET_MS / 1000} s (infinite loop or far too slow)` });
      finish();
    }, 1000);
    w.onmessage = (ev) => {
      const m = ev.data;
      progress.lastAt = performance.now();
      if (m.type === 'at') progress.at = m.where;
      else if (m.type === 'finding') findings.push(m.finding);
      else if (m.type === 'done') {
        timing[kind] = { setups: m.setups, ms: Math.round(m.ms), slowest: m.slowest.map(([wh, ms]: [string, number]) => [wh, Math.round(ms)]) };
        finish();
      }
    };
    w.onerror = (e) => {
      findings.push({ level: 'error', kind, where: progress.at, what: `worker crashed: ${e.message}` });
      finish();
    };
    w.postMessage({ kind });
  });
}

async function main() {
  const only = new URLSearchParams(location.search).get('kind');
  const kinds = (Object.keys(SIMS) as SimKind[]).filter((k) => !only || k === only);
  const t0 = performance.now();
  for (const k of kinds) {
    show(`Auditing ${k} (${progress.done.length + 1} of ${kinds.length})…`);
    await auditKind(k);
  }
  const summary = {
    simulators: kinds.length,
    setups: Object.values(timing).reduce((a, t) => a + t.setups, 0),
    errors: findings.filter((f) => f.level === 'error').length,
    warnings: findings.filter((f) => f.level === 'warn').length,
    seconds: Math.round((performance.now() - t0) / 100) / 10,
  };
  (window as unknown as { __audit: unknown }).__audit = { summary, findings, timing };
  show(JSON.stringify(summary));
}

void main();
