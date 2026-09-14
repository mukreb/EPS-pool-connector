'use strict';

const Homey = require('homey');
const { normalizeCredential } = require('../../lib/api');
const { capabilityPlan } = require('../../lib/mapping');

// Er is geen los "kies je zwembad" scherm nodig: Homey staat niet toe dat één
// pairing-sessie devices voor meerdere drivers tegelijk aanmaakt (dat kan alleen
// via de pairing-flow van de driver zelf). In plaats daarvan lijst deze
// pairing-flow de al gekoppelde "pool"-devices op — één per zwembad — en maakt
// bij bevestiging het bijbehorende afdekking-device aan, met een eigen kopie van
// hetzelfde credential.
class CoverDriver extends Homey.Driver {
  async onInit() {
    this.log('CoverDriver init');
  }

  async onPair(session) {
    session.setHandler('list_devices', async () => {
      const poolDriver = this.homey.drivers.getDriver('pool');
      const poolDevices = poolDriver.getDevices();
      return poolDevices
        .filter((poolDevice) => {
          const spec = poolDevice.getStoreValue('lastSpec');
          // Nog geen spec gezien (net gekoppeld, eerste poll onderweg): niet
          // blokkeren, gewoon aanbieden.
          return !spec || capabilityPlan(spec).coverDevice;
        })
        .map((poolDevice) => ({
          name: `${poolDevice.getName()} — cover`,
          data: { id: poolDevice.getData().id },
          store: { ...poolDevice.getStore() },
        }));
    });
  }

  async onRepair(session, device) {
    session.setHandler('repair_credentials', async ({ credential }) => {
      if (!credential || !credential.value || !credential.value.trim()) {
        throw new Error(credential?.type === 'token' ? 'Access token is required' : 'API key is required');
      }
      await device.setNewCredential(normalizeCredential({ type: credential.type, value: credential.value.trim() }));
    });
  }
}

module.exports = CoverDriver;
