/**
 * Checks the measuring instruments' readings: vernier and screw gauge (with zero errors), meter
 * needle limits and the measuring cylinder's parallax.
 * Run: node tests/gauge.test.ts   (from apps/web)
 */

import { fix, meterFraction, screwReading, seenVolume, vernierReading } from '../src/sim/gauge.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `-> ${detail}`);
}
const eq = (name: string, got: unknown, want: unknown) => check(name, got === want, `got ${String(got)}, want ${String(want)}`);
const near = (name: string, got: number, want: number, tol = 1e-9) => check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);

// --- vernier caliper ---------------------------------------------------------------------------------
let v = vernierReading(18.4, 0.1);
eq('vernier 18.4 mm: MSR 18', v.msr, 18);
eq('vernier 18.4 mm: line 4 coincides', v.k, 4);
near('vernier 18.4 mm: reading', v.reading, 18.4);
v = vernierReading(25.7, 0.1);
eq('vernier 25.7 mm: line 7', v.k, 7);
v = vernierReading(9.35, 0.05);
eq('vernier 0.05 mm LC, 9.35 mm: MSR 9, line 7', `${v.msr}/${v.k}`, '9/7');
v = vernierReading(12.999999, 0.1);
eq('vernier rounding up carries into the main scale', `${v.msr}/${v.k}`, '13/0');
v = vernierReading(0.3, 0.1);
near('positive zero error +0.3 mm with jaws closed', v.reading, 0.3);
v = vernierReading(-0.3, 0.1);
eq('negative zero error: zero falls left, line 7 coincides', `${v.msr}/${v.k}`, '-1/7');
near('negative zero error reads −0.3 mm', v.reading, -0.3);
near('corrected = observed − zero error', vernierReading(18.4 + 0.3, 0.1).reading - 0.3, 18.4);

// --- screw gauge ---------------------------------------------------------------------------------------
let s = screwReading(1.27, 0.5, 50);
eq('screw 1.27 mm: PSR 1.0, CSR 27', `${s.psr}/${s.csr}`, '1/27');
near('screw least count 0.01 mm', s.lc, 0.01);
near('screw 1.27 mm: reading', s.reading, 1.27);
s = screwReading(6.35, 0.5, 50);
eq('screw 6.35 mm: PSR 6.0, CSR 35', `${s.psr}/${s.csr}`, '6/35');
s = screwReading(0.48, 1, 100);
eq('screw pitch 1 mm, 100 divisions: 0.48 mm', `${s.psr}/${s.csr}`, '0/48');
s = screwReading(0.5, 0.5, 50);
eq('exactly half a millimetre: PSR 0.5, CSR 0', `${s.psr}/${s.csr}`, '0.5/0');
s = screwReading(-0.04, 0.5, 50);
eq('negative zero error −4 divisions: thimble shows 46 below the line', `${s.psr}/${s.csr}`, '-0.5/46');
near('negative zero error reads −0.04 mm', s.reading, -0.04);

// --- meters ----------------------------------------------------------------------------------------------
near('meter: 0.62 A on 1 A range', meterFraction(0.62, 1), 0.62);
near('meter: over range stops at the pin', meterFraction(9, 5), 1.04);
near('meter: below zero stops at the pin', meterFraction(-1, 5), -0.02);

// --- measuring cylinder parallax ---------------------------------------------------------------------------------
near('eye level: reads true', seenVolume(64.5, 0), 64.5, 1e-9);
check('eye above the meniscus reads high', seenVolume(64.5, -40) > 64.5, String(seenVolume(64.5, -40)));
check('eye below the meniscus reads low', seenVolume(64.5, 40) < 64.5, String(seenVolume(64.5, 40)));
near('parallax is symmetric', seenVolume(64.5, -40) - 64.5, 64.5 - seenVolume(64.5, 40), 1e-9);

// --- formatting -------------------------------------------------------------------------------------------------
eq('fix to 0.01', fix(1.27, 0.01), '1.27');
eq('fix keeps trailing zeros for the least count', fix(18, 0.1), '18.0');
eq('fix uses a real minus sign', fix(-0.04, 0.01), '−0.04');
eq('fix: no negative zero', fix(-1e-12, 0.1), '0.0');

console.log(failures ? `\n${failures} failed` : '\nall passed');
if (failures) process.exit(1);
