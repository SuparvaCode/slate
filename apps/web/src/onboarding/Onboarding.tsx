import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import type { LegalDoc } from '../legal/content';
import { friendlyAuthError, signInWithGoogle } from '../auth/session';
import { GoogleButton } from './GoogleButton';
import { Hero } from './Hero';
import { Wordmark } from './Wordmark';
import './onboarding.css';

// The legal text is a sizable chunk, so it loads the first time someone asks to read it.
const LegalDialog = lazy(() => import('../legal/LegalDialog'));

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const clamp = (v: number) => Math.max(-1, Math.min(1, v));

/** Moves the light fields, the board card and the copy a little with the pointer or device tilt. */
function useParallax(
  reduced: boolean,
  fields: React.RefObject<HTMLElement | null>,
  stage: React.RefObject<HTMLElement | null>,
  copy: React.RefObject<HTMLElement | null>,
) {
  useEffect(() => {
    if (reduced) return;
    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let raf = 0;
    const apply = () => {
      if (fields.current) fields.current.style.transform = `translate3d(${(x * -22).toFixed(2)}px, ${(y * -16).toFixed(2)}px, 0)`;
      if (stage.current) {
        stage.current.style.transform =
          `perspective(1400px) rotateY(${(x * 5).toFixed(2)}deg) rotateX(${(-y * 4).toFixed(2)}deg) ` +
          `translate3d(${(x * 8).toFixed(2)}px, ${(y * 6).toFixed(2)}px, 0)`;
      }
      if (copy.current) copy.current.style.transform = `translate3d(${(x * -4).toFixed(2)}px, ${(y * -3).toFixed(2)}px, 0)`;
    };
    const frame = () => {
      x += (tx - x) * 0.07;
      y += (ty - y) * 0.07;
      apply();
      raf = Math.abs(tx - x) > 0.0015 || Math.abs(ty - y) > 0.0015 ? requestAnimationFrame(frame) : 0;
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(frame);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      tx = clamp((e.clientX / innerWidth) * 2 - 1);
      ty = clamp((e.clientY / innerHeight) * 2 - 1);
      kick();
    };
    const onLeave = () => {
      tx = 0;
      ty = 0;
      kick();
    };
    const onTilt = (e: DeviceOrientationEvent) => {
      if (e.gamma === null || e.beta === null) return;
      tx = clamp(e.gamma / 25);
      ty = clamp((e.beta - 45) / 25);
      kick();
    };
    addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    addEventListener('deviceorientation', onTilt, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      removeEventListener('deviceorientation', onTilt);
    };
  }, [reduced, fields, stage, copy]);
}

interface Props {
  /** A message to show above the button, for example after a session ended. */
  notice: string | null;
  onClearNotice: () => void;
}

export default function Onboarding({ notice, onClearNotice }: Props) {
  const [reduced] = useState(reducedMotion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [legal, setLegal] = useState<LegalDoc | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const fieldsRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLElement>(null);
  useParallax(reduced, fieldsRef, stageRef, copyRef);

  const signIn = async () => {
    setError(null);
    onClearNotice();
    setBusy(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  const message = error ?? notice;

  return (
    <div className={`ob${reduced ? ' ob-still' : ''}`}>
      <div className="ob-fields" ref={fieldsRef} aria-hidden="true">
        <i className="ob-field ob-f1" />
        <i className="ob-field ob-f2" />
        <i className="ob-field ob-f3" />
      </div>
      <div className="ob-shell">
        <header className="ob-head">
          <Wordmark height={30} className="ob-mark" />
        </header>
        <main className="ob-main">
          <section className="ob-copy" ref={copyRef} aria-labelledby="ob-title">
            <h1 className="ob-title" id="ob-title" ref={titleRef}>
              <span className="ob-line">Write it.</span> <span className="ob-line">Circle it.</span>{' '}
              <span className="ob-line">Slate solves it.</span>
            </h1>
            <p className="ob-sub">
              Write a problem on an endless board and loop it. Slate reads your handwriting, checks the maths with a
              real calculator, and writes the answer back in your own hand.
            </p>
            <div className="ob-cta">
              <GoogleButton busy={busy} onClick={signIn} />
              {message && (
                <p className="ob-error" role="alert">
                  {message}
                </p>
              )}
            </div>
            <p className="ob-legal">
              By continuing, you agree to the{' '}
              <button type="button" className="ob-link" onClick={() => setLegal('terms')}>
                Terms of Service
              </button>{' '}
              and{' '}
              <button type="button" className="ob-link" onClick={() => setLegal('privacy')}>
                Privacy Policy
              </button>
              .
            </p>
          </section>
          <div className="ob-stage" ref={stageRef}>
            <div className="ob-stage-in">
              <Hero titleRef={titleRef} reduced={reduced} />
            </div>
          </div>
        </main>
      </div>
      {legal && (
        <Suspense fallback={null}>
          <LegalDialog doc={legal} tone="dark" onClose={() => setLegal(null)} />
        </Suspense>
      )}
    </div>
  );
}
