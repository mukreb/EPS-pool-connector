'use strict';

const Homey = require('homey');
const { SmartPoolConnectClient, ApiError } = require('../../lib/api');
const mapping = require('../../lib/mapping');

// Hoe lang na de laatste geziene afdekbeweging het waterniveau-alarm onderdrukt
// blijft. De afdekking doet er ~180s over; het niveau kan nog even napulsen na
// het stilvallen, dus ruim marge aanhouden. Zie §2.7 van het voorstel.
const LEVEL_ALARM_SUPPRESSION_MS = 5 * 60 * 1000;
const DEFAULT_LEVEL_THRESHOLD_CM = 2.0;

class PoolDevice extends Homey.Device {
  async onInit() {
    this.pid = this.getData().id;
    this._writesBlocked = false;
    this._lastCoverMovementAt = 0;

    this._createClient();
    this._poller = this.homey.app.getPoller(this.pid, this.client);
    this._poller.setInterval(this.getSetting('poll_interval'));
    this._poller.subscribe(this);

    this._registerCapabilityListeners();
    this.log(`PoolDevice ${this.pid} initialised`);
  }

  _createClient() {
    const { credential, baseUrl } = this.getStore();
    this.client = new SmartPoolConnectClient({ credential, baseUrl });
  }

  // Aangeroepen vanuit de repair-flow (drivers/pool/driver.js#onRepair).
  async setNewCredential(credential) {
    await this.setStoreValue('credential', credential);
    this._createClient();
    this._poller.setClient(this.client);
    this._writesBlocked = false;
    await this.setAvailable().catch(this.error);
  }

  _registerCapabilityListeners() {
    this.registerCapabilityListener('target_temperature', (value) => this._runWrite(async () => {
      await this.client.readModifyWrite(this.pid, 'temperature', { target: value });
      this._poller.refreshAfter('patch');
    }));

    this.registerCapabilityListener('filter_speed', (value) => this._runWrite(async () => {
      await this.client.readModifyWrite(this.pid, 'filter', { pump_speed: value });
      this._poller.refreshAfter('patch');
    }));

    this.registerCapabilityListener('onoff.pause', (value) => this._runWrite(async () => {
      await this.client.readModifyWrite(this.pid, 'spec', { pause: !!value });
      this._poller.refreshAfter('patch');
    }));

    // Shockchlorering heeft geen leesbare status in de API; de knop stuurt alleen
    // het commando en zet de capability daarna optimistisch, want er is geen
    // andere bron om op terug te vallen.
    this.registerCapabilityListener('onoff.shock', (value) => this._runWrite(async () => {
      await this.client.sendCommand(this.pid, value ? 'shock_start' : 'shock_stop');
      this._poller.refreshAfter('command');
    }));

    this.registerCapabilityListener('button.backwash', () => this._runWrite(async () => {
      await this.client.sendCommand(this.pid, 'backwash');
      this._poller.refreshAfter('command');
    }));
  }

  // Eén foutafhandeling voor alle schrijfacties: 401 zet het device op
  // onbeschikbaar met een verwijzing naar de repair-flow, 403 missing_scope
  // blokkeert verdere schrijfpogingen zonder de lezende kant te raken.
  async _runWrite(fn) {
    if (this._writesBlocked) {
      throw new Error(this.homey.__('errors.missing_scope'));
    }
    try {
      await fn();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        await this.setUnavailable(this.homey.__('errors.unauthorized')).catch(this.error);
      } else if (err instanceof ApiError && err.status === 403) {
        this._writesBlocked = true;
      }
      throw err;
    }
  }

  async onUninit() {
    this._poller.unsubscribe(this);
    this.homey.app.releasePollerIfIdle(this.pid);
  }

  async onDeleted() {
    this._poller.unsubscribe(this);
    this.homey.app.releasePollerIfIdle(this.pid);
  }

  async onSettings({ newSettings, changedKeys }) {
    if (changedKeys.includes('poll_interval')) {
      this._poller.setInterval(newSettings.poll_interval);
    }
  }

  // Aangeroepen door de PoolPoller met het volledige GET /pool/{pid}-antwoord.
  async onPoolData(pool, { limited }) {
    if (!pool) return;
    try {
      if (limited) {
        await this._applyLimitedState(pool);
      } else {
        await this._applyFullState(pool);
      }
      if (!this.getAvailable()) await this.setAvailable().catch(this.error);
    } catch (err) {
      this.error(`Failed to apply pool data: ${err.message}`);
    }
  }

  // v1-zwembad: GET /pool/{pid} gaf 501, dit komt uit de samenvatting van GET /pool.
  async _applyLimitedState(summary) {
    this.log(`Limited (v1) status for ${this.pid}: ${summary.status || 'unknown'}`);
  }

  async _applyFullState(pool) {
    const spec = pool.spec || {};
    await this.setStoreValue('lastSpec', spec).catch(this.error);
    await this._syncCapabilities(spec);

    await this._setIfNumber('measure_temperature', mapping.waterTemp(pool));
    await this._setIfNumber('measure_temperature.ambient', mapping.ambientTemp(pool));
    await this._setIfNumber('measure_ph', pool?.ph?.metrics?.actual);
    await this._setIfNumber('measure_redox', mapping.redox(pool));
    if (this.hasCapability('measure_chlorine')) {
      await this._setIfNumber('measure_chlorine', mapping.chlorinePpm(pool));
    }
    if (this.hasCapability('measure_water_level')) {
      await this._setIfNumber('measure_water_level', pool?.level?.metrics?.value);
    }
    await this._setIfNumber('measure_current', pool?.filter?.metrics?.pump_current);

    if (this.hasCapability('target_temperature')) {
      await this._setIfNumber('target_temperature', pool?.temperature?.config?.target);
    }

    const pumpStatusRaw = pool?.filter?.status?.pump_status;
    const running = mapping.pumpRunning(pool, this._poller.metricsEverNonZero);
    await this._setCapabilitySafe('filter_running', running);
    await this._setCapabilitySafe('filter_status', mapping.mapPumpStatus(pumpStatusRaw));
    await this._setCapabilitySafe('alarm_fault', mapping.isPumpFault(pumpStatusRaw));

    const filterSpeed = pool?.filter?.config?.pump_speed;
    if (mapping.FILTER_SPEED_VALUES.includes(filterSpeed)) {
      await this._setCapabilitySafe('filter_speed', filterSpeed);
    }

    if (this.hasCapability('alarm_dryrun')) {
      await this._setCapabilitySafe('alarm_dryrun', mapping.dryRunRisk(pool, this._poller.metricsEverNonZero));
    }

    const coverStatus = pool?.cover?.status?.status;
    if (coverStatus === 3 || coverStatus === 4) {
      this._lastCoverMovementAt = Date.now();
    }
    if (this.hasCapability('alarm_water_level')) {
      await this._setCapabilitySafe('alarm_water_level', this._waterLevelDeviation(pool, spec));
    }
  }

  // Een zakkend/stijgend niveau tijdens het bewegen van de afdekking is normaal
  // (het niveau verspringt mee met de afdekstand, zie §2.7) en mag geen alarm
  // geven. Onderdruk daarom kort na een geziene afdekbeweging.
  _waterLevelDeviation(pool, spec) {
    const delta = pool?.level?.metrics?.delta;
    if (typeof delta !== 'number') return false;
    if (Date.now() - this._lastCoverMovementAt < LEVEL_ALARM_SUPPRESSION_MS) return false;
    const threshold = this._levelThreshold(spec);
    return Math.abs(delta) > threshold;
  }

  _levelThreshold(spec) {
    const values = Object.keys(spec)
      .filter((key) => key.startsWith('wl_hys'))
      .map((key) => Math.abs(Number(spec[key])))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!values.length) return DEFAULT_LEVEL_THRESHOLD_CM;
    return Math.max(...values);
  }

  // Bouwt de capabilitylijst op uit spec (§2.6), in plaats van aan te nemen dat
  // elk veld gevuld wordt. Draait bij elke poll zodat een spec-wijziging
  // (nieuwe hardware) vanzelf wordt opgepikt.
  async _syncCapabilities(spec) {
    const wanted = new Set(mapping.poolCapabilities(spec));
    const optional = ['target_temperature', 'measure_chlorine', 'measure_water_level',
      'alarm_dryrun', 'alarm_water_level', 'button.backwash'];
    for (const capability of optional) {
      const shouldHave = wanted.has(capability);
      const has = this.hasCapability(capability);
      if (shouldHave && !has) {
        await this.addCapability(capability).catch(this.error);
      } else if (!shouldHave && has) {
        await this.removeCapability(capability).catch(this.error);
      }
    }
  }

  async _setIfNumber(capability, value) {
    if (!this.hasCapability(capability)) return;
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    await this._setCapabilitySafe(capability, value);
  }

  async _setCapabilitySafe(capability, value) {
    if (!this.hasCapability(capability)) return;
    await this.setCapabilityValue(capability, value).catch(this.error);
  }

  // Aangeroepen door de PoolPoller bij een fout op GET /pool/{pid}.
  async onPoolError(err) {
    if (err instanceof ApiError && err.status === 401) {
      await this.setUnavailable(this.homey.__('errors.unauthorized')).catch(this.error);
      return;
    }
    if (err instanceof ApiError && err.status === 403) {
      // 403 op de GET zelf betekent dat zelfs pools:read/controls:read/history:read
      // ontbreekt - dan is er niets te tonen, in tegenstelling tot een 403 op een
      // schrijfactie (die alleen controls:write mist en de lezende kant met rust
      // laat, afgehandeld in _runWrite()).
      await this.setUnavailable(this.homey.__('errors.missing_read_scope')).catch(this.error);
      return;
    }
    this.error(`Poll failed: ${err.message}`);
  }
}

module.exports = PoolDevice;
