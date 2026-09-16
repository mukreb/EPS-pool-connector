'use strict';

const DEFAULT_BASE_URL = 'https://api.smartpoolconnect.eu';

// Vervang elke waarde die op het credential lijkt door [hidden], zodat een key of
// token nooit in een Error-message of log terecht kan komen.
function redact(text, secrets) {
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join('[hidden]');
  }
  return out;
}

// De SmartPoolConnect-website zet geen kaal token in een cookie, maar een
// connect_session-cookie die een base64url-blob is met daarin (onder meer)
// tokens.access_token. Een gebruiker die "een token pakken uit de browser"
// probeert, kopieert dus bijna altijd deze hele cookiewaarde — niet het kale
// token, dat er middenin verstopt zit. In plaats van dat verschil aan de
// gebruiker uit te leggen (en ze een los scriptje te laten draaien), probeert
// de pairing-flow dit hier zelf te decoderen; lukt dat niet, dan behandelt hij
// de invoer gewoon als het kale token, zoals eerst. Zie ook
// prototypes/smartpoolconnect-cli/pool_test.py#token_from_cookie, waar dezelfde
// aanpak vandaan komt.
function tokenFromCookie(raw) {
  let value = (raw || '').trim().replace(/^["']/, '').replace(/["']$/, '');
  if (value.startsWith('connect_session=')) {
    value = value.slice('connect_session='.length).split(';')[0];
  }
  const payload = decodeURIComponent(value).split('.')[0];
  const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const decoded = Buffer.from(padded, 'base64').toString('utf8');
  const session = JSON.parse(decoded);
  const token = session?.tokens?.access_token;
  if (typeof token !== 'string' || !token.trim() || /\s/.test(token)) {
    throw new Error('no access_token found in decoded value');
  }
  return token;
}

// Voor het 'token'-credentialtype: accepteer zowel een rauwe connect_session-
// cookiewaarde als een reeds uitgepakt token. Een echt API-key ('spc_...')
// gaat hier nooit doorheen — dat pad wordt alleen voor credential.type ===
// 'token' aangeroepen.
function normalizeTokenInput(raw) {
  try {
    return tokenFromCookie(raw);
  } catch (_) {
    return (raw || '').trim();
  }
}

// Gedeeld door alle drie de drivers (pool/cover/light), zowel bij het pairen
// als bij repair: normaliseer alleen het 'token'-type, een API-key ('spc_...')
// gaat ongemoeid door.
function normalizeCredential(credential) {
  if (!credential || credential.type !== 'token') return credential;
  return { type: 'token', value: normalizeTokenInput(credential.value) };
}

// SmartPoolConnect's gateway antwoordt soms met een kale HTTP 500 waarvan de
// body een Python-exceptiontekst is van een mislukte interne aanroep naar hun
// eigen oauth_api/identity-service met "403 Forbidden" erin — in plaats van
// die afwijzing netjes als 401 door te geven. Dat is inhoudelijk hetzelfde
// probleem als een 401 (credential wordt door hun auth-laag geweigerd), dus
// wordt hier gedetecteerd zodat de rest van de app het ook zo kan behandelen.
// Zie ook de comment bij isAuthFailure() hieronder.
const UPSTREAM_AUTH_FAILURE_RE = /oauth_api/i;

function isUpstreamAuthFailure(status, body) {
  if (status !== 500) return false;
  const text = typeof body === 'string' ? body : JSON.stringify(body || '');
  return UPSTREAM_AUTH_FAILURE_RE.test(text) && /\b403\b/.test(text);
}

class ApiError extends Error {
  constructor(message, status, body, { upstreamAuthFailure = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
    // Zie isUpstreamAuthFailure() hierboven: true wanneer dit een 500 is die in
    // werkelijkheid een afgewezen credential is.
    this.upstreamAuthFailure = upstreamAuthFailure;
  }
}

// Eén plek voor "is dit een afgewezen credential", gebruikt door
// write-guard.js en alle drie de device.js-bestanden — dekt zowel de schone
// 401 als de vermomde 500 hierboven.
function isAuthFailure(err) {
  return err instanceof ApiError && (err.status === 401 || err.upstreamAuthFailure);
}

class SmartPoolConnectClient {
  /**
   * @param {object} opts
   * @param {{type: 'key'|'token', value: string}} opts.credential
   * @param {string} [opts.baseUrl]
   */
  constructor({ credential, baseUrl } = {}) {
    if (!credential || !credential.value) throw new Error('credential is required');
    if (credential.type !== 'key' && credential.type !== 'token') {
      throw new Error(`unknown credential type: ${credential.type}`);
    }
    this.credential = credential;
    this.baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.rateLimitReset = 0;
  }

  // Eén plek die op basis van het credentialtype de juiste header zet. De rest
  // van de client (en de app) hoeft het verschil tussen key en token niet te kennen.
  authHeader() {
    if (this.credential.type === 'token') {
      return { Authorization: `Bearer ${this.credential.value}` };
    }
    return { 'X-API-Key': this.credential.value };
  }

  async _request(path, { method = 'GET', body } = {}) {
    const now = Date.now();
    if (this.rateLimitReset > now) {
      await new Promise((resolve) => setTimeout(resolve, this.rateLimitReset - now));
    }

    const url = `${this.baseUrl}${path}`;
    const headers = {
      Accept: 'application/json',
      ...this.authHeader(),
    };
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(url, { method, headers, body: payload });
    } catch (err) {
      throw new Error(`Network error on ${method} ${path}: ${err.message}`);
    }

    const remaining = res.headers.get('x-ratelimit-remaining');
    const reset = res.headers.get('x-ratelimit-reset');
    if (res.status === 429 && reset) {
      const resetMs = Number(reset) * 1000;
      if (Number.isFinite(resetMs)) this.rateLimitReset = resetMs;
    } else if (remaining !== null && Number(remaining) === 0 && reset) {
      const resetMs = Number(reset) * 1000;
      if (Number.isFinite(resetMs)) this.rateLimitReset = resetMs;
    }

    const text = await res.text();
    let responseBody = text;
    if (text && res.headers.get('content-type')?.includes('application/json')) {
      try { responseBody = JSON.parse(text); } catch (_) { /* keep as text */ }
    }

    if (!res.ok) {
      const safeBody = redact(
        typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody),
        [this.credential.value],
      );
      throw new ApiError(`HTTP ${res.status} on ${method} ${path}: ${safeBody}`.slice(0, 1000), res.status, responseBody, {
        upstreamAuthFailure: isUpstreamAuthFailure(res.status, responseBody),
      });
    }
    return responseBody;
  }

  // GET /pool → items[]
  async listPools() {
    const data = await this._request('/pool');
    return data?.items || [];
  }

  // GET /pool/{pid} → volledige modules ({config, status, metrics} per module + spec)
  async getPool(pid) {
    return this._request(`/pool/${encodeURIComponent(pid)}`);
  }

  // GET /pool/{pid}/{module} → { config, status, metrics }
  async getModule(pid, module) {
    return this._request(`/pool/${encodeURIComponent(pid)}/${module}`);
  }

  // PATCH /pool/{pid}/{module} — de body is het kale config-object, zonder wrapper.
  // Vervangt het hele object; geen partiële merge. Gebruik readModifyWrite() tenzij
  // je zeker weet dat je het complete object al hebt.
  async patchModule(pid, module, config) {
    return this._request(`/pool/${encodeURIComponent(pid)}/${module}`, { method: 'PATCH', body: config });
  }

  // GET het huidige config-object van een module, pas changes toe, en PATCH het
  // complete resultaat terug. Dit is de enige manier waarop de rest van de app
  // configuratie zou moeten schrijven — nooit een gedeeltelijke body sturen.
  async readModifyWrite(pid, module, changes) {
    const current = await this.getModule(pid, module);
    const next = { ...(current?.config || {}), ...changes };
    return this.patchModule(pid, module, next);
  }

  // PATCH /pool/{pid}/lighting met alleen always_active. Dit is bewust een
  // uitzondering op readModifyWrite(): de documentatie staat voor dit endpoint
  // expliciet een kale aan/uit-body toe die de overige lichtvelden (dimming,
  // switch_pulse, cover_disabled, schedule) ongemoeid laat. Het lijkt een bug
  // (een PATCH die niet het complete object stuurt) maar is getest en werkt zo.
  async setLighting(pid, on) {
    return this._request(`/pool/${encodeURIComponent(pid)}/lighting`, {
      method: 'PATCH',
      body: { always_active: !!on },
    });
  }

  // POST /pool/{pid}/cmd/{command} — geen body. HTTP 200 betekent "in de wachtrij
  // gezet", niet "uitgevoerd". Nooit automatisch herhalen bij een timeout: het
  // commando kan al ontvangen zijn.
  async sendCommand(pid, command) {
    return this._request(`/pool/${encodeURIComponent(pid)}/cmd/${command}`, { method: 'POST' });
  }
}

module.exports = {
  SmartPoolConnectClient,
  ApiError,
  DEFAULT_BASE_URL,
  redact,
  tokenFromCookie,
  normalizeTokenInput,
  normalizeCredential,
  isAuthFailure,
  isUpstreamAuthFailure,
};
