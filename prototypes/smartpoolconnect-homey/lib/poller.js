'use strict';

const { ApiError } = require('./api');
const { metricsLooksLive } = require('./mapping');

// Extra pollrondes na een geslaagd schrijfverzoek. Een PATCH is binnen ~10s terug
// te lezen in config; een POST /cmd/* heeft 20-30s nodig omdat het zwembad moet
// synchroniseren. Zie §3.3 en §10.3 van het voorstel.
const REFRESH_DELAYS_S = {
  patch: [3, 6, 10],
  command: [10, 20, 30, 45],
};

const MIN_INTERVAL_S = 15;
const MAX_INTERVAL_S = 300;
const DEFAULT_INTERVAL_S = 30;

// Eén gedeelde poller per pool-UUID. Drie devices (pool/cover/light) die elk apart
// zouden pollen kost drie keer zoveel verzoeken; in plaats daarvan doet dit één
// GET /pool/{pid} per ronde en deelt het resultaat uit aan de abonnees.
class PoolPoller {
  constructor(homey, pid, client) {
    this.homey = homey;
    this.pid = pid;
    this.client = client;
    this.subscribers = new Set();
    this.intervalSeconds = DEFAULT_INTERVAL_S;
    this._timer = null;
    this._extraTimers = [];
    this._metricsEverNonZero = false;
    this._destroyed = false;
  }

  get metricsEverNonZero() {
    return this._metricsEverNonZero;
  }

  subscribe(device) {
    this.subscribers.add(device);
    if (!this._timer && !this._destroyed) this._scheduleNext(0);
  }

  unsubscribe(device) {
    this.subscribers.delete(device);
  }

  isIdle() {
    return this.subscribers.size === 0;
  }

  setClient(client) {
    this.client = client;
  }

  // Forceert een directe pollronde i.p.v. te wachten op de al geplande
  // volgende ronde (tot intervalSeconds later). Gebruikt door setNewCredential()
  // in de drie device.js-bestanden: na een repair op één device zou de storing
  // voor alle abonnees van deze gedeelde poller (dezelfde pid) meteen opgelost
  // moeten zijn, niet pas bij toeval bij de volgende geplande ronde.
  pollNow() {
    this._scheduleNext(0);
  }

  setInterval(seconds) {
    const clamped = Math.max(MIN_INTERVAL_S, Math.min(MAX_INTERVAL_S, Number(seconds) || DEFAULT_INTERVAL_S));
    this.intervalSeconds = clamped;
  }

  // Extra rondes na een schrijfactie. 'patch' voor PATCH /{module} (config), 'command'
  // voor POST /cmd/* (fysieke actie, langzamer zichtbaar).
  refreshAfter(kind) {
    const delays = REFRESH_DELAYS_S[kind];
    if (!delays) return;
    for (const seconds of delays) {
      const timer = this.homey.setTimeout(() => this._poll(), seconds * 1000);
      this._extraTimers.push(timer);
    }
  }

  destroy() {
    this._destroyed = true;
    if (this._timer) this.homey.clearTimeout(this._timer);
    this._timer = null;
    for (const timer of this._extraTimers) this.homey.clearTimeout(timer);
    this._extraTimers = [];
  }

  _scheduleNext(delayMs) {
    if (this._timer) this.homey.clearTimeout(this._timer);
    this._timer = this.homey.setTimeout(() => this._poll(), delayMs);
  }

  async _poll() {
    if (this._destroyed) return;
    try {
      const pool = await this.client.getPool(this.pid);
      if (metricsLooksLive(pool)) this._metricsEverNonZero = true;
      this._notify('onPoolData', pool, { limited: false });
    } catch (err) {
      if (err instanceof ApiError && err.status === 501) {
        // v1-zwembad: GET /pool/{pid} geeft geen moduledata. Val terug op de
        // samenvatting uit de lijst in plaats van het device onbeschikbaar te maken.
        await this._pollListFallback();
      } else {
        this._notify('onPoolError', err);
      }
    } finally {
      if (!this._destroyed) this._scheduleNext(this.intervalSeconds * 1000);
    }
  }

  async _pollListFallback() {
    try {
      const pools = await this.client.listPools();
      const summary = pools.find((p) => p.pid === this.pid) || null;
      this._notify('onPoolData', summary, { limited: true });
    } catch (err) {
      this._notify('onPoolError', err);
    }
  }

  _notify(method, ...args) {
    for (const device of this.subscribers) {
      if (typeof device[method] === 'function') {
        try {
          device[method](...args);
        } catch (err) {
          device.error?.(`${method} failed: ${err.message}`);
        }
      }
    }
  }
}

module.exports = { PoolPoller, MIN_INTERVAL_S, MAX_INTERVAL_S, DEFAULT_INTERVAL_S };
