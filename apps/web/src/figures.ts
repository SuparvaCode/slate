/**
 * Classroom figures: shapes, solids, graph paper, physics apparatus, circuit symbols and
 * chemistry glassware. Each is a set of lines in a unit square (0 to 1 in x and y) that is
 * stretched to whatever box the user drags, so the line width never stretches with it.
 *
 * This file has no imports on purpose: the model, the renderer and the picker all use it.
 */

export type V = [number, number];

export interface FPath {
  pts: V[];
  /** Join the last point back to the first. */
  closed?: boolean;
  /** Tint the inside when the figure's fill is on. Only meaningful on closed paths. */
  fill?: boolean;
  /** Hidden edges of solids are dashed. */
  dash?: boolean;
  /** Arrowhead at the last point. */
  arrow?: boolean;
  /** A filled dot at the first point, this many line widths in radius. */
  dot?: number;
  /** Fine lines: graph paper, scale ticks, construction marks. */
  thin?: boolean;
}

export interface FigDef {
  label: string;
  /** Width over height of a natural-looking figure; also the default shape when placed with a tap. */
  ratio: number;
  paths: FPath[];
}

const deg = Math.PI / 180;
const arc = (cx: number, cy: number, rx: number, ry: number, a0: number, a1: number, n = 24): V[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = (a0 + ((a1 - a0) * i) / n) * deg;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as V;
  });
const ell = (cx: number, cy: number, rx: number, ry: number, n = 48): V[] => arc(cx, cy, rx, ry, 0, 360, n).slice(0, -1);
const ngon = (n: number, cx: number, cy: number, r: number, a0 = -90): V[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (a0 + (360 * i) / n) * deg;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as V;
  });
const L = (pts: V[], o: Omit<FPath, 'pts'> = {}): FPath => ({ pts, ...o });
const box = (x0: number, y0: number, x1: number, y1: number, o: Omit<FPath, 'pts' | 'closed'> = {}): FPath =>
  L([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], { closed: true, ...o });

function starPts(): V[] {
  const out: V[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 0.48 : 0.2;
    const a = (-90 + 36 * i) * deg;
    out.push([0.5 + r * Math.cos(a), 0.54 + r * Math.sin(a)]);
  }
  return out;
}

function protractor(): FPath[] {
  const cx = 0.5, cy = 0.96, rx = 0.45, ry = 0.9;
  const paths: FPath[] = [
    L(arc(cx, cy, rx, ry, 180, 360, 40)),
    L([[0.05, cy], [0.95, cy]]),
    L([[cx, cy], [cx, cy]], { dot: 1.3 }),
  ];
  for (let d = 0; d <= 180; d += 10) {
    const a = d * deg;
    const long = d % 30 === 0;
    const s = long ? 0.82 : 0.9;
    paths.push(L([[cx + rx * s * Math.cos(a), cy - ry * s * Math.sin(a)], [cx + rx * Math.cos(a), cy - ry * Math.sin(a)]], { thin: true }));
  }
  return paths;
}

function grid(n: number): FPath[] {
  const paths: FPath[] = [box(0.02, 0.02, 0.98, 0.98)];
  for (let i = 1; i < n; i++) {
    const t = 0.02 + (0.96 * i) / n;
    paths.push(L([[t, 0.02], [t, 0.98]], { thin: true }), L([[0.02, t], [0.98, t]], { thin: true }));
  }
  return paths;
}

function numberLine(): FPath[] {
  const paths: FPath[] = [L([[0.03, 0.5], [0.97, 0.5]], { arrow: true }), L([[0.97, 0.5], [0.03, 0.5]], { arrow: true })];
  for (let i = 1; i < 10; i++) {
    const x = i / 10;
    const mid = i === 5;
    paths.push(L([[x, mid ? 0.3 : 0.4], [x, mid ? 0.7 : 0.6]]));
  }
  return paths;
}

function spring(): FPath[] {
  const zig: V[] = [[0.04, 0.5], [0.16, 0.5]];
  for (let i = 1; i < 10; i++) zig.push([0.16 + i * 0.066, i % 2 ? 0.26 : 0.74]);
  zig.push([0.82, 0.5]);
  return [L([[0.04, 0.16], [0.04, 0.84]]), L(zig), box(0.82, 0.3, 0.96, 0.7, { fill: true })];
}

function lens(): FPath[] {
  const right: V[] = [];
  const left: V[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const y = 0.08 + 0.84 * t;
    const bulge = 0.15 * Math.sin(Math.PI * t);
    right.push([0.5 + bulge, y]);
    left.unshift([0.5 - bulge, y]);
  }
  return [
    L([[0.02, 0.5], [0.98, 0.5]], { thin: true }),
    L([...right, ...left], { closed: true, fill: true }),
    L([[0.25, 0.5], [0.25, 0.5]], { dot: 1.3 }),
    L([[0.75, 0.5], [0.75, 0.5]], { dot: 1.3 }),
  ];
}

function incline(): FPath[] {
  // A wedge, a block sitting on the slope, and the angle at the foot.
  const p0: V = [0.04, 0.92];
  const d: V = [0.8296, -0.559];
  const n: V = [-0.559, -0.8296];
  const at = (s: number, h: number): V => [p0[0] + d[0] * s + n[0] * h, p0[1] + d[1] * s + n[1] * h];
  return [
    L([p0, [0.96, 0.92], [0.96, 0.3]], { closed: true, fill: true }),
    L([at(0.45, 0), at(0.78, 0), at(0.78, 0.14), at(0.45, 0.14)], { closed: true, fill: true }),
    L(arc(0.04, 0.92, 0.2, 0.2, -34, 0, 10), { thin: true }),
  ];
}

function pulley(): FPath[] {
  return [
    L([[0.3, 0.05], [0.7, 0.05]]),
    L([[0.5, 0.05], [0.5, 0.16]]),
    L(ell(0.5, 0.28, 0.12, 0.12), { closed: true }),
    L([[0.5, 0.28], [0.5, 0.28]], { dot: 1.2 }),
    L([[0.38, 0.28], [0.38, 0.62]]),
    L([[0.62, 0.28], [0.62, 0.76]]),
    box(0.28, 0.62, 0.48, 0.78, { fill: true }),
    box(0.5, 0.76, 0.74, 0.96, { fill: true }),
  ];
}

function pendulum(): FPath[] {
  return [
    L([[0.3, 0.04], [0.7, 0.04]]),
    L([[0.5, 0.04], [0.5, 0.96]], { dash: true, thin: true }),
    L([[0.5, 0.04], [0.76, 0.74]]),
    L(ell(0.79, 0.82, 0.08, 0.08), { closed: true, fill: true }),
    L(arc(0.5, 0.04, 0.2, 0.2, 68.2, 90, 10), { thin: true }),
  ];
}

const wireTo = (x: number): V[] => [[0.02, 0.5], [x, 0.5]];
const wireFrom = (x: number): V[] => [[x, 0.5], [0.98, 0.5]];

const D = {
  // ---------------------------------------------------------------- shapes
  triangle: { label: 'Triangle', ratio: 1.1, paths: [L([[0.5, 0.04], [0.96, 0.96], [0.04, 0.96]], { closed: true, fill: true })] },
  rtriangle: {
    label: 'Right triangle', ratio: 1.2,
    paths: [
      L([[0.06, 0.94], [0.06, 0.06], [0.94, 0.94]], { closed: true, fill: true }),
      L([[0.18, 0.94], [0.18, 0.82], [0.06, 0.82]], { thin: true }),
    ],
  },
  pentagon: { label: 'Pentagon', ratio: 1, paths: [L(ngon(5, 0.5, 0.54, 0.48), { closed: true, fill: true })] },
  hexagon: { label: 'Hexagon', ratio: 1.12, paths: [L(ngon(6, 0.5, 0.5, 0.48, 0), { closed: true, fill: true })] },
  star: { label: 'Star', ratio: 1, paths: [L(starPts(), { closed: true, fill: true })] },
  parallelogram: { label: 'Parallelogram', ratio: 1.6, paths: [L([[0.24, 0.1], [0.96, 0.1], [0.76, 0.9], [0.04, 0.9]], { closed: true, fill: true })] },
  trapezoid: { label: 'Trapezoid', ratio: 1.6, paths: [L([[0.28, 0.12], [0.72, 0.12], [0.96, 0.88], [0.04, 0.88]], { closed: true, fill: true })] },
  circleR: {
    label: 'Circle with radius', ratio: 1,
    paths: [L(ell(0.5, 0.5, 0.48, 0.48), { closed: true, fill: true }), L([[0.5, 0.5], [0.94, 0.38]]), L([[0.5, 0.5], [0.5, 0.5]], { dot: 1.4 })],
  },
  // ---------------------------------------------------------------- solids
  cube: {
    label: 'Cube', ratio: 1,
    paths: [
      L([[0.08, 0.34], [0.66, 0.34], [0.66, 0.92], [0.08, 0.92]], { closed: true, fill: true }),
      L([[0.08, 0.34], [0.34, 0.08], [0.92, 0.08], [0.66, 0.34]], { closed: true, fill: true }),
      L([[0.66, 0.34], [0.92, 0.08], [0.92, 0.66], [0.66, 0.92]], { closed: true, fill: true }),
      L([[0.34, 0.08], [0.34, 0.66], [0.92, 0.66]], { dash: true, thin: true }),
      L([[0.08, 0.92], [0.34, 0.66]], { dash: true, thin: true }),
    ],
  },
  cylinder: {
    label: 'Cylinder', ratio: 0.8,
    paths: [
      L(ell(0.5, 0.16, 0.4, 0.11), { closed: true, fill: true }),
      L([[0.1, 0.16], [0.1, 0.84]]),
      L([[0.9, 0.16], [0.9, 0.84]]),
      L(arc(0.5, 0.84, 0.4, 0.11, 0, 180, 24)),
      L(arc(0.5, 0.84, 0.4, 0.11, 180, 360, 24), { dash: true, thin: true }),
    ],
  },
  cone: {
    label: 'Cone', ratio: 0.9,
    paths: [
      L([[0.08, 0.82], [0.5, 0.06], [0.92, 0.82]]),
      L(arc(0.5, 0.82, 0.42, 0.11, 0, 180, 24)),
      L(arc(0.5, 0.82, 0.42, 0.11, 180, 360, 24), { dash: true, thin: true }),
    ],
  },
  sphere: {
    label: 'Sphere', ratio: 1,
    paths: [
      L(ell(0.5, 0.5, 0.46, 0.46), { closed: true, fill: true }),
      L(arc(0.5, 0.5, 0.46, 0.14, 0, 180, 24), { thin: true }),
      L(arc(0.5, 0.5, 0.46, 0.14, 180, 360, 24), { dash: true, thin: true }),
    ],
  },
  pyramid: {
    label: 'Pyramid', ratio: 1.2,
    paths: [
      L([[0.5, 0.06], [0.1, 0.78], [0.62, 0.78]], { closed: true, fill: true }),
      L([[0.5, 0.06], [0.62, 0.78], [0.9, 0.58]], { closed: true, fill: true }),
      L([[0.5, 0.06], [0.38, 0.58], [0.9, 0.58]], { dash: true, thin: true }),
      L([[0.38, 0.58], [0.1, 0.78]], { dash: true, thin: true }),
    ],
  },
  // ------------------------------------------------------------------ maths
  axes: { label: 'Axes', ratio: 1, paths: [L([[0.04, 0.5], [0.96, 0.5]], { arrow: true }), L([[0.5, 0.96], [0.5, 0.04]], { arrow: true })] },
  numberline: { label: 'Number line', ratio: 4, paths: numberLine() },
  grid: { label: 'Graph paper', ratio: 1, paths: grid(8) },
  angle: {
    label: 'Angle', ratio: 1.3,
    paths: [L([[0.1, 0.85], [0.92, 0.85]]), L([[0.1, 0.85], [0.62, 0.12]]), L(arc(0.1, 0.85, 0.26, 0.26, -54.5, 0, 14), { thin: true })],
  },
  protractor: { label: 'Protractor', ratio: 2, paths: protractor() },
  venn: {
    label: 'Venn diagram', ratio: 1.5,
    paths: [L(ell(0.38, 0.5, 0.3, 0.45), { closed: true, fill: true }), L(ell(0.62, 0.5, 0.3, 0.45), { closed: true, fill: true })],
  },
  // ---------------------------------------------------------------- physics
  incline: { label: 'Inclined plane', ratio: 1.4, paths: incline() },
  pulley: { label: 'Pulley', ratio: 1, paths: pulley() },
  spring: { label: 'Spring and mass', ratio: 2.5, paths: spring() },
  lens: { label: 'Convex lens', ratio: 1.5, paths: lens() },
  pendulum: { label: 'Pendulum', ratio: 0.9, paths: pendulum() },
  // --------------------------------------------------------------- circuits
  battery: {
    label: 'Battery', ratio: 2,
    paths: [
      L(wireTo(0.4)), L([[0.4, 0.2], [0.4, 0.8]]), L([[0.48, 0.32], [0.48, 0.68]]),
      L([[0.56, 0.2], [0.56, 0.8]]), L([[0.64, 0.32], [0.64, 0.68]]), L(wireFrom(0.64)),
    ],
  },
  resistor: {
    label: 'Resistor', ratio: 2,
    paths: [L([[0.02, 0.5], [0.2, 0.5], [0.26, 0.2], [0.38, 0.8], [0.5, 0.2], [0.62, 0.8], [0.74, 0.2], [0.8, 0.5], [0.98, 0.5]])],
  },
  bulb: {
    label: 'Bulb', ratio: 2,
    paths: [
      L(wireTo(0.34)), L(ell(0.5, 0.5, 0.16, 0.32), { closed: true, fill: true }), L(wireFrom(0.66)),
      L([[0.387, 0.274], [0.613, 0.726]]), L([[0.387, 0.726], [0.613, 0.274]]),
    ],
  },
  switch: {
    label: 'Switch', ratio: 2,
    paths: [L(wireTo(0.3)), L([[0.3, 0.5], [0.3, 0.5]], { dot: 1.5 }), L([[0.3, 0.5], [0.66, 0.2]]), L([[0.7, 0.5], [0.7, 0.5]], { dot: 1.5 }), L(wireFrom(0.7))],
  },
  capacitor: {
    label: 'Capacitor', ratio: 2,
    paths: [L(wireTo(0.44)), L([[0.44, 0.2], [0.44, 0.8]]), L([[0.56, 0.2], [0.56, 0.8]]), L(wireFrom(0.56))],
  },
  ammeter: {
    label: 'Ammeter', ratio: 2,
    paths: [
      L(wireTo(0.34)), L(ell(0.5, 0.5, 0.16, 0.32), { closed: true }), L(wireFrom(0.66)),
      L([[0.43, 0.7], [0.5, 0.28], [0.57, 0.7]]), L([[0.46, 0.58], [0.54, 0.58]]),
    ],
  },
  voltmeter: {
    label: 'Voltmeter', ratio: 2,
    paths: [L(wireTo(0.34)), L(ell(0.5, 0.5, 0.16, 0.32), { closed: true }), L(wireFrom(0.66)), L([[0.43, 0.3], [0.5, 0.72], [0.57, 0.3]])],
  },
  ground: {
    label: 'Ground', ratio: 1,
    paths: [L([[0.5, 0.04], [0.5, 0.4]]), L([[0.2, 0.4], [0.8, 0.4]]), L([[0.32, 0.6], [0.68, 0.6]]), L([[0.44, 0.8], [0.56, 0.8]])],
  },
  // -------------------------------------------------------------- chemistry
  beaker: {
    label: 'Beaker', ratio: 0.85,
    paths: [
      L([[0.06, 0.06], [0.12, 0.1], [0.16, 0.94], [0.84, 0.94], [0.88, 0.1]]),
      L([[0.16, 0.34], [0.3, 0.34]], { thin: true }), L([[0.16, 0.5], [0.26, 0.5]], { thin: true }), L([[0.16, 0.66], [0.3, 0.66]], { thin: true }),
      L([[0.15, 0.44], [0.85, 0.44]], { dash: true, thin: true }),
    ],
  },
  flask: {
    label: 'Conical flask', ratio: 0.9,
    paths: [
      L([[0.34, 0.05], [0.66, 0.05]]),
      L([[0.38, 0.05], [0.38, 0.32], [0.1, 0.88], [0.14, 0.94], [0.86, 0.94], [0.9, 0.88], [0.62, 0.32], [0.62, 0.05]]),
      L([[0.2, 0.68], [0.8, 0.68]], { dash: true, thin: true }),
    ],
  },
  testtube: {
    label: 'Test tube', ratio: 0.4,
    paths: [
      L([[0.12, 0.05], [0.88, 0.05]]), L([[0.2, 0.05], [0.2, 0.82]]), L([[0.8, 0.05], [0.8, 0.82]]),
      L(arc(0.5, 0.82, 0.3, 0.12, 0, 180, 20)), L([[0.2, 0.55], [0.8, 0.55]], { dash: true, thin: true }),
    ],
  },
  funnel: {
    label: 'Funnel', ratio: 0.9,
    paths: [L([[0.06, 0.08], [0.94, 0.08]]), L([[0.06, 0.08], [0.46, 0.52], [0.46, 0.95]]), L([[0.94, 0.08], [0.54, 0.52], [0.54, 0.95]])],
  },
} satisfies Record<string, FigDef>;

export type FigureKind = keyof typeof D;
export const FIGURES: Record<FigureKind, FigDef> = D;

export const FIGURE_GROUPS: { title: string; kinds: FigureKind[] }[] = [
  { title: 'Shapes', kinds: ['triangle', 'rtriangle', 'pentagon', 'hexagon', 'star', 'parallelogram', 'trapezoid', 'circleR'] },
  { title: 'Solids', kinds: ['cube', 'cylinder', 'cone', 'sphere', 'pyramid'] },
  { title: 'Maths', kinds: ['axes', 'numberline', 'grid', 'angle', 'protractor', 'venn'] },
  { title: 'Physics', kinds: ['incline', 'pulley', 'spring', 'lens', 'pendulum'] },
  { title: 'Circuits', kinds: ['battery', 'resistor', 'bulb', 'switch', 'capacitor', 'ammeter', 'voltmeter', 'ground'] },
  { title: 'Chemistry', kinds: ['beaker', 'flask', 'testtube', 'funnel'] },
];

export const isFigureKind = (k: unknown): k is FigureKind => typeof k === 'string' && k in FIGURES;

export interface PlacedPath {
  pts: V[];
  closed: boolean;
  fill: boolean;
  dash: boolean;
  arrow: boolean;
  dot: number;
  thin: boolean;
}

/** The figure's lines mapped into the box (x, y, w, h). */
export function placePaths(kind: FigureKind, x: number, y: number, w: number, h: number): PlacedPath[] {
  return FIGURES[kind].paths.map((p) => ({
    pts: p.pts.map(([px, py]) => [x + px * w, y + py * h] as V),
    closed: !!p.closed,
    fill: !!p.fill,
    dash: !!p.dash,
    arrow: !!p.arrow,
    dot: p.dot ?? 0,
    thin: !!p.thin,
  }));
}
