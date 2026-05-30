"""HTTP client for the EPS NEXUS PoolBuilder Public API.

This is the reusable core: a thin wrapper around the REST endpoints described in
``docs/``. The CLI (:mod:`eps_pool.cli`) is a thin layer on top, and a future
web / Home Assistant / MQTT layer can reuse this same client.
"""

from __future__ import annotations

import time
from typing import Any, Optional
from urllib.parse import urlencode, urljoin

import requests

from .config import Config

# ---------------------------------------------------------------------------
# Field mapping — to be filled in after the discovery step
# (`eps get realtimedata` / `eps get status`). Keeping these in one place makes
# them trivial to correct once we have seen the real JSON. Until they are set
# the high-level helpers raise a clear, actionable error.
# ---------------------------------------------------------------------------
WATER_TEMP_FIELD: Optional[str] = None   # e.g. "water_temperature"
DECK_FIELD: Optional[str] = None         # e.g. "deck" / "cover"
LAMP_FIELD: Optional[str] = None         # e.g. "light" / "lamp"

# Valid resource names per docs/02-api-endpoints-overview.md.
RESOURCES = (
    "realtimedata",
    "historicaldata",
    "configuration",
    "status",
    "settings",
)


class PoolApiError(RuntimeError):
    """Raised when an API call fails (network, HTTP error, or bad payload)."""


class PoolClient:
    """Client for the PoolBuilder / SmartPoolControl Public API."""

    # The docs state a default rate limit of ~1 request/second; keep a gap.
    _MIN_INTERVAL_S = 1.0

    def __init__(self, config: Config, *, session: Optional[requests.Session] = None):
        self.config = config
        self.session = session or requests.Session()
        self._last_request_ts = 0.0

    # -- URL / request plumbing ------------------------------------------------

    def build_url(self, resource: str, pk: Optional[int] = None) -> str:
        base = self.config.base_url
        if not base.endswith("/"):
            base += "/"
        path = f"{resource}/"
        if pk is not None:
            path += f"{pk}/"
        return urljoin(base, path)

    def _params(self, extra: Optional[dict] = None) -> dict:
        params = {
            "serialnumber": self.config.serialnumber,
            "api_key": self.config.api_key,
        }
        if extra:
            params.update(extra)
        return params

    def preview_url(
        self,
        resource: str,
        pk: Optional[int] = None,
        extra: Optional[dict] = None,
        mask: bool = True,
    ) -> str:
        """Return the full URL (with query params) that would be requested.

        The ``api_key`` is masked by default so it is safe to print/share.
        """
        params = self._params(extra)
        if mask and params.get("api_key"):
            params = {**params, "api_key": "***"}
        return f"{self.build_url(resource, pk)}?{urlencode(params)}"

    def _throttle(self) -> None:
        elapsed = time.monotonic() - self._last_request_ts
        if 0 < elapsed < self._MIN_INTERVAL_S:
            time.sleep(self._MIN_INTERVAL_S - elapsed)

    def _request(
        self,
        method: str,
        resource: str,
        pk: Optional[int] = None,
        params: Optional[dict] = None,
        json_body: Any = None,
    ) -> Any:
        url = self.build_url(resource, pk)
        self._throttle()
        try:
            resp = self.session.request(
                method,
                url,
                params=self._params(params),
                json=json_body,
                timeout=30,
            )
        except requests.RequestException as exc:
            raise PoolApiError(f"Network error calling {method} {url}: {exc}") from exc
        finally:
            self._last_request_ts = time.monotonic()

        if not resp.ok:
            raise PoolApiError(
                f"{method} {url} returned HTTP {resp.status_code}: {resp.text[:500]}"
            )
        if not resp.content:
            return None
        try:
            return resp.json()
        except ValueError as exc:
            raise PoolApiError(
                f"{method} {url} returned a non-JSON response: {resp.text[:500]}"
            ) from exc

    # -- Low-level GET helpers -------------------------------------------------

    def get_raw(self, resource: str, pk: Optional[int] = None) -> Any:
        """GET any resource and return parsed JSON (discovery helper)."""
        if resource not in RESOURCES:
            raise PoolApiError(
                f"Unknown resource '{resource}'. Choose one of: {', '.join(RESOURCES)}."
            )
        return self._request("GET", resource, pk=pk)

    def get_realtimedata(self, pk: Optional[int] = None) -> Any:
        return self._request("GET", "realtimedata", pk=pk)

    def get_status(self, pk: Optional[int] = None) -> Any:
        return self._request("GET", "status", pk=pk)

    def get_configuration(self, pk: Optional[int] = None) -> Any:
        return self._request("GET", "configuration", pk=pk)

    def get_settings(self, pk: Optional[int] = None) -> Any:
        return self._request("GET", "settings", pk=pk)

    # -- Low-level write helper (for deck/lamp; activated in step 2) -----------

    def write(
        self,
        resource: str,
        payload: Any,
        pk: Optional[int] = None,
        method: str = "PUT",
    ) -> Any:
        """Create (POST) or update (PUT) a resource with a JSON body."""
        return self._request(method, resource, pk=pk, json_body=payload)

    # -- High-level helpers (filled in after the discovery step) ---------------

    def water_temperature(self) -> float:
        if WATER_TEMP_FIELD is None:
            raise PoolApiError(_NOT_MAPPED.format(what="water temperature", cmd="realtimedata"))
        raise PoolApiError("water_temperature() is not implemented yet (step 2).")

    def deck_state(self):
        if DECK_FIELD is None:
            raise PoolApiError(_NOT_MAPPED.format(what="deck", cmd="status"))
        raise PoolApiError("deck_state() is not implemented yet (step 2).")

    def set_deck(self, open: bool):
        if DECK_FIELD is None:
            raise PoolApiError(_NOT_MAPPED.format(what="deck", cmd="status"))
        raise PoolApiError("set_deck() is not implemented yet (step 2).")

    def lamp_state(self):
        if LAMP_FIELD is None:
            raise PoolApiError(_NOT_MAPPED.format(what="lamp", cmd="status"))
        raise PoolApiError("lamp_state() is not implemented yet (step 2).")

    def set_lamp(self, on: bool):
        if LAMP_FIELD is None:
            raise PoolApiError(_NOT_MAPPED.format(what="lamp", cmd="status"))
        raise PoolApiError("set_lamp() is not implemented yet (step 2).")


_NOT_MAPPED = (
    "The {what} field is not mapped yet. Run `eps get {cmd}`, share the JSON, "
    "so the field name (and write format) can be wired up in client.py."
)
