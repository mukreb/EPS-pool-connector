'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { WriteGuard } = require('../lib/write-guard');
const { ApiError } = require('../lib/api');

function fakeDevice() {
  const calls = [];
  const store = {};
  return {
    calls,
    homey: {
      __: (key) => key,
      notifications: {
        createNotification: async ({ excerpt }) => { calls.push(['notify', excerpt]); },
      },
    },
    error: (err) => calls.push(['error', err]),
    setUnavailable: async (msg) => { calls.push(['setUnavailable', msg]); },
    // getStoreValue is in de Homey Apps SDK synchroon; alleen setStoreValue
    // persisteert async. Zie het commentaar bij fakeDevice in test/notify.test.js.
    getStoreValue: (key) => store[key],
    setStoreValue: async (key, value) => { store[key] = value; },
    getName: () => 'Pool',
  };
}

test('WriteGuard: 403 blokkeert alle volgende schrijfpogingen, zonder de device onbeschikbaar te maken', async () => {
  const device = fakeDevice();
  const guard = new WriteGuard(device);

  await assert.rejects(() => guard.run(async () => {
    throw new ApiError('forbidden', 403, { error: 'missing_scope' });
  }));
  assert.equal(guard.blocked, true);
  assert.deepEqual(device.calls, []);

  // Een volgende poging raakt de API niet eens meer.
  let ran = false;
  await assert.rejects(() => guard.run(async () => { ran = true; }));
  assert.equal(ran, false);
});

test('WriteGuard: 401 zet het device onbeschikbaar maar blokkeert schrijven niet blijvend', async () => {
  const device = fakeDevice();
  const guard = new WriteGuard(device);

  await assert.rejects(() => guard.run(async () => {
    throw new ApiError('unauthorized', 401, { error: 'unauthorized' });
  }));
  assert.equal(guard.blocked, false);
  assert.deepEqual(device.calls, [
    ['setUnavailable', 'errors.unauthorized'],
    ['notify', 'Pool: notifications.credential_invalid'],
  ]);
});

test('WriteGuard: een 500 die intern een oauth_api/403-afwijzing bevat, telt als een afgewezen credential', async () => {
  const device = fakeDevice();
  const guard = new WriteGuard(device);

  await assert.rejects(() => guard.run(async () => {
    throw new ApiError(
      'HTTP 500 on PATCH /pool/x/lighting: HTTP status client error (403 Forbidden) for url (http://oauth_api:3000/e/identity)',
      500,
      'HTTP status client error (403 Forbidden) for url (http://oauth_api:3000/e/identity)',
    );
  }));
  assert.equal(guard.blocked, false);
  assert.deepEqual(device.calls, [
    ['setUnavailable', 'errors.unauthorized'],
    ['notify', 'Pool: notifications.credential_invalid'],
  ]);
});

// Exact het scenario dat in de praktijk optrad op PATCH .../lighting: HTTP 400
// met een gestructureerde auth.credentials_invalid-foutcode, geen 401/403/500.
test('WriteGuard: een 400 met auth.credentials_invalid in de body telt ook als een afgewezen credential', async () => {
  const device = fakeDevice();
  const guard = new WriteGuard(device);

  await assert.rejects(() => guard.run(async () => {
    throw new ApiError(
      'HTTP 400 on PATCH /pool/x/lighting: {"error":"auth.credentials_invalid"}',
      400,
      { error: 'auth.credentials_invalid' },
    );
  }));
  assert.equal(guard.blocked, false);
  assert.deepEqual(device.calls, [
    ['setUnavailable', 'errors.unauthorized'],
    ['notify', 'Pool: notifications.credential_invalid'],
  ]);
});

test('WriteGuard: een gewone 500 zonder herkenbare auth-signatuur blijft een onbehandelde fout', async () => {
  const device = fakeDevice();
  const guard = new WriteGuard(device);

  await assert.rejects(() => guard.run(async () => {
    throw new ApiError('boom', 500, 'Internal Server Error');
  }));
  assert.equal(guard.blocked, false);
  assert.deepEqual(device.calls, []);
});

test('WriteGuard: een tweede 401 op rij stuurt geen tweede notificatie', async () => {
  const device = fakeDevice();
  const guard = new WriteGuard(device);

  await assert.rejects(() => guard.run(async () => {
    throw new ApiError('unauthorized', 401, { error: 'unauthorized' });
  }));
  await assert.rejects(() => guard.run(async () => {
    throw new ApiError('unauthorized', 401, { error: 'unauthorized' });
  }));

  const notifyCalls = device.calls.filter(([type]) => type === 'notify');
  assert.equal(notifyCalls.length, 1);
});

test('WriteGuard: reset() na een geslaagde repair laat schrijven weer toe', async () => {
  const device = fakeDevice();
  const guard = new WriteGuard(device);
  guard.blocked = true;
  guard.reset();

  let ran = false;
  await guard.run(async () => { ran = true; });
  assert.equal(ran, true);
});

test('WriteGuard: geeft de return-waarde van de actie door', async () => {
  const guard = new WriteGuard(fakeDevice());
  const result = await guard.run(async () => 42);
  assert.equal(result, 42);
});
