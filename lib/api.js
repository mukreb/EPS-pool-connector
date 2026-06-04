'use strict';

const DEFAULT_BASE_URL = 'https://api.smartpoolconnect.eu';

class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

class SmartPoolConnectClient {
  constructor({ apiKey, baseUrl } = {}) {
    if (!apiKey) throw new Error('apiKey is required');
    this.apiKey = apiKey;
    this.baseUrl = (baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.rateLimitReset = 0;
  }

  async _request(path, { method = 'GET' } = {}) {
    const now = Date.now();
    if (this.rateLimitReset > now) {
      const waitMs = this.rateLimitReset - now;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }

    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'X-API-Key': this.apiKey,
        Accept: 'application/json',
      },
    });

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
    let body = text;
    if (text && res.headers.get('content-type')?.includes('application/json')) {
      try { body = JSON.parse(text); } catch (_) { /* keep as text */ }
    }

    if (!res.ok) {
      throw new ApiError(`HTTP ${res.status} on ${method} ${path}`, res.status, body);
    }
    return body;
  }

  async listPools() {
    const data = await this._request('/pool');
    return data?.items || [];
  }

  async getPool(pid) {
    return this._request(`/pool/${encodeURIComponent(pid)}`);
  }
}

module.exports = { SmartPoolConnectClient, ApiError, DEFAULT_BASE_URL };
