'use strict';

const Homey = require('homey');
const { normalizeCredential } = require('../../lib/api');
const { capabilityPlan } = require('../../lib/mapping');

// Zelfde aanpak als de cover-driver: lijst de al gekoppelde "pool"-devices op en
// maak bij bevestiging het bijbehorende licht-device aan met een eigen kopie van
// het credential. Zie drivers/cover/driver.js voor de uitleg waarom dit niet in
// één pairing-sessie met de pool zelf kan.
class LightDriver extends Homey.Driver {
  async onInit() {
    this.log('LightDriver init');
  }

  async onPair(session) {
    session.setHandler('list_devices', async () => {
      const poolDriver = this.homey.drivers.getDriver('pool');
      const poolDevices = poolDriver.getDevices();
      return poolDevices
        .filter((poolDevice) => {
          const spec = poolDevice.getStoreValue('lastSpec');
          return !spec || capabilityPlan(spec).lightDevice;
        })
        .map((poolDevice) => {
          const spec = poolDevice.getStoreValue('lastSpec') || {};
          const plan = capabilityPlan(spec);
          const capabilities = ['onoff'];
          if (plan.rgbLighting) capabilities.push('button.next_colour', 'button.reset_colour');
          return {
            name: `${poolDevice.getName()} — lighting`,
            data: { id: poolDevice.getData().id },
            store: { ...poolDevice.getStore() },
            capabilities,
          };
        });
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

module.exports = LightDriver;
