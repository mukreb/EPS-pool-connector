# EPS pool integration prototypes

This repository collects small experiments for reading and controlling an EPS
swimming-pool installation. It is a prototype archive, not a finished product.

The pool supplier migrated this installation around April 2026 from the old
**SmartPoolControl** platform to **SmartPoolConnect**. The two platforms use
different APIs and authentication methods, so their code is kept separate.

## Repository layout

| Path | Platform | Purpose | Status |
|---|---|---|---|
| [`prototypes/smartpoolconnect-cli/`](prototypes/smartpoolconnect-cli/) | SmartPoolConnect | Minimal Python test for status and deck open/stop/close | Diagnostic tool; still useful alongside the Homey app for raw API checks |
| [`prototypes/smartpoolconnect-homey/`](prototypes/smartpoolconnect-homey/) | SmartPoolConnect | Homey app: live pool metrics, deck cover, lighting, target temperature | **In daily use** — sideloaded and running permanently on a Homey Pro |
| [`prototypes/smartpoolcontrol-python/`](prototypes/smartpoolcontrol-python/) | SmartPoolControl | Python CLI and converted legacy documentation | Historical; old platform no longer used |
| [`reference/smartpoolconnect/`](reference/smartpoolconnect/) | SmartPoolConnect | Supplied API reference PDF | Reference material |
| [`docs/homey-app-voorstel.md`](docs/homey-app-voorstel.md) | SmartPoolConnect | Design proposal behind the Homey app (readings + controls) | Fases 1–3 built and deployed; fase 4 (store polish) still open |

## Start here

The [SmartPoolConnect Homey app](prototypes/smartpoolconnect-homey/) is the
actual deliverable: it reads live pool data (temperature, pH, redox, filter,
water level, alarms) and controls the deck cover, lighting and target
temperature from Homey. See its
[README](prototypes/smartpoolconnect-homey/README.md) for setup,
architecture and the deliberate scope decisions (no pause/backwash/shock
chlorination from Homey — those stay in SmartPoolConnect's own app).

The [SmartPoolConnect CLI](prototypes/smartpoolconnect-cli/README.md) is a
lower-level diagnostic script for checking a raw API response or a `spec`
field without going through Homey. It accepts a dedicated API key, an OAuth
access token, or the `connect_session` cookie from an active browser login.

Never commit `.env` files, API keys, access tokens or session cookies. The root
`.gitignore` and the prototype-specific ignore files exclude these credentials.

## History

The former Claude branches and the Codex test branch have been merged into the
history of `main`. Their final states remain available as branches, while this
structure brings the useful files together without mixing the two platforms.

## License

MIT - see [`LICENSE`](LICENSE).
