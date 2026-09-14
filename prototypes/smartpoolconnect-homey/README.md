# Smart Pool Connect — Homey app

Read live status from a [SmartPoolConnect](https://www.smartpoolconnect.eu) pool
in [Homey](https://homey.app) and control the deck cover, lighting and filter
pump. Built from [the app proposal](../../docs/homey-app-voorstel.md); see that
document for the reasoning behind every design choice referenced below (§ numbers).

**Status: v0.2.0 — read, control and configuration (fases 1–3).** Fase 4
(translations polish, app-store assets, CI validation) is not done yet.

## What you get

Three devices are created per pool, all sharing one credential and one poller:

**"Pool"** (class `sensor`) — water/ambient temperature, target temperature,
pH, redox, free chlorine (only with a CLM sensor), water level, pump current,
filter running/status/speed, dry-run alarm, fault alarm, water-level-deviation
alarm, controller pause.

Backwash and shock chlorination are deliberately **not** exposed as
capabilities, even though the API supports both (`cmd/backwash`,
`cmd/shock_start`/`shock_stop`). Both have real, physical/chemical
consequences for the pool's water, and putting them one tap away on a Homey
tile — or one misconfigured flow away — invites exactly the kind of accidental
trigger that a maintenance action shouldn't have. Start those from
SmartPoolConnect's own app or website, where they're a deliberate action, not
a side effect.

**"Deck cover"** (class `windowcoverings`) — `windowcoverings_state` for the
usual up/stop/down tile control, plus a `cover_state` capability with the five
real, measured positions (open/closed/opening/closing/stopped) for flows and
display. Control is locked behind a per-device setting, off by default — see
[Safety](#safety) below.

**"Pool lighting"** (class `light`) — on/off. Next/reset-colour buttons appear
only when the installation actually has an RGB light (`spec.lighting_type`);
a single-colour installation doesn't get dead buttons.

Which capabilities exist on a given installation is decided from the `spec`
block the API returns (§2.6), not from whether a field happens to contain a
number — e.g. no ppm-chlorine capability without a CLM sensor, no cover device
without a cover. The pool device re-checks `spec` on every poll, so newly
enabled hardware is picked up automatically.

Flow cards are not hand-written: Homey generates trigger/condition/action
cards automatically from each capability (a boolean like `alarm_dryrun` gets
on/off triggers and a condition for free, a setable enum like `filter_speed`
gets a "set to…" action, etc.). That covers everything in §5 of the proposal
except device online/offline, which is Homey's own generic
device-(un)availability trigger, not something this app defines.

## Where values come from — the short version

- **Measurements** (temperature, pH, water level, pump current): `metrics`.
- **Settings** (lighting on/off, target temperature, filter speed): `config`.
- **Pump state and deck cover position**: `status` — the only source for
  those two, despite being a pool-wide snapshot that can lag by hours. See
  §2.3 of the proposal for why `filter.metrics.pump_speed` is not used here.
- **Dry-run alarm**: `filter.status.pump_speed > 0 && filter.status.pump_status > 0`
  combined with a `NO_FLOW` code (`201` or `-28`) on the pH or Cl channel —
  never on `201` alone, which is normal whenever the pump is idle.

`lib/mapping.js` is the single place all of this lives, with the measurement
that justifies each rule next to it, and `test/mapping.test.js` pins those
rules down against the exact values from the proposal.

## Safety

Moving the deck cover is a physical action (entrapment risk), and the stop
command also goes through the cloud — it is **not** a local emergency stop.
The cover device has a per-device setting **"Allow cover control"**, off by
default; while it's off the cover is read-only and both the tile controls and
any flow actions are rejected with a clear error. No command is ever retried
automatically after a timeout, because it may already have been received.

## Authentication and the repair flow

Both an `spc_...` API key and a temporary OAuth access token are supported —
whichever you have. The pairing flow asks which one you're using. A key is
recommended: it's valid for about a year. A token is not a standard JWT and
carries no readable expiry, so it can stop working at any moment.

When a credential is rejected (HTTP 401), the affected device goes
unavailable with a message pointing at **Repair**, where you paste a new key
or token without losing the device or its flows. Because each of the three
devices keeps its own copy of the credential (see
[Design note](#design-note-why-three-separate-pairing-flows) below), a token
rotation means repairing all three — one more reason to move to a permanent
API key once SmartPoolConnect issues one.

A 403 with `missing_scope` on a write disables further write attempts on that
device (reads keep working); the same status on the read itself means even
`pools:read`/`controls:read`/`history:read` is missing, which takes the whole
device unavailable instead.

## Design note: why three separate pairing flows

The proposal describes pairing once and getting all three devices. In
practice, the Homey Apps SDK does not let one driver's pairing session create
devices that belong to a *different* driver — only the driver whose pairing
screen the user opened can add devices in that session. This app therefore
follows the pattern real multi-device Homey apps use for a hub-plus-accessories
setup: pair the "Pool" device first (full credential entry), then pair
"Deck cover" and "Pool lighting" — their pairing screen simply lists the
pool(s) already added and attaches a device to whichever one you pick, reusing
its stored credential. It's two or three short pairing steps instead of one,
but each step is a single list-and-confirm click.

## Requirements

- A Homey Pro (custom Homey apps run only on Pro; Cloud/Bridge are not
  supported).
- A SmartPoolConnect API key (`spc_...`, from your installer or
  `api-support@smartpoolconnect.eu`) or an access token from a logged-in
  browser session.
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

`homey app run` builds the app and pushes it to a Homey Pro on your network in
development mode; it stays alive as long as the command runs. For permanent
installation use `homey app install` instead — after that the computer can be
turned off.

## Setup in Homey

1. **Devices → + Add device → Smart Pool Connect → Pool.** Choose API key or
   access token, paste it, pick your pool from the list.
2. **+ Add device → Smart Pool Connect → Deck cover** (if your pool has one) —
   pick the pool you just added.
3. **+ Add device → Smart Pool Connect → Pool lighting** (if your pool has
   lighting) — same idea.
4. On the "Deck cover" device's settings, turn on **Allow cover control**
   once you're ready to let Homey move it.

## Settings

- **Pool → Poll interval (seconds)** — how often the shared poller fetches
  `GET /pool/{pid}`, once per interval regardless of how many of the three
  devices are subscribed (§4.3). Default 30 s, ~2 of the 60 requests/minute
  budget. 15–300 s.
- **Deck cover → Allow cover control** — see [Safety](#safety).

## Known open points

- **`spec.wl_hys_*` field names are not confirmed.** The proposal only
  establishes the *prefix*; this app takes the largest absolute value among
  any `spec` key starting with `wl_hys` as the water-level-deviation
  threshold, falling back to 2 cm if none is present. Worth confirming
  against a real `spec` payload (`pool_test.py config spec`) and adjusting
  `PoolDevice#_levelThreshold` if the real field names differ.
- **Per-schedule flow control (§10.4 "Filterschema 1/2/3 in- of uitschakelen")
  is not exposed as separate capabilities.** `filter_speed` covers the
  documented "medium while the cover is open" recipe via read-modify-write
  (which always sends all three schedules back untouched); toggling
  individual schedules by name would need three more capabilities and read
  API confirmation of the exact fields, so it's left for later rather than
  half-built.
- **The `spc_...` API key is still pending** from SmartPoolConnect (§7);
  until then, pair with an access token and expect to use the repair flow
  when it expires.

## Development

```bash
npm test                             # unit tests for lib/api.js and lib/mapping.js
homey app validate --level publish   # full validator (needs the Athom CLI)
homey app run                        # sideload + hot-reload
homey app build                      # build artefact
```

Plain JavaScript, no transpile step. Layout:

```
app.json                      Manifest: capabilities, drivers, settings
app.js                        PoolPoller registry, shared per pool-UUID
lib/api.js                    API client: auth, rate limit, read/write, redaction
lib/poller.js                 One shared poll per pool, with post-write refresh bursts
lib/mapping.js                Codes → capability values, spec → capability list
drivers/pool/                 Pair flow (credentials → pool list), main device
drivers/cover/                Pairs by picking an existing pool device
drivers/light/                Same
drivers/*/repair/*.html       Paste a new key or token after a 401
locales/en.json, locales/nl.json
test/                         node --test unit tests (not bundled into the app)
```

[`prototypes/smartpoolconnect-cli/`](../smartpoolconnect-cli/) remains useful
alongside this app: it's the fastest way to check a raw API response or
confirm a `spec` field without touching Homey (§10.7).

## License

MIT — see [LICENSE](LICENSE).

This project is not affiliated with SmartPoolConnect B.V. SmartPoolConnect is
a trademark of its respective owner.
