'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { notifyOnce, resetNotified } = require('../lib/notify');

function fakeDevice() {
  const excerpts = [];
  return {
    excerpts,
    error: () => {},
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

test('resetNotified: laat een volgende uitval weer een notificatie sturen', async () => {
  const device = fakeDevice();
  await notifyOnce(device, 'token verlopen');
  resetNotified(device);
  await notifyOnce(device, 'token verlopen opnieuw');
  assert.deepEqual(device.excerpts, ['token verlopen', 'token verlopen opnieuw']);
});

test('notifyOnce: een fout bij createNotification wordt gelogd, niet doorgegooid', async () => {
  const device = fakeDevice();
  device.homey.notifications.createNotification = async () => { throw new Error('boom'); };
  const errors = [];
  device.error = (msg) => errors.push(msg);

  await notifyOnce(device, 'token verlopen');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /boom/);
});
