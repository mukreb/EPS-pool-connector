#!/usr/bin/env python3
"""Kleine SmartPoolConnect-test; alleen Python 3 nodig. Zie POOL-TEST.md."""

import argparse
import base64
import binascii
import getpass
import json
import os
import re
import sys
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path
from functools import partial
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlencode
from urllib.request import HTTPRedirectHandler, Request, build_opener
from uuid import UUID

BASE_URL = "https://api.smartpoolconnect.eu"
COMMANDS = {"open": "cover_open", "close": "cover_close", "stop": "cover_stop"}
MODULES_HINT = "filter, cover, lighting, spec, ph, cl, temperature, level"
MODULE_RE = re.compile(r"^[a-z0-9_]+(?:/[a-z0-9_-]+)?$")
# Welke module je na een commando in de gaten wilt houden.
WATCH_MODULE = {"light": "lighting", "open": "cover", "close": "cover", "stop": "cover"}


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


def token_expiry(token):
    """Lees exp uit de JWT-payload. Puur informatief; de API valideert zelf."""
    try:
        payload = token.split(".")[1]
        decoded = base64.b64decode(payload + "=" * (-len(payload) % 4),
                                   altchars=b"-_", validate=True)
        return datetime.fromtimestamp(int(json.loads(decoded)["exp"]), timezone.utc)
    except (ValueError, KeyError, TypeError, IndexError, OverflowError, OSError,
            binascii.Error):
        return None


def report_expiry(token):
    moment = token_expiry(token)
    if moment is None:
        print("Vervaldatum van het token niet leesbaar (geen standaard JWT).")
        return
    left = moment - datetime.now(timezone.utc)
    if left.total_seconds() <= 0:
        print(f"Let op: token is verlopen op {moment:%Y-%m-%d %H:%M} UTC.")
    else:
        print(f"Token verloopt op {moment:%Y-%m-%d %H:%M} UTC "
              f"(nog {left.days} dag(en), {left.seconds // 3600} uur).")


def module_state(pool, module):
    """Alles van een module behalve metrics.

    Het status-blok is een pool-brede momentopname die alleen bij bepaalde
    gebeurtenissen ververst en uren oud kan zijn; config verandert wel direct na
    een PATCH. Daarom kijken we naar allebei. Metrics blijft buiten beschouwing,
    want daar tikt de timestamp continu door.
    """
    block = dict(((pool or {}).get(module) or {}))
    block.pop("metrics", None)
    return block


def snapshot(api, key, path, module):
    pool = api("GET", path, key, quiet=True)
    before = module_state(pool, module)
    print(f"Voor:  {module} = {json.dumps(before, ensure_ascii=False)}")
    return before


def watch_module(api, key, path, module, before, timeout=420, interval=5):
    """Volg het statusblok van een module en meld elke wijziging.

    Commando's worden pas bij de volgende synchronisatie verwerkt, dus reken op
    tientallen seconden. Bij de afdekking zie je meerdere overgangen: eerst het
    bewegen, pas later de eindstand. Daarom loopt dit door tot de tijd om is;
    onderbreek met Ctrl+C zodra je genoeg gezien hebt.
    """
    print(f"Volgen van {module} (status + config), elke {interval}s tot {timeout}s. "
          f"Ctrl+C om te stoppen.")
    started = time.monotonic()
    current = before
    changes = 0
    try:
        while True:
            remaining = timeout - (time.monotonic() - started)
            if remaining <= 0:
                break
            time.sleep(min(interval, remaining))
            pool = api("GET", path, key, quiet=True)
            now = module_state(pool, module)
            elapsed = round(time.monotonic() - started)
            if now != current:
                changes += 1
                current = now
                print(f"  +{elapsed:>3}s  {json.dumps(now, ensure_ascii=False)}"
                      f"   <-- wijziging {changes}")
            else:
                print(f"  +{elapsed:>3}s  (ongewijzigd)")
    except KeyboardInterrupt:
        print("\nOnderbroken.")
    if changes == 0:
        print("Geen wijziging gezien. Het commando kan alsnog verwerkt worden; "
              "lees later opnieuw status.")
    else:
        print(f"Gestopt na {changes} wijziging(en). Het status-blok ververst alleen "
              f"bij gebeurtenissen, dus een eindstand kan later komen: lees zo nodig "
              f"opnieuw met 'status' of 'raw'.")
    return current


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


def request(method, path, key, *, bearer=False, body=None, quiet=False):
    headers = {"Accept": "application/json"}
    headers.update({"Authorization": "Bearer " + key} if bearer else {"X-API-Key": key})
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(BASE_URL + path, method=method,
                  headers=headers, data=data)
    try:
        with build_opener(NoRedirect()).open(req, timeout=20) as response:
            body = response.read().decode("utf-8")
            if not quiet:
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
    parser.add_argument("action",
                        choices=["list", "status", "raw", "config", "light", *COMMANDS])
    parser.add_argument("arg", nargs="?",
                        help=f"Bij config: welke module ({MODULES_HINT}). "
                             "Bij light: on of off.")
    parser.add_argument("--pid", help="Pool UUID; anders zoeken op SPC_MAC/EPS_SERIAL")
    parser.add_argument("--dry-run", action="store_true", help="Wel uitlezen, geen commando sturen")
    parser.add_argument("--watch", action="store_true",
                        help="Na het commando pollen tot de status verandert")
    parser.add_argument("--watch-timeout", type=int, default=420, metavar="S",
                        help="Hoe lang --watch blijft pollen (standaard 420s; "
                             "een afdekking doet er meerdere minuten over)")
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
    if token:
        report_expiry(token)
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
    if args.action == "raw":
        print(json.dumps(api("GET", path, key), indent=2, ensure_ascii=False))
        return
    if args.action == "config":
        if not args.arg:
            raise RuntimeError("Geef een module mee, bijvoorbeeld: config filter. "
                               f"Bekend: {MODULES_HINT}.")
        if not MODULE_RE.match(args.arg):
            raise RuntimeError("Ongeldige modulenaam; gebruik bijvoorbeeld filter of aux/1.")
        print(json.dumps(api("GET", path + "/" + args.arg, key),
                         indent=2, ensure_ascii=False))
        return
    if args.action == "light":
        state = (args.arg or "").lower()
        if state not in ("on", "off"):
            raise RuntimeError("Gebruik: light on  of  light off.")
        # De documentatie staat voor dit endpoint expliciet een kale aan/uit-body toe;
        # andere modules eisen het volledige configuratie-object.
        body = {"always_active": state == "on"}
        if args.dry_run:
            print(f"DRY RUN: PATCH {BASE_URL}{path}/lighting "
                  f"body {json.dumps(body)} (niets verstuurd)")
            return
        before = snapshot(api, key, path, "lighting") if args.watch else None
        api("PATCH", path + "/lighting", key, body=body)
        print("Verlichting aangepast.")
        if args.watch:
            watch_module(api, key, path, "lighting", before, timeout=args.watch_timeout)
        else:
            print("Lees over ~30s status of config lighting opnieuw; de wijziging "
                  "wordt pas bij de volgende synchronisatie zichtbaar.")
        return
    pool_path = path
    path += "/cmd/" + COMMANDS[args.action]
    if args.dry_run:
        print(f"DRY RUN: POST {BASE_URL}{path} (geen body; niets verstuurd)")
        return
    before = snapshot(api, key, pool_path, "cover") if args.watch else None
    result = api("POST", path, key)
    if isinstance(result, dict) and (result.get("error") or result.get("success") is False):
        raise RuntimeError("API meldt een fout: " + json.dumps(result).replace(key, "[verborgen]"))
    print("Commando geaccepteerd/in wachtrij; dit bewijst nog niet dat de afdekking beweegt.")
    print("Controleer fysiek bij het zwembad. Verwerking volgt bij de volgende synchronisatie.")
    if args.watch:
        watch_module(api, key, pool_path, "cover", before, timeout=args.watch_timeout)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, ValueError) as exc:
        print(f"Fout: {exc}", file=sys.stderr)
        sys.exit(1)
