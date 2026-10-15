'use strict';

const Homey = require('homey');
const { PoolPoller } = require('./lib/poller');

const CONNECTION_LOST_KEY = 'connectionLost';

class SmartPoolConnectApp extends Homey.App {
  async onInit() {
    // pool-UUID -> PoolPoller. Eén poll per pool per ronde, gedeeld door de
    // pool-, cover- en light-devices van dezelfde installatie.
    this._pollers = new Map();
    this._connectionLostTrigger = this.homey.flow.getTriggerCard('connection_lost');
    this._connectionRestoredTrigger = this.homey.flow.getTriggerCard('connection_restored');
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

  // Pool-, cover- en light-device van één zwembad vallen samen uit (zelfde
  // credential, zelfde poller); de flow moet dan één keer afgaan, niet drie
  // keer. Bijgehouden in de app-settings zodat een herstart midden in een
  // storing niet opnieuw triggert. Aangeroepen vanuit lib/notify.js.
  async reportConnectionLost(pid, deviceName, reason) {
    const lost = this.homey.settings.get(CONNECTION_LOST_KEY) || {};
    if (lost[pid]) return;
    // Eerst vastleggen, dan triggeren: de drie devices melden vrijwel
    // tegelijk, en pas na de (async) trigger vastleggen zou ze alle drie
    // doorlaten. Mislukt de trigger, dan terugdraaien zodat de volgende
    // mislukte poll het opnieuw probeert.
    lost[pid] = true;
    this.homey.settings.set(CONNECTION_LOST_KEY, lost);
    try {
      await this._connectionLostTrigger.trigger({ device: deviceName || '', reason: reason || '' });
    } catch (err) {
      this.error(`connection_lost trigger failed: ${err.message}`);
      this.forgetConnectionState(pid);
    }
  }

  async reportConnectionRestored(pid, deviceName) {
    const lost = this.homey.settings.get(CONNECTION_LOST_KEY) || {};
    if (!lost[pid]) return;
    // Bewust niet terugdraaien als de trigger mislukt: herstel wordt alleen
    // gemeld bij de overgang naar beschikbaar, dus een blijvende vlag zou elke
    // volgende "verbroken"-trigger voor dit zwembad onderdrukken.
    this.forgetConnectionState(pid);
    await this._connectionRestoredTrigger.trigger({ device: deviceName || '' })
      .catch((err) => this.error(`connection_restored trigger failed: ${err.message}`));
  }

  // Zwembad verwijderd tijdens een storing: niet laten hangen, anders triggert
  // een later opnieuw gekoppeld zwembad met dezelfde pid nooit meer.
  forgetConnectionState(pid) {
    const lost = this.homey.settings.get(CONNECTION_LOST_KEY) || {};
    if (!lost[pid]) return;
    delete lost[pid];
    this.homey.settings.set(CONNECTION_LOST_KEY, lost);
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
