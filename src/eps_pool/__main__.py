"""Allow running the CLI as `python -m eps_pool`."""

import sys

from .cli import main

if __name__ == "__main__":
    sys.exit(main())
