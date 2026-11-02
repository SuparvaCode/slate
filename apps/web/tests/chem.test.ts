/**
 * Checks the titration pH solver and the periodic table data against textbook values.
 * Run: node tests/chem.test.ts   (from apps/web)
 */

import { KA_ACETIC, indicatorName, phAt, veqOf } from '../src/sim/titration.ts';
import { ELEMENTS, configText, element } from '../src/sim/periodic-data.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `-> ${detail}`);
}
const near = (name: string, got: number, want: number, tol = 0.02) =>
  check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);
const eq = (name: string, got: unknown, want: unknown) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// --- titration: 25 mL of 0.1 M acid with 0.1 M titrant -------------------------------------
const pKa = -Math.log10(KA_ACETIC);
near('Veq = 25 mL', veqOf(0.1, 25, 0.1), 25, 1e-9);
near('HCl/NaOH start pH 1', phAt('sa-sb', 0.1, 25, 0.1, 0), 1.0);
near('HCl/NaOH 12.5 mL pH 1.48', phAt('sa-sb', 0.1, 25, 0.1, 12.5), 1.477);
near('HCl/NaOH 24.9 mL pH 3.70', phAt('sa-sb', 0.1, 25, 0.1, 24.9), 3.70);
near('HCl/NaOH equivalence pH 7', phAt('sa-sb', 0.1, 25, 0.1, 25), 7.0, 0.001);
near('HCl/NaOH 25.1 mL pH 10.30', phAt('sa-sb', 0.1, 25, 0.1, 25.1), 10.30);
near('HCl/NaOH 30 mL pH 11.96', phAt('sa-sb', 0.1, 25, 0.1, 30), 14 + Math.log10(0.5 / 55));
near('HCl/NaOH 50 mL pH 12.52', phAt('sa-sb', 0.1, 25, 0.1, 50), 14 + Math.log10(2.5 / 75));

near('pKa of ethanoic acid 4.74', pKa, 4.745, 0.001);
near('CH3COOH start pH 2.88', phAt('wa-sb', 0.1, 25, 0.1, 0), 2.88);
near('CH3COOH 5 mL HH 4.14', phAt('wa-sb', 0.1, 25, 0.1, 5), pKa + Math.log10(0.5 / 2), 0.01);
near('CH3COOH half-equivalence pH = pKa', phAt('wa-sb', 0.1, 25, 0.1, 12.5), pKa, 0.005);
near('CH3COOH 20 mL HH 5.35', phAt('wa-sb', 0.1, 25, 0.1, 20), pKa + Math.log10(2 / 0.5), 0.01);
near('CH3COOH equivalence pH 8.72', phAt('wa-sb', 0.1, 25, 0.1, 25), 14 + Math.log10(Math.sqrt((1e-14 / KA_ACETIC) * 0.05)), 0.01);
near('CH3COOH 30 mL excess pH 11.96', phAt('wa-sb', 0.1, 25, 0.1, 30), 14 + Math.log10(0.5 / 55), 0.01);

near('HCl/NH3 start pH 1', phAt('sa-wb', 0.1, 25, 0.1, 0), 1.0);
near('HCl/NH3 equivalence pH 5.28', phAt('sa-wb', 0.1, 25, 0.1, 25), -Math.log10(Math.sqrt((1e-14 / 1.8e-5) * 0.05)), 0.01);
near('HCl/NH3 50 mL pH = pKa(NH4+) 9.26', phAt('sa-wb', 0.1, 25, 0.1, 50), 14 - pKa, 0.01);

eq('phenolphthalein colourless at 7', indicatorName('phph', 7), 'colourless');
eq('phenolphthalein pink at 10', indicatorName('phph', 10), 'pink');
eq('methyl orange red at 2', indicatorName('mo', 2), 'red');
eq('methyl orange yellow at 7', indicatorName('mo', 7), 'yellow');
eq('universal green at 7', indicatorName('univ', 7), 'green');

// --- periodic table -----------------------------------------------------------------------
eq('118 elements', ELEMENTS.length, 118);
eq('symbols run in Z order', [1, 6, 26, 79, 92, 118].map((z) => element(z).symbol), ['H', 'C', 'Fe', 'Au', 'U', 'Og']);
eq('S config', configText(16), '[Ne] 3s² 3p⁴');
eq('Cr config (exception)', configText(24), '[Ar] 3d⁵ 4s¹');
eq('Cu config (exception)', configText(29), '[Ar] 3d¹⁰ 4s¹');
eq('Pd config (exception)', configText(46), '[Kr] 4d¹⁰');
eq('Gd config', configText(64), '[Xe] 4f⁷ 5d¹ 6s²');
eq('Pb config', configText(82), '[Xe] 4f¹⁴ 5d¹⁰ 6s² 6p²');
eq('U config', configText(92), '[Rn] 5f³ 6d¹ 7s²');
eq('H config', configText(1), '1s¹');
eq('Na shells', element(11).shells, [2, 8, 1]);
eq('Ca shells', element(20).shells, [2, 8, 8, 2]);
eq('Fe shells', element(26).shells, [2, 8, 14, 2]);
eq('Br shells', element(35).shells, [2, 8, 18, 7]);
eq('shells sum to Z', ELEMENTS.every((e) => e.shells.reduce((a, b) => a + b, 0) === e.z), true);
eq('Fe group/period/block', [element(26).group, element(26).period, element(26).block], [8, 4, 'd']);
eq('He group 18, s-block', [element(2).group, element(2).block], [18, 's']);
eq('Al group 13, p-block', [element(13).group, element(13).block], [13, 'p']);
eq('Ce has no group, f-block', [element(58).group, element(58).block, element(58).period], [null, 'f', 6]);
eq('Lu group 3', element(71).group, 3);
eq('Hf group 4', element(72).group, 4);
eq('Og group 18 period 7', [element(118).group, element(118).period], [18, 7]);
eq('grid cells unique', new Set(ELEMENTS.map((e) => `${e.col},${e.row}`)).size, 118);
eq('periods hold 2, 8, 8, 18, 18, 32, 32', [1, 2, 3, 4, 5, 6, 7].map((n) => ELEMENTS.filter((e) => e.period === n).length), [2, 8, 8, 18, 18, 32, 32]);
eq('liquids at 25 °C are Br and Hg', ELEMENTS.filter((e) => e.state === 'l').map((e) => e.symbol), ['Br', 'Hg']);
eq('gases at 25 °C', ELEMENTS.filter((e) => e.state === 'g').map((e) => e.symbol), ['H', 'He', 'N', 'O', 'F', 'Ne', 'Cl', 'Ar', 'Kr', 'Xe', 'Rn']);
near('F electronegativity 3.98', element(9).en ?? 0, 3.98, 0);
near('Cl mass 35.45', element(17).massValue, 35.45, 0);
near('O first IE 1313.9', element(8).ie ?? 0, 1313.9, 0);
eq('Tc mass bracketed', element(43).mass, '[98]');
eq('Cs radius 298 pm', element(55).radius, 298);

console.log(failures ? `\n${failures} failed` : '\nall passed');
if (failures) process.exit(1);
