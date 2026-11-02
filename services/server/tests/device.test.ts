// One device per account: the newest sign-in wins and the other devices are refused.
import assert from 'node:assert/strict';
import { test } from 'node:test';

// '0', not deleted: the local .env would fill an unset value back in.
process.env.SLATE_AUTH_DISABLED = '0';

const { MemoryDeviceStore, claimDevice, requireDevice, setDeviceStore } = await import('../src/device.ts');

const PHONE = 'phone-device-0000000001';
const LAPTOP = 'laptop-device-000000002';

/** Runs requireDevice for `uid` from `device` and returns what it passed to next(). */
async function check(uid: string, device: string | null) {
  const req = { headers: device ? { 'x-slate-device': device } : {} };
  const res = { locals: { caller: { uid } } };
  let out: unknown = 'not called';
  await requireDevice(req as never, res as never, (err?: unknown) => {
    out = err ?? null;
  });
  return out as { status?: number; headers?: Record<string, string> } | null;
}

test('the first device to call claims an account that has no claim yet', async () => {
  setDeviceStore(new MemoryDeviceStore());
  assert.equal(await check('u1', PHONE), null);
  assert.equal(await check('u1', PHONE), null);
});

test('signing in on a second device signs the first one out', async () => {
  setDeviceStore(new MemoryDeviceStore());
  await claimDevice('u2', PHONE);
  assert.equal(await check('u2', PHONE), null);
  await claimDevice('u2', LAPTOP);
  const refused = await check('u2', PHONE);
  assert.equal(refused?.status, 401);
  assert.equal(refused?.headers?.['X-Slate-Reason'], 'other-device');
  assert.equal(await check('u2', LAPTOP), null);
});

test('accounts are independent', async () => {
  setDeviceStore(new MemoryDeviceStore());
  await claimDevice('a', PHONE);
  await claimDevice('b', LAPTOP);
  assert.equal(await check('a', PHONE), null);
  assert.equal(await check('b', LAPTOP), null);
});

test('an older app without a device id is let through', async () => {
  setDeviceStore(new MemoryDeviceStore());
  await claimDevice('u3', PHONE);
  assert.equal(await check('u3', null), null);
});

test('a malformed device id is treated as none', async () => {
  setDeviceStore(new MemoryDeviceStore());
  await claimDevice('u4', PHONE);
  assert.equal(await check('u4', 'short'), null);
});

test('a store failure does not take the app down', async () => {
  setDeviceStore({
    get: async () => {
      throw new Error('firestore down');
    },
    set: async () => {},
  });
  const orig = console.error;
  console.error = () => {};
  try {
    assert.equal(await check('u5', PHONE), null);
  } finally {
    console.error = orig;
    setDeviceStore(null);
  }
});
