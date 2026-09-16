'use strict';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  SmartPoolConnectClient, ApiError, redact, tokenFromCookie, normalizeTokenInput, normalizeCredential,
  isAuthFailure, isUpstreamAuthFailure,
} = require('../lib/api');

// Bouwt een connect_session-achtige waarde op: base64url(JSON) + '.' + signature,
// zoals de echte cookie van smartpoolconnect.eu. Zie lib/api.js#tokenFromCookie.
function fakeConnectSession(accessToken) {
  const json = JSON.stringify({ tokens: { access_token: accessToken, refresh_token: 'refresh-xyz' }, user: { id: 1 } });
  const b64url = Buffer.from(json).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url}.somesignature`;
}

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name) => headers[name.toLowerCase()] ?? (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    text: async () => JSON.stringify(body),
  };
}

function textResponse(text, { status = 500 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'text/plain' : null) },
    text: async () => text,
  };
}

function mockFetch(handler) {
  const calls = [];
  global.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return handler(url, opts, calls.length);
  };
  return calls;
}

test('authHeader: X-API-Key voor key, Bearer voor token', () => {
  const keyClient = new SmartPoolConnectClient({ credential: { type: 'key', value: 'spc_abc' } });
  assert.deepEqual(keyClient.authHeader(), { 'X-API-Key': 'spc_abc' });

  const tokenClient = new SmartPoolConnectClient({ credential: { type: 'token', value: 'tok123' } });
  assert.deepEqual(tokenClient.authHeader(), { Authorization: 'Bearer tok123' });
});

test('patchModule stuurt het kale config-object, geen wrapper', async () => {
  const calls = mockFetch(() => jsonResponse({ ok: true }));
  const client = new SmartPoolConnectClient({ credential: { type: 'key', value: 'spc_x' } });

  await client.patchModule('pid-1', 'lighting', { always_active: true });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls[0].opts.body), { always_active: true });
  assert.match(calls[0].url, /\/pool\/pid-1\/lighting$/);
});

test('readModifyWrite: GET, samenvoegen, dan PATCH het complete object', async () => {
  const calls = mockFetch((url, opts, n) => {
    if (n === 1) {
      assert.equal(opts.method, 'GET');
      return jsonResponse({
        config: {
          always_active: false,
          pump_speed: 'low',
          schedule_1: { enabled: false },
          schedule_3: { enabled: true, pump_speed: 'high' },
        },
        status: {},
        metrics: {},
      });
    }
    assert.equal(opts.method, 'PATCH');
    return jsonResponse({ ok: true });
  });

  const client = new SmartPoolConnectClient({ credential: { type: 'key', value: 'spc_x' } });
  await client.readModifyWrite('pid-1', 'filter', { pump_speed: 'medium' });

  assert.equal(calls.length, 2);
  const patchBody = JSON.parse(calls[1].opts.body);
  // De wijziging is toegepast...
  assert.equal(patchBody.pump_speed, 'medium');
  // ...maar de andere velden (zoals alle drie de schema's) gaan ongewijzigd mee terug.
  assert.deepEqual(patchBody.schedule_1, { enabled: false });
  assert.deepEqual(patchBody.schedule_3, { enabled: true, pump_speed: 'high' });
});

test('setLighting stuurt bewust alleen always_active, geen volledig object', async () => {
  const calls = mockFetch(() => jsonResponse({ ok: true }));
  const client = new SmartPoolConnectClient({ credential: { type: 'key', value: 'spc_x' } });

  await client.setLighting('pid-1', true);

  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].opts.body), { always_active: true });
});

test('sendCommand: POST zonder body', async () => {
  const calls = mockFetch(() => jsonResponse(null));
  const client = new SmartPoolConnectClient({ credential: { type: 'key', value: 'spc_x' } });

  await client.sendCommand('pid-1', 'cover_open');

  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.body, undefined);
  assert.match(calls[0].url, /\/pool\/pid-1\/cmd\/cover_open$/);
});

test('401 gooit een ApiError met de status erop', async () => {
  mockFetch(() => jsonResponse({ error: 'unauthorized' }, { status: 401 }));
  const client = new SmartPoolConnectClient({ credential: { type: 'key', value: 'spc_x' } });

  await assert.rejects(() => client.getPool('pid-1'), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 401);
    return true;
  });
});

test('500 met een oauth_api/403-afwijzing erin wordt als upstreamAuthFailure herkend', async () => {
  mockFetch(() => textResponse(
    'HTTP status client error (403 Forbidden) for url (http://oauth_api:3000/e/identity)',
    { status: 500 },
  ));
  const client = new SmartPoolConnectClient({ credential: { type: 'key', value: 'spc_x' } });

  await assert.rejects(() => client.setLighting('pid-1', true), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 500);
    assert.equal(err.upstreamAuthFailure, true);
    assert.equal(isAuthFailure(err), true);
    return true;
  });
});

test('een gewone 500 (geen oauth_api/403 erin) is geen upstreamAuthFailure', async () => {
  mockFetch(() => textResponse('Internal Server Error', { status: 500 }));
  const client = new SmartPoolConnectClient({ credential: { type: 'key', value: 'spc_x' } });

  await assert.rejects(() => client.getPool('pid-1'), (err) => {
    assert.equal(err.upstreamAuthFailure, false);
    assert.equal(isAuthFailure(err), false);
    return true;
  });
});

test('isUpstreamAuthFailure: alleen bij status 500 mét zowel oauth_api als 403', () => {
  const body = 'HTTP status client error (403 Forbidden) for url (http://oauth_api:3000/e/identity)';
  assert.equal(isUpstreamAuthFailure(500, body), true);
  assert.equal(isUpstreamAuthFailure(401, body), false);
  assert.equal(isUpstreamAuthFailure(500, 'oauth_api zegt niets over de statuscode'), false);
  assert.equal(isUpstreamAuthFailure(500, '403 Forbidden zonder verdere context'), false);
});

test('isAuthFailure: waar voor 401 en voor de vermomde 500, niet voor 403 of een gewone 500', () => {
  assert.equal(isAuthFailure(new ApiError('x', 401, {})), true);
  assert.equal(isAuthFailure(new ApiError('x', 500, {}, { upstreamAuthFailure: true })), true);
  assert.equal(isAuthFailure(new ApiError('x', 403, {})), false);
  assert.equal(isAuthFailure(new ApiError('x', 500, {})), false);
  assert.equal(isAuthFailure(new Error('not an ApiError')), false);
});

test('het credential lekt nooit in een foutmelding', () => {
  const secret = 'spc_super_secret_key';
  const text = `HTTP 403: {"error":"missing_scope","key":"${secret}"}`;
  assert.equal(redact(text, [secret]).includes(secret), false);
});

test('429 zet rateLimitReset zodat het volgende verzoek wacht', async () => {
  const resetAt = Math.floor((Date.now() + 60000) / 1000);
  mockFetch(() => jsonResponse({ error: 'rate_limited' }, {
    status: 429,
    headers: { 'x-ratelimit-reset': String(resetAt) },
  }));
  const client = new SmartPoolConnectClient({ credential: { type: 'key', value: 'spc_x' } });

  await assert.rejects(() => client.getPool('pid-1'));
  assert.ok(client.rateLimitReset > Date.now());
});

test('tokenFromCookie: pakt access_token uit een rauwe connect_session-waarde', () => {
  const cookieValue = fakeConnectSession('the-real-access-token');
  assert.equal(tokenFromCookie(cookieValue), 'the-real-access-token');
});

test('tokenFromCookie: werkt ook met het "connect_session=...; Path=/" formaat uit DevTools', () => {
  const cookieValue = fakeConnectSession('the-real-access-token');
  const fullCookieLine = `connect_session=${encodeURIComponent(cookieValue)}; Path=/; HttpOnly`;
  assert.equal(tokenFromCookie(fullCookieLine), 'the-real-access-token');
});

test('tokenFromCookie: gooit een fout op een waarde die geen cookie is', () => {
  assert.throws(() => tokenFromCookie('gewoon-een-los-token'));
  assert.throws(() => tokenFromCookie(''));
});

test('normalizeTokenInput: decodeert een cookie, en laat een los token ongemoeid', () => {
  const cookieValue = fakeConnectSession('the-real-access-token');
  assert.equal(normalizeTokenInput(cookieValue), 'the-real-access-token');
  assert.equal(normalizeTokenInput('al-een-kaal-token'), 'al-een-kaal-token');
});

test('normalizeCredential: alleen het token-type wordt genormaliseerd, een key blijft ongemoeid', () => {
  const cookieValue = fakeConnectSession('the-real-access-token');
  assert.deepEqual(
    normalizeCredential({ type: 'token', value: cookieValue }),
    { type: 'token', value: 'the-real-access-token' },
  );
  assert.deepEqual(
    normalizeCredential({ type: 'key', value: 'spc_should_not_change' }),
    { type: 'key', value: 'spc_should_not_change' },
  );
});
