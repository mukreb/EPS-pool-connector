'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { notifyOnce, resetNotified, reportIfStale, STALE_AFTER_MS } = require('../lib/notify');

// getStoreValue is in de Homey Apps SDK synchroon (zie drivers/cover/driver.js
// en drivers/light/driver.js, die het al zonder await aanroepen); deze fake
// spiegelt dat bewust, want een async fake hier gaf eerder een vals-groene
// testsuite terwijl notify.js in het echt crashte op device.getStoreValue(...).catch.
function fakeDevice() {
  const excerpts = [];
  const store = {};
  return {
    excerpts,
    error: () => {},
    getStoreValue: (key) => store[key],
    setStoreValue: async (key, value) => { store[key] = value; },
    homey: {
      notifications: {
        createNotification: async ({ excerpt }) => { excerpts.push(excerpt); },
      },
    },
  };
}

test('notifyOnce: stuurt de eerste keer een notificatie', async () => {
  const device = fakeDevice();
  await notifyOnce(device, 'token verlopen');
  assert.deepEqual(device.excerpts, ['token verlopen']);
});

test('notifyOnce: herhaalde aanroepen sturen geen tweede notificatie', async () => {
  const device = fakeDevice();
  await notifyOnce(device, 'token verlopen');
  await notifyOnce(device, 'token verlopen');
  assert.deepEqual(device.excerpts, ['token verlopen']);
});

test('notifyOnce: twee gelijktijdige aanroepen (schrijfactie + gedeelde poller) sturen samen maar één melding', async () => {
  const device = fakeDevice();
  await Promise.all([
    notifyOnce(device, 'token verlopen'),
    notifyOnce(device, 'token verlopen'),
  ]);
  assert.deepEqual(device.excerpts, ['token verlopen']);
});

test('notifyOnce: de vlag overleeft een nieuwe device-instance (app-herstart)', async () => {
  const device = fakeDevice();
  await notifyOnce(device, 'token verlopen');

  // Simuleert een app-herstart: nieuw device-object, dezelfde onderliggende store.
  const restarted = { ...fakeDevice(), getStoreValue: device.getStoreValue, setStoreValue: device.setStoreValue, excerpts: device.excerpts };
  await notifyOnce(restarted, 'token verlopen');

  assert.deepEqual(device.excerpts, ['token verlopen']);
});

test('resetNotified: laat een volgende uitval weer een notificatie sturen', async () => {
  const device = fakeDevice();
  await notifyOnce(device, 'token verlopen');
  await resetNotified(device);
  await notifyOnce(device, 'token verlopen opnieuw');
  assert.deepEqual(device.excerpts, ['token verlopen', 'token verlopen opnieuw']);
});

test('notifyOnce: een fout bij createNotification wordt gelogd, niet doorgegooid, en de vlag blijft open voor een retry', async () => {
  const device = fakeDevice();
  device.homey.notifications.createNotification = async () => { throw new Error('boom'); };
  const errors = [];
  device.error = (msg) => errors.push(msg);

  await notifyOnce(device, 'token verlopen');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /boom/);

  // De mislukte poging mag de melding niet permanent blokkeren: een volgende
  // poll moet het opnieuw kunnen proberen.
  device.homey.notifications.createNotification = async ({ excerpt }) => { device.excerpts.push(excerpt); };
  await notifyOnce(device, 'token verlopen');
  assert.deepEqual(device.excerpts, ['token verlopen']);
});

function withApp(device) {
  const calls = [];
  device.pid = 'pid-1';
  device.getName = () => 'Zwembad';
  device.homey.app = {
    reportConnectionLost: async (...args) => { calls.push(['lost', ...args]); },
    reportConnectionRestored: async (...args) => { calls.push(['restored', ...args]); },
  };
  return calls;
}

test('notifyOnce: meldt de uitval ook aan de app voor de flow-trigger', async () => {
  const device = fakeDevice();
  const calls = withApp(device);
  await notifyOnce(device, 'token verlopen');
  await notifyOnce(device, 'token verlopen');
  assert.deepEqual(calls, [['lost', 'pid-1', 'Zwembad', 'token verlopen']]);
});

test('resetNotified: meldt herstel alleen als er eerder een uitval gemeld was', async () => {
  const device = fakeDevice();
  const calls = withApp(device);
  await resetNotified(device);
  assert.deepEqual(calls, []);

  await notifyOnce(device, 'token verlopen');
  await resetNotified(device);
  assert.deepEqual(calls.map((c) => c[0]), ['lost', 'restored']);
});

function staleDevice() {
  const device = fakeDevice();
  device.available = true;
  device.unavailableMessage = null;
  device.getName = () => 'Zwembad';
  device.setUnavailable = async (msg) => { device.available = false; device.unavailableMessage = msg; };
  device.homey.__ = (key, tokens) => (tokens ? `${key}:${tokens.error}` : key);
  return device;
}

test('reportIfStale: binnen het tijdvenster blijft een onbekende fout stil', async () => {
  const device = staleDevice();
  const poller = { msSinceLastSuccess: () => STALE_AFTER_MS - 1 };
  const reported = await reportIfStale(device, poller, new Error('HTTP 502'));
  assert.equal(reported, false);
  assert.equal(device.available, true);
  assert.deepEqual(device.excerpts, []);
});

test('reportIfStale: na het tijdvenster onbeschikbaar en één melding, ook bij herhaalde fouten', async () => {
  const device = staleDevice();
  const poller = { msSinceLastSuccess: () => STALE_AFTER_MS };
  assert.equal(await reportIfStale(device, poller, new Error('HTTP 502')), true);
  assert.equal(await reportIfStale(device, poller, new Error('HTTP 502')), true);
  assert.equal(device.available, false);
  assert.equal(device.unavailableMessage, 'errors.no_data:HTTP 502');
  assert.deepEqual(device.excerpts, ['Zwembad: notifications.no_data']);
});
