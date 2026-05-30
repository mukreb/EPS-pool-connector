# EPS-pool-connector

Connector and documentation for **EPS NEXUS** based **Europe Pool Supply (EPS)**
swimming pools, using the PoolBuilder / SmartPoolControl Public API.

The connector starts as a small command-line tool (`eps`) to **read the water
temperature** and (once the API fields are mapped) **open/close the deck** and
**switch the lamp on/off**. The reusable client library (`src/eps_pool/client.py`)
is kept separate from the CLI so it can later back a web UI, Home Assistant, or
MQTT integration.

## Command-line tool

### Install

```bash
python3 -m pip install -e .          # add ".[dev]" to also get pytest
```

This installs the `eps` command (you can also run `python -m eps_pool`).

### Configure

Credentials are read from environment variables (or a local `.env` file — copy
`.env.example` to `.env`; it is gitignored and never committed):

| Variable | Required | Description |
|----------|----------|-------------|
| `EPS_API_KEY` | yes | API key (request via support@epsbv.eu) |
| `EPS_SERIAL`  | yes | Pool serial number, e.g. `00:14:2D:A8:B1:42` |
| `EPS_BASE_URL`| no  | Override the API base URL (defaults to the public one) |

```bash
export EPS_API_KEY=...   EPS_SERIAL=00:14:2D:A8:B1:42
```

### Usage

```bash
eps temp                       # water temperature
eps status                     # deck + lamp status
eps deck open                  # open the deck (close to retract)
eps lamp on                    # switch the lamp on (off to switch off)

eps get realtimedata           # discovery: dump raw JSON of any resource
eps get status --print-url     # show the URL only (api_key masked), no call
eps deck open --dry-run        # show the request body without sending it
```

> The deck and lamp are physical actuators. Write commands ask for confirmation
> (use `-y/--yes` to skip) and support `--dry-run` to preview the request first.

### Discovery step (one-time)

The API docs do **not** list the JSON field names, so we map them from a live
response. Run the two commands below and share the output; the field names then
get wired into `src/eps_pool/client.py` (`WATER_TEMP_FIELD`, `DECK_FIELD`,
`LAMP_FIELD`), which activates `eps temp`, `eps status`, `eps deck` and
`eps lamp`.

```bash
eps get realtimedata           # → locate the water-temperature field
eps get status                 # → locate the deck + lamp fields
```

### Tests

```bash
python3 -m pytest
```

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
