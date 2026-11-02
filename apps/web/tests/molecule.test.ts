/**
 * Checks the molecule builder's chemistry: formulas, molar masses, hydrogens from valence,
 * rings, and the edits made on the card.
 * Run: node tests/molecule.test.ts   (from apps/web)
 */

import {
  MOLECULE_PRESETS, addAtom, analyse, atomInfo, bondTo, cycleBond, encodeMol, freeAngles, growFrom,
  molFromStructure, parseMol, removeAtom,
} from '../src/sim/molecule.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `-> ${detail}`);
}
const eq = (name: string, got: unknown, want: unknown) => check(name, got === want, `got ${String(got)}, want ${String(want)}`);
const near = (name: string, got: number, want: number, tol = 0.02) => check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);

// --- every preset: formula and molar mass against PubChem ----------------------------------------
const WANT: Record<string, [string, number, number | null]> = {
  Benzene: ['C₆H₆', 78.11, 4], Methane: ['CH₄', 16.04, 0], Ethane: ['C₂H₆', 30.07, 0], Ethene: ['C₂H₄', 28.05, 1],
  Ethyne: ['C₂H₂', 26.04, 2], Ethanol: ['C₂H₆O', 46.07, 0], 'Ethanoic acid': ['C₂H₄O₂', 60.05, 1], Water: ['H₂O', 18.02, null],
  Ammonia: ['H₃N', 17.03, null], 'Carbon dioxide': ['CO₂', 44.01, 2], Cyclohexane: ['C₆H₁₂', 84.16, 1], Phenol: ['C₆H₆O', 94.11, 4],
  Toluene: ['C₇H₈', 92.14, 4], Glucose: ['C₆H₁₂O₆', 180.16, 1], Aspirin: ['C₉H₈O₄', 180.16, 6], Caffeine: ['C₈H₁₀N₄O₂', 194.19, 6],
  Acetone: ['C₃H₆O', 58.08, 1], Propane: ['C₃H₈', 44.10, 0], Butane: ['C₄H₁₀', 58.12, 0], Methanol: ['CH₄O', 32.04, 0],
  Formaldehyde: ['CH₂O', 30.03, 1], Urea: ['CH₄N₂O', 60.06, 1], Naphthalene: ['C₁₀H₈', 128.17, 7], 'Ethyl ethanoate': ['C₄H₈O₂', 88.11, 1],
  Pyridine: ['C₅H₅N', 79.10, 4], Chloroform: ['CHCl₃', 119.37, 0], Glycine: ['C₂H₅NO₂', 75.07, 1], 'Benzoic acid': ['C₇H₆O₂', 122.12, 5],
  Nitrobenzene: ['C₆H₅NO₂', 123.11, 5], Aniline: ['C₆H₇N', 93.13, 4],
};
eq('30 presets', MOLECULE_PRESETS.length, 30);
for (const pr of MOLECULE_PRESETS) {
  const want = WANT[pr.label];
  if (!want) {
    check(`${pr.label} has an expected value`, false, 'missing from the table');
    continue;
  }
  const an = analyse(parseMol(String(pr.params.atoms), String(pr.params.bonds)));
  eq(`${pr.label} formula`, an.formula, want[0]);
  near(`${pr.label} molar mass`, an.mass, want[1]);
  if (want[2] !== null) eq(`${pr.label} unsaturation`, an.dou, want[2]);
  eq(`${pr.label} valence all OK`, an.errors, 0);
}

// --- rings ---------------------------------------------------------------------------------------
const ring = (label: string) => {
  const pr = MOLECULE_PRESETS.find((p) => p.label === label)!;
  return analyse(parseMol(String(pr.params.atoms), String(pr.params.bonds)));
};
eq('benzene: one ring', ring('Benzene').rings.length, 1);
eq('benzene: aromatic', ring('Benzene').aromatic.length, 1);
eq('cyclohexane: not aromatic', ring('Cyclohexane').aromatic.length, 0);
eq('naphthalene: two rings', ring('Naphthalene').rings.length, 2);
eq('caffeine: two rings', ring('Caffeine').rings.length, 2);

// --- valence rules ----------------------------------------------------------------------------------
eq('C with no bonds: 4 H', atomInfo('C', 0, 0).h, 4);
eq('N⁺ with 4 bonds: no H, fine', atomInfo('N', 1, 4).error, false);
eq('O⁻ with 1 bond: no H', atomInfo('O', -1, 1).h, 0);
eq('O with 1 bond: 1 H, 2 lone pairs', `${atomInfo('O', 0, 1).h}/${atomInfo('O', 0, 1).lone}`, '1/2');
eq('S with 6 bonds (SF₆-like) is allowed', atomInfo('S', 0, 6).error, false);
eq('C with 5 bonds is an error', atomInfo('C', 0, 5).error, true);
eq('N with 1 bond: 2 H, 1 lone pair', `${atomInfo('N', 0, 1).h}/${atomInfo('N', 0, 1).lone}`, '2/1');
eq('Cl alone: 1 H (HCl)', atomInfo('Cl', 0, 0).h, 1);

// --- editing ---------------------------------------------------------------------------------------
let m = addAtom({ atoms: [], bonds: [] }, 'C', 0, 0);
eq('one C is methane', analyse(m).formula, 'CH₄');
m = growFrom(m, 0, 'C', 1);
eq('grow: ethane', analyse(m).formula, 'C₂H₆');
near('grow: one bond length', Math.hypot(m.atoms[1].x - m.atoms[0].x, m.atoms[1].y - m.atoms[0].y), 1, 1e-9);
m = growFrom(m, 1, 'C', 1);
eq('grow again: propane', analyse(m).formula, 'C₃H₈');
const a012 = Math.atan2(m.atoms[0].y - m.atoms[1].y, m.atoms[0].x - m.atoms[1].x) - Math.atan2(m.atoms[2].y - m.atoms[1].y, m.atoms[2].x - m.atoms[1].x);
near('zig-zag at 120°', Math.abs(((a012 * 180) / Math.PI + 540) % 360 - 180), 120, 1e-6);
m = cycleBond(m, 0);
eq('cycle bond: propene', analyse(m).formula, 'C₃H₆');
m = cycleBond(cycleBond(m, 0), 0);
eq('cycle twice more: back to single', m.bonds[0].o, 1);
m = bondTo(m, 2, 5, 5, 'O', 1);
eq('bond to a new O: propanol', analyse(m).formula, 'C₃H₈O');
m = bondTo(m, 0, m.atoms[2].x, m.atoms[2].y, 'C', 1);
eq('bond to an existing atom closes a ring', analyse(m).rings.length, 1);
m = removeAtom(m, 1);
eq('remove an atom renumbers bonds', m.bonds.every((b) => b.a < m.atoms.length && b.b < m.atoms.length), true);

// --- settings round trip -------------------------------------------------------------------------------
const asp = MOLECULE_PRESETS.find((p) => p.label === 'Aspirin')!;
const parsed = parseMol(String(asp.params.atoms), String(asp.params.bonds));
const again = encodeMol(parsed);
eq('round trip: atoms', again.atoms, String(asp.params.atoms).replace(/(^|[,;])-0(?=[,;]|$)/g, '$10'));
eq('round trip: bonds', again.bonds, String(asp.params.bonds));
eq('bad input is skipped', parseMol('C,0,0;X;O,a,1;N,1,0', '0-1-2;0-0-1;0-9-1;0-1-1').bonds.length, 1);

// --- from PubChem's shape (explicit hydrogens) ----------------------------------------------------------
const water = molFromStructure({
  atoms: [{ el: 'O', x: 0, y: 0 }, { el: 'H', x: 1, y: 0 }, { el: 'H', x: -0.3, y: 0.95 }],
  bonds: [{ a: 0, b: 1, order: 1 }, { a: 0, b: 2, order: 1 }],
});
eq('PubChem water: hydrogens folded in', water.atoms.split(';').length, 1);
eq('PubChem water: formula', analyse(parseMol(water.atoms, water.bonds)).formula, 'H₂O');
const ammonium = molFromStructure({ atoms: [{ el: 'N', x: 0, y: 0, charge: 1 }], bonds: [] });
eq('ammonium ion', analyse(parseMol(ammonium.atoms, ammonium.bonds)).formula, 'H₄N⁺');

// --- placing hydrogens --------------------------------------------------------------------------------------
const spread = freeAngles([0], 3).map((a) => Math.round((a * 180) / Math.PI)).sort((x, y) => x - y);
eq('3 H round one bond go at 90/180/270', spread.join(','), '90,180,270');
eq('no gaps asked: none given', freeAngles([0, 1], 0).length, 0);

console.log(failures ? `\n${failures} failed` : '\nall passed');
if (failures) process.exit(1);
