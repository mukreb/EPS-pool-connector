'use strict';

const Homey = require('homey');
const { SmartPoolConnectClient, ApiError, isAuthFailure } = require('../../lib/api');
const { WriteGuard } = require('../../lib/write-guard');
const { notifyOnce, resetNotified } = require('../../lib/notify');
const mapping = require('../../lib/mapping');

// Hoe lang na de laatste geziene afdekbeweging het waterniveau-alarm onderdrukt
// blijft. De afdekking doet er ~180s over; het niveau kan nog even napulsen na
// het stilvallen, dus ruim marge aanhouden. Zie §2.7 van het voorstel.
const LEVEL_ALARM_SUPPRESSION_MS = 5 * 60 * 1000;
const DEFAULT_LEVEL_THRESHOLD_CM = 2.0;

class PoolDevice extends Homey.Device {
  // Op één schrijfbare capability na (target_temperature — de streeftemperatuur
  // wordt wél vaak genoeg aangepast om een tegel/flow-actie te verdienen) is dit
  // een alleen-lezen device. Controller pauzeren, filtersnelheid, backwash en
  // shockchlorering doet de gebruiker in de SmartPoolConnect-app of -website —
  // acties van een paar keer per jaar horen niet op een Homey-tegel of achter
  // een flow-actie. Afdekking en verlichting zijn de veelgebruikte bedieningen
  // en staan daarom op hun eigen devices (drivers/cover, drivers/light).
  async onInit() {
    this.pid = this.getData().id;
    this._writeGuard = new WriteGuard(this);
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
    this._writeGuard.reset();
    await resetNotified(this);
    await this.setAvailable().catch(this.error);
  }

  _registerCapabilityListeners() {
    this.registerCapabilityListener('target_temperature', (value) => this._writeGuard.run(async () => {
      await this.client.readModifyWrite(this.pid, 'temperature', { target: value });
      this._poller.refreshAfter('patch');
    }));
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
      if (!this.getAvailable()) {
        await this.setAvailable().catch(this.error);
        await resetNotified(this);
      }
    } catch (err) {
      this.error(`Failed to apply pool data: ${err.message}`);
    }
  }

  // v1-zwembad: GET /pool/{pid} gaf 501, dit komt uit de samenvatting van GET /pool.
  // Geen van de modules waar de capabilities hieronder uit gelezen worden is
  // bereikbaar zonder die detail-endpoint, dus alles verwijderen in plaats van
  // de laatst bekende (of default) set te laten staan met permanent kapotte
  // besturing erin. `limited` (i.p.v. gewoon `lastSpec` op null laten staan) is
  // hoe de cover/light pairing-flows dit onderscheiden van "nog niet gepolld,
  // spec komt nog": een v1-zwembad krijgt namelijk nooit een spec, dus zonder
  // deze vlag zou het voor altijd als "wacht nog even" aangeboden blijven
  // worden in plaats van uitgesloten.
  async _applyLimitedState(summary) {
    await this.setStoreValue('limited', true).catch(this.error);
    await this._syncCapabilities([]);
    this.log(`Limited (v1) status for ${this.pid}: ${summary.status || 'unknown'}`);
  }

  async _applyFullState(pool) {
    await this.setStoreValue('limited', false).catch(this.error);
    const spec = pool.spec || {};
    await this.setStoreValue('lastSpec', spec).catch(this.error);
    await this._syncCapabilities(mapping.poolCapabilities(spec));

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
    if (this.hasCapability('measure_water_level_delta')) {
      await this._setIfNumber('measure_water_level_delta', pool?.level?.metrics?.delta);
    }
    if (this.hasCapability('target_temperature')) {
      await this._setIfNumber('target_temperature', pool?.temperature?.config?.target);
    }
    await this._setIfNumber('measure_current', pool?.filter?.metrics?.pump_current);

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

  // Brengt de daadwerkelijke capabilities van dit device in lijn met `desired`
  // (uit spec via §2.6, of een lege lijst voor een v1-zwembad zonder detail-
  // endpoint). Reconcileert niet alleen de huidige beheerde set, maar ook
  // alles wat het device toevallig al heeft — anders blijft een capability die
  // in een oudere appversie wél bestond (bijv. de inmiddels verwijderde
  // onoff.pause, onoff.shock, button.backwash) voor altijd op bestaande devices
  // staan, want die naam komt dan nergens meer in de "bekende" lijst voor om als
  // "weg te halen" te herkennen. Draait bij elke poll zodat een spec-wijziging
  // (nieuwe hardware) vanzelf wordt opgepikt.
  async _syncCapabilities(desired) {
    const wanted = new Set(desired);
    const candidates = new Set([...mapping.POOL_MANAGED_CAPABILITIES, ...this.getCapabilities()]);
    for (const capability of candidates) {
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
    if (isAuthFailure(err)) {
      await this.setUnavailable(this.homey.__('errors.unauthorized')).catch(this.error);
      await notifyOnce(this, `${this.getName()}: ${this.homey.__('notifications.credential_invalid')}`);
      return;
    }
    if (err instanceof ApiError && err.status === 403) {
      // 403 op de GET zelf betekent dat zelfs pools:read/controls:read/history:read
      // ontbreekt - dan is er niets te tonen, in tegenstelling tot een 403 op de
      // target_temperature-write (die alleen controls:write mist en de lezende
      // kant met rust laat, afgehandeld door WriteGuard in lib/write-guard.js).
      await this.setUnavailable(this.homey.__('errors.missing_read_scope')).catch(this.error);
      await notifyOnce(this, `${this.getName()}: ${this.homey.__('notifications.missing_read_scope')}`);
      return;
    }
    this.error(`Poll failed: ${err.message}`);
  }
}

module.exports = PoolDevice;
