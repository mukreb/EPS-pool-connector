'use strict';

const Homey = require('homey');
const { SmartPoolConnectClient, ApiError, DEFAULT_BASE_URL } = require('../../lib/api');
const { poolCapabilities } = require('../../lib/mapping');

class PoolDriver extends Homey.Driver {
  async onInit() {
    this.log('PoolDriver init');
  }

  async onPair(session) {
    let credential = null;
    let baseUrl = DEFAULT_BASE_URL;
    let pools = [];

    session.setHandler('validate_credentials', async ({ credential: cred, baseUrl: url }) => {
      if (!cred || !cred.value || !cred.value.trim()) {
        throw new Error(cred?.type === 'token' ? 'Access token is required' : 'API key is required');
      }

      const client = new SmartPoolConnectClient({
        credential: { type: cred.type, value: cred.value.trim() },
        baseUrl: (url || '').trim() || DEFAULT_BASE_URL,
      });

      try {
        pools = await client.listPools();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          throw new Error('Invalid credential (401)');
        }
        throw new Error(`Could not reach API: ${err.message}`);
      }

      credential = { type: cred.type, value: cred.value.trim() };
      baseUrl = client.baseUrl;
      return { count: pools.length };
    });

    session.setHandler('list_devices', async () => {
      if (!credential) throw new Error('Credentials not validated');
      const client = new SmartPoolConnectClient({ credential, baseUrl });
      return Promise.all(pools.map(async (pool) => {
        // Spec vast alvast ophalen scheelt dat het device even met de volledige
        // capabilitylijst verschijnt totdat de eerste poll die trimt (§2.6), en
        // geeft de cover/light pairing-flows meteen iets om op te filteren.
        let spec = null;
        try {
          const detail = await client.getPool(pool.pid);
          spec = detail?.spec || null;
        } catch (err) {
          // v1-zwembad (501) of tijdelijke fout: gewoon met de volledige set
          // starten, de eerste geslaagde poll corrigeert dit vanzelf.
        }
        return {
          name: pool.name || `Pool ${pool.pid}`,
          data: { id: pool.pid },
          store: { credential, baseUrl, lastSpec: spec },
          capabilities: spec ? poolCapabilities(spec) : undefined,
        };
      }));
    });
  }

  async onRepair(session, device) {
    session.setHandler('repair_credentials', async ({ credential }) => {
      if (!credential || !credential.value || !credential.value.trim()) {
        throw new Error(credential?.type === 'token' ? 'Access token is required' : 'API key is required');
      }
      await device.setNewCredential({ type: credential.type, value: credential.value.trim() });
    });
  }
}

module.exports = PoolDriver;
