/**
 * Drives the real board the way a user would and checks what it saved after each step.
 * Run from the app page:  (await import('/src/dev/boardtest.ts')).start()
 * The page reloads at the end; the result is then in sessionStorage under 'slate.boardtest'.
 *
 * The saved board, instruments and settings are backed up first and put back at the end, so it
 * can run on a board that is in use. Page errors raised during the run are reported.
 */

interface Step { name: string; ok: boolean; detail: string }

const KEYS = ['slate.board.v1', 'slate.instruments', 'slate.ui.v1'];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const canvas = () => document.querySelector('canvas') as HTMLCanvasElement;
const saved = () => JSON.parse(localStorage.getItem('slate.board.v1') ?? '{"elements":[]}') as { elements: { type: string; kind?: string; x?: number; points?: unknown[]; text?: string }[]; cam: { x: number; y: number; z: number } };
const els = () => saved().elements;

let pid = 100;
function pointer(type: string, x: number, y: number, id: number, extra: PointerEventInit = {}) {
  canvas().dispatchEvent(new PointerEvent(type, {
    bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: id, pointerType: 'mouse', isPrimary: true,
    button: 0, buttons: type === 'pointerup' ? 0 : 1, pressure: type === 'pointerup' ? 0 : 0.5, ...extra,
  }));
}
async function drag(x0: number, y0: number, x1: number, y1: number, steps = 12) {
  const id = pid++;
  pointer('pointerdown', x0, y0, id);
  for (let i = 1; i <= steps; i++) {
    pointer('pointermove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, id);
    await wait(6);
  }
  pointer('pointerup', x1, y1, id);
}
async function tap(x: number, y: number) {
  const id = pid++;
  pointer('pointerdown', x, y, id);
  await wait(20);
  pointer('pointerup', x, y, id);
}
function key(k: string, o: KeyboardEventInit = {}) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
  window.dispatchEvent(new KeyboardEvent('keyup', { key: k, bubbles: true, ...o }));
}
/** Picks a tool by its key, then pauses as a hand would: the board takes the new tool on its next render. */
async function pick(k: string) {
  key(k);
  await wait(150);
}
const button = (label: string) => document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement | null;
const byText = (sel: string, t: string) => [...document.querySelectorAll(sel)].find((b) => (b.textContent ?? '').trim() === t) as HTMLElement | undefined;

export async function start() {
  const steps: Step[] = [];
  const errors: string[] = [];
  const onErr = (e: ErrorEvent) => errors.push(e.message);
  const onRej = (e: PromiseRejectionEvent) => errors.push(`unhandled: ${String(e.reason)}`);
  const origError = console.error;
  console.error = (...a: unknown[]) => {
    errors.push(a.map(String).join(' ').slice(0, 300));
    origError(...a);
  };
  window.addEventListener('error', onErr);
  window.addEventListener('unhandledrejection', onRej);
  const backup = Object.fromEntries(KEYS.map((k) => [k, localStorage.getItem(k)]));
  (window as unknown as { __boardtest: unknown }).__boardtest = { running: true, steps };
  const check = (name: string, ok: boolean, detail = '') => steps.push({ name, ok, detail });
  const settle = () => wait(750);

  try {
    // --- an empty board -------------------------------------------------------------------------
    // Instruments live in the app's memory as well as in storage, so put them away through the app.
    button('Classroom tools')?.click();
    await wait(200);
    const away = [...document.querySelectorAll('.cls-menu .cls-item')].find((b) => (b.textContent ?? '').trim().startsWith('Put away')) as HTMLElement | undefined;
    if (away) away.click();
    else button('Classroom tools')?.click();
    await wait(200);
    if (els().length) {
      button('Clear board')?.click();
      await wait(150);
      byText('button', 'Clear board?')?.click();
      await settle();
    }
    check('clear board empties it', els().length === 0, `${els().length} left`);
    button('Reset zoom')?.click();
    await wait(450);
    const W = innerWidth;
    const H = innerHeight;
    const cx = W / 2;
    const cy = H / 2 - 40;

    // --- drawing ----------------------------------------------------------------------------------
    await pick('p');
    await drag(cx - 300, cy - 150, cx - 160, cy - 100);
    await settle();
    let e = els();
    check('pen draws a stroke', e.length === 1 && e[0].type === 'stroke' && e[0].kind === 'pen', JSON.stringify(e.map((x) => [x.type, x.kind])));
    await pick('h');
    await drag(cx - 300, cy - 60, cx - 160, cy - 60);
    await settle();
    e = els();
    check('highlighter draws a highlight', e.length === 2 && e[1].kind === 'highlight', JSON.stringify(e.map((x) => [x.type, x.kind])));

    const shapes: [string, string][] = [['r', 'rect'], ['o', 'ellipse'], ['d', 'diamond'], ['l', 'line'], ['a', 'arrow']];
    let at = cx - 120;
    for (const [k] of shapes) {
      await pick(k);
      await drag(at, cy - 150, at + 60, cy - 90);
      at += 80;
    }
    await settle();
    e = els();
    const kinds = e.slice(2).map((x) => x.kind ?? x.type);
    check('rectangle, ellipse, diamond, line and arrow', e.length === 7 && shapes.every(([, n], i) => kinds[i] === n), JSON.stringify(kinds));

    await pick('t');
    await tap(cx - 300, cy + 40);
    await wait(250);
    const ta = document.querySelector('textarea') as HTMLTextAreaElement | null;
    if (ta) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(ta, 'F = ma');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(50);
      ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    await settle();
    e = els();
    check('text tool writes text', !!ta && e.some((x) => x.type === 'text' && x.text === 'F = ma'), ta ? JSON.stringify(e.filter((x) => x.type === 'text')) : 'no text box opened');

    // --- editing ----------------------------------------------------------------------------------
    const before = els().length;
    key('a', { ctrlKey: true });
    await wait(100);
    key('Delete');
    await settle();
    check('select all and delete', els().length === 0, `${els().length} left`);
    key('z', { ctrlKey: true });
    await settle();
    check('undo brings them back', els().length === before, `${els().length} of ${before}`);
    key('y', { ctrlKey: true });
    await settle();
    check('redo deletes them again', els().length === 0, `${els().length}`);
    key('z', { ctrlKey: true });
    await settle();

    // Move the rectangle with the select tool.
    const rect0 = els().find((x) => x.kind === 'rect')!;
    await pick('v');
    key('Escape');
    await wait(100);
    await drag(cx - 90, cy - 150, cx - 90 + 60, cy - 150 + 40);
    await settle();
    const rect1 = els().find((x) => x.kind === 'rect')!;
    check('drag moves a shape', !!rect1 && Math.abs((rect1.x ?? 0) - (rect0.x ?? 0) - 60) < 2, `x ${rect0?.x} → ${rect1?.x}`);
    key('d', { ctrlKey: true });
    await settle();
    check('duplicate copies the selection', els().filter((x) => x.kind === 'rect').length === 2, `${els().filter((x) => x.kind === 'rect').length} rectangles`);
    key('z', { ctrlKey: true });
    await settle();

    // Erase across the pen stroke.
    const strokes0 = els().filter((x) => x.type === 'stroke' && x.kind === 'pen').length;
    await pick('e');
    await drag(cx - 240, cy - 170, cx - 220, cy - 80, 16);
    await settle();
    const pens = els().filter((x) => x.type === 'stroke' && x.kind === 'pen');
    check('eraser cuts the stroke', pens.length !== strokes0 || pens.reduce((t, s) => t + (s.points?.length ?? 0), 0) < 40, `${strokes0} → ${pens.length} strokes`);

    // --- view ---------------------------------------------------------------------------------------
    // Zoom is checked by hand: the camera updates on animation frames, which a hidden page does not get.
    const t0 = document.documentElement.dataset.theme;
    button('Toggle theme')?.click();
    await wait(150);
    const t1 = document.documentElement.dataset.theme;
    button('Toggle theme')?.click();
    await wait(150);
    check('theme toggles both ways', t0 !== t1 && document.documentElement.dataset.theme === t0, `${t0} → ${t1} → ${document.documentElement.dataset.theme}`);

    // --- every simulator ------------------------------------------------------------------------------
    const simsBefore = els().filter((x) => x.type === 'sim').length;
    const names: string[] = [];
    for (let guard = 0; guard < 40; guard++) {
      if (!byText('button', 'Simulators')) {
        button('Shapes and diagrams')?.click();
        await wait(300);
      }
      byText('button', 'Simulators')?.click();
      await wait(200);
      byText('button', 'All')?.click();
      await wait(150);
      const cards = [...document.querySelectorAll('.sim-card')] as HTMLButtonElement[];
      const next = cards.find((c) => !names.includes(c.getAttribute('aria-label') ?? ''));
      if (!next) break;
      names.push(next.getAttribute('aria-label') ?? '');
      next.click();
      await wait(250);
      const panel = document.querySelector('.sim-panel');
      if (panel) (panel.querySelector('[aria-label="Close settings"]') as HTMLButtonElement | null)?.click();
      await wait(80);
    }
    await settle();
    const sims = els().filter((x) => x.type === 'sim');
    check('every simulator can be placed', sims.length - simsBefore === names.length && names.length >= 19, `${names.length} in the picker, ${sims.length - simsBefore} placed: ${names.join(', ')}`);

    // --- classroom tools ---------------------------------------------------------------------------------
    const menuItems = async () => {
      if (!document.querySelector('.cls-menu')) button('Classroom tools')?.click();
      await wait(200);
      return [...document.querySelectorAll('.cls-menu .cls-item')] as HTMLButtonElement[];
    };
    for (const t of ['Ruler', 'Set square 45°', 'Set square 30°–60°', 'Protractor', 'Compass']) {
      (await menuItems()).find((b) => (b.textContent ?? '').trim() === t)?.click();
      await wait(150);
    }
    const inst = JSON.parse(localStorage.getItem('slate.instruments') ?? '[]');
    check('all five instruments placed', inst.length === 5, `${inst.length}: ${inst.map((i: { kind: string }) => i.kind).join(', ')}`);
    for (const t of ['Timer', 'Spotlight', 'Screen shade', 'Random picker', 'Scoreboard']) {
      (await menuItems()).find((b) => (b.textContent ?? '').trim() === t)?.click();
      await wait(150);
    }
    const open = { timer: !!document.querySelector('[aria-label="Timer"], [aria-label="Stopwatch"]'), spot: !!document.querySelector('.cls-spot'), shade: !!document.querySelector('.cls-shade'), picker: !!document.querySelector('[aria-label="Random picker"]'), score: !!document.querySelector('[aria-label="Scoreboard"]') };
    check('all five screen tools open', Object.values(open).every(Boolean), JSON.stringify(open));
    for (const l of ['Close Timer', 'Close the spotlight', 'Close the screen shade', 'Close Random picker', 'Close Scoreboard']) button(l)?.click();
    await wait(200);
    check('screen tools close', !document.querySelector('.cls-card, .cls-spot, .cls-shade'), '');
    (await menuItems()).find((b) => (b.textContent ?? '').startsWith('Put away'))?.click();
    await wait(200);
    check('instruments put away', JSON.parse(localStorage.getItem('slate.instruments') ?? '[]').length === 0, '');
  } catch (err) {
    check('the run itself', false, `threw: ${String((err as Error)?.stack ?? err).slice(0, 400)}`);
  } finally {
    window.removeEventListener('error', onErr);
    window.removeEventListener('unhandledrejection', onRej);
    console.error = origError;
    check('no page errors during the run', errors.length === 0, errors.slice(0, 8).join(' | '));
    // Let the board's own autosave (0.5 s after a change) finish first, or it would write over the restore.
    await wait(900);
    for (const [k, v] of Object.entries(backup)) {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    }
    const result = { running: false, passed: steps.filter((s) => s.ok).length, failed: steps.filter((s) => !s.ok).length, steps };
    (window as unknown as { __boardtest: unknown }).__boardtest = result;
    // The page still holds the test board in memory and would save it over the restore, so reload.
    sessionStorage.setItem('slate.boardtest', JSON.stringify(result));
    location.reload();
  }
}
