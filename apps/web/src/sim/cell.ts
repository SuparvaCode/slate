/**
 * Cells: animal, plant and bacterial cells with every part labelled, mitosis step by step, and
 * osmosis through a partially permeable membrane.
 *
 * Tap a part of a cell to pick it out and read what it does. With labels off it becomes a quiz:
 * the parts are numbered and tapping one names it.
 */

import { BH, BW, SIM_FONT, arrow, bool, label, line, num, str, text, fmt } from './kit.ts';
import type { Formula, Look, Readout, SimDef, SimGrab, SimParams, SimState } from './kit.ts';

// --- the parts of each cell -----------------------------------------------------------------------

export interface Part {
  id: string;
  name: string;
  does: string;
  /** Where its label points, and the box a tap selects it in. */
  x: number;
  y: number;
  rx: number;
  ry: number;
}

const P = (id: string, name: string, does: string, x: number, y: number, rx: number, ry: number): Part => ({ id, name, does, x, y, rx, ry });

export const CELLS: Record<string, Part[]> = {
  animal: [
    P('nucleus', 'Nucleus', 'Holds the DNA and controls the cell', 262, 186, 46, 40),
    P('nucleolus', 'Nucleolus', 'Makes ribosomes', 270, 182, 12, 11),
    P('mito', 'Mitochondrion', 'Aerobic respiration releases energy (ATP)', 372, 128, 30, 15),
    P('rer', 'Rough ER', 'Ribosomes on it make proteins', 188, 120, 32, 18),
    P('golgi', 'Golgi apparatus', 'Packages proteins and sends them out', 360, 248, 30, 22),
    P('lyso', 'Lysosome', 'Enzymes break down waste and old parts', 190, 262, 13, 13),
    P('ribo', 'Ribosome', 'Makes proteins', 322, 300, 12, 10),
    P('centriole', 'Centrioles', 'Organise the spindle in cell division', 312, 92, 16, 12),
    P('membrane', 'Cell membrane', 'Controls what enters and leaves', 120, 190, 14, 50),
    P('cyto', 'Cytoplasm', 'Jelly where most reactions happen', 214, 318, 26, 16),
  ],
  plant: [
    P('wall', 'Cell wall', 'Cellulose: supports the cell and keeps its shape', 84, 190, 10, 60),
    P('membrane', 'Cell membrane', 'Controls what enters and leaves', 102, 190, 8, 50),
    P('vacuole', 'Vacuole', 'Cell sap keeps the cell firm (turgid)', 300, 190, 80, 66),
    P('nucleus', 'Nucleus', 'Holds the DNA and controls the cell', 152, 112, 30, 26),
    P('chloro', 'Chloroplast', 'Photosynthesis: light energy makes glucose', 158, 278, 26, 13),
    P('mito', 'Mitochondrion', 'Aerobic respiration releases energy (ATP)', 430, 300, 22, 11),
    P('cyto', 'Cytoplasm', 'Jelly where most reactions happen', 440, 92, 22, 14),
    P('ribo', 'Ribosome', 'Makes proteins', 216, 86, 10, 9),
  ],
  bacteria: [
    P('wall', 'Cell wall', 'Peptidoglycan: supports the cell', 280, 108, 60, 9),
    P('capsule', 'Capsule', 'Slime layer: protects, helps it stick', 280, 92, 60, 7),
    P('membrane', 'Cell membrane', 'Controls what enters and leaves', 280, 270, 60, 7),
    P('dna', 'Nucleoid (DNA)', 'One loop of DNA, not in a nucleus', 262, 186, 52, 30),
    P('plasmid', 'Plasmid', 'Small DNA rings, can carry resistance genes', 372, 210, 13, 13),
    P('ribo', 'Ribosome (70S)', 'Makes proteins; smaller than in plants and animals', 188, 236, 10, 9),
    P('flagellum', 'Flagellum', 'Spins to move the cell', 510, 190, 34, 22),
    P('pili', 'Pili', 'Hairs that attach to surfaces and other cells', 160, 80, 22, 16),
  ],
};

/**
 * The plant cell is drawn a little narrower than its layout, about the centre of the box, so the
 * labels have room on both sides of its wide wall. Its parts are kept in drawn coordinates.
 */
const PLANT = { cx: 280, cy: 190, sx: 0.76, sy: 0.92 };
CELLS.plant = CELLS.plant.map((q) => ({
  ...q,
  x: PLANT.cx + (q.x - PLANT.cx) * PLANT.sx,
  y: PLANT.cy + (q.y - PLANT.cy) * PLANT.sy,
  rx: q.rx * PLANT.sx,
  ry: q.ry * PLANT.sy,
}));

export function partAt(cell: string, x: number, y: number): Part | null {
  const parts = CELLS[cell] ?? [];
  // Smallest first, so a nucleolus wins over the nucleus round it.
  const sorted = [...parts].sort((a, b) => a.rx * a.ry - b.rx * b.ry);
  return sorted.find((q) => ((x - q.x) / (q.rx + 4)) ** 2 + ((y - q.y) / (q.ry + 4)) ** 2 <= 1) ?? null;
}

// --- mitosis ----------------------------------------------------------------------------------------

export const PHASES = [
  { id: 'interphase', name: 'Interphase', does: 'The cell grows and copies its DNA' },
  { id: 'prophase', name: 'Prophase', does: 'Chromosomes coil up and show; the nuclear envelope breaks down' },
  { id: 'metaphase', name: 'Metaphase', does: 'Chromosomes line up across the middle on the spindle' },
  { id: 'anaphase', name: 'Anaphase', does: 'Sister chromatids are pulled to opposite poles' },
  { id: 'telophase', name: 'Telophase', does: 'New nuclear envelopes form round each set' },
  { id: 'cytokinesis', name: 'Cytokinesis', does: 'The cytoplasm divides: two identical daughter cells' },
] as const;
const PHASE_S = 2.5;

/** Which phase a run is in after t seconds, and how far through it (0 to 1). */
export function mitosisPhase(t: number): { i: number; f: number } {
  const k = Math.max(0, t) / PHASE_S;
  const i = Math.min(PHASES.length - 1, Math.floor(k));
  return { i, f: i === PHASES.length - 1 ? Math.min(1, k - i) : k - i };
}

// --- osmosis -----------------------------------------------------------------------------------------

/**
 * Net water movement across the membrane: towards the side with more solute (less water).
 * Returns the direction, and the share of the water in the tube that ends up on the left.
 */
export function osmosis(left: number, right: number): { dir: 'left' | 'right' | 'none'; share: number } {
  if (Math.abs(left - right) < 1e-9) return { dir: 'none', share: 0.5 };
  // A simple model: water spreads in proportion to the solute each side, plus a share for the
  // pressure of the raised column that holds it back.
  const share = (left + 1) / (left + right + 2);
  return { dir: left > right ? 'left' : 'right', share };
}

export const TONICITY: Record<string, { name: string; does: string; scale: number }> = {
  hypotonic: { name: 'Hypotonic (pure water)', does: 'Water moves in: an animal cell swells and may burst (lysis); a plant cell goes turgid', scale: 1.22 },
  isotonic: { name: 'Isotonic', does: 'No net movement: the cell keeps its shape', scale: 1 },
  hypertonic: { name: 'Hypertonic (salty)', does: 'Water moves out: an animal cell shrinks and crinkles; a plant cell is plasmolysed', scale: 0.78 },
};

// --- drawing helpers ------------------------------------------------------------------------------

function blob(ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, wobble: number, seed: number) {
  ctx.beginPath();
  const n = 48;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 1 + wobble * (Math.sin(a * 3 + seed) * 0.6 + Math.sin(a * 5 + seed * 2.3) * 0.4);
    const x = cx + Math.cos(a) * rx * r;
    const y = cy + Math.sin(a) * ry * r;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

const fills = (look: Look) => ({
  cyto: look.dark ? '#3a3a2c' : '#fdf6e3',
  edge: look.dark ? '#c9a24a' : '#c99a2e',
  nucleus: look.dark ? '#4a3a66' : '#e4d9f5',
  nucleusEdge: look.dark ? '#a88ce0' : '#7f5fc0',
  mito: look.dark ? '#7a3a2a' : '#f7b9a1',
  mitoEdge: look.dark ? '#e0805c' : '#c4573a',
  er: look.dark ? '#2f5a7a' : '#bde0f7',
  erEdge: look.dark ? '#6ab0e0' : '#3d8bc4',
  golgi: look.dark ? '#7a6a2a' : '#f7e1a1',
  golgiEdge: look.dark ? '#e0c45c' : '#b8901a',
  chloro: look.dark ? '#2f6a3a' : '#a8dfa9',
  chloroEdge: look.dark ? '#6ad07a' : '#2e8b3e',
  vacuole: look.dark ? '#2a4a5a' : '#d8eef7',
  wall: look.dark ? '#4a6a2a' : '#c4e09a',
});

function mito(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, a: number, look: Look) {
  const f = fills(look);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
  ctx.fillStyle = f.mito;
  ctx.fill();
  ctx.strokeStyle = f.mitoEdge;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  // Cristae.
  ctx.beginPath();
  ctx.moveTo(-w * 0.8, 0);
  for (let i = 0; i < 6; i++) {
    const xx = -w * 0.8 + ((i + 0.5) * 1.6 * w) / 6;
    ctx.lineTo(xx, i % 2 ? h * 0.6 : -h * 0.6);
  }
  ctx.lineTo(w * 0.8, 0);
  ctx.lineWidth = 1.2;
  ctx.stroke();
  ctx.restore();
}

function chloroplast(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, a: number, look: Look) {
  const f = fills(look);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.beginPath();
  ctx.ellipse(0, 0, w, h, 0, 0, Math.PI * 2);
  ctx.fillStyle = f.chloro;
  ctx.fill();
  ctx.strokeStyle = f.chloroEdge;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.fillStyle = f.chloroEdge;
  for (let i = -2; i <= 2; i++) for (let k = 0; k < 3; k++) ctx.fillRect(i * w * 0.32 - 3, -4.5 + k * 3.2, 6, 1.8);
  ctx.restore();
}

function ribosomes(ctx: CanvasRenderingContext2D, pts: [number, number][], look: Look) {
  ctx.fillStyle = look.dark ? '#e0e0e6' : '#5a5a66';
  for (const [x, y] of pts) {
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function nucleus(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, look: Look, nucleolus = true) {
  const f = fills(look);
  blob(ctx, x, y, rx, ry, 0.03, 1.7);
  ctx.fillStyle = f.nucleus;
  ctx.fill();
  ctx.strokeStyle = f.nucleusEdge;
  ctx.lineWidth = 2.4;
  ctx.setLineDash([9, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
  if (nucleolus) {
    ctx.beginPath();
    ctx.arc(x + 8, y - 4, 11, 0, Math.PI * 2);
    ctx.fillStyle = f.nucleusEdge;
    ctx.fill();
  }
}

// --- each cell ----------------------------------------------------------------------------------------

function drawAnimal(ctx: CanvasRenderingContext2D, look: Look) {
  const f = fills(look);
  blob(ctx, 280, 192, 172, 136, 0.05, 0.4);
  ctx.fillStyle = f.cyto;
  ctx.fill();
  ctx.strokeStyle = f.edge;
  ctx.lineWidth = 3;
  ctx.stroke();
  // Rough ER folds beside the nucleus.
  ctx.strokeStyle = f.erEdge;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    ctx.beginPath();
    ctx.moveTo(158, 104 + k * 13);
    ctx.bezierCurveTo(176, 94 + k * 13, 196, 118 + k * 13, 216, 106 + k * 13);
    ctx.stroke();
  }
  ribosomes(ctx, [[160, 98], [174, 96], [190, 104], [206, 106], [166, 112], [184, 116], [200, 120], [214, 118], [172, 130], [194, 134], [212, 132]], look);
  nucleus(ctx, 262, 186, 46, 40, look);
  mito(ctx, 372, 128, 28, 13, -0.3, look);
  mito(ctx, 196, 214, 22, 10, 0.9, look);
  mito(ctx, 330, 336 - 56, 20, 9, 0.2, look);
  // Golgi: a stack of curved sacs and vesicles budding off.
  ctx.strokeStyle = f.golgiEdge;
  ctx.lineWidth = 5;
  for (let k = 0; k < 4; k++) {
    ctx.beginPath();
    ctx.arc(372, 270 + k * 7, 30 - k * 2, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  }
  ctx.fillStyle = f.golgi;
  for (const [x, y] of [[398, 228], [406, 240], [338, 230]] as [number, number][]) {
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = f.golgiEdge;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(190, 262, 11, 0, Math.PI * 2);
  ctx.fillStyle = look.dark ? '#5a3a5a' : '#f2c6e8';
  ctx.fill();
  ctx.strokeStyle = look.dark ? '#d080c0' : '#b04a96';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ribosomes(ctx, [[316, 298], [326, 302], [320, 308], [404, 180], [150, 240], [236, 300], [420, 150]], look);
  // Centrioles: two little barrels at right angles.
  ctx.fillStyle = look.dark ? '#8e8e93' : '#636366';
  ctx.fillRect(302, 88, 16, 7);
  ctx.fillRect(316, 84, 7, 16);
}

function drawPlant(ctx: CanvasRenderingContext2D, look: Look) {
  const f = fills(look);
  ctx.beginPath();
  ctx.roundRect(76, 40, 408, 300, 16);
  ctx.fillStyle = f.wall;
  ctx.fill();
  ctx.strokeStyle = look.dark ? '#7aa04a' : '#7aa02e';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.roundRect(92, 54, 376, 272, 10);
  ctx.fillStyle = f.cyto;
  ctx.fill();
  ctx.strokeStyle = f.edge;
  ctx.lineWidth = 2;
  ctx.stroke();
  blob(ctx, 300, 190, 120, 92, 0.03, 2.1);
  ctx.fillStyle = f.vacuole;
  ctx.fill();
  ctx.strokeStyle = look.dark ? '#6ab0d0' : '#5aa0c4';
  ctx.lineWidth = 1.6;
  ctx.stroke();
  nucleus(ctx, 152, 112, 30, 26, look);
  for (const [x, y, a] of [[158, 278, 0.3], [128, 210, -0.8], [230, 302, -0.1], [400, 70, 0.1], [446, 200, 1.4], [330, 306, 0.2]] as [number, number, number][]) {
    chloroplast(ctx, x, y, 24, 11, a, look);
  }
  mito(ctx, 430, 300, 20, 9, -0.4, look);
  mito(ctx, 230, 70, 18, 8, 0.2, look);
  ribosomes(ctx, [[216, 86], [206, 92], [222, 94], [118, 160], [454, 120], [380, 314]], look);
}

function drawBacteria(ctx: CanvasRenderingContext2D, look: Look) {
  const f = fills(look);
  // Flagellum out of one end, pili round it.
  ctx.strokeStyle = look.muted;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(444, 190);
  for (let x = 444; x <= 548; x += 2) ctx.lineTo(x, 190 + 16 * Math.sin((x - 444) / 12));
  ctx.stroke();
  ctx.lineWidth = 1.4;
  for (const [x1, y1, x2, y2] of [[150, 108, 132, 72], [180, 96, 174, 62], [212, 90, 214, 56], [140, 140, 106, 120], [150, 250, 124, 284]]) {
    line(ctx, x1, y1, x2, y2, look.muted, 1.4);
  }
  ctx.beginPath();
  ctx.roundRect(116, 84, 330, 196, 98);
  ctx.fillStyle = look.dark ? 'rgba(200,200,120,0.18)' : 'rgba(200,180,80,0.18)';
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(124, 98, 314, 172, 86);
  ctx.fillStyle = f.wall;
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(132, 106, 298, 156, 78);
  ctx.fillStyle = f.cyto;
  ctx.fill();
  ctx.strokeStyle = f.edge;
  ctx.lineWidth = 2;
  ctx.stroke();
  // Nucleoid: a tangle of DNA.
  ctx.strokeStyle = look.dark ? '#b48ce0' : '#7f5fc0';
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 0; i <= 200; i++) {
    const t = (i / 200) * Math.PI * 2;
    const x = 262 + Math.cos(t) * 44 + Math.sin(t * 7) * 10;
    const y = 186 + Math.sin(t) * 24 + Math.cos(t * 5) * 8;
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.stroke();
  for (const [x, y, r] of [[372, 210, 10], [392, 168, 7]] as [number, number, number][]) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ribosomes(ctx, [[188, 236], [200, 244], [178, 226], [330, 240], [346, 228], [316, 136], [196, 140], [360, 130]], look);
}

// --- mitosis ----------------------------------------------------------------------------------------------

function chromosome(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, color: string, pair: boolean, len = 18) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  const arm = (dx: number) => {
    ctx.beginPath();
    ctx.moveTo(dx, -len / 2);
    ctx.quadraticCurveTo(dx + (dx >= 0 ? 2 : -2), 0, dx, len / 2);
    ctx.stroke();
  };
  if (pair) {
    arm(-3);
    arm(3);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(0, 0, 3.6, 0, Math.PI * 2);
    ctx.fill();
  } else arm(0);
  ctx.restore();
}

function drawMitosis(ctx: CanvasRenderingContext2D, p: SimParams, s: SimState, look: Look) {
  const fixed = str(p, 'phase', 'auto');
  const ph = fixed === 'auto' ? mitosisPhase(s.t) : { i: Math.max(0, PHASES.findIndex((x) => x.id === fixed)), f: 1 };
  const f = fills(look);
  const id = PHASES[ph.i].id;
  const cx = 280;
  const cy = 182;
  const colors = [look.red, look.blue, look.green, look.orange];
  // The cell: one oval, pinched in telophase, two cells in cytokinesis.
  const pinch = id === 'telophase' ? 0.25 * ph.f : id === 'cytokinesis' ? 0.25 + 0.75 * ph.f : 0;
  const stretch = id === 'anaphase' ? 1 + 0.25 * ph.f : id === 'telophase' || id === 'cytokinesis' ? 1.25 : 1;
  ctx.beginPath();
  if (pinch < 0.98) {
    const rx = 150 * stretch;
    const ry = 112;
    const n = 64;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const squeeze = 1 - pinch * Math.exp(-((Math.cos(a) * 3) ** 2));
      const x = cx + Math.cos(a) * rx;
      const y = cy + Math.sin(a) * ry * squeeze;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.closePath();
  } else {
    ctx.ellipse(cx - 98, cy, 88, 96, 0, 0, Math.PI * 2);
    ctx.moveTo(cx + 98 + 88, cy);
    ctx.ellipse(cx + 98, cy, 88, 96, 0, 0, Math.PI * 2);
  }
  ctx.fillStyle = f.cyto;
  ctx.fill();
  ctx.strokeStyle = f.edge;
  ctx.lineWidth = 3;
  ctx.stroke();

  const spindle = id === 'metaphase' || id === 'anaphase' || (id === 'prophase' && ph.f > 0.5);
  const poleX = 118 * stretch;
  if (spindle) {
    ctx.strokeStyle = look.dark ? 'rgba(200,200,210,0.35)' : 'rgba(80,80,90,0.3)';
    ctx.lineWidth = 1;
    for (let k = -4; k <= 4; k++) {
      ctx.beginPath();
      ctx.moveTo(cx - poleX, cy);
      ctx.quadraticCurveTo(cx, cy + k * 22, cx + poleX, cy);
      ctx.stroke();
    }
    for (const sx of [-1, 1]) {
      ctx.fillStyle = look.muted;
      ctx.fillRect(cx + sx * poleX - 5, cy - 3, 10, 6);
    }
  }
  if (id === 'interphase') {
    nucleus(ctx, cx, cy, 58, 52, look);
    // Loose chromatin.
    ctx.strokeStyle = look.dark ? '#b48ce0' : '#7f5fc0';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i <= 160; i++) {
      const t = (i / 160) * Math.PI * 6;
      const x = cx - 30 + Math.cos(t * 1.3) * 22 + i * 0.32;
      const y = cy + Math.sin(t) * 26;
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
  } else if (id === 'prophase') {
    ctx.globalAlpha = 1 - ph.f * 0.8;
    nucleus(ctx, cx, cy, 58, 52, look, false);
    ctx.globalAlpha = 1;
    const spots: [number, number, number][] = [[-26, -18, 0.4], [22, -22, -0.6], [-18, 22, -0.3], [26, 16, 0.8]];
    spots.forEach(([dx, dy, a], i) => chromosome(ctx, cx + dx, cy + dy, a, colors[i], true, 14 + ph.f * 6));
  } else if (id === 'metaphase') {
    [-42, -14, 14, 42].forEach((dy, i) => chromosome(ctx, cx, cy + dy, 0, colors[i], true, 20));
  } else if (id === 'anaphase') {
    const d = 8 + ph.f * (poleX - 30);
    [-42, -14, 14, 42].forEach((dy, i) => {
      for (const sx of [-1, 1]) {
        chromosome(ctx, cx + sx * d, cy + dy * (1 - ph.f * 0.4), sx * 0.15 * ph.f, colors[i], false, 20);
        line(ctx, cx + sx * d, cy + dy * (1 - ph.f * 0.4), cx + sx * poleX, cy, look.faint, 1);
      }
    });
  } else {
    const split = id === 'cytokinesis' && pinch >= 0.98;
    for (const sx of [-1, 1]) {
      const nx = cx + sx * (split ? 98 : 96);
      ctx.globalAlpha = id === 'telophase' ? ph.f : 1;
      nucleus(ctx, nx, cy, 38, 36, look, id === 'cytokinesis');
      ctx.globalAlpha = 1;
      [-14, -5, 5, 14].forEach((dy, i) => chromosome(ctx, nx + dy * 0.6, cy + dy, 0.5, colors[i], false, 12));
    }
  }

  // Phase strip along the bottom: tap one to jump there.
  const w = BW / PHASES.length;
  PHASES.forEach((q, i) => {
    const x = i * w;
    const on = i === ph.i;
    ctx.fillStyle = on ? look.blue : look.dark ? '#2c2c2e' : '#f2f2f5';
    ctx.beginPath();
    ctx.roundRect(x + 4, 312, w - 8, 26, 7);
    ctx.fill();
    text(ctx, q.name, x + w / 2, 325, { size: 10.5, weight: 650, color: on ? '#ffffff' : look.ink, align: 'center' });
  });
  text(ctx, PHASES[ph.i].does, 14, 356, { size: 11.5, weight: 600, color: look.ink });
  text(ctx, fixed === 'auto' ? 'Playing through the phases · tap one to hold it' : 'Holding this phase · tap Auto in settings to play', 14, 372, { size: 10, color: look.faint });
}

// --- osmosis ----------------------------------------------------------------------------------------------

interface CS extends SimState {
  /** Particles in the U-tube: x, y, velocity, and whether it is solute. */
  dots: { x: number; y: number; vx: number; vy: number; solute: boolean; left: boolean }[];
  /** Share of the water on the left, moving towards its target. */
  share: number;
  /** The cell in a solution: its size relative to normal. */
  size: number;
}

const TUBE = { x0: 90, x1: 470, mid: 280, bottom: 316, base: 190 };

function seeded(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a * 1664525 + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function initDots(p: SimParams) {
  const rnd = seeded(7);
  const dots: CS['dots'] = [];
  const add = (left: boolean, solute: boolean, n: number) => {
    for (let i = 0; i < n; i++) {
      const x0 = left ? TUBE.x0 + 8 : TUBE.mid + 8;
      dots.push({
        x: x0 + rnd() * (TUBE.mid - TUBE.x0 - 16), y: TUBE.base + 10 + rnd() * (TUBE.bottom - TUBE.base - 20),
        vx: (rnd() - 0.5) * 60, vy: (rnd() - 0.5) * 60, solute, left,
      });
    }
  };
  add(true, false, 34);
  add(false, false, 34);
  add(true, true, Math.round(num(p, 'cl', 6)));
  add(false, true, Math.round(num(p, 'cr', 1)));
  return dots;
}

/** The water surface on each side, from the share of water on the left. */
function levels(share: number) {
  const rise = (share - 0.5) * 160;
  return { left: TUBE.base - rise, right: TUBE.base + rise };
}

function drawOsmosis(ctx: CanvasRenderingContext2D, p: SimParams, s: CS, look: Look) {
  const lv = levels(s.share);
  const water = look.dark ? 'rgba(10,132,255,0.22)' : 'rgba(0,122,255,0.14)';
  ctx.fillStyle = water;
  ctx.fillRect(TUBE.x0, lv.left, TUBE.mid - TUBE.x0, TUBE.bottom - lv.left);
  ctx.fillRect(TUBE.mid, lv.right, TUBE.x1 - TUBE.mid, TUBE.bottom - lv.right);
  ctx.strokeStyle = look.muted;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(TUBE.x0, 40);
  ctx.lineTo(TUBE.x0, TUBE.bottom);
  ctx.lineTo(TUBE.x1, TUBE.bottom);
  ctx.lineTo(TUBE.x1, 40);
  ctx.stroke();
  line(ctx, TUBE.mid, 40, TUBE.mid, TUBE.bottom, look.orange, 2.4, [6, 4]);
  label(ctx, 'Partially permeable membrane', TUBE.mid, 30, look, { color: look.orange });
  for (const d of s.dots) {
    const top = d.x < TUBE.mid ? lv.left : lv.right;
    if (d.y < top) continue;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.solute ? 7 : 3.2, 0, Math.PI * 2);
    ctx.fillStyle = d.solute ? look.orange : look.blue;
    ctx.fill();
  }
  const o = osmosis(num(p, 'cl', 6), num(p, 'cr', 1));
  if (o.dir !== 'none') {
    const dir = o.dir === 'left' ? -1 : 1;
    arrow(ctx, TUBE.mid - dir * 36, 120, TUBE.mid + dir * 36, 120, look.blue, { w: 3, tag: 'water', look });
  }
  text(ctx, 'Small blue: water passes through · large orange: sugar cannot', 14, BH - 12, { size: 10.5, color: look.faint });
}

function drawCellInSolution(ctx: CanvasRenderingContext2D, p: SimParams, s: CS, look: Look) {
  const kind = str(p, 'tonic', 'hypotonic');
  const plant = str(p, 'which', 'animal') === 'plant';
  const f = fills(look);
  const conc = kind === 'hypotonic' ? 0 : kind === 'isotonic' ? 0.5 : 1;
  ctx.fillStyle = look.dark ? `rgba(10,132,255,${0.15 + conc * 0.12})` : `rgba(0,122,255,${0.08 + conc * 0.1})`;
  ctx.fillRect(0, 0, BW, BH);
  const cx = 280;
  const cy = 176;
  const k = s.size;
  if (plant) {
    // The wall stays put; the membrane and vacuole shrink away from it when plasmolysed.
    ctx.beginPath();
    ctx.roundRect(cx - 150, cy - 100, 300, 200, 14);
    ctx.fillStyle = f.wall;
    ctx.fill();
    ctx.beginPath();
    ctx.roundRect(cx - 140, cy - 90, 280, 180, 10);
    ctx.fillStyle = look.dark ? '#2a3a4a' : '#eef6fb';
    ctx.fill();
    const m = Math.min(1, k);
    blob(ctx, cx, cy, 138 * m, 88 * m, k < 0.95 ? 0.06 : 0.01, 1.1);
    ctx.fillStyle = f.cyto;
    ctx.fill();
    ctx.strokeStyle = f.edge;
    ctx.lineWidth = 2;
    ctx.stroke();
    blob(ctx, cx + 16, cy, 96 * m, 62 * m, 0.02, 2.4);
    ctx.fillStyle = f.vacuole;
    ctx.fill();
    nucleus(ctx, cx - 92 * m, cy - 40 * m, 20, 17, look);
    label(ctx, k < 0.95 ? 'Plasmolysed: membrane pulls away from the wall' : k > 1.05 ? 'Turgid: pressing on the wall' : 'Normal', cx, cy + 126, look);
  } else {
    // A red blood cell: a disc, crinkled when it loses water, round and stretched when it gains.
    const burst = k >= TONICITY.hypotonic.scale - 0.005;
    const wob = k < 0.95 ? 0.08 * (1 - k) / 0.22 : 0;
    blob(ctx, cx, cy, 92 * k, (burst ? 92 : 76) * k, wob, 3.3);
    ctx.fillStyle = look.dark ? '#a83a3a' : '#e05a5a';
    ctx.fill();
    ctx.strokeStyle = look.dark ? '#e08080' : '#a82a2a';
    ctx.lineWidth = 2;
    if (burst) ctx.setLineDash([10, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    if (!burst) {
      ctx.beginPath();
      ctx.ellipse(cx, cy, 40 * k, 30 * k, 0, 0, Math.PI * 2);
      ctx.fillStyle = look.dark ? 'rgba(0,0,0,0.18)' : 'rgba(120,0,0,0.12)';
      ctx.fill();
    }
    label(ctx, burst ? 'Swollen to bursting (lysis)' : k < 0.95 ? 'Shrunken and crinkled (crenation)' : 'Normal disc shape', cx, cy + 116, look);
  }
  // Water arrows across the edge.
  const dir = kind === 'hypotonic' ? 1 : kind === 'hypertonic' ? -1 : 0;
  for (const a of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    const r1 = 170;
    const r2 = 132;
    if (!dir) continue;
    const [ra, rb] = dir > 0 ? [r1, r2] : [r2, r1];
    arrow(ctx, cx + Math.cos(a + 0.5) * ra, cy + Math.sin(a + 0.5) * ra * 0.78, cx + Math.cos(a + 0.5) * rb, cy + Math.sin(a + 0.5) * rb * 0.78, look.blue, { w: 2.4 });
  }
  text(ctx, TONICITY[kind]?.does ?? '', 14, BH - 12, { size: 10.5, color: look.ink });
}

// --- the simulator ---------------------------------------------------------------------------------------------

const SETUPS = [
  { value: 'animal', label: 'Animal cell' },
  { value: 'plant', label: 'Plant cell' },
  { value: 'bacteria', label: 'Bacterial cell' },
  { value: 'mitosis', label: 'Mitosis' },
  { value: 'osmosis', label: 'Osmosis' },
  { value: 'tonicity', label: 'Cell in a solution' },
];
const setupOf = (p: SimParams) => str(p, 'setup', 'animal');
const is = (...k: string[]) => (p: SimParams) => k.includes(setupOf(p));

function drawCell(ctx: CanvasRenderingContext2D, p: SimParams, look: Look) {
  const cell = setupOf(p);
  if (cell === 'animal') drawAnimal(ctx, look);
  else if (cell === 'plant') {
    ctx.save();
    ctx.translate(PLANT.cx, PLANT.cy);
    ctx.scale(PLANT.sx, PLANT.sy);
    ctx.translate(-PLANT.cx, -PLANT.cy);
    drawPlant(ctx, look);
    ctx.restore();
  } else drawBacteria(ctx, look);
  const parts = CELLS[cell];
  const sel = str(p, 'sel');
  const labels = bool(p, 'labels');
  // Labels sit against the card's edges, on the side nearer their part, in the order the parts come
  // down that side (so no two leader lines cross), each as close to its part as 19 px spacing allows.
  // A part that reaches into that margin itself, like the flagellum, is labelled just beneath.
  const tagOf = (q: Part, i: number) => (labels || q.id === sel ? q.name : String(i + 1));
  ctx.save();
  ctx.font = `600 10.5px ${SIM_FONT}`;
  const width = new Map(parts.map((q, i) => [q.id, ctx.measureText(tagOf(q, i)).width]));
  ctx.restore();
  const isRight = (q: Part) => q.x > BW / 2;
  const inline = (q: Part) => {
    const w = width.get(q.id)!;
    return isRight(q) ? q.x + q.rx * 0.6 > BW - 22 - w : q.x - q.rx * 0.6 < 22 + w;
  };
  const slot = new Map<string, number>();
  for (const right of [false, true]) {
    const side = parts.filter((q) => isRight(q) === right && !inline(q)).sort((a, b) => a.y - b.y);
    // Labels drawn beside their own part on this side are fixed: the column keeps 19 px from them.
    const fixed = parts.filter((q) => isRight(q) === right && inline(q)).map((q) => q.y + q.ry + 12);
    const clear = (y: number) => {
      for (let n = 0; n < 4; n++) {
        const f = fixed.find((v) => Math.abs(y - v) < 19);
        if (f === undefined) break;
        y = f + 19;
      }
      return y;
    };
    const ys = side.map((q) => clear(Math.min(BH - 32, Math.max(22, q.y))));
    for (let k = 1; k < ys.length; k++) ys[k] = clear(Math.max(ys[k], ys[k - 1] + 19));
    if (ys.length && ys[ys.length - 1] > BH - 32) {
      ys[ys.length - 1] = BH - 32;
      for (let k = ys.length - 2; k >= 0; k--) ys[k] = Math.min(ys[k], ys[k + 1] - 19);
    }
    side.forEach((q, k) => slot.set(q.id, ys[k]));
  }
  parts.forEach((q, i) => {
    const on = q.id === sel;
    if (on) {
      ctx.beginPath();
      ctx.ellipse(q.x, q.y, q.rx + 5, q.ry + 5, 0, 0, Math.PI * 2);
      ctx.strokeStyle = look.blue;
      ctx.lineWidth = 2.4;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const color = on ? look.blue : look.ink;
    // With labels off it is a quiz: numbers, and the name only once the part is tapped.
    if (inline(q)) {
      label(ctx, tagOf(q, i), q.x, q.y + q.ry + 12, look, { size: 10.5, color });
      return;
    }
    const right = isRight(q);
    const w = width.get(q.id)!;
    const ly = slot.get(q.id)!;
    const end = right ? BW - 12 - w : 12 + w;
    line(ctx, q.x + (right ? q.rx * 0.6 : -q.rx * 0.6), q.y, end, ly, on ? look.blue : look.faint, on ? 1.4 : 1);
    label(ctx, tagOf(q, i), right ? BW - 8 : 8, ly, look, { size: 10.5, align: right ? 'right' : 'left', color });
  });
  const picked = parts.find((q) => q.id === sel);
  text(ctx, picked ? `${picked.name}: ${picked.does}` : labels ? 'Tap a part to see what it does' : 'Quiz: name each numbered part, then tap it to check', 14, BH - 12, { size: 11, weight: picked ? 650 : 500, color: picked ? look.blue : look.faint });
}

export const cellSim: SimDef<CS> = {
  label: 'Cells',
  subject: 'Biology',
  keywords: 'cell animal plant bacteria prokaryote eukaryote organelle nucleus mitochondria chloroplast ribosome vacuole cell wall membrane mitosis cell division chromosome osmosis diffusion turgid plasmolysis hypotonic hypertonic isotonic',
  blurb: 'Animal, plant and bacterial cells, mitosis, osmosis',
  display: ['sel', 'labels'],
  autoplay: true,
  still: (p) => ['animal', 'plant', 'bacteria'].includes(setupOf(p)),
  defaults: { setup: 'animal', sel: '', labels: true, phase: 'auto', cl: 6, cr: 1, tonic: 'hypotonic', which: 'animal' },
  controls: [
    { key: 'setup', label: 'Show', type: 'choice', options: SETUPS },
    { key: 'labels', label: 'Labels (off: quiz)', type: 'toggle', show: is('animal', 'plant', 'bacteria') },
    { key: 'phase', label: 'Phase', type: 'choice', options: [{ value: 'auto', label: 'Auto' }, ...PHASES.map((q) => ({ value: q.id, label: q.name }))], show: is('mitosis') },
    { key: 'cl', label: 'Sugar on the left', type: 'range', min: 0, max: 14, step: 1, show: is('osmosis') },
    { key: 'cr', label: 'Sugar on the right', type: 'range', min: 0, max: 14, step: 1, show: is('osmosis') },
    { key: 'tonic', label: 'Solution', type: 'choice', options: Object.entries(TONICITY).map(([value, t]) => ({ value, label: t.name })), show: is('tonicity') },
    { key: 'which', label: 'Cell', type: 'choice', options: [{ value: 'animal', label: 'Red blood cell' }, { value: 'plant', label: 'Plant cell' }], show: is('tonicity') },
  ],
  presets: [
    { label: 'Animal cell', params: { setup: 'animal', labels: true, sel: '' } },
    { label: 'Plant cell', params: { setup: 'plant', labels: true, sel: '' } },
    { label: 'Bacterium', params: { setup: 'bacteria', labels: true, sel: '' } },
    { label: 'Quiz: animal cell', params: { setup: 'animal', labels: false, sel: '' } },
    { label: 'Mitosis', params: { setup: 'mitosis', phase: 'auto' } },
    { label: 'Osmosis', params: { setup: 'osmosis', cl: 6, cr: 1 } },
    { label: 'Blood cell in water', params: { setup: 'tonicity', tonic: 'hypotonic', which: 'animal' } },
    { label: 'Plasmolysis', params: { setup: 'tonicity', tonic: 'hypertonic', which: 'plant' } },
  ],
  title: (p) => SETUPS.find((x) => x.value === setupOf(p))?.label ?? 'Cells',
  init: (p) => ({ t: 0, done: false, dots: setupOf(p) === 'osmosis' ? initDots(p) : [], share: 0.5, size: 1 }),
  step: (p, s, dt) => {
    s.t += dt;
    const setup = setupOf(p);
    if (setup === 'mitosis' && str(p, 'phase', 'auto') === 'auto' && s.t > PHASE_S * PHASES.length + 1.5) s.t = 0;
    if (setup === 'tonicity') {
      const target = TONICITY[str(p, 'tonic', 'hypotonic')]?.scale ?? 1;
      s.size += (target - s.size) * (1 - Math.exp(-dt / 1.2));
    }
    if (setup !== 'osmosis') return;
    const o = osmosis(num(p, 'cl', 6), num(p, 'cr', 1));
    s.share += (o.share - s.share) * (1 - Math.exp(-dt / 3));
    const lv = levels(s.share);
    const rnd = Math.random;
    for (const d of s.dots) {
      d.vx += (rnd() - 0.5) * 400 * dt;
      d.vy += (rnd() - 0.5) * 400 * dt;
      const sp = Math.hypot(d.vx, d.vy);
      const cap = d.solute ? 30 : 70;
      if (sp > cap) {
        d.vx *= cap / sp;
        d.vy *= cap / sp;
      }
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      // Sugar stays on its side; water may cross, a little more often towards the sugar.
      const onLeft = d.x < TUBE.mid;
      if (d.solute) {
        const lo = d.left ? TUBE.x0 + 8 : TUBE.mid + 8;
        const hi = d.left ? TUBE.mid - 8 : TUBE.x1 - 8;
        if (d.x < lo || d.x > hi) {
          d.x = Math.max(lo, Math.min(hi, d.x));
          d.vx *= -1;
        }
      } else if (d.x < TUBE.x0 + 4 || d.x > TUBE.x1 - 4) {
        d.x = Math.max(TUBE.x0 + 4, Math.min(TUBE.x1 - 4, d.x));
        d.vx *= -1;
      } else if (Math.abs(d.x - TUBE.mid) < 3) {
        const towards = o.dir === 'left' ? d.vx < 0 : o.dir === 'right' ? d.vx > 0 : true;
        if (!towards && rnd() < 0.35) d.vx *= -1;
      }
      const top = (onLeft ? lv.left : lv.right) + 6;
      if (d.y < top) {
        d.y = top;
        d.vy = Math.abs(d.vy);
      }
      if (d.y > TUBE.bottom - 6) {
        d.y = TUBE.bottom - 6;
        d.vy = -Math.abs(d.vy);
      }
    }
  },
  draw: (ctx, p, s, look) => {
    const setup = setupOf(p);
    if (setup === 'mitosis') drawMitosis(ctx, p, s, look);
    else if (setup === 'osmosis') drawOsmosis(ctx, p, s, look);
    else if (setup === 'tonicity') drawCellInSolution(ctx, p, s, look);
    else drawCell(ctx, p, look);
  },
  grab: (p, _s, x, y): SimGrab | null => {
    const setup = setupOf(p);
    if (setup === 'mitosis') {
      if (y < 310 || y > 340) return null;
      const i = Math.floor(x / (BW / PHASES.length));
      return PHASES[i] ? { cursor: 'pointer', tap: { phase: PHASES[i].id }, hint: PHASES[i].name } : null;
    }
    if (!CELLS[setup]) return null;
    const part = partAt(setup, x, y);
    if (!part) return null;
    return { cursor: 'pointer', tap: { sel: str(p, 'sel') === part.id ? '' : part.id }, hint: bool(p, 'labels') ? part.name : 'Tap to check' };
  },
  readouts: (p, s): Readout[] => {
    const setup = setupOf(p);
    if (setup === 'mitosis') {
      const fixed = str(p, 'phase', 'auto');
      const i = fixed === 'auto' ? mitosisPhase(s.t).i : Math.max(0, PHASES.findIndex((q) => q.id === fixed));
      return [
        { label: 'Phase', value: `${i + 1} of ${PHASES.length}` },
        { label: 'Now', value: PHASES[i].name, color: 'blue' },
        { label: 'Chromosomes', value: i === 3 ? '8 (4 each side)' : i >= 4 ? '4 in each cell' : '4 (2n)' },
      ];
    }
    if (setup === 'osmosis') {
      const o = osmosis(num(p, 'cl', 6), num(p, 'cr', 1));
      const lv = levels(s.share);
      return [
        { label: 'Sugar left : right', value: `${num(p, 'cl', 6)} : ${num(p, 'cr', 1)}` },
        { label: 'Water moves', value: o.dir === 'none' ? 'No net movement' : `To the ${o.dir}`, color: 'blue' },
        { label: 'Level difference', value: `${fmt(Math.abs(lv.right - lv.left) / 10)} cm` },
      ];
    }
    if (setup === 'tonicity') {
      const t = TONICITY[str(p, 'tonic', 'hypotonic')] ?? TONICITY.isotonic;
      return [{ label: 'Solution', value: t.name }, { label: 'Size', value: `${Math.round(s.size * 100)}%`, color: 'blue' }];
    }
    const parts = CELLS[setup];
    const picked = parts.find((q) => q.id === str(p, 'sel'));
    return [
      { label: 'Type', value: setup === 'bacteria' ? 'Prokaryotic' : 'Eukaryotic' },
      { label: 'Parts shown', value: String(parts.length) },
      { label: 'Selected', value: picked?.name ?? 'None', color: picked ? 'blue' : undefined },
    ];
  },
  formulas: (p): Formula[] => {
    const setup = setupOf(p);
    if (setup === 'plant') return [{ label: 'Photosynthesis (in the chloroplasts)', tex: '6\\text{CO}_2 + 6\\text{H}_2\\text{O} \\xrightarrow{\\text{light}} \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2' }];
    if (setup === 'animal') return [{ label: 'Aerobic respiration (in the mitochondria)', tex: '\\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2 \\to 6\\text{CO}_2 + 6\\text{H}_2\\text{O} + \\text{energy}' }];
    if (setup === 'mitosis') return [{ label: 'Mitosis keeps the chromosome number', tex: '2n \\to 2n + 2n' }];
    if (setup === 'osmosis' || setup === 'tonicity') return [{ label: 'Osmosis', tex: '\\text{water: high water potential} \\to \\text{low water potential}' }];
    return [{ label: 'Bacteria divide by binary fission', tex: '1 \\to 2 \\to 4 \\to 8 \\ldots \\quad N = N_0 \\cdot 2^{t / t_d}' }];
  },
};
