"""Phase 0 — prove the Screener sessionid cookie is valid, via Firecrawl.

Scrapes a login-walled Screener page (the watchlist page redirects to /login/
for an anonymous or expired session). PASS means logged-in content came back;
FAIL means the cookie is missing/expired and needs re-copying from DevTools.
"""

import sys

from common import firecrawl_request, load_cache, save_cache, screener_cookie_header

WATCHLIST_URL = "https://www.screener.in/watchlist/"

LOGIN_WALL_MARKERS = [
    "login to screener",
    "create a free account",
    "id_password",
    "id_username",
    "forgot password",
    "don't have an account",
]


def run_auth(ticker="_auth", refresh=False, url=WATCHLIST_URL):
    module = "auth"
    data = None if refresh else load_cache(ticker, module)
    if data is None:
        data = _fetch(url)
        save_cache(ticker, module, data)

    markdown = ((data.get("data") or {}).get("markdown") or "")
    lower = markdown.lower()
    markers_found = [m for m in LOGIN_WALL_MARKERS if m in lower]
    passed = not markers_found and len(markdown.strip()) > 200

    result = {
        "passed": passed,
        "url": url,
        "markers_found": markers_found,
        "markdown_preview": markdown[:1000],
    }
    _print_result(result)
    return result


def _fetch(url):
    payload = {
        "url": url,
        "formats": ["markdown"],
        "headers": screener_cookie_header(),
        "onlyMainContent": False,
        "waitFor": 2500,
    }
    return firecrawl_request("scrape", payload)


def _print_result(result):
    print("=" * 60)
    print(f"AUTH SMOKE-TEST: {'PASS' if result['passed'] else 'FAIL'}")
    print(f"URL scraped: {result['url']}")
    if result["markers_found"]:
        print(f"Login-wall markers found (cookie likely expired/invalid): {result['markers_found']}")
    print("-" * 60)
    print("Markdown preview (eyeball this against a logged-in browser tab):")
    print(result["markdown_preview"])
    print("=" * 60)


if __name__ == "__main__":
    _ticker = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "_auth"
    run_auth(_ticker, refresh="--refresh" in sys.argv)
