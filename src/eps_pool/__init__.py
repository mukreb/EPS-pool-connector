"""EPS pool connector — talk to EPS NEXUS pools via the PoolBuilder Public API."""

from .config import Config, ConfigError
from .client import PoolClient, PoolApiError

__all__ = ["Config", "ConfigError", "PoolClient", "PoolApiError"]
__version__ = "0.1.0"
