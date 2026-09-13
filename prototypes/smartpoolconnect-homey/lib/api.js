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

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
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
      throw new ApiError(`HTTP ${res.status} on ${method} ${path}: ${safeBody}`.slice(0, 1000), res.status, responseBody);
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

module.exports = { SmartPoolConnectClient, ApiError, DEFAULT_BASE_URL, redact };
