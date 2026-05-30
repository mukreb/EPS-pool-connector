# EPS-pool-connector

Connector and documentation for **EPS NEXUS** based **Europe Pool Supply (EPS)**
swimming pools, using the PoolBuilder / SmartPoolControl Public API.

## Documentation

The full API documentation (converted from the *EPS NEXUS Handleiding*,
chapter 9 *API koppeling*) lives in the [`docs/`](docs/) folder:

- [Documentation index](docs/README.md)
- [9.1 Introduction](docs/01-introduction.md)
- [9.2 API endpoints overview](docs/02-api-endpoints-overview.md)
- [9.2.1 Realtime data](docs/03-realtime-data.md)
- [9.2.2 Historical data](docs/04-historical-data.md)
- [9.3 Configuration](docs/05-configuration.md)
- [9.4 Status](docs/06-status.md)
- [9.5 Settings](docs/07-settings.md)
- [9.6 / 9.7 Using the API & conclusion](docs/08-using-the-api.md)

## API at a glance

- **Base URL:** `https://api.Smartpoolcontrol.eu/publicapi/`
- **Authentication:** `api_key` query parameter (request one via
  [support@epsbv.eu](mailto:support@epsbv.eu)) or a logged-in poolbuilder session.
- **Resources:** `realtimedata`, `historicaldata`, `configuration`, `status`,
  `settings`.
