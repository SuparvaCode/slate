// Port of services/api/tests/test_answers.py (one test per check).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cleanColumns, endsWithQuestion, exprFromLatex, looksLikeMath, nameUnknown, plainText, questionUnknown, splitChain, trimChain,
} from '../src/answers.ts';

const check = (name: string, fn: () => unknown) => test(name, () => assert.ok(fn()));
const eq = (name: string, got: () => unknown, want: unknown) => test(name, () => assert.deepEqual(got(), want));

// --- columns ---
const two = [{ heading: 'Elimination', lines: ['3x = 12', 'x = 4'] }, { heading: 'Check', lines: ['4 - 2 = 2'] }];
eq('two columns are kept', () => cleanColumns(two), two);
eq('one column is not side by side', () => cleanColumns(two.slice(0, 1)), []);
check('not a list', () => cleanColumns('x').length === 0 && cleanColumns(null).length === 0 && cleanColumns({}).length === 0);
eq('junk entries are skipped', () => cleanColumns([1, null, 'x', ...two]).length, 2);
eq('empty columns are dropped', () => cleanColumns([{ heading: 'a', lines: [] }, ...two]), two);
const many = Array.from({ length: 5 }, (_, i) => ({ heading: String(i), lines: [String(i)] }));
eq('at most three columns', () => cleanColumns(many).length, 3);
const tall = [{ heading: 'h', lines: Array.from({ length: 12 }, (_, i) => `x = ${i}`) }, ...two];
eq('at most eight lines each', () => cleanColumns(tall)[0].lines.length, 8);
const broken = [{ heading: 'A  very\nlong ' + 'heading '.repeat(8), lines: ['a \\\\ b', '  ', 'c\nd'] }, ...two];
eq('line breaks inside a line become spaces', () => cleanColumns(broken)[0].lines, ['a   b', 'c d']);
check('headings are tidied and capped', () => {
  const h = cleanColumns(broken)[0].heading;
  return !h.includes('\n') && h.length <= 24;
});
eq('a missing heading is allowed', () => cleanColumns([{ lines: ['a'] }, { lines: ['b'] }])[0].heading, '');

// --- "z = ?" ---
check('trailing ? is detected', () => endsWithQuestion('z = ?') && endsWithQuestion('z = ? '));
check('no ? is not', () => !endsWithQuestion('z =') && !endsWithQuestion('x? = 1'));
const w = String.raw`x = 78 \\ y = 9 \\ z = x + yx \\ z = ?`;
eq('names the unknown', () => nameUnknown(w, '780'), 'z = 780');
eq('keeps an answer that already names it', () => nameUnknown(w, 'z = 780'), 'z = 780');
eq('handles a subscript', () => nameUnknown('v_0 = ?', '12'), 'v_0 = 12');
check('leaves other questions alone', () => nameUnknown('7 + 8 =', '15') === '15' && nameUnknown('what is 2 + 2 ?', '4') === '4');
eq('an empty answer stays empty', () => nameUnknown('z = ?', ''), '');

// --- typed notes versus maths ---
for (const note of ['buy milk', String.raw`\text{buy milk}`, 'call Sam at five', String.raw`\text{remember the meeting}`]) {
  check(`note: ${note}`, () => !looksLikeMath(note));
}
for (const maths of ['2x + 5 = 13', String.raw`\int \sin x`, '7', 'x^2', String.raw`\frac{1}{2}`, String.raw`\sin x`, 'a_1', String.raw`\text{x} = 3`]) {
  check(`maths: ${maths}`, () => looksLikeMath(maths));
}
eq('plain_text unwraps', () => plainText(String.raw`\text{buy   milk}`), 'buy milk');

// --- the line separator the reader really produces: one backslash before a space ---
const B = '\\';
const single = `x + y = 5 ${B} x - y = 1 ${B} x = ?`;
const double = `x + y = 5 ${B}${B} x - y = 1 ${B}${B} x = ?`;
const mixed = `x = 78 ${B} ${B}${B} y = 9 ${B} ${B}${B} z = ?`;
eq('unknown with single-backslash lines', () => questionUnknown(single), 'x');
eq('unknown with double-backslash lines', () => questionUnknown(double), 'x');
eq('unknown with mixed separators', () => questionUnknown(mixed), 'z');
eq('naming works with single-backslash lines', () => nameUnknown(single, '3'), 'x = 3');
eq('trimming works with single-backslash lines', () => trimChain(single, 'x = 1 + 2 = 3'), 'x = 3');

// --- which unknown the question asks for ---
eq("finds x in 'x = ?'", () => questionUnknown('x = ?'), 'x');
eq("finds the last line's unknown", () => questionUnknown(String.raw`x = 78 \\ z = ?`), 'z');
eq("no unknown for '7 + 8 ='", () => questionUnknown('7 + 8 ='), null);

// --- a derivation after "?" is cut down ---
const q = String.raw`v_0 = 20 \\ t_{flight} = ?`;
const long = String.raw`t_{flight} = \frac{2v_0\sin\theta}{g} = \frac{2\cdot20\cdot \sin 30^\circ}{9.8} \approx 2.04\ \text{s}`;
eq('chain cut to the value', () => trimChain(q, long), String.raw`t_{flight} = 2.04\ \text{s}`);
eq('chain without approx keeps the last part', () => trimChain('F = ?', String.raw`F = ma = 2 \cdot 3 = 6 N`), 'F = 6 N');
eq("a plain 'z = 780' is left alone", () => trimChain('z = ?', 'z = 780'), 'z = 780');
eq('exact then approx is left alone', () => trimChain('x = ?', String.raw`x = \frac{\ln 2}{\ln 3} \approx 0.63`), String.raw`x = \frac{\ln 2}{\ln 3} \approx 0.63`);
eq('several results are left alone', () => trimChain('x = ?', 'x = 2, x = 3'), 'x = 2, x = 3');
eq('cases are left alone', () => trimChain('f = ?', String.raw`f = \begin{cases} 1 & x = 0 \end{cases}`), String.raw`f = \begin{cases} 1 & x = 0 \end{cases}`);
eq("not a '?' question is left alone", () => trimChain('7 + 8 =', '7 + 8 = 15 = 15'), '7 + 8 = 15 = 15');

// --- the machine-readable form from plain LaTeX ---
eq('plain value', () => exprFromLatex('780'), '780');
eq('value after the name', () => exprFromLatex('z = 780'), '780');
eq('units are dropped', () => exprFromLatex(String.raw`6 \, \text{N}`), '6');
eq('decimal with units', () => exprFromLatex(String.raw`t_{flight} = 2.04\ \text{s}`), '2.04');
eq('several results keep their names', () => exprFromLatex('x = 2, x = 3'), 'x = 2, x = 3');
eq('fractions are not guessed', () => exprFromLatex(String.raw`\frac{3}{4}`), '');
eq('approx is not guessed', () => exprFromLatex(String.raw`x \approx 1.7`), '');
eq('empty stays empty', () => exprFromLatex(''), '');

// --- long chains become one "=" per line ---
const chain = String.raw`\tan^4 x = \tan^2 x (\sec^2 x - 1) = \tan^2 x \sec^2 x - \tan^2 x`;
eq('chain split', () => splitChain(chain), [String.raw`\tan^4 x = \tan^2 x (\sec^2 x - 1)`, String.raw`= \tan^2 x \sec^2 x - \tan^2 x`]);
eq('one = is left alone', () => splitChain('x = 4'), ['x = 4']);
eq('no = is left alone', () => splitChain(String.raw`\int x dx`), [String.raw`\int x dx`]);
eq('continuation chain split', () => splitChain('= a = b'), ['= a', '= b']);
eq('= inside braces is not split', () => splitChain(String.raw`f_{x=1} = 2 = 2`), [String.raw`f_{x=1} = 2`, '= 2']);
eq('cases are left alone', () => splitChain(String.raw`\begin{cases} a = 1 \end{cases} = 2 = 2`), [String.raw`\begin{cases} a = 1 \end{cases} = 2 = 2`]);
eq('empty part is left alone', () => splitChain('a = = b'), ['a = = b']);
// Several equations on one line are not a chain.
for (const line of [
  String.raw`x - 2 = 0 \text{ or } x - 3 = 0`,
  'x - 2 = 0 or x - 3 = 0',
  'x = 2, x = 3',
  String.raw`x = 2 \quad y = 3`,
  String.raw`2x = 8 \implies x = 4`,
  'a = 1; b = 2',
  String.raw`x = 1 \\ y = 2`,
]) {
  eq(`not a chain: ${line}`, () => splitChain(line), [line]);
}
// A comma inside brackets, or a word that only contains "or", still splits.
eq('comma in brackets still splits', () => splitChain('f(a, b) = a + b = 3'), ['f(a, b) = a + b', '= 3']);
eq('thin space still splits', () => splitChain(String.raw`F = 2\,\text{N} \cdot 3 = 6\,\text{N}`), [String.raw`F = 2\,\text{N} \cdot 3`, String.raw`= 6\,\text{N}`]);
eq("word with 'or' still splits", () => splitChain(String.raw`\cos x = \text{floor} = 1`), [String.raw`\cos x = \text{floor}`, '= 1']);
