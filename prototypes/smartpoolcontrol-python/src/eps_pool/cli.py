"""Command-line interface for the EPS pool connector.

Thin layer over :class:`eps_pool.client.PoolClient`. Subcommands:

    eps get <resource> [--pk N] [--print-url]   # discovery: dump raw JSON
    eps temp [--print-url]                       # water temperature
    eps status [--print-url]                     # deck + lamp status
    eps deck {open,close} [--dry-run] [--yes]    # control the deck/cover
    eps lamp {on,off}   [--dry-run] [--yes]      # control the lamp
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import Any, Optional

from . import client as eps_client
from .client import PoolApiError, PoolClient, RESOURCES
from .config import Config, ConfigError


def _make_client(args: argparse.Namespace) -> PoolClient:
    config = Config.from_env(getattr(args, "env_file", None))
    return PoolClient(config)


def _dump(data: Any) -> None:
    print(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True))


# -- commands ----------------------------------------------------------------

def cmd_get(args: argparse.Namespace) -> int:
    client = _make_client(args)
    if args.print_url:
        print(client.preview_url(args.resource, pk=args.pk))
        return 0
    _dump(client.get_raw(args.resource, pk=args.pk))
    return 0


def cmd_temp(args: argparse.Namespace) -> int:
    client = _make_client(args)
    if args.print_url:
        print(client.preview_url("realtimedata"))
        return 0
    if eps_client.WATER_TEMP_FIELD is None:
        # Step 1: we don't know the field name yet — show the raw data so it can
        # be mapped, and tell the user what to do next.
        _dump(client.get_realtimedata())
        print(
            "\nnote: the water-temperature field is not mapped yet — showing raw "
            "realtimedata above.\nShare this JSON so WATER_TEMP_FIELD can be set "
            "in client.py; after that `eps temp` will print just the value.",
            file=sys.stderr,
        )
        return 0
    print(f"{client.water_temperature()} °C")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    client = _make_client(args)
    if args.print_url:
        print(client.preview_url("status"))
        return 0
    if eps_client.DECK_FIELD is None or eps_client.LAMP_FIELD is None:
        _dump(client.get_status())
        print(
            "\nnote: the deck/lamp fields are not mapped yet — showing raw status "
            "above.\nShare this JSON so DECK_FIELD and LAMP_FIELD can be set in "
            "client.py; after that `eps status`, `eps deck` and `eps lamp` work.",
            file=sys.stderr,
        )
        return 0
    print(f"deck: {client.deck_state()}")
    print(f"lamp: {client.lamp_state()}")
    return 0


def _control(
    args: argparse.Namespace,
    what: str,
    field: Optional[str],
    desired: bool,
    label: str,
) -> int:
    """Shared handler for deck/lamp write commands.

    In step 1 the write format is unknown, so this guides the user to the
    discovery step. Step 2 will call ``client.set_deck`` / ``client.set_lamp``.
    """
    if field is None:
        raise PoolApiError(
            f"The {what} control is not mapped yet. Run `eps get status`, share "
            f"the JSON, so the {what} field and write format can be wired up. "
            f"(Requested: set {what} to '{label}'.)"
        )
    # Step 2 implementation goes here:
    #   client = _make_client(args)
    #   payload = {field: desired}
    #   if args.dry_run: show payload; else confirm + client.set_*(desired)
    raise PoolApiError(f"{what} control is not implemented yet (step 2).")


def cmd_deck(args: argparse.Namespace) -> int:
    desired = args.action == "open"
    return _control(args, "deck", eps_client.DECK_FIELD, desired, args.action)


def cmd_lamp(args: argparse.Namespace) -> int:
    desired = args.action == "on"
    return _control(args, "lamp", eps_client.LAMP_FIELD, desired, args.action)


# -- parser ------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="eps",
        description="Command-line connector for EPS NEXUS based pools.",
    )
    parser.add_argument(
        "--env-file",
        metavar="PATH",
        help="Path to a .env file (default: ./.env).",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_get = sub.add_parser("get", help="GET a raw resource and print its JSON (discovery).")
    p_get.add_argument("resource", choices=RESOURCES)
    p_get.add_argument("--pk", type=int, help="Fetch a single item by primary key.")
    p_get.add_argument("--print-url", action="store_true", help="Print the URL instead of calling it.")
    p_get.set_defaults(func=cmd_get)

    p_temp = sub.add_parser("temp", help="Show the water temperature.")
    p_temp.add_argument("--print-url", action="store_true")
    p_temp.set_defaults(func=cmd_temp)

    p_status = sub.add_parser("status", help="Show deck and lamp status.")
    p_status.add_argument("--print-url", action="store_true")
    p_status.set_defaults(func=cmd_status)

    p_deck = sub.add_parser("deck", help="Open or close the deck/cover.")
    p_deck.add_argument("action", choices=["open", "close"])
    p_deck.add_argument("--dry-run", action="store_true", help="Show the request body without sending it.")
    p_deck.add_argument("-y", "--yes", action="store_true", help="Skip the confirmation prompt.")
    p_deck.set_defaults(func=cmd_deck)

    p_lamp = sub.add_parser("lamp", help="Turn the lamp on or off.")
    p_lamp.add_argument("action", choices=["on", "off"])
    p_lamp.add_argument("--dry-run", action="store_true", help="Show the request body without sending it.")
    p_lamp.add_argument("-y", "--yes", action="store_true", help="Skip the confirmation prompt.")
    p_lamp.set_defaults(func=cmd_lamp)

    return parser


def main(argv: Optional[list] = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        return args.func(args)
    except (ConfigError, PoolApiError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
