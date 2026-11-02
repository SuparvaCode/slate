/**
 * Checks the biology simulators: the cardiac cycle and ECG, breathing, the action potential,
 * mitosis, osmosis and tapping the parts of a cell.
 * Run: node tests/biology.test.ts   (from apps/web)
 */

import { CELLS, PHASES, TONICITY, mitosisPhase, osmosis, partAt } from '../src/sim/cell.ts';
import { apShape, breath, cardiacOutput, cardiacPhase, ecg, heartSound, systoleScale } from '../src/sim/heart.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `-> ${detail}`);
}
const eq = (name: string, got: unknown, want: unknown) => check(name, got === want, `got ${String(got)}, want ${String(want)}`);
const near = (name: string, got: number, want: number, tol = 1e-6) => check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);

// --- cardiac cycle ---------------------------------------------------------------------------------
const ORDER = ['Ventricular filling', 'Atrial systole', 'Isovolumetric contraction', 'Ventricular ejection', 'Isovolumetric relaxation', 'Ventricular filling'];
for (const hr of [40, 75, 120, 180]) {
  const T = 60 / hr;
  const seen: string[] = [];
  for (let i = 0; i < 2000; i++) {
    const ph = cardiacPhase((i / 2000) * T, T);
    if (seen[seen.length - 1] !== ph.name) seen.push(ph.name);
  }
  eq(`${hr} bpm: phases in order`, seen.join(' → '), ORDER.join(' → '));
}
eq('75 bpm: systole lasts its resting length', systoleScale(0.8), 1);
check('fast heart: systole shortened', systoleScale(0.4) < 1);
check('fast heart: diastole still there', systoleScale(60 / 180) * 0.54 < 60 / 180);
const ej = cardiacPhase(0.3, 0.8);
check('ejection: semilunar open, AV shut', ej.sl && !ej.av);
const fill = cardiacPhase(0.65, 0.8);
check('filling: AV open, semilunar shut', fill.av && !fill.sl);
check('never both valve sets open', Array.from({ length: 800 }, (_, i) => cardiacPhase(i / 1000, 0.8)).every((p) => !(p.av && p.sl)));

// ECG: the R wave is the tallest point and comes just before the ventricles squeeze.
let peak = 0;
let at = 0;
for (let i = 0; i < 8000; i++) {
  const v = ecg(i / 10000, 0.8);
  if (v > peak) {
    peak = v;
    at = i / 10000;
  }
}
near('ECG: R peak about 1 mV', peak, 1, 0.05);
near('ECG: R peak at 0.19 s', at, 0.19, 0.005);
eq('ECG: R wave comes just before the ventricles contract', cardiacPhase(at, 0.8).name, 'Atrial systole');
near('ECG: flat between beats', ecg(0.7, 0.8), 0, 0.01);
eq('heart sound "lub" as the AV valves shut', heartSound(0.21, 0.8), 'lub');
eq('heart sound "dub" as the semilunar valves shut', heartSound(0.5, 0.8), 'dub');
eq('silent mid-diastole', heartSound(0.7, 0.8), null);
near('cardiac output 75 × 70 mL = 5.25 L/min', cardiacOutput(75, 70), 5.25);

// --- breathing ---------------------------------------------------------------------------------------
near('breath: starts empty', breath(0, 12).f, 0);
near('breath: full at 40% of the breath', breath(2, 12).f, 1);
near('breath: empty again after a whole breath', breath(5, 12).f, 0, 1e-9);
check('breath: in for 2 s, then out', breath(1, 12).inhaling && !breath(3, 12).inhaling);

// --- action potential ----------------------------------------------------------------------------------
near('resting at −70 mV', apShape(-1), -70);
near('peak +40 mV at 1 ms', apShape(1), 40);
near('undershoot to −80 mV', apShape(2.5), -80);
near('back to −70 mV at 5 ms', apShape(5), -70);

// --- mitosis ---------------------------------------------------------------------------------------------
eq('six stages', PHASES.map((p) => p.name).join(', '), 'Interphase, Prophase, Metaphase, Anaphase, Telophase, Cytokinesis');
eq('t = 0: interphase', mitosisPhase(0).i, 0);
eq('t = 6 s: metaphase', PHASES[mitosisPhase(6).i].id, 'metaphase');
eq('long after: stays at cytokinesis', PHASES[mitosisPhase(100).i].id, 'cytokinesis');
near('cytokinesis finishes', mitosisPhase(100).f, 1);

// --- osmosis ---------------------------------------------------------------------------------------------
eq('water moves towards more sugar (left)', osmosis(6, 1).dir, 'left');
eq('water moves towards more sugar (right)', osmosis(1, 6).dir, 'right');
eq('equal: no net movement', osmosis(3, 3).dir, 'none');
check('the sugary side ends up with more water', osmosis(6, 1).share > 0.5 && osmosis(1, 6).share < 0.5);
check('hypotonic swells, hypertonic shrinks', TONICITY.hypotonic.scale > 1 && TONICITY.hypertonic.scale < 1 && TONICITY.isotonic.scale === 1);

// --- cell parts ------------------------------------------------------------------------------------------
eq('tap the nucleolus inside the nucleus', partAt('animal', 270, 182)?.id, 'nucleolus');
eq('tap the nucleus away from the nucleolus', partAt('animal', 262, 218)?.id, 'nucleus');
// The plant cell is drawn at 0.76 × its width about x = 280, so its wall at x = 82 is drawn at 129.
eq('tap the plant cell wall', partAt('plant', 280 + (82 - 280) * 0.76, 190)?.id, 'wall');
eq('tap empty space', partAt('animal', 20, 20), null);
check('plant cells have chloroplasts, a wall and a vacuole', ['chloro', 'wall', 'vacuole'].every((id) => CELLS.plant.some((p) => p.id === id)));
check('animal cells have none of them', ['chloro', 'wall', 'vacuole'].every((id) => !CELLS.animal.some((p) => p.id === id)));
check('bacteria have no nucleus', !CELLS.bacteria.some((p) => p.id === 'nucleus'));
check('every part says what it does', Object.values(CELLS).every((ps) => ps.every((p) => p.does.length > 10)));

console.log(failures ? `\n${failures} failed` : '\nall passed');
if (failures) process.exit(1);
