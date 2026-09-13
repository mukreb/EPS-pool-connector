'use strict';

const Homey = require('homey');
const { SmartPoolConnectClient, ApiError } = require('../../lib/api');
const { mapCoverStatus } = require('../../lib/mapping');

// windowcoverings_state kent maar drie waarden (up/idle/down) en bedient de
// gewone rolluik-knoppen; cover_state toont de vijf echte, gemeten standen
// (open/closed/opening/closing/stopped) voor tegel en flows. Zie §2.5 en §4.4.
const TO_WINDOWCOVERINGS_STATE = {
  open: 'up',
  opening: 'up',
  closed: 'down',
  closing: 'down',
  stopped: 'idle',
  unknown: 'idle',
};

const COMMANDS = {
  up: 'cover_open',
  idle: 'cover_stop',
  down: 'cover_close',
};

class CoverDevice extends Homey.Device {
  async onInit() {
    this.pid = this.getData().id;
    this._createClient();
    this._poller = this.homey.app.getPoller(this.pid, this.client);
    this._poller.subscribe(this);

    // Afdekking bewegen is een fysieke handeling (beknellingsrisico) en het
    // stopcommando loopt óók via de cloud, dus geen lokale noodstop. Standaard
    // uit; zolang dat zo is blijft dit device alleen-lezen. Zie §6.
    this.registerCapabilityListener('windowcoverings_state', async (value) => {
      if (!this.getSetting('allow_control')) {
        throw new Error(this.homey.__('errors.control_not_allowed'));
      }
      const command = COMMANDS[value];
      if (!command) throw new Error(`Unknown windowcoverings_state: ${value}`);
      try {
        await this.client.sendCommand(this.pid, command);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          await this.setUnavailable(this.homey.__('errors.unauthorized')).catch(this.error);
        }
        throw err;
      }
      // Geen automatische herhaling bij een timeout: het commando kan al
      // ontvangen zijn. Zie §10.2.
      this._poller.refreshAfter('command');
    });

    this.log(`CoverDevice ${this.pid} initialised`);
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
    const raw = pool?.cover?.status?.status;
    const state = mapCoverStatus(raw);
    await this.setCapabilityValue('cover_state', state).catch(this.error);
    await this.setCapabilityValue('windowcoverings_state', TO_WINDOWCOVERINGS_STATE[state]).catch(this.error);
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

module.exports = CoverDevice;
