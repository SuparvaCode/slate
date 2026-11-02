/**
 * Checks the magnetism simulator's physics against hand-worked values: fields of a wire and a
 * solenoid, the sign of the induced EMF, Lenz's law, the generator and a charge's circle.
 * Run: node tests/physics-fields.test.ts   (from apps/web)
 */

import { dopplerSource, pathDifference, pipeHarmonic, stringHarmonic, wavelength } from '../src/sim/waves.ts';
import { MU0, coilPoles, generatorEmf, gyroRadius, inducedEmf, loopFlux, poleField, solenoidField, wireField } from '../src/sim/magnetism.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `-> ${detail}`);
}
const near = (name: string, got: number, want: number, tol = 1e-6) =>
  check(name, Math.abs(got - want) <= tol * Math.max(1, Math.abs(want)), `got ${got}, want ${want}`);
const eq = (name: string, got: unknown, want: unknown) => check(name, got === want, `got ${String(got)}, want ${String(want)}`);

// --- wire and solenoid ------------------------------------------------------------------------------
near('μ0 = 4π × 10⁻⁷', MU0, 1.2566370614e-6, 1e-9);
// 10 A at 5 cm: B = 2e-7 × 10 / 0.05 = 40 μT.
near('wire: 10 A at 5 cm is 40 μT', wireField(10, 0.05), 4e-5);
near('wire: field halves at twice the distance', wireField(10, 0.1) / wireField(10, 0.05), 0.5);
// 200 turns over 10 cm with 2 A: B = μ0 × 2000 × 2 = 5.03 mT.
near('solenoid: 200 turns, 10 cm, 2 A is 5.027 mT', solenoidField(200, 0.1, 2), 5.0265e-3, 1e-4);
near('solenoid: iron core multiplies by μr', solenoidField(200, 0.1, 2, 200) / solenoidField(200, 0.1, 2), 200);

// --- induction ------------------------------------------------------------------------------------------
const m = 2;
const a = 0.02;
check('flux is greatest with the magnet in the coil', loopFlux(m, a, 0) > loopFlux(m, a, 0.01) && loopFlux(m, a, 0.01) > loopFlux(m, a, 0.05));
near('flux is the same either side', loopFlux(m, a, -0.03), loopFlux(m, a, 0.03));
near('no EMF with the magnet at the centre', inducedEmf(200, m, a, 0, 1), 0);
near('no EMF when the magnet is still', inducedEmf(200, m, a, -0.03, 0), 0);
const coming = inducedEmf(200, m, a, -0.03, 0.5);
const going = inducedEmf(200, m, a, 0.03, 0.5);
check('EMF reverses between coming in and going out', coming * going < 0, `${coming}, ${going}`);
near('EMF doubles with twice the speed', inducedEmf(200, m, a, -0.03, 1) / coming, 2);
near('EMF doubles with twice the turns', inducedEmf(400, m, a, -0.03, 0.5) / coming, 2);
// Faraday by numbers: the EMF matches −N ΔΦ/Δt over a small step.
const dt = 1e-6;
const v = 0.5;
const numeric = (-200 * (loopFlux(m, a, -0.03 + v * dt) - loopFlux(m, a, -0.03))) / dt;
near('EMF is −N dΦ/dt', coming, numeric, 1e-4);

// Lenz: magnet N end on its right, so N faces the coil from the left.
eq('N coming in from the left: left face becomes N (repels)', coilPoles(100, 50, true), 'N');
eq('N going out to the left: left face becomes S (attracts)', coilPoles(100, -50, true), 'S');
eq('S leaving on the right: right face becomes N, left S', coilPoles(500, 50, true), 'S');
eq('S coming in from the right: right face becomes S, left N', coilPoles(500, -50, true), 'N');
eq('flipped magnet, S coming in from the left: left face S', coilPoles(100, 50, false), 'S');
eq('still magnet: no poles', coilPoles(100, 0, true), null);

// --- generator --------------------------------------------------------------------------------------------
const w = 2 * Math.PI * 0.5;
near('generator: zero when the coil faces the field', generatorEmf(100, 0.2, 0.01, w, 0), 0);
near('generator: peak NBAω a quarter turn later', generatorEmf(100, 0.2, 0.01, w, 0.5), 100 * 0.2 * 0.01 * w);

// --- charge in a field ------------------------------------------------------------------------------------------
// Proton at 1e5 m/s in 10 mT: r = (1.6726e-27 × 1e5) / (1.602e-19 × 0.01) = 10.44 cm.
near('proton: r = mv/qB', gyroRadius(1.6726e-27, 1e5, 1.602176634e-19, 0.01), 0.1044, 1e-3);
near('alpha has twice the proton radius at the same speed', gyroRadius(4 * 1.6605e-27, 1e5, 2 * 1.602e-19, 0.01) / gyroRadius(1.6605e-27, 1e5, 1.602e-19, 0.01), 2);

// --- bar magnet poles ----------------------------------------------------------------------------------------------
const bar = [{ x: 50, y: 0, q: 1 }, { x: -50, y: 0, q: -1 }];
const [bx, by] = poleField(bar, 0, 0);
check('pole model: midway between the poles the field points from N towards S', bx < 0 && Math.abs(by) < 1e-12, `${bx}, ${by}`);
const [ox] = poleField(bar, 0, 80);
check('above the magnet the field runs from N towards S', ox < 0, String(ox));
const [ex] = poleField(bar, 150, 0);
check('beyond the N pole the field points away from it', ex > 0, String(ex));

// --- waves ------------------------------------------------------------------------------------------------------
near('v = fλ: 343 m/s at 440 Hz is 78 cm', wavelength(343, 440), 0.7795, 1e-3);
near('string: fundamental v/2L', stringHarmonic(1, 20, 2), 5);
near('string: third harmonic is 3× the fundamental', stringHarmonic(3, 20, 2), 15);
near('open pipe 0.8 m: fundamental 214.4 Hz', pipeHarmonic(1, 343, 0.8, false), 214.375);
near('closed pipe 0.8 m: fundamental 107.2 Hz', pipeHarmonic(1, 343, 0.8, true), 107.1875);
near('closed pipe: next resonance is the 3rd harmonic', pipeHarmonic(2, 343, 0.8, true) / pipeHarmonic(1, 343, 0.8, true), 3);
near('open pipe: next resonance is the 2nd harmonic', pipeHarmonic(2, 343, 0.8, false) / pipeHarmonic(1, 343, 0.8, false), 2);
// 440 Hz siren at 0.4 × 343 m/s: ahead 440/(1 − 0.4) = 733.3 Hz, behind 440/1.4 = 314.3 Hz.
near('Doppler ahead', dopplerSource(440, 343, 0.4 * 343), 733.333, 1e-4);
near('Doppler behind', dopplerSource(440, 343, -0.4 * 343), 314.286, 1e-4);
near('Doppler: still source, no change', dopplerSource(440, 343, 0), 440);
eq('interference: on the centre line, a maximum', pathDifference(300, 190, [60, 140], [60, 240], 40).kind, 'max');
near('interference: path difference in wavelengths', pathDifference(60, 340, [60, 140], [60, 240], 40).d, 2.5);
eq('interference: half a wavelength, a minimum', pathDifference(60, 340, [60, 140], [60, 240], 40).kind, 'min');

console.log(failures ? `\n${failures} failed` : '\nall passed');
if (failures) process.exit(1);
