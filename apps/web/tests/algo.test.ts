/**
 * Checks the algorithm simulator: every sort ends sorted with sensible counts, the searches,
 * the binary search tree and its traversals, and BFS, DFS and Dijkstra on the sample graph.
 * Run: node tests/algo.test.ts   (from apps/web)
 */

import { binaryTrace, bstInsert, graphTrace, linearTrace, parseList, randomList, sortTrace, traverse, treeHeight } from '../src/sim/algo.ts';
import type { SortName } from '../src/sim/algo.ts';

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(ok ? 'ok  ' : 'FAIL', name, ok ? '' : `-> ${detail}`);
}
const eq = (name: string, got: unknown, want: unknown) => check(name, got === want, `got ${String(got)}, want ${String(want)}`);

// --- input -------------------------------------------------------------------------------------------
eq('parse a typed list', parseList('5, 2  9;1').join(','), '5,2,9,1');
eq('random list is repeatable', randomList(7, 6).join(','), randomList(7, 6).join(','));
check('random list stays in range', randomList(3, 50).every((v) => v >= 1 && v <= 99));

// --- sorting -------------------------------------------------------------------------------------------
const SORTS: SortName[] = ['bubble', 'selection', 'insertion', 'merge', 'quick'];
const inputs = [randomList(1, 12), randomList(9, 16), [5, 1, 4, 2, 8], [3, 3, 1, 2, 3], [1], [2, 1], [1, 2, 3, 4, 5, 6, 7, 8], [8, 7, 6, 5, 4, 3, 2, 1]];
for (const algo of SORTS) {
  let ok = true;
  let bad = '';
  for (const a of inputs) {
    const steps = sortTrace(a, algo);
    const last = steps[steps.length - 1].arr;
    const want = [...a].sort((x, y) => x - y);
    if (last.join(',') !== want.join(',')) {
      ok = false;
      bad = `${a} -> ${last}`;
    }
    if (steps.some((st) => [...st.arr].sort((x, y) => x - y).join(',') !== want.join(','))) {
      ok = false;
      bad = `values lost or invented while sorting ${a}`;
    }
  }
  check(`${algo} sort: every input ends sorted`, ok, bad);
}
const sorted = [1, 2, 3, 4, 5, 6, 7, 8];
const n = sorted.length;
eq('bubble on sorted input: one pass, n − 1 comparisons', sortTrace(sorted, 'bubble').at(-1)!.comparisons, n - 1);
eq('insertion on sorted input: n − 1 comparisons', sortTrace(sorted, 'insertion').at(-1)!.comparisons, n - 1);
eq('selection always makes n(n − 1)/2 comparisons', sortTrace(sorted, 'selection').at(-1)!.comparisons, (n * (n - 1)) / 2);
eq('bubble on reversed input: n(n − 1)/2 swaps', sortTrace([...sorted].reverse(), 'bubble').at(-1)!.swaps, (n * (n - 1)) / 2);
check('merge sort beats bubble sort on 16 random items', sortTrace(randomList(9, 16), 'merge').at(-1)!.comparisons < sortTrace(randomList(9, 16), 'bubble').at(-1)!.comparisons);
eq('every item ends marked in place', sortTrace([4, 2, 3, 1], 'quick').at(-1)!.done.length, 4);

// --- searching -----------------------------------------------------------------------------------------
const list = [3, 9, 14, 21, 27, 35, 42, 50, 58, 66, 73, 81, 90];
const bin = binaryTrace(list, 42);
eq('binary search finds 42 at position 7', bin.at(-1)!.found, 6);
eq('binary search: 42 is the first middle', bin.filter((s) => s.at >= 0).length, 1);
const bin2 = binaryTrace(list, 81);
eq('binary search finds 81', bin2.at(-1)!.found, 11);
check('binary search takes at most ⌈log₂(n + 1)⌉ checks', bin2.filter((s) => s.at >= 0).length <= Math.ceil(Math.log2(list.length + 1)));
eq('binary search: missing value', binaryTrace(list, 40).at(-1)!.found, -1);
check('binary search: missing value still within the bound', binaryTrace(list, 40).filter((s) => s.at >= 0).length <= Math.ceil(Math.log2(list.length + 1)));
eq('linear search: 42 takes 7 checks', linearTrace(list, 42).filter((s) => s.at >= 0).length, 7);
eq('linear search: missing value checks everything', linearTrace(list, 40).filter((s) => s.at >= 0).length, list.length);

// --- binary search tree ----------------------------------------------------------------------------------
const tree = bstInsert([50, 30, 70, 20, 40, 60, 80, 35]);
eq('in-order is sorted', traverse(tree, 'in').join(','), '20,30,35,40,50,60,70,80');
eq('pre-order', traverse(tree, 'pre').join(','), '50,30,20,40,35,70,60,80');
eq('post-order', traverse(tree, 'post').join(','), '20,35,40,30,60,80,70,50');
eq('level order', traverse(tree, 'level').join(','), '50,30,70,20,40,60,80,35');
eq('height', treeHeight(tree), 4);
eq('duplicates are ignored', traverse(bstInsert([5, 3, 5, 3]), 'in').join(','), '3,5');
eq('sorted input makes a chain', treeHeight(bstInsert([1, 2, 3, 4, 5])), 5);

// --- graphs ------------------------------------------------------------------------------------------------
const order = (k: 'bfs' | 'dfs', s = 'A') => graphTrace(k, s).at(-1)!.visited.join('');
eq('BFS from A visits level by level', order('bfs'), 'ABCDFEG');
eq('DFS from A goes deep first', order('dfs'), 'ABCDEFG');
check('BFS and DFS visit every node once', ['bfs', 'dfs'].every((k) => new Set(order(k as 'bfs' | 'dfs')).size === 7 && order(k as 'bfs' | 'dfs').length === 7));
const tree6 = (k: 'bfs' | 'dfs') => graphTrace(k, 'A').at(-1)!.tree.length;
eq('BFS tree has V − 1 edges', tree6('bfs'), 6);
eq('DFS tree has V − 1 edges', tree6('dfs'), 6);
const dj = graphTrace('dijkstra', 'A').at(-1)!;
// A–C 2, A–C–B 3, B–D 8, D–E 10, E–F 11, E–G 12.
eq('Dijkstra distances from A', ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((x) => dj.dist[x]).join(','), '0,3,2,8,10,11,12');
eq('Dijkstra: B is reached through C', dj.prev.B, 'C');
eq('Dijkstra: G is reached through E', dj.prev.G, 'E');
eq('Dijkstra from G', ['A', 'D', 'F'].map((x) => graphTrace('dijkstra', 'G').at(-1)!.dist[x]).join(','), '12,4,3');

console.log(failures ? `\n${failures} failed` : '\nall passed');
if (failures) process.exit(1);
