'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PoolPoller } = require('../lib/poller');

// Simpele timerqueue i.p.v. echte setTimeout: laat de test zelf bepalen
// wanneer een geplande poll "afgaat", zonder op de klok te hoeven wachten.
function fakeHomey() {
  const timers = new Map();
  let nextId = 1;
  return {
    timers,
    setTimeout: (fn, delay) => {
      const id = nextId++;
      timers.set(id, { fn, delay });
      return id;
    },
    clearTimeout: (id) => { timers.delete(id); },
  };
}

function fakeDevice() {
  return { onPoolData: () => {}, onPoolError: () => {} };
}

test('pollNow(): plant een poll met delay 0, in plaats van te wachten op de geplande ronde', () => {
  const homey = fakeHomey();
  const poller = new PoolPoller(homey, 'pid-1', { getPool: async () => ({}) });

  let scheduledWith = null;
  poller._scheduleNext = (delay) => { scheduledWith = delay; };
  poller.pollNow();

  assert.equal(scheduledWith, 0);
});

test('pollNow(): na een repair (setClient + pollNow) komt de volgende ronde meteen, niet pas na intervalSeconds', async () => {
  const homey = fakeHomey();
  let calls = 0;
  const badClient = { getPool: async () => { calls += 1; throw new Error('unauthorized'); } };
  const poller = new PoolPoller(homey, 'pid-1', badClient);
  poller.subscribe(fakeDevice());

  // De initiële ronde die subscribe() plant (delay 0) afvuren.
  const [firstId, firstTimer] = [...homey.timers.entries()][0];
  homey.timers.delete(firstId);
  await firstTimer.fn();
  assert.equal(calls, 1);

  // Er staat nu een timer met delay = intervalSeconds*1000 (default 30s) te wachten.
  const [, pendingTimer] = [...homey.timers.entries()][0];
  assert.equal(pendingTimer.delay, 30 * 1000);

  // Repair: nieuwe (goede) client, en pollNow() i.p.v. wachten op die 30s.
  const goodClient = { getPool: async () => { calls += 1; return { spec: {} }; } };
  poller.setClient(goodClient);
  poller.pollNow();

  const scheduled = [...homey.timers.values()];
  assert.equal(scheduled.length, 1);
  assert.equal(scheduled[0].delay, 0);

  await scheduled[0].fn();
  assert.equal(calls, 2);
});
