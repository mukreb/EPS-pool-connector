# EPS pool integration prototypes

This repository collects small experiments for reading and controlling an EPS
swimming-pool installation. It is a prototype archive, not a finished product.

The pool supplier migrated this installation around April 2026 from the old
**SmartPoolControl** platform to **SmartPoolConnect**. The two platforms use
different APIs and authentication methods, so their code is kept separate.

## Repository layout

| Path | Platform | Purpose | Status |
|---|---|---|---|
| [`prototypes/smartpoolconnect-cli/`](prototypes/smartpoolconnect-cli/) | SmartPoolConnect | Minimal Python test for status and deck open/stop/close | Current experiment; status/authentication tested |
| [`prototypes/smartpoolconnect-homey/`](prototypes/smartpoolconnect-homey/) | SmartPoolConnect | Homey app exposing pool sensor data | Read-only prototype |
| [`prototypes/smartpoolcontrol-python/`](prototypes/smartpoolcontrol-python/) | SmartPoolControl | Python CLI and converted legacy documentation | Historical; old platform no longer used |
| [`reference/smartpoolconnect/`](reference/smartpoolconnect/) | SmartPoolConnect | Supplied API reference PDF | Reference material |
| [`docs/homey-app-voorstel.md`](docs/homey-app-voorstel.md) | SmartPoolConnect | Design proposal for a full Homey app (readings + controls) | Proposal, not yet built |

## Start here

For the current platform, read the
[SmartPoolConnect CLI instructions](prototypes/smartpoolconnect-cli/README.md).
The test script accepts a dedicated API key, an OAuth access token, or the
`connect_session` cookie from an active browser login.

Never commit `.env` files, API keys, access tokens or session cookies. The root
`.gitignore` and the prototype-specific ignore files exclude these credentials.

## History

The former Claude branches and the Codex test branch have been merged into the
history of `main`. Their final states remain available as branches, while this
structure brings the useful files together without mixing the two platforms.

## License

MIT - see [`LICENSE`](LICENSE).
