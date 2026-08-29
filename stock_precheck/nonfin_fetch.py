#!/usr/bin/env python3
"""CLI entrypoint for the Nonfin Precheck fetcher.

    python nonfin_fetch.py <TICKER> [--refresh] [--only auth,financials,...]

Phase 0 only implements the `auth` module (smoke-test for the Screener
cookie). Later phases add financials / valuation / concalls / news / cyclical
and the assembler that writes ./out/<ticker>_precheck_data.json + _draft.md.
"""

import argparse
import sys

from auth import run_auth

ALL_MODULES = ["auth"]  # extended as later phases land


def main():
    parser = argparse.ArgumentParser(description="Nonfin Precheck data fetcher")
    parser.add_argument("ticker")
    parser.add_argument("--refresh", action="store_true", help="ignore cache, re-fetch from Firecrawl")
    parser.add_argument("--only", default=None, help=f"comma-separated subset of: {','.join(ALL_MODULES)}")
    args = parser.parse_args()

    ticker = args.ticker.upper()
    modules = args.only.split(",") if args.only else ALL_MODULES

    if "auth" in modules:
        result = run_auth(ticker, refresh=args.refresh)
        if not result["passed"]:
            print("\nStopping: fix the Screener cookie before running other modules.", file=sys.stderr)
            sys.exit(1)


if __name__ == "__main__":
    main()
