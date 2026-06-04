'use strict';

const Homey = require('homey');
const { SmartPoolConnectClient, ApiError } = require('../../lib/api');

const COVER_IDLE_CLOSED = 2;
const COVER_MOVING = new Set([3, 4, 5]);

class PoolDevice extends Homey.Device {
  async onInit() {
    const { apiKey, baseUrl } = this.getStore();
    this.client = new SmartPoolConnectClient({ apiKey, baseUrl });
    this.pid = this.getData().id;

    this._scheduleNextPoll(0);
    this.log(`PoolDevice ${this.pid} initialised`);
  }

  async onDeleted() {
    this._clearPoll();
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('base_url')) {
      const { apiKey } = this.getStore();
      this.client = new SmartPoolConnectClient({
        apiKey,
        baseUrl: newSettings.base_url,
      });
      await this.setStoreValue('baseUrl', newSettings.base_url);
    }
    if (changedKeys.includes('poll_interval')) {
      this._scheduleNextPoll(0);
    }
  }

  _clearPoll() {
    if (this._pollTimer) {
      this.homey.clearTimeout(this._pollTimer);
      this._pollTimer = null;
    }
  }

  _scheduleNextPoll(delayMs) {
    this._clearPoll();
    this._pollTimer = this.homey.setTimeout(() => this._poll(), delayMs);
  }

  _intervalMs() {
    const seconds = Number(this.getSetting('poll_interval')) || 30;
    return Math.max(15, Math.min(300, seconds)) * 1000;
  }

  async _poll() {
    try {
      const pool = await this.client.getPool(this.pid);
      await this._applyState(pool);
      if (!this.getAvailable()) await this.setAvailable();
    } catch (err) {
      this._handleError(err);
    } finally {
      this._scheduleNextPoll(this._intervalMs());
    }
  }

  async _applyState(pool) {
    const water = pool?.temperature?.metrics?.water_temp;
    const ambient = pool?.temperature?.metrics?.ambient_temp;
    const ph = pool?.ph?.metrics?.actual;
    const cl = pool?.cl?.metrics?.actual;
    const pumpStatus = pool?.filter?.status?.pump_status;
    const lighting = pool?.lighting?.status?.status;
    const cover = pool?.cover?.status?.status;

    await this._setIfNumber('measure_temperature', water);
    await this._setIfNumber('measure_temperature.ambient', ambient);
    await this._setIfNumber('measure_ph', ph);
    await this._setIfNumber('measure_chlorine', cl);

    if (typeof pumpStatus === 'number') {
      await this.setCapabilityValue('filter_running', pumpStatus > 0).catch(this.error);
    }
    if (typeof lighting === 'number') {
      await this.setCapabilityValue('lighting_on', lighting === 1).catch(this.error);
    }
    await this.setCapabilityValue('cover_state', this._mapCover(cover)).catch(this.error);
  }

  async _setIfNumber(capability, value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    await this.setCapabilityValue(capability, value).catch(this.error);
  }

  _mapCover(raw) {
    if (raw === COVER_IDLE_CLOSED) return 'closed';
    if (typeof raw === 'number' && COVER_MOVING.has(raw)) return 'moving';
    return 'unknown';
  }

  _handleError(err) {
    if (err instanceof ApiError && err.status === 401) {
      this.setUnavailable(this.homey.__('errors.unauthorized') || 'API key invalid (401)').catch(this.error);
      return;
    }
    this.error(`Poll failed: ${err.message}`);
  }
}

module.exports = PoolDevice;
