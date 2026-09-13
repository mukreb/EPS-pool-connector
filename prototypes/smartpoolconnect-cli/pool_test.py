#!/usr/bin/env python3
"""Kleine SmartPoolConnect-test; alleen Python 3 nodig. Zie POOL-TEST.md."""

import argparse
import base64
import binascii
import getpass
import json
import os
import sys
import warnings
from pathlib import Path
from functools import partial
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import UUID

BASE_URL = "https://api.smartpoolconnect.eu"
COMMANDS = {"open": "cover_open", "close": "cover_close", "stop": "cover_stop"}


def hidden_input(prompt):
    # Geen getpass-fallback die credentials zichtbaar zou kunnen laten invoeren.
    with warnings.catch_warnings():
        warnings.simplefilter("error", getpass.GetPassWarning)
        try:
            return getpass.getpass(prompt).strip()
        except (getpass.GetPassWarning, EOFError):
            raise RuntimeError("Verborgen invoer niet beschikbaar. Start dit script in een terminal.") from None


def token_from_cookie(value):
    """Lees alleen de payload; de API valideert het toegangstoken zelf."""
    try:
        value = value.strip().strip("\"'")
        if value.startswith("connect_session="):
            value = value.split("=", 1)[1].split(";", 1)[0]
        payload = unquote(value).split(".", 1)[0]
        decoded = base64.b64decode(payload + "=" * (-len(payload) % 4),
                                   altchars=b"-_", validate=True)
        session = json.loads(decoded)
        token = session["tokens"]["access_token"]
        if not isinstance(token, str) or not token.strip() or any(c.isspace() for c in token):
            raise ValueError()
        return token
    except (ValueError, KeyError, TypeError, binascii.Error):
        raise RuntimeError("Ongeldige sessiecookie of geen access_token. "
                           "Kopieer de volledige waarde van connect_session uit Chrome.") from None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Stuur de API-key nooit door naar een andere URL.


def settings():
    values = {}
    script_dir = Path(__file__).resolve().parent
    paths = (script_dir / ".env", script_dir.parents[1] / ".env", Path.cwd() / ".env")
    for path in dict.fromkeys(paths):
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.lstrip().startswith("#"):
                key, value = line.split("=", 1)
                values.setdefault(key.strip(), value.strip().strip("\"'"))
    values.update(os.environ)
    return values


def request(method, path, key, *, bearer=False):
    headers = {"Accept": "application/json"}
    headers.update({"Authorization": "Bearer " + key} if bearer else {"X-API-Key": key})
    req = Request(BASE_URL + path, method=method,
                  headers=headers)
    try:
        with build_opener(NoRedirect()).open(req, timeout=20) as response:
            body = response.read().decode("utf-8")
            print(f"HTTP {response.status} — {method} {path}")
    except HTTPError as exc:
        hints = {401: "API-key of toegangstoken ongeldig/verlopen.",
                 403: "Geen toegang of onvoldoende scopes (pools:read / controls:write).",
                 429: "Te veel verzoeken. Wacht voordat je opnieuw probeert."}
        detail = exc.read().decode("utf-8", errors="replace").replace(key, "[verborgen]")
        raise RuntimeError(f"HTTP {exc.code}: {hints.get(exc.code, '')} {detail[:1000]}") from None
    except (URLError, TimeoutError, OSError):
        raise RuntimeError("Verbindingsfout/timeout. Bij een commando is ontvangst onzeker; "
                           "controleer het zwembad voordat je opnieuw probeert.") from None
    if not body.strip():
        return None
    try:
        return json.loads(body)
    except ValueError:
        raise RuntimeError("Onverwacht antwoord (geen JSON). Bij een commando: "
                           "controleer het zwembad; niet automatisch opnieuw sturen.") from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["list", "status", *COMMANDS])
    parser.add_argument("--pid", help="Pool UUID; anders zoeken op SPC_MAC/EPS_SERIAL")
    parser.add_argument("--dry-run", action="store_true", help="Wel uitlezen, geen commando sturen")
    auth = parser.add_mutually_exclusive_group()
    auth.add_argument("--token", action="store_true", help="Vraag een Bearer-token verborgen op (niet opslaan)")
    auth.add_argument("--cookie", action="store_true", help="Plak connect_session verborgen; haal het toegangstoken eruit (niet opslaan)")
    args = parser.parse_args()
    cfg = settings()
    if args.cookie:
        token = token_from_cookie(hidden_input("Plak connect_session (invoer verborgen): "))
    elif args.token:
        token = hidden_input("SmartPoolConnect access token: ")
    else:
        token = cfg.get("SPC_ACCESS_TOKEN", "").strip()
        if not token and cfg.get("SPC_SESSION_COOKIE", "").strip():
            token = token_from_cookie(cfg["SPC_SESSION_COOKIE"])
    key = token or cfg.get("SPC_API_KEY") or cfg.get("EPS_API_KEY", "")
    api = partial(request, bearer=bool(token))
    if not key:
        raise RuntimeError("Gebruik --cookie/--token of zet SPC_SESSION_COOKIE, SPC_ACCESS_TOKEN of SPC_API_KEY in .env.")
    if args.token and not token:
        raise RuntimeError("Geen toegangstoken ingevoerd.")
    if args.action == "list":
        print(json.dumps(api("GET", "/pool", key), indent=2, ensure_ascii=False))
        return
    pid = args.pid or cfg.get("SPC_POOL_ID")
    if not pid:
        mac = cfg.get("SPC_MAC") or cfg.get("EPS_SERIAL")
        if not mac:
            raise RuntimeError("Vul EPS_SERIAL/SPC_MAC in of geef --pid UUID mee. Zie ook: list.")
        result = api("GET", "/pool?" + urlencode({"mac": mac}), key)
        pools = result.get("items") if isinstance(result, dict) else None
        if not isinstance(pools, list) or len(pools) != 1:
            raise RuntimeError("Geen uniek zwembad gevonden voor dit MAC-adres. Controleer list.")
        pid = pools[0].get("pid")
    try:
        pid = str(UUID(str(pid)))
    except ValueError:
        raise RuntimeError("Ongeldig pool UUID in configuratie/API-antwoord.") from None
    path = "/pool/" + quote(pid, safe="")
    if args.action == "status":
        pool = api("GET", path, key)
        if not isinstance(pool, dict):
            raise RuntimeError("Onverwacht zwembadantwoord; verwacht een JSON-object.")
        print(json.dumps({k: pool[k] for k in
                         ("pid", "name", "version", "status", "activity_at", "cover")
                         if k in pool}, indent=2, ensure_ascii=False))
        return
    path += "/cmd/" + COMMANDS[args.action]
    if args.dry_run:
        print(f"DRY RUN: POST {BASE_URL}{path} (geen body; niets verstuurd)")
        return
    result = api("POST", path, key)
    if isinstance(result, dict) and (result.get("error") or result.get("success") is False):
        raise RuntimeError("API meldt een fout: " + json.dumps(result).replace(key, "[verborgen]"))
    print("Commando geaccepteerd/in wachtrij; dit bewijst nog niet dat de afdekking beweegt.")
    print("Controleer fysiek bij het zwembad. Verwerking volgt bij de volgende synchronisatie.")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError) as exc:
        print(f"Fout: {exc}", file=sys.stderr)
        sys.exit(1)
