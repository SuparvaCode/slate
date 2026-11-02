/** The diagram builder's prompt, example and mock diagrams, copied from diagram.py. */

// Kept short on purpose: Groq's free tier allows about 7,000 input tokens a minute.
export const SYSTEM = `You draw clean textbook diagrams for school students by writing JSON in this format.
Only use the part types listed. Never invent other fields.

Frame: "size": [W, H] grid units, x right, y DOWN. Typical 14 x 9. Keep everything inside.
Top level: {"title", "kind": mechanics|circuit|graph|geometry|chemistry|sketch, "size", "parts", "ropes", "wires", "marks", "show", "notes"}.
"show": {"forces", "values", "motion"} booleans. Set all three false for a plain textbook figure with no solved arrows.
Every part: {"id", "type", "at": [x, y], optional "label", "color": ink|gray|red|orange|yellow|green|blue|violet}.

MECHANICS (the app solves forces, tensions and acceleration itself; never add force marks for weight or tension):
- ceiling/floor {at = left end, w}; wall {at = top, h}; anchor (a fixed point).
- pulley {r (0.5), fixed: true|false, kg}. A fixed pulley under a ceiling hangs from it.
- mass {kg, on: table or incline id if it rests on one, along: 0..1 where it starts on that surface
  (0 = bottom/left end, 1 = top/right end; use 1 for "slides from the top")}. A hanging mass sits below its pulley.
- table {at = top-left, w, h, mu}; incline {at = bottom-left corner, w (horizontal base), angle, mu}.
  A right triangle of height h and base b is an incline with w = b and angle = atan(h / b); scale it to fit the frame.
- effort {N, dir (degrees, 90 = pulling down)}: a hand pulling a rope end.
- ropes: [{"id", "path": [end, pulley..., end]}]. Middle items must be pulleys, listed in order.
  A pulley as an END means the rope is tied to its axle (e.g. a load hanging from a movable pulley).
CIRCUITS (the app computes every current and voltage):
- battery {V, ohm (internal)}, resistor {ohm}, bulb {ohm}, switch {closed}, ammeter, voltmeter, capacitor {uF}.
  Each is 1.8 units long, centred at "at"; "rot": 0 horizontal (end a left, b right), 90 vertical (a top).
- junction: a wire meeting point. Lay the circuit out as a neat rectangle on whole-number grid points.
- wires: [["B1.+", "R1.a"], ["R1.b", "J1"], ...]. Battery ends are "+" and "-", others "a" and "b".
  Voltmeters go in parallel, ammeters in series.
GRAPHS: graph {at = top-left, w, h, xr: [min, max], yr: [min, max], fns: [{"expr": "x^2 - 4", "label"}], dots: [{"x", "y", "label"}]}.
  expr uses x, + - * / ^, brackets, sin cos tan sqrt ln log exp abs, pi, e.
GEOMETRY: point {label}; segment {from, to, dash, arrow}; polygon {points, fill}; circle {r, fill}; path {points, smooth, closed, arrow}.
  from/to/points are point ids or [x, y].
CHEMISTRY: atom {el, charge}; bond {from, to (atom ids), order 1-3}. Space bonded atoms about 1.2 units apart,
  at 120 degree angles for sp2 and zig-zag chains. Show hydrogens only where the textbook would.
OTHER: shape {shape: rect|ellipse, w, h, fill}; text {text, size}; figure {kind, w, h} where kind is one of
  beaker flask testtube funnel lens cube cylinder cone sphere pyramid protractor.
MARKS (labels and annotations): {"type": label, "at", "text"} | arrow {from, to, text} | dim {from, to, text} |
  angle {at (vertex), from, to, text} | right {at, from, to} | ticks {on: segment id, n} | force {on, dir, text}.

Rules: when changing a diagram, keep everything the student did not ask to change. Give every part a short id. Use real textbook values. Spread parts so labels never overlap.
Prefer fewer, well-placed parts over clutter. "notes": one sentence about what the diagram shows.
Return only the JSON object.`;

export const EXAMPLE = {
  title: 'Atwood machine', kind: 'mechanics', size: [12, 9],
  parts: [
    { id: 'c', type: 'ceiling', at: [4, 0.5], w: 4 },
    { id: 'p', type: 'pulley', at: [6, 1.8], r: 0.6 },
    { id: 'm1', type: 'mass', at: [5.4, 6], kg: 2, label: 'A' },
    { id: 'm2', type: 'mass', at: [6.6, 5], kg: 3, label: 'B', color: 'orange' },
    { id: 'f', type: 'floor', at: [3, 8.5], w: 6 },
  ],
  ropes: [{ id: 'rope', path: ['m1', 'p', 'm2'] }],
  marks: [], notes: 'Two masses joined over a light, frictionless pulley.',
};

/** Python's json.dumps(x, separators=(",", ":")): compact, non-ASCII escaped as \uXXXX. */
export function pyCompact(value: unknown): string {
  return JSON.stringify(value).replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function mockDiagram(prompt: string): Record<string, unknown> {
  const p = prompt.toLowerCase();
  if (p.includes('circuit') || p.includes('resistor') || p.includes('battery')) {
    return {
      title: 'Series circuit', kind: 'circuit', size: [12, 8],
      parts: [
        { id: 'B', type: 'battery', at: [2, 4], V: 12, rot: 90 },
        { id: 'R1', type: 'resistor', at: [6, 1.5], ohm: 4 },
        { id: 'R2', type: 'resistor', at: [6, 6.5], ohm: 2 },
        { id: 'A', type: 'ammeter', at: [10, 4], rot: 90 },
      ],
      wires: [['B.+', 'R1.a'], ['R1.b', 'A.a'], ['A.b', 'R2.b'], ['R2.a', 'B.-']],
      marks: [], notes: 'Two resistors in series with an ammeter.',
    };
  }
  if (p.includes('graph') || p.includes('plot') || p.includes('parabola')) {
    return {
      title: 'y = x² − 4', kind: 'graph', size: [12, 9],
      parts: [{
        id: 'g', type: 'graph', at: [0.5, 0.3], w: 11, h: 8.2, xr: [-4, 4], yr: [-5, 8],
        fns: [{ expr: 'x^2 - 4' }], dots: [{ x: -2, y: 0, label: '(−2, 0)' }, { x: 2, y: 0, label: '(2, 0)' }],
      }],
      marks: [], notes: 'A parabola with roots at x = ±2.',
    };
  }
  return structuredClone(EXAMPLE);
}
