# Smart Pool Connect — Homey app

Read live status from a [SmartPoolConnect](https://www.smartpoolconnect.eu) pool
in [Homey](https://homey.app). Exposes one device per pool with sensors for
water and ambient temperature, pH, chlorine, filter pump, lighting and deck
cover.

**Status: v0.1.0 — read-only.** Controlling lighting and the deck cover is not
yet possible because the corresponding endpoints currently require a
web-session cookie rather than the official API key. See
[Why no write actions yet?](#why-no-write-actions-yet) below.

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
cd eps-pool-connector
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

The official, documented API (`api.smartpoolconnect.eu` with `X-API-Key`)
returns *read* data including lighting status and cover state, but does not
expose endpoints to control lighting or the deck cover. Those actions live
on `www.smartpoolconnect.eu` as
`POST /api/cmd/{pid}/cover_{open,stop,close}` and
`PATCH /pool/{pid}/lighting.data`, and currently authenticate via a
web-session cookie rather than the API key. Using a captured cookie works
but breaks every time the session expires.

This app deliberately uses only the official API key route so it stays
honest and stable. Once SmartPoolConnect ships per-endpoint enforcement for
API keys (their docs mention this is in progress) we will add lighting
and cover control in a follow-up release. If you would like to see this
sooner, drop a note to `api-support@smartpoolconnect.eu`.

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
