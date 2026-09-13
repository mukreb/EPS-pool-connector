# EPS NEXUS – PoolBuilder Public API

This documentation describes the **PoolBuilder Public API** for EPS NEXUS based
swimming pools from **Europe Pool Supply (EPS)**. It is the Markdown conversion
of chapter 9 (*API koppeling*) of the *EPS NEXUS Handleiding*.

The API provides developers with a flexible and powerful interface to interact
with pool data within the PoolBuilder / SmartPoolControl system. It supports
listing, retrieving, creating and updating pool-related data across various
endpoints, each tailored to a specific aspect of pool management such as
real-time data, historical data, configuration, status and settings.

- **Base URL:** `https://api.Smartpoolcontrol.eu/publicapi/`
- **Support / API key requests:** [support@epsbv.eu](mailto:support@epsbv.eu)
- **Website:** [www.epsbv.eu](https://www.epsbv.eu)

## Table of contents

| # | Section | File |
|---|---------|------|
| 9.1 | Introduction (overview, API key management, authentication & security) | [01-introduction.md](01-introduction.md) |
| 9.2 | API endpoints overview (URL logic) | [02-api-endpoints-overview.md](02-api-endpoints-overview.md) |
| 9.2.1 | Realtime data | [03-realtime-data.md](03-realtime-data.md) |
| 9.2.2 | Historical data | [04-historical-data.md](04-historical-data.md) |
| 9.3 | Configuration | [05-configuration.md](05-configuration.md) |
| 9.4 | Status | [06-status.md](06-status.md) |
| 9.5 | Settings | [07-settings.md](07-settings.md) |
| 9.6 / 9.7 | Using the API & conclusion | [08-using-the-api.md](08-using-the-api.md) |

## Quick reference

| Resource | List / create endpoint | Single item endpoint |
|----------|------------------------|----------------------|
| Realtime data | `GET /publicapi/realtimedata/` | `GET /publicapi/realtimedata/<pk>/` |
| Historical data | `GET /publicapi/historicaldata/` | `GET /publicapi/historicaldata/<pk>/` |
| Configuration | `GET /publicapi/configuration/` | `GET /publicapi/configuration/<pk>/` |
| Status | `GET /publicapi/status/` | `GET /publicapi/status/<pk>/` |
| Settings | `GET /publicapi/settings/` | `GET /publicapi/settings/<pk>/` |

> **Note on the serial number:** throughout the examples the pool serial number
> is written in MAC-address notation, e.g. `00:14:2D:A8:B1:42`.
