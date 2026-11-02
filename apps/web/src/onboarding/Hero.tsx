/**
 * The onboarding hero: `2x + 5 = 13` is written by hand, a lasso is drawn around it, and
 * `x = 4` writes itself in. The strokes use the same pen glyphs the app writes answers with.
 *
 * One Web Animations timeline loops the scene. Only stroke-dashoffset (on a handful of short
 * paths), opacity and transform are animated. With reduced motion the composed final frame
 * is shown and nothing moves.
 */
import { useLayoutEffect, useMemo, useRef } from 'react';
import type { RefObject } from 'react';
import { textWidth, writeText } from './ink';

const W = 360;
const H = 236;
const SIZE = 52;
const PEN = 3.1;
/** Pen speed in viewBox units per millisecond. */
const SPEED = 0.42;
const EQ = '2x + 5 = 13';
const ANS = 'x = 4';
const BASE_EQ = 100;
const BASE_ANS = 184;

type Kind = 'ink' | 'lasso' | 'answer';
interface Seg {
  kind: Kind;
  d: string;
  transform?: string;
  start: number;
  dur: number;
}

/** A hand-drawn loop: an ellipse that wobbles a little and overshoots where it started. */
function lassoPath(cx: number, cy: number, rx: number, ry: number): string {
  const n = 120;
  const a0 = -2.5;
  const a1 = a0 + Math.PI * 2 + 0.6;
  let d = '';
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = a0 + (a1 - a0) * t;
    const grow = 1 + 0.03 * Math.sin(a * 3 + 0.6) + 0.06 * t;
    const x = cx + Math.cos(a) * rx * grow;
    const y = cy + Math.sin(a) * ry * grow * (1 - 0.05 * Math.cos(a));
    d += `${i ? ' L' : 'M'} ${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

function buildScene() {
  const eqW = textWidth(EQ) * SIZE;
  const x0 = (W - eqW) / 2;
  // Line the answer's "=" up under the equation's "=".
  const ansX = x0 + (textWidth('2x + 5 ') - textWidth('x ')) * SIZE;

  const segs: Seg[] = [];
  let t = 700;
  const write = (kind: Kind, strokes: ReturnType<typeof writeText>) => {
    for (const s of strokes) {
      const start = t + s.gap;
      const dur = Math.max(90, s.len / SPEED);
      segs.push({ kind, d: s.d, transform: s.transform, start, dur });
      t = start + dur;
    }
  };

  const eqStart = t;
  write('ink', writeText(EQ, x0, BASE_EQ, SIZE));
  const lassoStart = t + 420;
  const lassoDur = 950;
  segs.push({
    kind: 'lasso',
    d: lassoPath(W / 2, BASE_EQ - SIZE * 0.36, eqW / 2 + 24, SIZE * 0.4 + 22),
    start: lassoStart,
    dur: lassoDur,
  });
  t = lassoStart + lassoDur + 520;
  const ansStart = t;
  write('answer', writeText(ANS, ansX, BASE_ANS, SIZE, 2));
  const ansEnd = t;
  const holdEnd = ansEnd + 2800;
  const fadeEnd = holdEnd + 650;
  const T = fadeEnd + 450;

  return {
    segs,
    T,
    beats: [eqStart, lassoStart, ansStart],
    ansEnd,
    holdEnd,
    fadeEnd,
    glow: { cx: ansX + (textWidth(ANS) * SIZE) / 2, cy: BASE_ANS - SIZE * 0.36 },
  };
}

const at = (ms: number, T: number) => Math.min(1, Math.max(0, ms / T));
const EASE = 'cubic-bezier(0.45, 0.05, 0.4, 1)';

interface Props {
  /** The headline whose lines light up in step with the scene, on the first pass. */
  titleRef: RefObject<HTMLElement | null>;
  reduced: boolean;
}

export function Hero({ titleRef, reduced }: Props) {
  const scene = useMemo(() => buildScene(), []);
  const sceneRef = useRef<SVGGElement>(null);
  const strokeRefs = useRef<(SVGPathElement | null)[]>([]);
  const glowRef = useRef<SVGEllipseElement>(null);
  const chipRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (reduced) return;
    const { T, segs } = scene;
    const loop: KeyframeAnimationOptions = { duration: T, iterations: Infinity };
    const anims: Animation[] = [];
    const strokes = strokeRefs.current;

    segs.forEach((seg, i) => {
      const el = strokes[i];
      if (!el) return;
      el.style.strokeDasharray = '1 2';
      anims.push(
        el.animate(
          [
            { strokeDashoffset: 1.02, offset: 0 },
            { strokeDashoffset: 1.02, offset: at(seg.start, T), easing: seg.kind === 'lasso' ? 'cubic-bezier(0.6, 0, 0.3, 1)' : EASE },
            { strokeDashoffset: 0, offset: at(seg.start + seg.dur, T) },
            { strokeDashoffset: 0, offset: 1 },
          ],
          loop,
        ),
      );
    });

    const fade = (el: Element | null, frames: Keyframe[]) => {
      if (el) anims.push(el.animate(frames, loop));
    };
    fade(sceneRef.current, [
      { opacity: 1, offset: 0 },
      { opacity: 1, offset: at(scene.holdEnd, T), easing: 'ease-in' },
      { opacity: 0, offset: at(scene.fadeEnd, T) },
      { opacity: 0, offset: 1 },
    ]);
    fade(glowRef.current, [
      { opacity: 0, offset: 0 },
      { opacity: 0, offset: at(scene.ansEnd - 200, T), easing: 'ease-out' },
      { opacity: 1, offset: at(scene.ansEnd + 500, T), easing: 'ease-in-out' },
      { opacity: 0.6, offset: at(scene.holdEnd, T) },
      { opacity: 0.6, offset: 1 },
    ]);
    fade(chipRef.current, [
      { opacity: 0, transform: 'translate3d(0, 10px, 0) scale(0.96)', offset: 0 },
      { opacity: 0, transform: 'translate3d(0, 10px, 0) scale(0.96)', offset: at(scene.ansEnd + 150, T), easing: 'cubic-bezier(0.32, 0.72, 0, 1)' },
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)', offset: at(scene.ansEnd + 700, T) },
      { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)', offset: at(scene.holdEnd, T), easing: 'ease-in' },
      { opacity: 0, transform: 'translate3d(0, 4px, 0) scale(0.98)', offset: at(scene.fadeEnd, T) },
      { opacity: 0, transform: 'translate3d(0, 4px, 0) scale(0.98)', offset: 1 },
    ]);

    // Headline: each line lights up as its step happens, the first time only.
    titleRef.current?.querySelectorAll<HTMLElement>('.ob-line').forEach((line, i) => {
      anims.push(
        line.animate([{ opacity: 0.22 }, { opacity: 1 }], {
          duration: 700,
          delay: scene.beats[i] ?? 0,
          easing: 'ease-out',
          fill: 'both',
        }),
      );
    });

    return () => {
      anims.forEach((a) => a.cancel());
      strokes.forEach((el) => el?.style.removeProperty('stroke-dasharray'));
    };
  }, [reduced, scene, titleRef]);

  return (
    <div className="ob-card">
      <svg
        className="ob-board"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="2x + 5 = 13 is written by hand and circled, then x = 4 is written in."
      >
        <defs>
          <radialGradient id="ob-glow-fill">
            <stop offset="0" stopColor="#6cb4ff" stopOpacity="0.42" />
            <stop offset="1" stopColor="#6cb4ff" stopOpacity="0" />
          </radialGradient>
        </defs>
        <g ref={sceneRef} fill="none" strokeLinecap="round" strokeLinejoin="round">
          <ellipse
            ref={glowRef}
            className="ob-glow"
            cx={scene.glow.cx}
            cy={scene.glow.cy}
            rx={92}
            ry={44}
            fill="url(#ob-glow-fill)"
          />
          {scene.segs.map((s, i) => (
            <path
              key={i}
              ref={(el) => {
                strokeRefs.current[i] = el;
              }}
              className={`ob-${s.kind}`}
              d={s.d}
              transform={s.transform}
              pathLength={1}
              strokeWidth={s.kind === 'lasso' ? 2 : PEN / SIZE}
            />
          ))}
        </g>
      </svg>
      <div className="ob-chip" ref={chipRef}>
        <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.5 8.4 6.6 11.3 12.6 4.8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Checked with a calculator
      </div>
    </div>
  );
}
