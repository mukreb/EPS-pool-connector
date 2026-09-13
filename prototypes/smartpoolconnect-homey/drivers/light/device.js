'use strict';

const Homey = require('homey');
const { SmartPoolConnectClient, ApiError } = require('../../lib/api');
const { lightingOn } = require('../../lib/mapping');

class LightDevice extends Homey.Device {
  async onInit() {
    this.pid = this.getData().id;
    this._createClient();
    this._poller = this.homey.app.getPoller(this.pid, this.client);
    this._poller.subscribe(this);

    // Licht aan/uit is géén commando maar een instelling: PATCH /lighting met
    // alleen always_active. lighting_next/lighting_reset wisselen alleen de
    // RGB-kleur en doen niets op een enkelkleurige lamp, dus die twee knoppen
    // bestaan hier alleen als de pairing-flow ze heeft aangemaakt. Zie §3.2.
    this.registerCapabilityListener('onoff', async (value) => {
      try {
        await this.client.setLighting(this.pid, value);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await this.setUnavailable(this.homey.__('errors.unauthorized')).catch(this.error);
        }
        throw err;
      }
      this._poller.refreshAfter('patch');
    });

    if (this.hasCapability('button.next_colour')) {
      this.registerCapabilityListener('button.next_colour', async () => {
        await this.client.sendCommand(this.pid, 'lighting_next');
        this._poller.refreshAfter('command');
      });
    }
    if (this.hasCapability('button.reset_colour')) {
      this.registerCapabilityListener('button.reset_colour', async () => {
        await this.client.sendCommand(this.pid, 'lighting_reset');
        this._poller.refreshAfter('command');
      });
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
    if (!this.getAvailable()) await this.setAvailable().catch(this.error);
  }

  async onPoolError(err) {
    if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
      await this.setUnavailable(this.homey.__('errors.unauthorized')).catch(this.error);
      return;
    }
    this.error(`Poll failed: ${err.message}`);
  }
}

module.exports = LightDevice;
