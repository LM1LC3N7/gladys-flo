// -----------------------------------------------------------------------------
// The shutoff keeper alone (src/shutoff.js) and its file in /data
// (src/store.js): a fake Flo of three functions, a clock the tests move, and
// one run on the real clock measuring the period of the resends.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ShutoffKeeper } from '../src/shutoff.js';
import { MAX_SHUTOFFS, loadShutoffs, normalizeShutoffs, saveShutoffs } from '../src/store.js';
import { createFakeTimers } from './helpers/fakeFlo.js';

const TIMINGS = {
  check: 90_000,
  resends: 3,
  heldEvery: 15 * 60_000,
  expiry: 24 * 60 * 60_000,
  minGap: 60_000,
  openBlock: 20_000,
};
const quiet = { info() {}, warn() {}, debug() {} };

/** A keeper on a fake Flo: `flo.closed` is what a read shows; `flo.fail` an error kind to throw. */
function keeperOf({ timings = TIMINGS, timers = createFakeTimers(), clock = { now: 1_000 } } = {}) {
  const flo = { sends: [], reads: 0, closed: false, fail: undefined, ready: {}, saved: [] };
  const keeper = new ShutoffKeeper({
    send: async (entry) => {
      flo.sends.push({ id: entry.id, at: clock.now });
      if (flo.fail) {
        throw Object.assign(new Error(flo.fail), { kind: flo.fail });
      }
    },
    read: async (entry) => {
      const ticket = keeper.ticket();
      flo.reads += 1;
      keeper.observe(entry.id, flo.closed, ticket);
    },
    ready: () => flo.ready,
    save: async (list) => flo.saved.push(list),
    logger: quiet,
    timers,
    monotonic: () => clock.now,
    wallNow: () => 1_790_000_000_000 + clock.now,
    timings,
  });
  return { keeper, flo, timers, clock };
}

const runAll = async (timers, clock) => {
  const ms = Math.max(0, ...timers.timeouts().map((t) => t.ms));
  clock.now += ms;
  await timers.runTimeouts();
};

test('a click sends at once and keeps the shutoff until a later read shows it closed', async () => {
  const { keeper, flo, timers, clock } = keeperOf();
  assert.equal(await keeper.click('v1', 'Valve'), 'sent');
  assert.deepEqual(flo.sends, [{ id: 'v1', at: 1_000 }]);
  assert.equal(flo.saved.length >= 1, true);
  assert.deepEqual(flo.saved[0], [{ id: 'v1', name: 'Valve', at: 1_790_000_001_000 }]);
  // A reading that started before the send ended never confirms it.
  const early = keeper.entries.get('v1').doneTicket - 1;
  keeper.observe('v1', true, early);
  assert.equal(keeper.entries.size, 1);
  keeper.observe('v1', false, keeper.ticket());
  assert.equal(keeper.entries.size, 1);
  keeper.observe('v1', true, keeper.ticket());
  assert.equal(keeper.entries.size, 0);
  await keeper.saving;
  assert.deepEqual(flo.saved.at(-1), []);
  assert.equal(timers.timeouts().length, 0);
  await runAll(timers, clock);
  assert.equal(flo.sends.length, 1);
});

test('resends: 3 after 90 s each, then held every 15 min; read before each', async () => {
  const { keeper, flo, timers, clock } = keeperOf();
  await keeper.click('v1', 'Valve');
  for (let i = 1; i <= 3; i += 1) {
    assert.deepEqual(
      timers.timeouts().map((t) => t.ms),
      [90_000],
    );
    await runAll(timers, clock);
    assert.equal(flo.reads, i);
    assert.equal(flo.sends.length, 1 + i);
  }
  await runAll(timers, clock);
  assert.equal(flo.sends.length, 4, 'held: not sent at once');
  assert.equal(keeper.summary().held, 1);
  assert.deepEqual(
    timers.timeouts().map((t) => t.ms),
    [15 * 60_000],
  );
  await runAll(timers, clock);
  assert.equal(flo.sends.length, 5);
  // Seen closed at the read of a check: not sent.
  flo.closed = true;
  await runAll(timers, clock);
  assert.equal(flo.sends.length, 5);
  assert.equal(keeper.entries.size, 0);
});

test('given up 24 h after its first send, not before; a new click counts again', async () => {
  const { keeper, flo, timers, clock } = keeperOf();
  await keeper.click('v1', 'Valve');
  const first = clock.now;
  for (let i = 0; i < 4; i += 1) {
    await runAll(timers, clock);
  }
  const sends = flo.sends.length;
  // The check right before the 24 h: sent again.
  clock.now = first + TIMINGS.expiry - 1 - 15 * 60_000;
  await runAll(timers, clock);
  assert.equal(flo.sends.length, sends + 1);
  // At 24 h: given up, said by the summary.
  clock.now = first + TIMINGS.expiry - 15 * 60_000;
  await runAll(timers, clock);
  assert.equal(keeper.entries.size, 0);
  assert.equal(flo.sends.length, sends + 1);
  assert.deepEqual(keeper.summary().givenUp, ['Valve']);
  // A new click: kept again, no longer given up.
  await keeper.click('v1', 'Valve');
  assert.deepEqual(keeper.summary().givenUp, []);
  assert.equal(keeper.entries.get('v1').firstSent, clock.now);
});

test('a refused account: nothing sent, no timer; fireAll sends it, with a new budget', async () => {
  const { keeper, flo, timers } = keeperOf();
  flo.ready = { blocked: true };
  assert.equal(await keeper.click('v1', 'Valve'), 'blocked');
  assert.equal(keeper.blocked, true);
  assert.equal(flo.sends.length, 0);
  assert.equal(timers.timeouts().length, 0);
  flo.ready = {};
  keeper.fireAll();
  assert.equal(keeper.blocked, false);
  await keeper.entries.get('v1').inFlight;
  assert.equal(flo.sends.length, 1);
});

test('a pause asked by Flo: the shutoff waits for its end, nothing read before', async () => {
  const { keeper, flo, timers, clock } = keeperOf();
  flo.ready = { wait: 300_000 };
  assert.equal(await keeper.click('v1', 'Valve'), 'paused');
  assert.deepEqual(
    timers.timeouts().map((t) => t.ms),
    [300_000],
  );
  flo.ready = {};
  await runAll(timers, clock);
  assert.equal(flo.reads, 1);
  assert.equal(flo.sends.length, 1);
});

test('fireAll: skips a shutoff sent less than a minute ago or in flight', async () => {
  const { keeper, flo, clock } = keeperOf();
  await keeper.click('v1', 'Valve');
  clock.now += 59_999;
  keeper.fireAll();
  assert.equal(flo.sends.length, 1);
  clock.now += 1;
  keeper.fireAll();
  keeper.fireAll();
  await keeper.entries.get('v1').inFlight;
  assert.equal(flo.sends.length, 2, 'one send in flight at a time');
});

test('a failed send is checked again; 404 gives up; 429 asks the app to pause', async () => {
  let paused;
  const { keeper, flo, timers, clock } = keeperOf();
  keeper.onRateLimited = (err) => (paused = err.kind);
  flo.fail = 'unavailable';
  assert.equal(await keeper.click('v1', 'Valve'), 'failed');
  assert.deepEqual(
    timers.timeouts().map((t) => t.ms),
    [90_000],
  );
  flo.fail = 'rate_limited';
  await runAll(timers, clock);
  assert.equal(paused, 'rate_limited');
  assert.equal(keeper.entries.size, 1);
  flo.fail = 'not_found';
  await runAll(timers, clock);
  assert.equal(keeper.entries.size, 0);
  assert.equal(timers.timeouts().length, 0);
});

test('a click while its send is in flight: one request, not two', async () => {
  const { keeper, flo } = keeperOf();
  let release;
  keeper.send = (entry) => {
    flo.sends.push({ id: entry.id });
    return new Promise((resolve) => (release = resolve));
  };
  const first = keeper.click('v1', 'Valve');
  const second = keeper.click('v1', 'Valve');
  release();
  assert.deepEqual(await Promise.all([first, second]), ['sent', 'sent']);
  assert.equal(flo.sends.length, 1);
});

test('a new click before the 24 h: they count from its own first send', async () => {
  const { keeper, timers, clock } = keeperOf();
  await keeper.click('v1', 'Valve');
  await runAll(timers, clock);
  clock.now += 60 * 60_000;
  await keeper.click('v1', 'Valve');
  assert.equal(keeper.entries.get('v1').firstSent, clock.now);
});

test('openings: refused 20 s after a click, the click count moves', async () => {
  const { keeper, clock } = keeperOf();
  assert.equal(keeper.justClicked('v1'), false);
  assert.equal(keeper.clickCount('v1'), 0);
  await keeper.click('v1', 'Valve');
  assert.equal(keeper.clickCount('v1'), 1);
  clock.now += 19_999;
  assert.equal(keeper.justClicked('v1'), true);
  clock.now += 1;
  assert.equal(keeper.justClicked('v1'), false);
});

test('stop: no timer and no send after it, even for a send in flight', async () => {
  const { keeper, flo, timers } = keeperOf();
  let release;
  keeper.send = () => new Promise((resolve) => (release = resolve));
  const sending = keeper.click('v1', 'Valve');
  keeper.stop();
  release();
  await sending;
  assert.equal(timers.timeouts().length, 0);
  assert.equal(flo.sends.length, 0);
});

test('restore: the shutoffs of /data, never twice, sent by fireAll', async () => {
  const { keeper, flo } = keeperOf();
  await keeper.click('v1', 'Clicked');
  keeper.restore([
    { id: 'v1', name: 'Old', at: 5 },
    { id: 'v2', name: '', at: 6 },
  ]);
  assert.deepEqual(
    [...keeper.entries.values()].map((e) => [e.id, e.name]),
    [
      ['v1', 'Clicked'],
      ['v2', 'v2'],
    ],
  );
  keeper.fireAll();
  await keeper.entries.get('v2').inFlight;
  assert.deepEqual(
    flo.sends.map((s) => s.id),
    ['v1', 'v2'],
  );
});

test('the file of /data: repaired, bounded, unreadable never taken for empty', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'gladys-flo-shutoffs-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  assert.deepEqual(await loadShutoffs(dir), { ok: true, list: [] });
  const list = Array.from({ length: 20 }, (_, i) => ({ id: `v${i}`, name: `V${i}`, at: i + 1 }));
  await saveShutoffs(dir, list);
  const back = await loadShutoffs(dir);
  assert.equal(back.ok, true);
  assert.equal(back.list.length, MAX_SHUTOFFS);
  const raw = JSON.parse(await readFile(join(dir, 'flo-shutoffs.json'), 'utf8'));
  assert.equal(raw.version, 1);
  assert.deepEqual(
    normalizeShutoffs({
      version: 1,
      shutoffs: [
        { id: 'a', name: 'A\u0000\nB', at: 3, extra: 1 },
        { id: 'a', name: 'twice' },
        { id: '../x', name: 'bad id' },
        { id: 7 },
        null,
        { id: 'b', at: -1 },
      ],
    }),
    [
      { id: 'a', name: 'A  B', at: 3 },
      { id: 'b', name: '', at: 0 },
    ],
  );
  assert.deepEqual(normalizeShutoffs({ version: 2, shutoffs: [{ id: 'a' }] }), []);
  await writeFile(join(dir, 'flo-shutoffs.json'), 'not json');
  const garbage = await loadShutoffs(dir);
  assert.equal(garbage.ok, true);
  assert.ok(garbage.error);
  await rm(join(dir, 'flo-shutoffs.json'));
  // A directory in place of the file: unreadable, never taken for empty.
  await mkdir(join(dir, 'flo-shutoffs.json'));
  const unreadable = await loadShutoffs(dir);
  assert.equal(unreadable.ok, false);
});

test('real clock: the resends keep their period and stop once seen closed', async (t) => {
  const clock = {
    get now() {
      return performance.now();
    },
  };
  const timers = { setTimeout, clearTimeout };
  const timings = { ...TIMINGS, check: 40, heldEvery: 80, resends: 2, minGap: 10 };
  const { keeper, flo } = keeperOf({ timings, timers, clock });
  t.after(() => keeper.stop());
  await keeper.click('v1', 'Valve');
  const deadline = performance.now() + 5_000;
  while (flo.sends.length < 5 && performance.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(flo.sends.length >= 5, true, 'five sends within 5 s');
  const gaps = flo.sends.slice(1).map((s, i) => s.at - flo.sends[i].at);
  // Two resends 40 ms apart, then held: 80 ms. Never faster (a storm), wide margins.
  assert.ok(gaps[0] >= 39 && gaps[1] >= 39, `gaps ${gaps}`);
  assert.ok(gaps[2] >= 79 && gaps[3] >= 79, `held gaps ${gaps}`);
  flo.closed = true;
  const sends = flo.sends.length;
  await new Promise((resolve) => setTimeout(resolve, 250));
  assert.ok(flo.sends.length <= sends + 1, 'stops at the next check');
  assert.equal(keeper.entries.size, 0);
});
