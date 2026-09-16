'use strict';

const { ApiError, isAuthFailure } = require('./api');
const { notifyOnce } = require('./notify');

// Eén foutafhandeling voor elke schrijfactie (PATCH/POST) op een device: een
// afgewezen credential (401, of de vermomde 500 die isAuthFailure() ook
// herkent, zie lib/api.js) zet het device op onbeschikbaar met een
// verwijzing naar de repair-flow, 403 missing_scope blokkeert verdere
// schrijfpogingen zonder de lezende kant te raken (zie §6 van het
// voorstel). Gedeeld door pool/cover/light, want alle drie hebben dezelfde
// twee foutmodi op hun schrijfaanroepen.
class WriteGuard {
  constructor(device) {
    this.device = device;
    this.blocked = false;
  }

  async run(fn) {
    if (this.blocked) {
      throw new Error(this.device.homey.__('errors.missing_scope'));
    }
    try {
      return await fn();
    } catch (err) {
      if (isAuthFailure(err)) {
        await this.device.setUnavailable(this.device.homey.__('errors.unauthorized')).catch((e) => this.device.error(e));
        await notifyOnce(this.device, `${this.device.getName()}: ${this.device.homey.__('notifications.credential_invalid')}`);
      } else if (err instanceof ApiError && err.status === 403) {
        this.blocked = true;
      }
      throw err;
    }
  }

  reset() {
    this.blocked = false;
  }
}

module.exports = { WriteGuard };
