# Smart Pool Connect — Homey app

> Prototype snapshot created before the later command API documentation became
> available. It currently remains read-only; the separate CLI prototype contains
> the newer deck-control experiment.

Read live status from a [SmartPoolConnect](https://www.smartpoolconnect.eu) pool
in [Homey](https://homey.app). Exposes one device per pool with sensors for
water and ambient temperature, pH, chlorine, filter pump, lighting and deck
cover.

**Status: v0.1.0 — read-only.** This app does not yet control lighting or the
deck cover, but that is a gap in this prototype, not in the API. See
[Why no write actions yet?](#why-no-write-actions-yet) below, and
[the Homey app proposal](../../docs/homey-app-voorstel.md) for the planned
design.

## What you get

| Capability | Source |
|---|---|
| Water temperature (°C) | `temperature.metrics.water_temp` |
| Ambient temperature (°C) | `temperature.metrics.ambient_temp` |
| pH | `ph.metrics.actual` |
| Chlorine (mV) | `cl.metrics.actual` |
| Filter pump (on/off) | `filter.status.pump_status > 0` |
| Lighting (on/off) | `lighting.status.status === 1` |
| Deck cover (closed / moving / unknown) | `cover.status.status` |

Polling interval is configurable per device (15–300 s, default 30 s).
At default settings the app makes ~2 requests per minute, well under the
60 req/min rate limit.

## Requirements

- A Homey Pro (custom Homey apps run only on Pro; Cloud/Bridge are not
  supported).
- A SmartPoolConnect API key. Keys are issued by your pool installer or
  by emailing `api-support@smartpoolconnect.eu`. Keys start with `spc_`.
- Node.js ≥ 18 and the Athom CLI on your computer for sideloading.

## Install (sideload)

```bash
git clone https://github.com/mukreb/eps-pool-connector
cd eps-pool-connector/prototypes/smartpoolconnect-homey
npm install
npm install -g homey
homey login
homey app run
```

`homey app run` builds the app and pushes it to a Homey Pro on your network
in development mode. As long as it is running the app is alive on your Homey.
Press `Ctrl+C` to stop. For permanent installation, use `homey app install`.

## Setup in Homey

1. Open the Homey app on your phone → **Devices** → **+ Add device** →
   **Smart Pool Connect** → **Pool**.
2. Paste your `spc_…` API key. Leave the base URL on the default unless
   support tells you otherwise.
3. Pick your pool from the list and confirm.

## Settings (per device)

- **Poll interval (seconds)** — how often the app fetches status. Default
  30 s. Lower means faster updates but more API requests; the API allows
  ~60 requests/minute per key in total.
- **API base URL** — only change if SmartPoolConnect tells you to.

## Why no write actions yet?

**This section is outdated.** It was written before the SmartPoolConnect API
documentation covering commands became available, and claimed that control
actions only existed on `www.smartpoolconnect.eu` behind a web-session cookie.
That is not the case: the official API exposes them on
`api.smartpoolconnect.eu` with `X-API-Key`, namely

- `POST /pool/{pid}/cmd/{command}` — `cover_open`, `cover_stop`, `cover_close`,
  `backwash`, `shock_start`, `shock_stop`, `lighting_next`, `lighting_reset`;
- `PATCH /pool/{pid}/lighting` with `{"always_active": true|false}` for
  lighting on/off (it is a setting, not a command);
- `PATCH /pool/{pid}/spec` with `{"pause": true|false}` to pause the controller;
- `PATCH /pool/{pid}/filter` for pump speed and schedules.

The [`smartpoolconnect-cli`](../smartpoolconnect-cli/) prototype already uses
that route successfully — the deck cover has actually been opened and closed
through `POST /pool/{pid}/cmd/cover_open|cover_close`. What is missing here is
the implementation, not the API.

Note that those successful calls used an OAuth token taken from a browser
session, because no `spc_…` API key has been issued yet. A token works, but it
expires; a Homey app runs unattended and cannot ask for a fresh one. The
proposal therefore supports both credential types plus a repair flow, and an
API key with `pools:read`, `controls:read` and `controls:write` is still worth
requesting via `api-support@smartpoolconnect.eu`.

See [the Homey app proposal](../../docs/homey-app-voorstel.md) for how the
read and control features are planned to fit together.

## Development

```bash
homey app validate --level publish   # full validator
homey app run                        # sideload + hot-reload
homey app build                      # build artefact
```

The project is plain JavaScript, no transpile step. Layout:

```
app.json                    Manifest (capabilities, driver, settings)
app.js                      App entry point
lib/api.js                  Stateless API client
drivers/pool/driver.js      Pair flow
drivers/pool/device.js      Polling + capability mapping
drivers/pool/pair/*.html    Pair UI (credentials → pool list)
```

## License

MIT — see [LICENSE](LICENSE).

This project is not affiliated with SmartPoolConnect B.V. SmartPoolConnect
is a trademark of its respective owner.
