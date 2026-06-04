'use strict';

const Homey = require('homey');
const { SmartPoolConnectClient, ApiError, DEFAULT_BASE_URL } = require('../../lib/api');

class PoolDriver extends Homey.Driver {
  async onInit() {
    this.log('PoolDriver init');
  }

  async onPair(session) {
    let credentials = null;
    let pools = [];

    session.setHandler('validate_credentials', async ({ apiKey, baseUrl }) => {
      const key = (apiKey || '').trim();
      if (!key) throw new Error('API key is required');

      const client = new SmartPoolConnectClient({
        apiKey: key,
        baseUrl: (baseUrl || '').trim() || DEFAULT_BASE_URL,
      });

      try {
        pools = await client.listPools();
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          throw new Error('Invalid API key (401)');
        }
        throw new Error(`Could not reach API: ${err.message}`);
      }

      credentials = { apiKey: key, baseUrl: client.baseUrl };
      return { count: pools.length };
    });

    session.setHandler('list_devices', async () => {
      if (!credentials) throw new Error('Credentials not validated');
      return pools.map((pool) => ({
        name: pool.name || `Pool ${pool.pid}`,
        data: { id: pool.pid },
        store: {
          apiKey: credentials.apiKey,
          baseUrl: credentials.baseUrl,
        },
      }));
    });
  }
}

module.exports = PoolDriver;
