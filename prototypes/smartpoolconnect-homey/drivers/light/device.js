'use strict';

const Homey = require('homey');
const { SmartPoolConnectClient, ApiError, isAuthFailure } = require('../../lib/api');
const { WriteGuard } = require('../../lib/write-guard');
const { notifyOnce, resetNotified } = require('../../lib/notify');
const { lightingOn } = require('../../lib/mapping');

class LightDevice extends Homey.Device {
  async onInit() {
    this.pid = this.getData().id;
    this._writeGuard = new WriteGuard(this);
    this._createClient();
    this._poller = this.homey.app.getPoller(this.pid, this.client);
    this._poller.subscribe(this);

    // Licht aan/uit is géén commando maar een instelling: PATCH /lighting met
    // alleen always_active. lighting_next/lighting_reset wisselen alleen de
    // RGB-kleur en doen niets op een enkelkleurige lamp, dus die twee knoppen
    // bestaan hier alleen als de pairing-flow ze heeft aangemaakt. Zie §3.2.
    this.registerCapabilityListener('onoff', (value) => this._writeGuard.run(async () => {
      await this.client.setLighting(this.pid, value);
      this._poller.refreshAfter('patch');
    }));

    if (this.hasCapability('button.next_colour')) {
      this.registerCapabilityListener('button.next_colour', () => this._writeGuard.run(async () => {
        await this.client.sendCommand(this.pid, 'lighting_next');
        this._poller.refreshAfter('command');
      }));
    }
    if (this.hasCapability('button.reset_colour')) {
      this.registerCapabilityListener('button.reset_colour', () => this._writeGuard.run(async () => {
        await this.client.sendCommand(this.pid, 'lighting_reset');
        this._poller.refreshAfter('command');
      }));
    }

    this.log(`LightDevice ${this.pid} initialised`);
  }

  _createClient() {
    const { credential, baseUrl } = this.getStore();
    this.client = new SmartPoolConnectClient({ credential, baseUrl });
  }

  async setNewCredential(credential) {
    await this.setStoreValue('credential', credential);
    this._createClient();
    this._poller.setClient(this.client);
    this._poller.pollNow();
    this._writeGuard.reset();
    await resetNotified(this);
    await this.setAvailable().catch(this.error);
  }

  async onUninit() {
    this._poller.unsubscribe(this);
    this.homey.app.releasePollerIfIdle(this.pid);
  }

  async onDeleted() {
    this._poller.unsubscribe(this);
    this.homey.app.releasePollerIfIdle(this.pid);
  }

  async onPoolData(pool, { limited }) {
    if (limited || !pool) return;
    await this.setCapabilityValue('onoff', lightingOn(pool)).catch(this.error);
    if (!this.getAvailable()) {
      await this.setAvailable().catch(this.error);
      await resetNotified(this);
    }
  }

  async onPoolError(err) {
    if (isAuthFailure(err)) {
      await this.setUnavailable(this.homey.__('errors.unauthorized')).catch(this.error);
      await notifyOnce(this, `${this.getName()}: ${this.homey.__('notifications.credential_invalid')}`);
      return;
    }
    // 403 op de gedeelde GET /pool/{pid} betekent geen enkele leesscope, niet
    // "ongeldig/verlopen" — zelfde onderscheid als PoolDevice#onPoolError,
    // anders krijgt de gebruiker via de pushmelding een tegenstrijdige diagnose
    // tussen dit device en het pool-device voor exact dezelfde poll-fout.
    if (err instanceof ApiError && err.status === 403) {
      await this.setUnavailable(this.homey.__('errors.missing_read_scope')).catch(this.error);
      await notifyOnce(this, `${this.getName()}: ${this.homey.__('notifications.missing_read_scope')}`);
      return;
    }
    this.error(`Poll failed: ${err.message}`);
  }
}

module.exports = LightDevice;
