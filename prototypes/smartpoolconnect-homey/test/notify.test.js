'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { notifyOnce, resetNotified } = require('../lib/notify');

function fakeDevice() {
  const excerpts = [];
  const store = {};
  return {
    excerpts,
    error: () => {},
    getStoreValue: async (key) => store[key],
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
