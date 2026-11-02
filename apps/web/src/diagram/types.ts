/**
 * The diagram format. Users, the AI and the library all produce this same JSON: parts from a
 * fixed library placed on a grid, ropes and wires that join parts (not screen positions), and
 * markings. The board draws it, the solvers compute with it, and the checker validates it.
 *
 * Units: the frame is `size` grid units, x to the right and y DOWN. One unit is drawn as U base
 * pixels, and for motion one unit is one metre.
 */

export const U = 40;

export type XY = [number, number];
/** A part id, or a point on the grid. */
export type Ref = string | XY;

export const TINTS = ['ink', 'gray', 'red', 'orange', 'yellow', 'green', 'blue', 'violet'] as const;
export type Tint = (typeof TINTS)[number];

export const MECH_TYPES = ['ceiling', 'floor', 'wall', 'anchor', 'pulley', 'mass', 'table', 'incline', 'effort'] as const;
export const CIRCUIT_TYPES = ['battery', 'resistor', 'bulb', 'switch', 'ammeter', 'voltmeter', 'capacitor', 'junction'] as const;
export const OTHER_TYPES = ['graph', 'point', 'segment', 'polygon', 'circle', 'atom', 'bond', 'shape', 'path', 'text', 'figure'] as const;
export const PART_TYPES = [...MECH_TYPES, ...CIRCUIT_TYPES, ...OTHER_TYPES] as const;
export type PartType = (typeof PART_TYPES)[number];

/** Two-terminal circuit parts. */
export const TWO_TERMINAL = new Set<PartType>(['battery', 'resistor', 'bulb', 'switch', 'ammeter', 'voltmeter', 'capacitor']);

export interface Fn {
  expr: string;
  label?: string;
}

export interface Dot {
  x: number;
  y: number;
  label?: string;
}

/**
 * One part. Only the fields its type uses are set; `normalize` drops the rest.
 * `at` is the centre, except: ceiling/floor (left end), wall (top), table/graph (top-left),
 * incline (bottom-left corner).
 */
export interface Part {
  id: string;
  type: PartType;
  at: XY;
  color?: Tint;
  label?: string;
  w?: number;
  h?: number;
  r?: number;
  /** pulley: fixed to the ceiling (default) or movable. */
  fixed?: boolean;
  kg?: number;
  /** mass: the table or incline it rests on. */
  on?: string;
  /** mass on a table or slope: where it starts, 0 = bottom (left) end, 1 = top (right) end. */
  along?: number;
  mu?: number;
  /** incline slope, in degrees. */
  angle?: number;
  /** effort: pull in newtons, and its direction in degrees (90 = straight down). */
  N?: number;
  dir?: number;
  /** circuit parts: 0 = horizontal (a on the left), 90 = vertical (a on top). */
  rot?: number;
  V?: number;
  ohm?: number;
  /** switch: closed; path: joined back to the start. */
  closed?: boolean;
  uF?: number;
  /** graph */
  xr?: XY;
  yr?: XY;
  fns?: Fn[];
  dots?: Dot[];
  grid?: boolean;
  /** segment, bond */
  from?: Ref;
  to?: Ref;
  dash?: boolean;
  /** polygon (refs) and path (grid points) */
  points?: Ref[];
  fill?: boolean;
  smooth?: boolean;
  arrow?: boolean;
  /** atom */
  el?: string;
  charge?: string;
  /** bond order */
  order?: number;
  shape?: 'rect' | 'ellipse';
  text?: string;
  size?: number;
  /** figure: one of the board's figure kinds. */
  kind?: string;
}

export interface Rope {
  id: string;
  /** End, the pulleys it wraps round in order, end. A pulley at an end ties to its axle. */
  path: string[];
  color?: Tint;
}

export interface Wire {
  /** "part.a", "part.b", "battery.+", "battery.-" or a junction id. */
  from: string;
  to: string;
}

export type MarkType = 'label' | 'arrow' | 'dim' | 'angle' | 'right' | 'ticks' | 'force';

export interface Mark {
  type: MarkType;
  at?: Ref;
  from?: Ref;
  to?: Ref;
  on?: string;
  dir?: number;
  text?: string;
  n?: number;
  color?: Tint;
}

export type DiagramKind = 'mechanics' | 'circuit' | 'graph' | 'geometry' | 'chemistry' | 'sketch';

export interface Diagram {
  v: 1;
  title: string;
  kind: DiagramKind;
  size: XY;
  parts: Part[];
  ropes: Rope[];
  wires: Wire[];
  marks: Mark[];
  /** What the solver adds: force arrows, numbers, and the Play button. All off is a plain drawing. */
  show: { forces: boolean; values: boolean; motion: boolean };
  g: number;
  notes: string;
}

export const emptyDiagram = (): Diagram => ({
  v: 1, title: 'Untitled diagram', kind: 'sketch', size: [14, 9], parts: [], ropes: [], wires: [], marks: [],
  show: { forces: true, values: true, motion: true }, g: 9.8, notes: '',
});
