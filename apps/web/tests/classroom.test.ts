/**
 * Checks the board instruments' geometry: true-size scales, ruling a line along an edge, the
 * compass arc, protractor angles, and turning an instrument about its centre.
 * Run: node tests/classroom.test.ts   (from apps/web)
 */

import {
  CM, PROT_R, centreOf, compassArc, compassParts, dragInstrument, edgesOf, instrumentHit, newInstrument,
  protractorAngle, snapAngle, snapToEdge, tilt, toLocal, toWorld, turnBetween,
} from '../src/classroom/instruments.ts';
import type { Compass, Protractor, Ruler } from '../src/classroom/instruments.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `-> ${detail}`);
}
const eq = (name: string, got: unknown, want: unknown) => check(name, got === want, `got ${String(got)}, want ${String(want)}`);
const near = (name: string, got: number, want: number, tol = 1e-6) => check(name, Math.abs(got - want) <= tol, `got ${got}, want ${want}`);
const DEG = Math.PI / 180;

near('1 cm is 37.8 px at 96 dpi', CM, 37.795, 1e-3);

// --- frames ---------------------------------------------------------------------------------------
const turned = { x: 100, y: 50, a: 30 * DEG };
const [wx, wy] = toWorld(turned, 40, -12);
const [lx, ly] = toLocal(turned, wx, wy);
near('local to world and back (x)', lx, 40);
near('local to world and back (y)', ly, -12);

// --- ruler ----------------------------------------------------------------------------------------
const ruler = newInstrument('ruler', 0, 0, 'r') as Ruler;
const [edge] = edgesOf(ruler);
near('ruler edge is level', edge.p[1], edge.q[1]);
near('the 10 cm mark is 10 cm along', toWorld(ruler, 10 * CM, 0)[0] - ruler.x, 10 * CM);
const snapped = snapToEdge([ruler.x + 5 * CM, ruler.y - 6], ruler, 12)!;
near('a pen point 6 px off the edge lands on it', snapped[1], ruler.y);
near('at the same place along it', snapped[0], ruler.x + 5 * CM);
eq('a pen point far from the edge is left alone', snapToEdge([ruler.x + 5 * CM, ruler.y - 60], ruler, 12), null);
const tilted = { ...ruler, a: 45 * DEG };
const sp = snapToEdge(toWorld(tilted, 8 * CM, -5), tilted, 12)!;
near('tilted ruler: snapped point is on the edge', toLocal(tilted, sp[0], sp[1])[1], 0, 1e-9);
near('tilted ruler reads 315° (turned clockwise on screen)', tilt(tilted), 315);
eq('ruler body is "move"', instrumentHit(ruler, ...toWorld(ruler, 12 * CM, 1.6 * CM), 1), 'move');
eq('ruler edge is "edge"', instrumentHit(ruler, ...toWorld(ruler, 12 * CM, 2), 1), 'edge');
eq('ruler turn knob', instrumentHit(ruler, ...toWorld(ruler, ruler.len * CM - 0.9 * CM, 2.35 * CM), 1), 'rotate');
eq('ruler close button', instrumentHit(ruler, ...toWorld(ruler, 0.4 * CM, 2.35 * CM), 1), 'close');
eq('beside the ruler: nothing', instrumentHit(ruler, ruler.x - 3 * CM, ruler.y - 3 * CM, 1), null);

// --- turning ---------------------------------------------------------------------------------------
const c0 = centreOf(ruler);
const r90 = dragInstrument(ruler, 'rotate', [c0[0] + 100, c0[1]], [c0[0], c0[1] + 100]);
near('turning a quarter turn', r90.a, 90 * DEG, 1e-9);
const c1 = centreOf(r90);
near('turning keeps the centre (x)', c1[0], c0[0], 1e-6);
near('turning keeps the centre (y)', c1[1], c0[1], 1e-6);
near('44° snaps to 45°', snapAngle(44 * DEG) / DEG, 45, 1e-9);
near('37.4° rounds to 37°', snapAngle(37.4 * DEG) / DEG, 37, 1e-9);
const moved = dragInstrument(ruler, 'move', [0, 0], [30, -20]);
near('moving shifts it', moved.x - ruler.x, 30);

// --- set squares ------------------------------------------------------------------------------------
const s45 = newInstrument('set45', 0, 0, 's');
const e45 = edgesOf(s45);
eq('set square has three edges', e45.length, 3);
const hyp = e45[2];
near('45° set square: hypotenuse at 45°', Math.abs(Math.atan2(hyp.q[1] - hyp.p[1], hyp.q[0] - hyp.p[0]) / DEG), 135, 1e-9);
const s60 = newInstrument('set60', 0, 0, 's');
const h60 = edgesOf(s60)[2];
near('30–60 set square: hypotenuse at 30° to the long leg', Math.abs(Math.atan2(h60.q[1] - h60.p[1], h60.q[0] - h60.p[0]) / DEG), 150, 1e-9);
eq('inside the set square is "move"', instrumentHit(s45, ...toWorld(s45, 3 * CM, -2.5 * CM), 1), 'move');
eq('outside its hypotenuse is nothing', instrumentHit(s45, ...toWorld(s45, 9 * CM, -9 * CM), 1), null);

// --- protractor --------------------------------------------------------------------------------------
const prot = newInstrument('protractor', 0, 0, 'p') as Protractor;
near('straight up reads 90°', protractorAngle(prot, prot.x, prot.y - 100), 90);
near('up and right reads 45°', protractorAngle(prot, prot.x + 100, prot.y - 100), 45);
near('left along the baseline reads 180°', protractorAngle(prot, prot.x - 100, prot.y), 180);
near('half protractor: just below on the right stays 0°', protractorAngle(prot, prot.x + 100, prot.y + 5), 0);
const full = { ...prot, full: true };
near('full protractor: below the line reads 315°', protractorAngle(full, full.x + 100, full.y + 100), 315);
const turnedProt = { ...prot, a: -30 * DEG };
near('turned protractor measures from its own baseline', protractorAngle(turnedProt, turnedProt.x + 100 * Math.cos(-75 * DEG), turnedProt.y + 100 * Math.sin(-75 * DEG)), 45);
const swung = dragInstrument(prot, 'arm', [0, 0], [prot.x, prot.y - 200]);
eq('dragging the arm sets it', (swung as Protractor).arm, 90);
eq('the arm can be picked', instrumentHit(prot, ...toWorld(prot, Math.cos(-60 * DEG) * PROT_R * 0.8, Math.sin(-60 * DEG) * PROT_R * 0.8), 1), 'arm');

// --- compass -----------------------------------------------------------------------------------------
const comp = newInstrument('compass', 0, 0, 'c') as Compass;
const parts = compassParts(comp);
near('pencil is r from the needle', Math.hypot(parts.pencil[0] - comp.x, parts.pencil[1] - comp.y), comp.r, 1e-9);
check('hinge is above the legs', parts.hinge[1] < Math.min(comp.y, parts.pencil[1]));
const arc = compassArc([0, 0], 100, 0, Math.PI / 2);
check('arc points are all r from the pivot', arc.every(([x, y]) => Math.abs(Math.hypot(x, y) - 100) < 1e-9));
near('arc starts at a0', arc[0][0], 100, 1e-9);
near('arc ends at a1', arc[arc.length - 1][1], 100, 1e-9);
check('arc points about 2 units apart', arc.slice(1).every((q, k) => Math.hypot(q[0] - arc[k][0], q[1] - arc[k][1]) <= 2.01));
const back = compassArc([0, 0], 50, 1, 0);
check('arc can run backwards', back[0][1] > back[back.length - 1][1]);
const swing = dragInstrument(comp, 'pencil', [0, 0], [comp.x, comp.y + 50]);
near('swinging the pencil keeps the radius', (swing as Compass).r, comp.r);
near('swinging the pencil turns it to point down', swing.a, Math.PI / 2, 1e-9);
const opened = dragInstrument(comp, 'hinge', [0, 0], [comp.x + 6 * CM, comp.y]);
near('dragging the hinge sets the radius', (opened as Compass).r, 6 * CM, 1e-9);
eq('the pencil can be picked', instrumentHit(comp, ...parts.pencil, 1), 'pencil');
eq('the needle moves it', instrumentHit(comp, comp.x, comp.y, 1), 'move');
near('turnBetween wraps the short way', turnBetween(350 * DEG, 10 * DEG) / DEG, 20, 1e-9);
near('turnBetween backwards', turnBetween(10 * DEG, 350 * DEG) / DEG, -20, 1e-9);

console.log(failures ? `\n${failures} failed` : '\nall passed');
if (failures) process.exit(1);
