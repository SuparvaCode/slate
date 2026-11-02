// Public share links: made by the owner, seen by anyone with the link, until they expire or stop.
import assert from 'node:assert/strict';
import { test } from 'node:test';

// '0', not deleted: the local .env would fill an unset value back in.
process.env.SLATE_AUTH_DISABLED = '0';

const { MemoryShareStore, SHARE_ID, myShares, setShareStore, shareBoard, stopSharing, viewShare } = await import('../src/shares.ts');

const board = (slate = 'abc', days = 7) => ({ slate, title: 'Algebra', theme: 'dark' as const, elements: [{ id: 'e1', type: 'text' }], days });

test('anyone with the link sees the snapshot', async () => {
  setShareStore(new MemoryShareStore());
  const s = await shareBoard('owner', board());
  assert.match(s.id, SHARE_ID);
  const v = await viewShare(s.id);
  assert.equal(v.title, 'Algebra');
  assert.deepEqual(v.elements, [{ id: 'e1', type: 'text' }]);
});

test('sharing the same board again keeps its link and updates it', async () => {
  setShareStore(new MemoryShareStore());
  const a = await shareBoard('owner', board());
  const b = await shareBoard('owner', { ...board(), title: 'Algebra 2', days: 0 });
  assert.equal(a.id, b.id);
  assert.equal(b.expiresAt, null);
  assert.equal((await viewShare(a.id)).title, 'Algebra 2');
  assert.equal((await myShares('owner')).length, 1);
});

test('an expired link is refused and a new share gets a new link', async (t) => {
  setShareStore(new MemoryShareStore());
  const a = await shareBoard('owner', board('abc', 1));
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 2 * 86_400_000 });
  await assert.rejects(viewShare(a.id), (e: { status: number }) => e.status === 410);
  assert.equal((await myShares('owner')).length, 0);
  const b = await shareBoard('owner', board('abc', 1));
  assert.notEqual(a.id, b.id);
  t.mock.timers.reset();
});

test('only the owner can stop sharing', async () => {
  setShareStore(new MemoryShareStore());
  const s = await shareBoard('owner', board());
  await assert.rejects(stopSharing('someone-else', s.id), (e: { status: number }) => e.status === 404);
  await stopSharing('owner', s.id);
  await assert.rejects(viewShare(s.id), (e: { status: number }) => e.status === 404);
});

test('a malformed or unknown id is not found', async () => {
  setShareStore(new MemoryShareStore());
  await assert.rejects(viewShare('../../users/x'), (e: { status: number }) => e.status === 404);
  await assert.rejects(viewShare('A'.repeat(22)), (e: { status: number }) => e.status === 404);
});

test('a board too big for one document is refused with a clear message', async () => {
  setShareStore(new MemoryShareStore());
  const big = { ...board(), elements: [{ id: 'img', type: 'image', src: `data:image/png;base64,${'A'.repeat(1_000_000)}` }] };
  await assert.rejects(shareBoard('owner', big), (e: { status: number }) => e.status === 413);
  setShareStore(null);
});

test('over HTTP: a link opens without signing in, and making one needs sign-in', async () => {
  const { createApp } = await import('../src/app.ts');
  setShareStore(new MemoryShareStore());
  const s = await shareBoard('owner', board());
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const open = await fetch(`${base}/api/share/${s.id}`);
    assert.equal(open.status, 200);
    assert.equal(open.headers.get('x-robots-tag'), 'noindex, nofollow');
    assert.equal((await open.json()).title, 'Algebra');
    assert.equal((await fetch(`${base}/api/share/${'B'.repeat(22)}`)).status, 404);
    const make = await fetch(`${base}/api/shares`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(board()) });
    assert.equal(make.status, 401);
    assert.equal((await fetch(`${base}/api/shares`)).status, 401);
  } finally {
    // fetch keeps its connections alive; close them first so `close` finishes now, not at exit,
    // where an unclosed handle races process teardown (a libuv assertion on Windows).
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    setShareStore(null);
  }
});
