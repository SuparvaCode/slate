/**
 * Element data for the periodic table simulator, one line per element:
 *
 *   symbol name mass category electronegativity radius ionisation state valency
 *
 * - mass: IUPAC standard atomic weight (abridged); [n] is the mass number of the longest-lived
 *   isotope for elements with no stable one.
 * - category: am alkali metal, ae alkaline earth metal, tm transition metal, pt post-transition
 *   metal, md metalloid, nm reactive non-metal, hl halogen, ng noble gas, la lanthanide,
 *   ac actinide, un properties unknown.
 * - electronegativity: Pauling scale (WebElements values, CRC for the rest).
 * - radius: calculated atomic radius in pm (Clementi et al. 1967); '-' where none was calculated.
 * - ionisation: first ionisation energy, kJ/mol (CRC; values from Rf on are predictions).
 * - state at 25 °C and 1 atm: s solid, l liquid, g gas, u unknown.
 * - valency: common valencies, the usual one first. 0 for noble gases.
 *
 * '-' means no value. Group, period, block and electron configuration are worked out in code.
 */

const RAW = `
H Hydrogen 1.008 nm 2.20 53 1312.0 g 1
He Helium 4.0026 ng - 31 2372.3 g 0
Li Lithium 6.94 am 0.98 167 520.2 s 1
Be Beryllium 9.0122 ae 1.57 112 899.5 s 2
B Boron 10.81 md 2.04 87 800.6 s 3
C Carbon 12.011 nm 2.55 67 1086.5 s 4
N Nitrogen 14.007 nm 3.04 56 1402.3 g 3,5
O Oxygen 15.999 nm 3.44 48 1313.9 g 2
F Fluorine 18.998 hl 3.98 42 1681.0 g 1
Ne Neon 20.180 ng - 38 2080.7 g 0
Na Sodium 22.990 am 0.93 190 495.8 s 1
Mg Magnesium 24.305 ae 1.31 145 737.7 s 2
Al Aluminium 26.982 pt 1.61 118 577.5 s 3
Si Silicon 28.085 md 1.90 111 786.5 s 4
P Phosphorus 30.974 nm 2.19 98 1011.8 s 3,5
S Sulfur 32.06 nm 2.58 88 999.6 s 2,4,6
Cl Chlorine 35.45 hl 3.16 79 1251.2 g 1,3,5,7
Ar Argon 39.95 ng - 71 1520.6 g 0
K Potassium 39.098 am 0.82 243 418.8 s 1
Ca Calcium 40.078 ae 1.00 194 589.8 s 2
Sc Scandium 44.956 tm 1.36 184 633.1 s 3
Ti Titanium 47.867 tm 1.54 176 658.8 s 4,3
V Vanadium 50.942 tm 1.63 171 650.9 s 5,4,3,2
Cr Chromium 51.996 tm 1.66 166 652.9 s 3,6,2
Mn Manganese 54.938 tm 1.55 161 717.3 s 2,4,7
Fe Iron 55.845 tm 1.83 156 762.5 s 2,3
Co Cobalt 58.933 tm 1.88 152 760.4 s 2,3
Ni Nickel 58.693 tm 1.91 149 737.1 s 2
Cu Copper 63.546 tm 1.90 145 745.5 s 2,1
Zn Zinc 65.38 tm 1.65 142 906.4 s 2
Ga Gallium 69.723 pt 1.81 136 578.8 s 3
Ge Germanium 72.630 md 2.01 125 762 s 4
As Arsenic 74.922 md 2.18 114 947.0 s 3,5
Se Selenium 78.971 nm 2.55 103 941.0 s 2,4,6
Br Bromine 79.904 hl 2.96 94 1139.9 l 1,5
Kr Krypton 83.798 ng 3.00 88 1350.8 g 0
Rb Rubidium 85.468 am 0.82 265 403.0 s 1
Sr Strontium 87.62 ae 0.95 219 549.5 s 2
Y Yttrium 88.906 tm 1.22 212 600 s 3
Zr Zirconium 91.224 tm 1.33 206 640.1 s 4
Nb Niobium 92.906 tm 1.6 198 652.1 s 5
Mo Molybdenum 95.95 tm 2.16 190 684.3 s 6,4
Tc Technetium [98] tm 1.9 183 686.9 s 7,4
Ru Ruthenium 101.07 tm 2.2 178 710.2 s 3,4
Rh Rhodium 102.91 tm 2.28 173 719.7 s 3
Pd Palladium 106.42 tm 2.20 169 804.4 s 2,4
Ag Silver 107.87 tm 1.93 165 731.0 s 1
Cd Cadmium 112.41 tm 1.69 161 867.8 s 2
In Indium 114.82 pt 1.78 156 558.3 s 3
Sn Tin 118.71 pt 1.96 145 708.6 s 4,2
Sb Antimony 121.76 md 2.05 133 834 s 3,5
Te Tellurium 127.60 md 2.1 123 869.3 s 2,4,6
I Iodine 126.90 hl 2.66 115 1008.4 s 1,5,7
Xe Xenon 131.29 ng 2.6 108 1170.4 g 0
Cs Caesium 132.91 am 0.79 298 375.7 s 1
Ba Barium 137.33 ae 0.89 253 502.9 s 2
La Lanthanum 138.91 la 1.10 - 538.1 s 3
Ce Cerium 140.12 la 1.12 - 534.4 s 3,4
Pr Praseodymium 140.91 la 1.13 247 527 s 3
Nd Neodymium 144.24 la 1.14 206 533.1 s 3
Pm Promethium [145] la 1.13 205 540 s 3
Sm Samarium 150.36 la 1.17 238 544.5 s 3,2
Eu Europium 151.96 la 1.2 231 547.1 s 3,2
Gd Gadolinium 157.25 la 1.20 233 593.4 s 3
Tb Terbium 158.93 la 1.1 225 565.8 s 3
Dy Dysprosium 162.50 la 1.22 228 573.0 s 3
Ho Holmium 164.93 la 1.23 226 581.0 s 3
Er Erbium 167.26 la 1.24 226 589.3 s 3
Tm Thulium 168.93 la 1.25 222 596.7 s 3
Yb Ytterbium 173.05 la 1.1 222 603.4 s 3,2
Lu Lutetium 174.97 la 1.27 217 523.5 s 3
Hf Hafnium 178.49 tm 1.3 208 658.5 s 4
Ta Tantalum 180.95 tm 1.5 200 761 s 5
W Tungsten 183.84 tm 2.36 193 770 s 6,4
Re Rhenium 186.21 tm 1.9 188 760 s 7,4
Os Osmium 190.23 tm 2.2 185 840 s 4,8
Ir Iridium 192.22 tm 2.20 180 880 s 3,4
Pt Platinum 195.08 tm 2.28 177 870 s 2,4
Au Gold 196.97 tm 2.54 174 890.1 s 3,1
Hg Mercury 200.59 tm 2.00 171 1007.1 l 2,1
Tl Thallium 204.38 pt 1.62 156 589.4 s 1,3
Pb Lead 207.2 pt 2.33 154 715.6 s 2,4
Bi Bismuth 208.98 pt 2.02 143 703 s 3
Po Polonium [209] pt 2.0 135 812.1 s 4,2
At Astatine [210] hl 2.2 127 899.0 s 1
Rn Radon [222] ng - 120 1037 g 0
Fr Francium [223] am 0.7 - 393 s 1
Ra Radium [226] ae 0.9 - 509.3 s 2
Ac Actinium [227] ac 1.1 - 499 s 3
Th Thorium 232.04 ac 1.3 - 587 s 4
Pa Protactinium 231.04 ac 1.5 - 568 s 5
U Uranium 238.03 ac 1.38 - 597.6 s 6,4
Np Neptunium [237] ac 1.36 - 604.5 s 5
Pu Plutonium [244] ac 1.28 - 584.7 s 4
Am Americium [243] ac 1.3 - 578 s 3
Cm Curium [247] ac 1.3 - 581 s 3
Bk Berkelium [247] ac 1.3 - 601 s 3,4
Cf Californium [251] ac 1.3 - 608 s 3
Es Einsteinium [252] ac 1.3 - 619 s 3
Fm Fermium [257] ac 1.3 - 629 s 3
Md Mendelevium [258] ac 1.3 - 636 s 3,2
No Nobelium [259] ac 1.3 - 639 s 2,3
Lr Lawrencium [266] ac 1.3 - 479 s 3
Rf Rutherfordium [267] tm - - 580 u 4
Db Dubnium [268] tm - - 665 u 5
Sg Seaborgium [269] tm - - 757 u 6
Bh Bohrium [270] tm - - 740 u 7
Hs Hassium [269] tm - - 730 u 8
Mt Meitnerium [278] un - - 800 u -
Ds Darmstadtium [281] un - - 960 u -
Rg Roentgenium [282] un - - 1020 u -
Cn Copernicium [285] un - - 1155 u -
Nh Nihonium [286] un - - 707.2 u -
Fl Flerovium [289] un - - 832.2 u -
Mc Moscovium [290] un - - 538.3 u -
Lv Livermorium [293] un - - 663.9 u -
Ts Tennessine [294] un - - 736.9 u -
Og Oganesson [294] un - - 860.1 u -
`;

export type Category = 'am' | 'ae' | 'tm' | 'pt' | 'md' | 'nm' | 'hl' | 'ng' | 'la' | 'ac' | 'un';
export type State = 's' | 'l' | 'g' | 'u';
export type Block = 's' | 'p' | 'd' | 'f';

export interface Element {
  z: number;
  symbol: string;
  name: string;
  /** As printed: "32.06", or "[98]" for a mass number. */
  mass: string;
  /** Mass as a number (the mass number for bracketed ones). */
  massValue: number;
  /** Mass is a mass number of the longest-lived isotope, not an average. */
  unstable: boolean;
  category: Category;
  en: number | null;
  radius: number | null;
  ie: number | null;
  state: State;
  valency: number[];
  /** Grid position: col 0..17, row 0..6 for the main table, 7 and 8 for the f-block rows. */
  col: number;
  row: number;
  period: number;
  /** Group 1..18; Lu and Lr are group 3, the other f-row elements (La..Yb, Ac..No) have none. */
  group: number | null;
  block: Block;
  /** Electrons in each subshell, e.g. { '1s': 2, '2s': 2, '2p': 4 }. */
  subshells: Record<string, number>;
  /** Electrons in shells n = 1, 2, 3... */
  shells: number[];
}

export const CATEGORY_NAMES: Record<Category, string> = {
  am: 'Alkali metal',
  ae: 'Alkaline earth metal',
  tm: 'Transition metal',
  pt: 'Post-transition metal',
  md: 'Metalloid',
  nm: 'Reactive non-metal',
  hl: 'Halogen',
  ng: 'Noble gas',
  la: 'Lanthanide',
  ac: 'Actinide',
  un: 'Unknown properties',
};

export const STATE_NAMES: Record<State, string> = { s: 'Solid', l: 'Liquid', g: 'Gas', u: 'Unknown' };

/** Filling order of the subshells (Madelung rule). */
const AUFBAU = ['1s', '2s', '2p', '3s', '3p', '4s', '3d', '4p', '5s', '4d', '5p', '6s', '4f', '5d', '6p', '7s', '5f', '6d', '7p'];
const CAP: Record<string, number> = { s: 2, p: 6, d: 10, f: 14 };

/** Ground states that break the Madelung order: the subshells that differ from it. */
const EXCEPTIONS: Record<number, Record<string, number>> = {
  24: { '4s': 1, '3d': 5 },
  29: { '4s': 1, '3d': 10 },
  41: { '5s': 1, '4d': 4 },
  42: { '5s': 1, '4d': 5 },
  44: { '5s': 1, '4d': 7 },
  45: { '5s': 1, '4d': 8 },
  46: { '5s': 0, '4d': 10 },
  47: { '5s': 1, '4d': 10 },
  57: { '4f': 0, '5d': 1 },
  58: { '4f': 1, '5d': 1 },
  64: { '4f': 7, '5d': 1 },
  78: { '6s': 1, '5d': 9 },
  79: { '6s': 1, '5d': 10 },
  89: { '5f': 0, '6d': 1 },
  90: { '5f': 0, '6d': 2 },
  91: { '5f': 2, '6d': 1 },
  92: { '5f': 3, '6d': 1 },
  93: { '5f': 4, '6d': 1 },
  96: { '5f': 7, '6d': 1 },
  103: { '6d': 0, '7p': 1 },
};

function subshellsOf(z: number): Record<string, number> {
  const out: Record<string, number> = {};
  let left = z;
  for (const sub of AUFBAU) {
    if (left <= 0) break;
    const k = Math.min(left, CAP[sub[1]]);
    out[sub] = k;
    left -= k;
  }
  const ex = EXCEPTIONS[z];
  if (ex) for (const [sub, k] of Object.entries(ex)) out[sub] = k;
  for (const sub of Object.keys(out)) if (out[sub] === 0) delete out[sub];
  return out;
}

const L_ORDER: Record<string, number> = { s: 0, p: 1, d: 2, f: 3 };
const bySubshell = (a: string, b: string) => Number(a[0]) - Number(b[0]) || L_ORDER[a[1]] - L_ORDER[b[1]];

const NOBLE: [number, string][] = [[86, 'Rn'], [54, 'Xe'], [36, 'Kr'], [18, 'Ar'], [10, 'Ne'], [2, 'He']];
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const sup = (n: number) => String(n).split('').map((d) => SUP[Number(d)]).join('');

/** The subshells beyond the noble-gas core, in n then l order, and the core's symbol. */
function configParts(z: number): { core: string | null; parts: [string, number][] } {
  const own = subshellsOf(z);
  const nb = NOBLE.find(([zz]) => zz < z);
  const core = nb ? subshellsOf(nb[0]) : {};
  const parts = Object.keys(own)
    .filter((sub) => own[sub] !== core[sub])
    .sort(bySubshell)
    .map((sub): [string, number] => [sub, own[sub]]);
  return { core: nb ? nb[1] : null, parts };
}

/** Electron configuration with a noble-gas core and superscripts: "[Ne] 3s² 3p⁴". */
export function configText(z: number): string {
  const { core, parts } = configParts(z);
  const body = parts.map(([sub, k]) => `${sub}${sup(k)}`).join(' ');
  return core ? `[${core}] ${body}` : body;
}

/** The same in KaTeX: "[\mathrm{Ne}]\,3s^{2}\,3p^{4}". */
export function configTex(z: number): string {
  const { core, parts } = configParts(z);
  const body = parts.map(([sub, k]) => `${sub}^{${k}}`).join('\\,');
  return core ? `[\\mathrm{${core}}]\\,${body}` : body;
}

/** Full configuration without the core: "1s² 2s² 2p⁶ 3s² 3p⁴". */
export function fullConfigText(z: number): string {
  const own = subshellsOf(z);
  return Object.keys(own).sort(bySubshell).map((sub) => `${sub}${sup(own[sub])}`).join(' ');
}

const PERIOD_END = [2, 10, 18, 36, 54, 86, 118];

function place(z: number): { col: number; row: number; period: number } {
  const period = PERIOD_END.findIndex((e) => z <= e) + 1;
  const start = period === 1 ? 1 : PERIOD_END[period - 2] + 1;
  const i = z - start;
  if (period === 1) return { col: z === 1 ? 0 : 17, row: 0, period };
  if (period <= 3) return { col: i < 2 ? i : i + 10, row: period - 1, period };
  if (period <= 5) return { col: i, row: period - 1, period };
  // Periods 6 and 7: s-block, then the f-block row below, then d and p from group 4 on.
  if (i < 2) return { col: i, row: period - 1, period };
  if (i < 17) return { col: i, row: period + 1, period };
  return { col: i - 14, row: period - 1, period };
}

function parse(line: string, z: number): Element {
  const [symbol, name, mass, cat, en, r, ie, st, val] = line.split(' ');
  const unstable = mass.startsWith('[');
  const { col, row, period } = place(z);
  const fRow = row >= 7;
  const group = fRow ? (z === 71 || z === 103 ? 3 : null) : col + 1;
  let block: Block;
  if (z === 2) block = 's';
  else if (fRow) block = z === 71 || z === 103 ? 'd' : 'f';
  else if (col < 2) block = 's';
  else if (col < 12) block = 'd';
  else block = 'p';
  const subshells = subshellsOf(z);
  const shells: number[] = [];
  for (const [sub, k] of Object.entries(subshells)) {
    const n = Number(sub[0]);
    shells[n - 1] = (shells[n - 1] ?? 0) + k;
  }
  for (let i = 0; i < shells.length; i++) shells[i] = shells[i] ?? 0;
  const numOrNull = (s: string) => (s === '-' ? null : Number(s));
  return {
    z, symbol, name, mass, unstable,
    massValue: Number(mass.replace(/[[\]]/g, '')),
    category: cat as Category,
    en: numOrNull(en), radius: numOrNull(r), ie: numOrNull(ie),
    state: st as State,
    valency: val === '-' ? [] : val.split(',').map(Number),
    col, row, period, group, block, subshells, shells,
  };
}

export const ELEMENTS: Element[] = RAW.trim().split('\n').map((l, i) => parse(l.trim(), i + 1));

export const element = (z: number): Element => ELEMENTS[Math.max(1, Math.min(118, Math.round(z))) - 1];
