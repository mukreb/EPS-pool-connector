'use strict';

const Homey = require('homey');
const { PoolPoller } = require('./lib/poller');

class SmartPoolConnectApp extends Homey.App {
  async onInit() {
    // pool-UUID -> PoolPoller. Eén poll per pool per ronde, gedeeld door de
    // pool-, cover- en light-devices van dezelfde installatie.
    this._pollers = new Map();
    this.log('Smart Pool Connect app initialised');
  }

  // Devices roepen dit aan in onInit()/onUninit(). Wie er als eerste is voor een
  // pid wint: die client blijft gebruikt totdat de laatste abonnee vertrekt.
  getPoller(pid, client) {
    let poller = this._pollers.get(pid);
    if (!poller) {
      poller = new PoolPoller(this.homey, pid, client);
      this._pollers.set(pid, poller);
    }
    return poller;
  }

  releasePollerIfIdle(pid) {
    const poller = this._pollers.get(pid);
    if (poller && poller.isIdle()) {
      poller.destroy();
      this._pollers.delete(pid);
    }
  }
}

module.exports = SmartPoolConnectApp;
