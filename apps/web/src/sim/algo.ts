/**
 * Algorithms and data structures: five sorts, linear and binary search, a stack, a queue, a
 * binary search tree with its traversals, and BFS, DFS and Dijkstra on a small weighted graph.
 *
 * Every algorithm is run in full when its settings change, and the steps are kept as a trace; the
 * card's play button walks through them and the step button moves one at a time. The numbers are
 * a setting, typed in ("5, 2, 9, 1") or drawn at random from a seed so the board saves them.
 */

import { BH, BW, label, line, num, str, text } from './kit.ts';
import type { Formula, Look, Readout, SimDef, SimGrab, SimParams, SimState } from './kit.ts';

// --- input --------------------------------------------------------------------------------------------

export function parseList(s: string, max = 16): number[] {
  return s.split(/[\s,;]+/).map(Number).filter((n) => Number.isFinite(n)).map((n) => Math.round(n)).slice(0, max);
}

export function randomList(seed: number, n: number, lo = 1, hi = 99): number[] {
  let a = (Math.round(seed) * 2654435761) >>> 0 || 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    a = (a * 1664525 + 1013904223) >>> 0;
    out.push(lo + (a % (hi - lo + 1)));
  }
  return out;
}

// --- sorting ------------------------------------------------------------------------------------------

export interface SortStep {
  arr: number[];
  /** Being compared. */
  cmp: number[];
  /** Just moved. */
  moved: number[];
  /** In their final place. */
  done: number[];
  /** A sub-range being worked on (merge and quick sort). */
  range?: [number, number];
  pivot?: number;
  note: string;
  comparisons: number;
  swaps: number;
}

export type SortName = 'bubble' | 'selection' | 'insertion' | 'merge' | 'quick';

export function sortTrace(input: number[], algo: SortName): SortStep[] {
  const a = [...input];
  const n = a.length;
  const steps: SortStep[] = [];
  let comparisons = 0;
  let swaps = 0;
  const done = new Set<number>();
  const push = (cmp: number[], moved: number[], note: string, extra: Partial<SortStep> = {}) =>
    steps.push({ arr: [...a], cmp, moved, done: [...done], note, comparisons, swaps, ...extra });
  const swap = (i: number, j: number) => {
    [a[i], a[j]] = [a[j], a[i]];
    swaps++;
  };
  push([], [], 'Start');

  if (algo === 'bubble') {
    for (let end = n - 1; end > 0; end--) {
      let any = false;
      for (let i = 0; i < end; i++) {
        comparisons++;
        push([i, i + 1], [], `Compare ${a[i]} and ${a[i + 1]}`);
        if (a[i] > a[i + 1]) {
          swap(i, i + 1);
          any = true;
          push([], [i, i + 1], `${a[i + 1]} > ${a[i]}: swap`);
        }
      }
      done.add(end);
      if (!any) {
        for (let k = 0; k < end; k++) done.add(k);
        push([], [], 'No swaps in a whole pass: sorted');
        break;
      }
    }
    done.add(0);
  } else if (algo === 'selection') {
    for (let i = 0; i < n - 1; i++) {
      let min = i;
      for (let j = i + 1; j < n; j++) {
        comparisons++;
        push([min, j], [], `Smallest so far ${a[min]}; check ${a[j]}`);
        if (a[j] < a[min]) min = j;
      }
      if (min !== i) {
        swap(i, min);
        push([], [i, min], `Move the smallest, ${a[i]}, to position ${i + 1}`);
      }
      done.add(i);
    }
    done.add(n - 1);
  } else if (algo === 'insertion') {
    done.add(0);
    for (let i = 1; i < n; i++) {
      let j = i;
      push([j], [], `Insert ${a[j]} into the sorted part`);
      while (j > 0) {
        comparisons++;
        push([j - 1, j], [], `Compare ${a[j - 1]} and ${a[j]}`);
        if (a[j - 1] <= a[j]) break;
        swap(j - 1, j);
        push([], [j - 1, j], `Shift ${a[j]} right`);
        j--;
      }
      done.add(i);
    }
  } else if (algo === 'merge') {
    // Each frame shows lo..hi as: merged so far, then what is left of each half, so every frame
    // is a rearrangement of the input and the two values being compared sit side by side.
    const merge = (lo: number, mid: number, hi: number) => {
      const left = a.slice(lo, mid + 1);
      const right = a.slice(mid + 1, hi + 1);
      const out: number[] = [];
      let i = 0;
      let j = 0;
      const lay = () => {
        const row = [...out, ...left.slice(i), ...right.slice(j)];
        for (let k = 0; k < row.length; k++) a[lo + k] = row[k];
      };
      while (i < left.length && j < right.length) {
        comparisons++;
        const at = lo + out.length;
        push([at, at + left.length - i], [], `Merge: compare ${left[i]} and ${right[j]}`, { range: [lo, hi] });
        out.push(left[i] <= right[j] ? left[i++] : right[j++]);
        swaps++;
        lay();
        push([], [lo + out.length - 1], `Place ${out[out.length - 1]}`, { range: [lo, hi] });
      }
      while (i < left.length) {
        out.push(left[i++]);
        swaps++;
      }
      while (j < right.length) {
        out.push(right[j++]);
        swaps++;
      }
      lay();
      push([], [], `Merged positions ${lo + 1}–${hi + 1}`, { range: [lo, hi] });
    };
    const sort = (lo: number, hi: number) => {
      if (lo >= hi) return;
      const mid = (lo + hi) >> 1;
      push([], [], `Split ${lo + 1}–${hi + 1} into halves`, { range: [lo, hi] });
      sort(lo, mid);
      sort(mid + 1, hi);
      merge(lo, mid, hi);
    };
    sort(0, n - 1);
    for (let k = 0; k < n; k++) done.add(k);
  } else {
    // Lomuto partition: the last element is the pivot.
    const sort = (lo: number, hi: number) => {
      if (lo > hi) return;
      if (lo === hi) {
        done.add(lo);
        return;
      }
      const pv = a[hi];
      push([], [], `Pivot ${pv}`, { range: [lo, hi], pivot: hi });
      let i = lo;
      for (let j = lo; j < hi; j++) {
        comparisons++;
        push([j, hi], [], `Is ${a[j]} < ${pv}?`, { range: [lo, hi], pivot: hi });
        if (a[j] < pv) {
          if (i !== j) {
            swap(i, j);
            push([], [i, j], `Yes: move ${a[i]} left of the pivot`, { range: [lo, hi], pivot: hi });
          }
          i++;
        }
      }
      if (i !== hi) swap(i, hi);
      done.add(i);
      push([], [i], `Pivot ${pv} is in its final place`, { range: [lo, hi], pivot: i });
      sort(lo, i - 1);
      sort(i + 1, hi);
    };
    sort(0, n - 1);
  }
  for (let k = 0; k < n; k++) done.add(k);
  push([], [], `Sorted: ${comparisons} comparisons, ${swaps} ${algo === 'merge' ? 'writes' : 'swaps'}`);
  return steps;
}

export const BIG_O: Record<SortName, { best: string; avg: string; worst: string; space: string; stable: boolean }> = {
  bubble: { best: 'n', avg: 'n^2', worst: 'n^2', space: '1', stable: true },
  selection: { best: 'n^2', avg: 'n^2', worst: 'n^2', space: '1', stable: false },
  insertion: { best: 'n', avg: 'n^2', worst: 'n^2', space: '1', stable: true },
  merge: { best: 'n \\log n', avg: 'n \\log n', worst: 'n \\log n', space: 'n', stable: true },
  quick: { best: 'n \\log n', avg: 'n \\log n', worst: 'n^2', space: '\\log n', stable: false },
};

// --- searching ------------------------------------------------------------------------------------------

export interface SearchStep {
  lo: number;
  hi: number;
  at: number;
  found: number;
  /** Ruled out. */
  out: number[];
  note: string;
}

export function linearTrace(a: number[], target: number): SearchStep[] {
  const steps: SearchStep[] = [{ lo: 0, hi: a.length - 1, at: -1, found: -1, out: [], note: `Look for ${target}, one by one` }];
  for (let i = 0; i < a.length; i++) {
    const out = Array.from({ length: i }, (_, k) => k);
    if (a[i] === target) {
      steps.push({ lo: 0, hi: a.length - 1, at: i, found: i, out, note: `Found ${target} at position ${i + 1} after ${i + 1} checks` });
      return steps;
    }
    steps.push({ lo: 0, hi: a.length - 1, at: i, found: -1, out, note: `${a[i]} ≠ ${target}` });
  }
  steps.push({ lo: 0, hi: a.length - 1, at: -1, found: -1, out: a.map((_, k) => k), note: `${target} is not in the list` });
  return steps;
}

/** Binary search on a sorted list. */
export function binaryTrace(a: number[], target: number): SearchStep[] {
  let lo = 0;
  let hi = a.length - 1;
  const outside = () => a.map((_, k) => k).filter((k) => k < lo || k > hi);
  const steps: SearchStep[] = [{ lo, hi, at: -1, found: -1, out: [], note: `Look for ${target}: the list is sorted, so halve it each time` }];
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid] === target) {
      steps.push({ lo, hi, at: mid, found: mid, out: outside(), note: `Middle is ${target}: found at position ${mid + 1}` });
      return steps;
    }
    steps.push({ lo, hi, at: mid, found: -1, out: outside(), note: `Middle is ${a[mid]}: ${target} ${a[mid] < target ? '>' : '<'} ${a[mid]}, keep the ${a[mid] < target ? 'right' : 'left'} half` });
    if (a[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  steps.push({ lo, hi, at: -1, found: -1, out: a.map((_, k) => k), note: `Nothing left: ${target} is not in the list` });
  return steps;
}

// --- binary search tree -----------------------------------------------------------------------------------

export interface TreeNode { v: number; l: TreeNode | null; r: TreeNode | null }

export function bstInsert(values: number[]): TreeNode | null {
  let root: TreeNode | null = null;
  for (const v of values) {
    const node: TreeNode = { v, l: null, r: null };
    if (!root) {
      root = node;
      continue;
    }
    let cur = root;
    for (;;) {
      if (v === cur.v) break;
      const side = v < cur.v ? 'l' : 'r';
      const next: TreeNode | null = cur[side];
      if (!next) {
        cur[side] = node;
        break;
      }
      cur = next;
    }
  }
  return root;
}

export function traverse(root: TreeNode | null, order: 'in' | 'pre' | 'post' | 'level'): number[] {
  const out: number[] = [];
  if (order === 'level') {
    const q = root ? [root] : [];
    while (q.length) {
      const n = q.shift()!;
      out.push(n.v);
      if (n.l) q.push(n.l);
      if (n.r) q.push(n.r);
    }
    return out;
  }
  const walk = (n: TreeNode | null) => {
    if (!n) return;
    if (order === 'pre') out.push(n.v);
    walk(n.l);
    if (order === 'in') out.push(n.v);
    walk(n.r);
    if (order === 'post') out.push(n.v);
  };
  walk(root);
  return out;
}

export function treeHeight(n: TreeNode | null): number {
  return n ? 1 + Math.max(treeHeight(n.l), treeHeight(n.r)) : 0;
}

// --- graphs -------------------------------------------------------------------------------------------------

export const GRAPH = {
  nodes: [
    { id: 'A', x: 70, y: 180 }, { id: 'B', x: 180, y: 80 }, { id: 'C', x: 180, y: 280 }, { id: 'D', x: 300, y: 180 },
    { id: 'E', x: 410, y: 80 }, { id: 'F', x: 410, y: 280 }, { id: 'G', x: 510, y: 180 },
  ],
  edges: [
    ['A', 'B', 4], ['A', 'C', 2], ['B', 'C', 1], ['B', 'D', 5], ['C', 'D', 8], ['C', 'F', 10],
    ['D', 'E', 2], ['D', 'F', 6], ['E', 'G', 2], ['F', 'G', 3], ['E', 'F', 1],
  ] as [string, string, number][],
};

function neighbours(id: string): [string, number][] {
  const out: [string, number][] = [];
  for (const [a, b, w] of GRAPH.edges) {
    if (a === id) out.push([b, w]);
    if (b === id) out.push([a, w]);
  }
  return out.sort((x, y) => (x[0] < y[0] ? -1 : 1));
}

export interface GraphStep {
  current: string | null;
  visited: string[];
  frontier: string[];
  /** Dijkstra: best distance so far, and the edge it came by. */
  dist: Record<string, number>;
  prev: Record<string, string>;
  /** Edges used so far, as "A-B". */
  tree: string[];
  note: string;
}

export function graphTrace(kind: 'bfs' | 'dfs' | 'dijkstra', start: string): GraphStep[] {
  const steps: GraphStep[] = [];
  const visited: string[] = [];
  const tree: string[] = [];
  const dist: Record<string, number> = {};
  const prev: Record<string, string> = {};
  const snap = (current: string | null, frontier: string[], note: string) =>
    steps.push({ current, visited: [...visited], frontier: [...frontier], dist: { ...dist }, prev: { ...prev }, tree: [...tree], note });

  if (kind === 'dijkstra') {
    for (const n of GRAPH.nodes) dist[n.id] = Infinity;
    dist[start] = 0;
    snap(null, [start], `Start at ${start}: distance 0, every other node ∞`);
    const done = new Set<string>();
    while (done.size < GRAPH.nodes.length) {
      let u: string | null = null;
      for (const n of GRAPH.nodes) if (!done.has(n.id) && dist[n.id] < Infinity && (u === null || dist[n.id] < dist[u])) u = n.id;
      if (u === null) break;
      done.add(u);
      visited.push(u);
      if (prev[u]) tree.push([prev[u], u].sort().join('-'));
      const open = () => GRAPH.nodes.filter((n) => !done.has(n.id) && dist[n.id] < Infinity).map((n) => n.id);
      snap(u, open(), `Closest unvisited is ${u} (${dist[u]}): its distance is now final`);
      for (const [v, w] of neighbours(u)) {
        if (done.has(v)) continue;
        if (dist[u] + w < dist[v]) {
          const was = dist[v];
          dist[v] = dist[u] + w;
          prev[v] = u;
          snap(u, open(), `${u}→${v}: ${dist[u]} + ${w} = ${dist[v]} beats ${was === Infinity ? '∞' : was}`);
        }
      }
    }
    snap(null, [], 'Every shortest distance from the start is found');
    return steps;
  }

  const frontier = [start];
  const seen = new Set([start]);
  snap(null, frontier, kind === 'bfs' ? `Queue: [${start}]` : `Stack: [${start}]`);
  while (frontier.length) {
    const u = kind === 'bfs' ? frontier.shift()! : frontier.pop()!;
    if (kind === 'dfs' && visited.includes(u)) continue;
    visited.push(u);
    if (prev[u]) tree.push([prev[u], u].sort().join('-'));
    const next = neighbours(u).map(([v]) => v).filter((v) => (kind === 'bfs' ? !seen.has(v) : !visited.includes(v)));
    // DFS pushes in reverse so the alphabetically first neighbour comes off the stack first.
    for (const v of kind === 'bfs' ? next : [...next].reverse()) {
      seen.add(v);
      // BFS only sees a node once; in DFS the latest push is the one popped, so it wins.
      prev[v] = u;
      frontier.push(v);
    }
    snap(u, frontier, `Visit ${u}; ${kind === 'bfs' ? 'queue' : 'stack'}: [${frontier.join(', ')}]`);
  }
  snap(null, [], `Visit order: ${visited.join(' → ')}`);
  return steps;
}

// --- choosing what to run --------------------------------------------------------------------------------------

const SORTS: SortName[] = ['bubble', 'selection', 'insertion', 'merge', 'quick'];
const algoOf = (p: SimParams) => str(p, 'algo', 'bubble');
const isSort = (p: SimParams) => (SORTS as string[]).includes(algoOf(p));
const isGraph = (p: SimParams) => ['bfs', 'dfs', 'dijkstra'].includes(algoOf(p));

function listOf(p: SimParams): number[] {
  const typed = parseList(str(p, 'data'));
  const n = Math.round(num(p, 'n', 10));
  const list = str(p, 'source', 'random') === 'typed' && typed.length >= 2 ? typed : randomList(num(p, 'seed', 1), n);
  return algoOf(p) === 'binary' ? [...list].sort((a, b) => a - b) : list;
}

type Trace = { kind: 'sort'; steps: SortStep[] } | { kind: 'search'; steps: SearchStep[]; list: number[] } | { kind: 'graph'; steps: GraphStep[] } | { kind: 'tree'; root: TreeNode | null; order: number[]; values: number[] } | { kind: 'ds' };

const traceMemo = new Map<string, Trace>();
function traceOf(p: SimParams): Trace {
  const key = ['algo', 'data', 'n', 'seed', 'source', 'target', 'start', 'order'].map((k) => String(p[k])).join('|');
  let t = traceMemo.get(key);
  if (t) return t;
  const algo = algoOf(p);
  if (isSort(p)) t = { kind: 'sort', steps: sortTrace(listOf(p), algo as SortName) };
  else if (algo === 'linear' || algo === 'binary') {
    const list = listOf(p);
    t = { kind: 'search', list, steps: (algo === 'linear' ? linearTrace : binaryTrace)(list, Math.round(num(p, 'target', 42))) };
  } else if (isGraph(p)) t = { kind: 'graph', steps: graphTrace(algo as 'bfs' | 'dfs' | 'dijkstra', str(p, 'start', 'A')) };
  else if (algo === 'bst') {
    const values = listOf(p).slice(0, 12);
    const root = bstInsert(values);
    t = { kind: 'tree', root, values, order: traverse(root, str(p, 'order', 'in') as 'in' | 'pre' | 'post' | 'level') };
  } else t = { kind: 'ds' };
  traceMemo.set(key, t);
  if (traceMemo.size > 24) traceMemo.delete(traceMemo.keys().next().value!);
  return t;
}

const stepCount = (t: Trace) => (t.kind === 'sort' || t.kind === 'search' || t.kind === 'graph' ? t.steps.length : t.kind === 'tree' ? t.values.length + t.order.length + 1 : 0);

// --- running ---------------------------------------------------------------------------------------------------

interface AS extends SimState {
  /** Step being shown, and the time it has been shown for. */
  i: number;
  acc: number;
}

const idx = (s: AS, t: Trace) => Math.min(Math.max(0, stepCount(t) - 1), s.i);

// --- drawing ---------------------------------------------------------------------------------------------------

const BAR = { x0: 30, x1: 530, base: 300, top: 60 };

function drawBars(ctx: CanvasRenderingContext2D, arr: number[], look: Look, color: (i: number) => string, mark?: (i: number) => string | null, range?: [number, number]) {
  const n = arr.length;
  const w = (BAR.x1 - BAR.x0) / n;
  const max = Math.max(1, ...arr.map(Math.abs));
  if (range) {
    ctx.fillStyle = look.dark ? 'rgba(10,132,255,0.12)' : 'rgba(0,122,255,0.07)';
    ctx.fillRect(BAR.x0 + range[0] * w, BAR.top - 18, (range[1] - range[0] + 1) * w, BAR.base - BAR.top + 34);
  }
  arr.forEach((v, i) => {
    const h = ((BAR.base - BAR.top) * Math.abs(v)) / max;
    const x = BAR.x0 + i * w + w * 0.12;
    ctx.beginPath();
    ctx.roundRect(x, BAR.base - h, w * 0.76, h, Math.min(6, w * 0.15));
    ctx.fillStyle = color(i);
    ctx.fill();
    text(ctx, String(v), x + w * 0.38, BAR.base - h - 10, { size: Math.min(13, w * 0.42), weight: 650, color: look.ink, align: 'center' });
    text(ctx, String(i + 1), x + w * 0.38, BAR.base + 13, { size: 9.5, color: look.faint, align: 'center' });
    const m = mark?.(i);
    if (m) label(ctx, m, x + w * 0.38, BAR.base + 30, look, { size: 10.5, color: look.violet });
  });
}

function drawSort(ctx: CanvasRenderingContext2D, st: SortStep, look: Look) {
  const done = new Set(st.done);
  const idle = look.dark ? '#5a5a5e' : '#c7c7cc';
  drawBars(ctx, st.arr, look, (i) => (st.moved.includes(i) ? look.red : st.cmp.includes(i) ? look.orange : i === st.pivot ? look.violet : done.has(i) ? look.green : idle),
    (i) => (i === st.pivot ? 'pivot' : null), st.range);
  label(ctx, st.note, BW / 2, 30, look, { size: 13 });
  const key: [string, string][] = [[look.orange, 'Comparing'], [look.red, 'Moved'], [look.green, 'In place']];
  key.forEach(([c, t], k) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.roundRect(30 + k * 110, 354, 12, 12, 3);
    ctx.fill();
    text(ctx, t, 48 + k * 110, 360, { size: 10.5, color: look.muted });
  });
}

function drawSearch(ctx: CanvasRenderingContext2D, list: number[], st: SearchStep, binary: boolean, look: Look) {
  const out = new Set(st.out);
  const idle = look.dark ? '#5a5a5e' : '#c7c7cc';
  drawBars(ctx, list, look, (i) => (i === st.found ? look.green : i === st.at ? look.orange : out.has(i) ? (look.dark ? '#2c2c2e' : '#ececf0') : idle),
    (i) => (binary && st.found < 0 && st.lo <= st.hi ? (i === st.lo ? 'low' : i === st.hi ? 'high' : i === st.at ? 'mid' : null) : null));
  label(ctx, st.note, BW / 2, 30, look, { size: 13 });
}

function drawTree(ctx: CanvasRenderingContext2D, t: Extract<Trace, { kind: 'tree' }>, step: number, look: Look) {
  // Insert the values one at a time, then walk the traversal.
  const inserted = Math.min(t.values.length, step);
  const root = bstInsert(t.values.slice(0, inserted));
  const walked = Math.max(0, step - t.values.length - 1);
  const order = t.order.slice(0, walked + 1);
  const visiting = step > t.values.length ? t.order[walked] : undefined;
  const pos = new Map<TreeNode, [number, number]>();
  let k = 0;
  const lay = (n: TreeNode | null, depth: number) => {
    if (!n) return;
    lay(n.l, depth + 1);
    pos.set(n, [0, 50 + depth * 56]);
    pos.get(n)![0] = k++;
    lay(n.r, depth + 1);
  };
  lay(root, 0);
  const total = Math.max(1, k);
  for (const [n, p] of pos) pos.set(n, [40 + ((BW - 80) * (p[0] + 0.5)) / total, p[1]]);
  for (const [n, [x, y]] of pos) for (const c of [n.l, n.r]) if (c) line(ctx, x, y, pos.get(c)![0], pos.get(c)![1], look.faint, 2);
  for (const [n, [x, y]] of pos) {
    const isNew = step <= t.values.length && n.v === t.values[inserted - 1];
    const done = step > t.values.length && order.includes(n.v) && n.v !== visiting;
    ctx.beginPath();
    ctx.arc(x, y, 17, 0, Math.PI * 2);
    ctx.fillStyle = n.v === visiting ? look.orange : isNew ? look.blue : done ? look.green : look.card;
    ctx.fill();
    ctx.strokeStyle = look.ink;
    ctx.lineWidth = 1.6;
    ctx.stroke();
    text(ctx, String(n.v), x, y + 0.5, { size: 12, weight: 700, color: n.v === visiting || isNew || done ? '#ffffff' : look.ink, align: 'center' });
  }
  const note = step === 0 ? 'Empty tree: insert each value, smaller to the left, larger to the right'
    : step <= t.values.length ? `Insert ${t.values[inserted - 1]}`
      : step === t.values.length + 1 && !visiting ? 'Tree built: now walk it' : `Visit ${visiting}`;
  label(ctx, note, BW / 2, 18, look, { size: 12.5 });
  if (step > t.values.length) text(ctx, `Order so far: ${order.join(', ')}`, 14, BH - 14, { size: 11.5, weight: 650, color: look.ink });
}

function drawGraph(ctx: CanvasRenderingContext2D, st: GraphStep, dijkstra: boolean, look: Look) {
  const pos = new Map(GRAPH.nodes.map((n) => [n.id, n]));
  for (const [a, b, w] of GRAPH.edges) {
    const A = pos.get(a)!;
    const B = pos.get(b)!;
    const used = st.tree.includes([a, b].sort().join('-'));
    line(ctx, A.x, A.y, B.x, B.y, used ? look.green : look.faint, used ? 4 : 2);
    if (dijkstra) label(ctx, String(w), (A.x + B.x) / 2, (A.y + B.y) / 2, look, { size: 11, color: look.muted });
  }
  for (const n of GRAPH.nodes) {
    const visited = st.visited.includes(n.id);
    const cur = st.current === n.id;
    const front = st.frontier.includes(n.id);
    ctx.beginPath();
    ctx.arc(n.x, n.y, 21, 0, Math.PI * 2);
    ctx.fillStyle = cur ? look.orange : visited ? look.green : front ? look.blue : look.card;
    ctx.fill();
    ctx.strokeStyle = look.ink;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    text(ctx, n.id, n.x, n.y + 0.5, { size: 14, weight: 750, color: cur || visited || front ? '#ffffff' : look.ink, align: 'center' });
    if (dijkstra) {
      const d = st.dist[n.id];
      label(ctx, d === undefined || d === Infinity ? '∞' : String(d), n.x, n.y - 33, look, { size: 11.5, color: look.violet });
    } else if (visited) label(ctx, String(st.visited.indexOf(n.id) + 1), n.x + 22, n.y - 22, look, { size: 10.5, color: look.violet });
  }
  label(ctx, st.note, BW / 2, 22, look, { size: 12.5 });
  const key: [string, string][] = [[look.orange, 'Current'], [look.green, 'Visited'], [look.blue, dijkstra ? 'Reached' : 'Waiting']];
  key.forEach(([c, t], k) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(36 + k * 100, 360, 6, 0, Math.PI * 2);
    ctx.fill();
    text(ctx, t, 48 + k * 100, 360, { size: 10.5, color: look.muted });
  });
}

// --- stack and queue: operated with buttons on the card ------------------------------------------------------------

const DS_BTN = [
  { id: 'add', x: 380, label: (q: boolean) => (q ? 'Enqueue' : 'Push') },
  { id: 'remove', x: 470, label: (q: boolean) => (q ? 'Dequeue' : 'Pop') },
];

function itemsOf(p: SimParams): number[] {
  return parseList(str(p, 'items', '7, 3, 12'), 9);
}

function drawDs(ctx: CanvasRenderingContext2D, p: SimParams, look: Look) {
  const queue = algoOf(p) === 'queue';
  const items = itemsOf(p);
  const last = str(p, 'last');
  if (queue) {
    const y = 170;
    items.forEach((v, i) => {
      const x = 60 + i * 52;
      ctx.beginPath();
      ctx.roundRect(x, y - 24, 46, 48, 8);
      ctx.fillStyle = i === items.length - 1 && last === 'add' ? look.blue : look.dark ? '#3a3a3c' : '#e8eef7';
      ctx.fill();
      ctx.strokeStyle = look.cardEdge;
      ctx.stroke();
      text(ctx, String(v), x + 23, y, { size: 15, weight: 700, color: i === items.length - 1 && last === 'add' ? '#ffffff' : look.ink, align: 'center' });
    });
    if (items.length) {
      label(ctx, 'front', 83, y + 42, look, { color: look.green });
      label(ctx, 'rear', 60 + (items.length - 1) * 52 + 23, y + 42, look, { color: look.orange });
    }
    text(ctx, 'First in, first out: dequeue takes from the front, enqueue adds at the rear', 30, 80, { size: 11.5, color: look.muted });
  } else {
    const x = 120;
    ctx.strokeStyle = look.muted;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(x - 10, 60);
    ctx.lineTo(x - 10, 330);
    ctx.lineTo(x + 110, 330);
    ctx.lineTo(x + 110, 60);
    ctx.stroke();
    items.forEach((v, i) => {
      const y = 300 - i * 30;
      const top = i === items.length - 1;
      ctx.beginPath();
      ctx.roundRect(x - 4, y - 13, 108, 26, 6);
      ctx.fillStyle = top && last === 'add' ? look.blue : look.dark ? '#3a3a3c' : '#e8eef7';
      ctx.fill();
      text(ctx, String(v), x + 50, y, { size: 14, weight: 700, color: top && last === 'add' ? '#ffffff' : look.ink, align: 'center' });
      if (top) label(ctx, '← top', x + 150, y, look, { color: look.orange });
    });
    text(ctx, 'Last in, first out: push and pop both use the top', 260, 80, { size: 11.5, color: look.muted });
  }
  const removed = str(p, 'removed');
  if (removed) label(ctx, `${queue ? 'Dequeued' : 'Popped'} ${removed}`, 440, 120, look, { color: look.red, size: 13 });
  for (const b of DS_BTN) {
    const disabled = b.id === 'remove' ? !items.length : items.length >= 9;
    ctx.beginPath();
    ctx.roundRect(b.x - 40, 320, 80, 32, 9);
    ctx.fillStyle = disabled ? look.cardEdge : b.id === 'add' ? look.blue : look.red;
    ctx.fill();
    text(ctx, b.label(queue), b.x, 336, { size: 12, weight: 700, color: disabled ? look.faint : '#ffffff', align: 'center' });
  }
  text(ctx, `Next value to add: ${nextValue(p)}`, 340, 300, { size: 10.5, color: look.muted });
}

const nextValue = (p: SimParams) => randomList(num(p, 'seed', 1) + itemsOf(p).length * 7 + str(p, 'items').length, 1)[0];

// --- the simulator ------------------------------------------------------------------------------------------------

const ALGOS = [
  { value: 'bubble', label: 'Bubble sort' }, { value: 'selection', label: 'Selection sort' }, { value: 'insertion', label: 'Insertion sort' },
  { value: 'merge', label: 'Merge sort' }, { value: 'quick', label: 'Quick sort' },
  { value: 'linear', label: 'Linear search' }, { value: 'binary', label: 'Binary search' },
  { value: 'stack', label: 'Stack' }, { value: 'queue', label: 'Queue' }, { value: 'bst', label: 'Binary search tree' },
  { value: 'bfs', label: 'Breadth-first search' }, { value: 'dfs', label: 'Depth-first search' }, { value: 'dijkstra', label: "Dijkstra's shortest path" },
];
const isAny = (...k: string[]) => (p: SimParams) => k.includes(algoOf(p));
const usesList = (p: SimParams) => isSort(p) || isAny('linear', 'binary', 'bst')(p);

export const algoSim: SimDef<AS> = {
  label: 'Algorithms',
  subject: 'Computer',
  keywords: 'algorithm sorting bubble selection insertion merge quick sort search linear binary stack queue linked list tree binary search tree traversal inorder preorder postorder graph bfs dfs dijkstra shortest path big o complexity data structure',
  blurb: 'Sorts, searches, stack, queue, trees and graph search, step by step',
  display: ['speed'],
  still: (p) => ['stack', 'queue'].includes(algoOf(p)),
  defaults: {
    algo: 'bubble', source: 'random', data: '38, 27, 43, 3, 9, 82, 10', n: 10, seed: 3, target: 42, speed: 3,
    order: 'in', start: 'A', items: '7, 3, 12', last: '', removed: '',
  },
  controls: [
    { key: 'algo', label: 'Algorithm', type: 'choice', options: ALGOS },
    { key: 'source', label: 'Numbers', type: 'choice', options: [{ value: 'random', label: 'Random' }, { value: 'typed', label: 'My list' }], show: usesList },
    { key: 'n', label: 'How many', type: 'range', min: 4, max: 16, step: 1, show: (p) => usesList(p) && str(p, 'source', 'random') === 'random' },
    { key: 'seed', label: 'Shuffle', type: 'range', min: 1, max: 50, step: 1, show: (p) => usesList(p) && str(p, 'source', 'random') === 'random' },
    { key: 'target', label: 'Look for', type: 'range', min: 1, max: 99, step: 1, show: isAny('linear', 'binary') },
    { key: 'order', label: 'Traversal', type: 'choice', options: [{ value: 'in', label: 'In-order' }, { value: 'pre', label: 'Pre-order' }, { value: 'post', label: 'Post-order' }, { value: 'level', label: 'Level order' }], show: isAny('bst') },
    { key: 'start', label: 'Start at', type: 'choice', options: GRAPH.nodes.map((n) => ({ value: n.id, label: n.id })), show: isGraph },
    { key: 'speed', label: 'Steps per second', type: 'range', min: 0.5, max: 12, step: 0.5, show: (p) => !isAny('stack', 'queue')(p) },
  ],
  presets: [
    { label: 'Bubble sort', params: { algo: 'bubble' } },
    { label: 'Insertion sort', params: { algo: 'insertion' } },
    { label: 'Merge sort', params: { algo: 'merge' } },
    { label: 'Quick sort', params: { algo: 'quick' } },
    { label: 'Already sorted', params: { algo: 'bubble', source: 'typed', data: '1, 2, 3, 4, 5, 6, 7, 8' } },
    { label: 'Binary search', params: { algo: 'binary', target: 42 } },
    { label: 'Stack', params: { algo: 'stack', items: '7, 3, 12', last: '', removed: '' } },
    { label: 'Queue', params: { algo: 'queue', items: '7, 3, 12', last: '', removed: '' } },
    { label: 'Binary search tree', params: { algo: 'bst', source: 'typed', data: '50, 30, 70, 20, 40, 60, 80, 35' } },
    { label: 'BFS', params: { algo: 'bfs', start: 'A' } },
    { label: 'DFS', params: { algo: 'dfs', start: 'A' } },
    { label: 'Dijkstra', params: { algo: 'dijkstra', start: 'A' } },
  ],
  title: (p) => ALGOS.find((a) => a.value === algoOf(p))?.label ?? 'Algorithms',
  init: () => ({ t: 0, done: false, i: 0, acc: 0 }),
  step: (p, s, dt) => {
    s.t += dt;
    const t = traceOf(p);
    const n = stepCount(t);
    if (!n) return;
    s.acc += dt * num(p, 'speed', 3);
    while (s.acc >= 1 && s.i < n - 1) {
      s.acc -= 1;
      s.i++;
    }
    if (s.i >= n - 1) s.done = true;
  },
  draw: (ctx, p, s, look) => {
    const t = traceOf(p);
    if (t.kind === 'sort') drawSort(ctx, t.steps[idx(s, t)], look);
    else if (t.kind === 'search') drawSearch(ctx, t.list, t.steps[idx(s, t)], algoOf(p) === 'binary', look);
    else if (t.kind === 'graph') drawGraph(ctx, t.steps[idx(s, t)], algoOf(p) === 'dijkstra', look);
    else if (t.kind === 'tree') drawTree(ctx, t, idx(s, t), look);
    else drawDs(ctx, p, look);
  },
  grab: (p, _s, x, y): SimGrab | null => {
    if (!isAny('stack', 'queue')(p)) return null;
    const b = DS_BTN.find((q) => Math.abs(x - q.x) <= 40 && y >= 318 && y <= 354);
    if (!b) return null;
    const items = itemsOf(p);
    if (b.id === 'add') {
      if (items.length >= 9) return null;
      return { cursor: 'pointer', tap: { items: [...items, nextValue(p)].join(', '), last: 'add', removed: '' }, hint: 'Add a value' };
    }
    if (!items.length) return null;
    const queue = algoOf(p) === 'queue';
    const removed = queue ? items[0] : items[items.length - 1];
    const rest = queue ? items.slice(1) : items.slice(0, -1);
    return { cursor: 'pointer', tap: { items: rest.join(', '), last: 'remove', removed: String(removed) }, hint: 'Take a value off' };
  },
  readouts: (p, s): Readout[] => {
    const t = traceOf(p);
    const i = idx(s, t);
    if (t.kind === 'sort') {
      const st = t.steps[i];
      return [
        { label: 'Step', value: `${i + 1} of ${t.steps.length}` },
        { label: 'Comparisons', value: String(st.comparisons), color: 'orange' },
        { label: algoOf(p) === 'merge' ? 'Writes' : 'Swaps', value: String(st.swaps), color: 'red' },
        { label: 'Items', value: String(st.arr.length) },
      ];
    }
    if (t.kind === 'search') {
      const st = t.steps[i];
      const checks = t.steps.slice(1, i + 1).filter((q) => q.at >= 0).length;
      return [
        { label: 'Looking for', value: String(Math.round(num(p, 'target', 42))) },
        { label: 'Checks', value: String(checks), color: 'orange' },
        { label: 'Result', value: st.found >= 0 ? `Position ${st.found + 1}` : i === t.steps.length - 1 ? 'Not found' : 'Searching', color: st.found >= 0 ? 'green' : undefined },
        { label: 'Worst case', value: algoOf(p) === 'binary' ? `${Math.ceil(Math.log2(t.list.length + 1))} checks` : `${t.list.length} checks` },
      ];
    }
    if (t.kind === 'graph') {
      const st = t.steps[i];
      return [
        { label: 'Step', value: `${i + 1} of ${t.steps.length}` },
        { label: 'Visited', value: st.visited.join(' ') || '—', color: 'green' },
        { label: algoOf(p) === 'bfs' ? 'Queue' : algoOf(p) === 'dfs' ? 'Stack' : 'Open', value: st.frontier.join(' ') || '—', color: 'blue' },
      ];
    }
    if (t.kind === 'tree') {
      return [
        { label: 'Nodes', value: String(new Set(t.values).size) },
        { label: 'Height', value: String(treeHeight(t.root)) },
        { label: 'Traversal', value: t.order.join(' '), color: 'green' },
      ];
    }
    const items = itemsOf(p);
    const queue = algoOf(p) === 'queue';
    return [
      { label: 'Size', value: String(items.length) },
      { label: queue ? 'Front' : 'Top', value: items.length ? String(queue ? items[0] : items[items.length - 1]) : 'Empty', color: 'orange' },
      { label: 'Contents', value: items.join(', ') || '—' },
    ];
  },
  formulas: (p): Formula[] => {
    const algo = algoOf(p);
    if ((SORTS as string[]).includes(algo)) {
      const o = BIG_O[algo as SortName];
      return [
        { label: 'Time: best, average, worst', tex: `O(${o.best}),\\ O(${o.avg}),\\ O(${o.worst})` },
        { label: `Extra space · ${o.stable ? 'stable' : 'not stable'}`, tex: `O(${o.space})` },
      ];
    }
    if (algo === 'binary') return [{ label: 'Halving each time', tex: '\\text{checks} \\le \\lceil \\log_2(n + 1) \\rceil, \\quad O(\\log n)' }];
    if (algo === 'linear') return [{ label: 'One at a time', tex: 'O(n)' }];
    if (algo === 'bst') return [{ label: 'Search, insert (balanced tree)', tex: 'O(\\log n), \\text{ worst } O(n)' }, { label: 'In-order gives sorted order', tex: '\\text{left} \\to \\text{node} \\to \\text{right}' }];
    if (algo === 'dijkstra') return [{ label: 'Relaxing an edge u → v of weight w', tex: 'd(v) = \\min\\big(d(v),\\ d(u) + w\\big)' }];
    if (algo === 'bfs' || algo === 'dfs') return [{ label: 'Every node and edge once', tex: 'O(V + E)' }];
    return [{ label: algo === 'queue' ? 'Enqueue and dequeue' : 'Push and pop', tex: 'O(1)' }];
  },
};
