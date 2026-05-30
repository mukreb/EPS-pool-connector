"""Configuration loading for the EPS pool connector.

Secrets are read from environment variables (optionally from a local ``.env``
file). Nothing is ever written to disk or committed to git.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

DEFAULT_BASE_URL = "https://api.Smartpoolcontrol.eu/publicapi/"


class ConfigError(RuntimeError):
    """Raised when required configuration is missing or invalid."""


def _load_dotenv(path: Path) -> None:
    """Minimal ``.env`` loader (stdlib only).

    Lines of the form ``KEY=value`` are loaded into ``os.environ`` without
    overriding variables that are already set. Surrounding quotes are stripped
    and ``#`` comments / blank lines are ignored.
    """
    if not path.is_file():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


@dataclass
class Config:
    """Connection settings for a single pool."""

    api_key: str
    serialnumber: str
    base_url: str = DEFAULT_BASE_URL

    @classmethod
    def from_env(cls, dotenv_path: Optional[str] = None) -> "Config":
        """Build a :class:`Config` from environment variables (+ optional ``.env``).

        Reads ``EPS_API_KEY``, ``EPS_SERIAL`` and optional ``EPS_BASE_URL``.
        Raises :class:`ConfigError` with a helpful message when required values
        are missing.
        """
        _load_dotenv(Path(dotenv_path) if dotenv_path else Path.cwd() / ".env")

        api_key = os.environ.get("EPS_API_KEY", "").strip()
        serial = os.environ.get("EPS_SERIAL", "").strip()
        base_url = os.environ.get("EPS_BASE_URL", "").strip() or DEFAULT_BASE_URL

        missing = [
            name
            for name, value in (("EPS_API_KEY", api_key), ("EPS_SERIAL", serial))
            if not value
        ]
        if missing:
            raise ConfigError(
                "Missing required environment variable(s): "
                + ", ".join(missing)
                + ". Set them in your shell or in a local .env file "
                "(see .env.example)."
            )
        return cls(api_key=api_key, serialnumber=serial, base_url=base_url)
