/**
 * Chemical structures by name, from PubChem's 2D coordinates (public domain, no key needed).
 * Port of molecule.py. Anything PubChem does not know falls back to the model.
 */
import { ClientGone } from './errors.ts';

const PUBCHEM = (name: string) => `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${quote(name)}/JSON?record_type=2d`;
const TIMEOUT_MS = 6000;
const BOND = 1.3; // grid units between bonded atoms
const MAX_W = 22;
const MAX_H = 15;

const SYMBOLS = (
  'H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As Se Br Kr ' +
  'Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu Gd Tb Dy Ho Er Tm Yb ' +
  'Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np Pu Am Cm Bk Cf Es Fm Md No Lr ' +
  'Rf Db Sg Bh Hs Mt Ds Rg Cn Nh Fl Mc Lv Ts Og'
).split(' ');

// Words that make a request worth looking up, and words to strip to get the compound name.
const CHEM = /structur|molecul|compound|formula|chemical|organic|\bacid\b|benzene|\w+(?:ol|ane|ene|yne|one|al|ide|ate|ine)\b/i;
const NOT_CHEM = /circuit|pulley|incline|graph|triangle|block|resistor|lens|force/i;
const FILLER =
  /\b(draw|show|sketch|make|give|me|please|the|a|an|of|for|its|it|2d|3d|full|complete|structural|structure|skeletal|displayed|expanded|condensed|lewis|formula|molecule|molecular|compound|diagram)\b/gi;

/** urllib.parse.quote(name, safe=""): only letters, digits and _.-~ stay as they are. */
function quote(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

const capitalize = (s: string) => s.slice(0, 1).toUpperCase() + s.slice(1);
const round = (x: number, d: number) => Math.round(x * 10 ** d) / 10 ** d;

/** The compound a request names, or null if it does not look like a chemistry request. */
export function compoundName(prompt: string): string | null {
  const p = prompt.trim();
  if (p.length > 120 || NOT_CHEM.test(p)) return null;
  const name = p.replace(FILLER, ' ').replace(/\s+/g, ' ').trim().replace(/^[ .,:;?!'"]+|[ .,:;?!'"]+$/g, '');
  // A bare name ("aspirin", "glucose") is worth a lookup too; PubChem says no quickly.
  if (!name || name.split(/\s+/).length > (CHEM.test(p) ? 5 : 2)) return null;
  return name;
}

const SUB = '₀₁₂₃₄₅₆₇₈₉';

/** Hill order: carbon, then hydrogen, then the rest alphabetically; with no carbon, all alphabetical. */
export function hill(counts: Map<string, number>): string {
  const part = (el: string) => {
    const n = counts.get(el)!;
    return el + (n > 1 ? [...String(n)].map((d) => SUB[Number(d)]).join('') : '');
  };
  const first = counts.has('C') ? ['C', 'H'].filter((el) => counts.has(el)) : [];
  const rest = [...counts.keys()].filter((el) => !first.includes(el)).sort();
  return [...first, ...rest].map(part).join('');
}

interface Parsed {
  aids: number[];
  els: Map<number, string>;
  charges: Map<number, number>;
  pos: Map<number, [number, number]>;
  bonds: [number, number, number][];
  counts: Map<string, number>;
  cid: number;
}

function read(record: any): Parsed {
  const atoms = record.atoms;
  const aids: number[] = atoms.aid;
  const els = new Map<number, string>();
  aids.forEach((a, i) => {
    const e = atoms.element[i];
    els.set(a, e > 0 && e <= SYMBOLS.length ? SYMBOLS[e - 1] : 'X');
  });
  const charges = new Map<number, number>((atoms.charge ?? []).map((c: any) => [c.aid, c.value]));
  const conf = record.coords[0].conformers[0];
  const pos = new Map<number, [number, number]>();
  record.coords[0].aid.forEach((a: number, i: number) => pos.set(a, [conf.x[i], -conf.y[i]])); // PubChem y is up
  const b = record.bonds ?? { aid1: [], aid2: [], order: [] };
  const bonds: [number, number, number][] = b.aid1.map((a1: number, i: number) => [a1, b.aid2[i], b.order[i]]);
  const counts = new Map<string, number>();
  for (const el of els.values()) counts.set(el, (counts.get(el) ?? 0) + 1);
  const cid = record.id.id.cid;
  if (typeof cid !== 'number') throw new TypeError('no cid');
  return { aids, els, charges, pos, bonds, counts, cid };
}

/** Hydrogens bonded to carbon. */
function hOnCarbon(p: Parsed): Set<number> {
  const drop = new Set<number>();
  for (const [a1, a2] of p.bonds) {
    for (const [h, other] of [[a1, a2], [a2, a1]]) if (p.els.get(h) === 'H' && p.els.get(other) === 'C') drop.add(h);
  }
  return drop;
}

function medianBond(p: Parsed, bonds: [number, number, number][]): number {
  const lengths = bonds.map(([a1, a2]) => Math.hypot(p.pos.get(a1)![0] - p.pos.get(a2)![0], p.pos.get(a1)![1] - p.pos.get(a2)![1])).sort((x, y) => x - y);
  if (!lengths.length) return 1;
  return lengths[Math.floor(lengths.length / 2)] || 1;
}

const clampOrder = (o: number) => Math.min(3, Math.max(1, o));

/** PubChem's 2D record as a Slate diagram. */
export function toDiagram(name: string, record: any): Record<string, unknown> {
  const p = read(record);
  // Textbook style: every hydrogen on small molecules; on bigger ones only those on N, O, S...
  const heavy = p.aids.filter((a) => p.els.get(a) !== 'H');
  const keepH = heavy.length <= 8;
  const drop = keepH ? new Set<number>() : hOnCarbon(p);
  const shown = p.aids.filter((a) => !drop.has(a));
  const bonds = p.bonds.filter(([a1, a2]) => !drop.has(a1) && !drop.has(a2));

  const k = BOND / medianBond(p, bonds);
  const xs = shown.map((a) => p.pos.get(a)![0] * k);
  const ys = shown.map((a) => p.pos.get(a)![1] * k);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  const fit = Math.min(1, (MAX_W - 2) / (w || 1), (MAX_H - 2.4) / (h || 1));
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);

  const parts: Record<string, unknown>[] = [];
  shown.forEach((a, i) => {
    const part: Record<string, unknown> = { id: `a${a}`, type: 'atom', el: p.els.get(a), at: [round(1 + (xs[i] - x0) * fit, 2), round(1.4 + (ys[i] - y0) * fit, 2)] };
    const q = p.charges.get(a);
    if (q) part.charge = Math.abs(q) === 1 ? (q > 0 ? '+' : '-') : `${Math.abs(q)}${q > 0 ? '+' : '-'}`;
    parts.push(part);
  });
  bonds.forEach(([a1, a2, o], i) => parts.push({ id: `b${i + 1}`, type: 'bond', from: `a${a1}`, to: `a${a2}`, order: clampOrder(o) }));

  const formula = hill(p.counts);
  return {
    title: `${capitalize(name)} (${formula})`,
    kind: 'chemistry',
    size: [round(w * fit + 2, 1), round(h * fit + 2.6, 1)],
    parts,
    marks: [],
    show: { forces: false, values: false, motion: false },
    notes: `Structure of ${name}, ${formula}. 2D layout from PubChem (CID ${p.cid})` + (keepH ? '.' : '; hydrogens on carbon are not drawn.'),
  };
}

/** Atoms and bonds for the editable simulator: bond length about 1, y down, centred; no H on C. */
export function toStructure(name: string, record: any): Record<string, unknown> {
  const p = read(record);
  const drop = hOnCarbon(p);
  const shown = p.aids.filter((a) => !drop.has(a));
  const bonds = p.bonds.filter(([a1, a2]) => !drop.has(a1) && !drop.has(a2));
  if (!shown.length) throw new RangeError('no atoms'); // Python: ZeroDivisionError
  const k = 1 / medianBond(p, bonds);
  const cx = shown.reduce((s, a) => s + p.pos.get(a)![0], 0) / shown.length;
  const cy = shown.reduce((s, a) => s + p.pos.get(a)![1], 0) / shown.length;
  const index = new Map(shown.map((a, i) => [a, i]));
  const atoms = shown.map((a) => {
    const atom: Record<string, unknown> = { el: p.els.get(a), x: round((p.pos.get(a)![0] - cx) * k, 3), y: round((p.pos.get(a)![1] - cy) * k, 3) };
    if (p.charges.get(a)) atom.charge = p.charges.get(a);
    return atom;
  });
  return {
    name: capitalize(name),
    formula: hill(p.counts),
    cid: p.cid,
    atoms,
    bonds: bonds.map(([a1, a2, o]) => ({ a: index.get(a1), b: index.get(a2), order: clampOrder(o) })),
  };
}

const diagramCache = new Map<string, Record<string, unknown> | null>();
const structCache = new Map<string, Record<string, unknown> | null>();
const CACHE_MAX = 2000;

async function fetchRecord(name: string, signal?: AbortSignal): Promise<{ status: number; record: any } | null> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const r = await fetch(PUBCHEM(name), { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (r.status !== 200) {
      await r.body?.cancel().catch(() => {});
      return { status: r.status, record: null };
    }
    const data: any = await r.json().catch(() => null);
    return { status: 200, record: data?.PC_Compounds?.[0] ?? null };
  } catch {
    if (signal?.aborted) throw new ClientGone();
    return null; // offline or slow: the model can still try
  }
}

function remember(cache: Map<string, Record<string, unknown> | null>, key: string, value: Record<string, unknown> | null): void {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
}

async function cached(
  cache: Map<string, Record<string, unknown> | null>, key: string, name: string,
  convert: (name: string, record: any) => Record<string, unknown>, signal?: AbortSignal,
): Promise<Record<string, unknown> | null> {
  if (cache.has(key)) return cache.get(key)!;
  const got = await fetchRecord(key, signal);
  if (!got) return null;
  let out: Record<string, unknown> | null = null;
  if (got.status === 200 && got.record) {
    try {
      out = convert(name, got.record);
    } catch {
      out = null;
    }
  }
  if (got.status === 200 || got.status === 404) remember(cache, key, out);
  return out;
}

/** The structure a request names, as a diagram, or null to let the model draw it. */
export async function lookup(prompt: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  const name = compoundName(prompt);
  if (!name) return null;
  return cached(diagramCache, name.toLowerCase(), name, toDiagram, signal);
}

/** Atoms and bonds for a compound name, or null if it is unknown or unreachable. */
export async function structure(name: string, signal?: AbortSignal): Promise<Record<string, unknown> | null> {
  const key = name.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!key || key.length > 80) return null;
  return cached(structCache, key, key, toStructure, signal);
}
