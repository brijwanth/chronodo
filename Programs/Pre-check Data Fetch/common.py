"""Shared helpers: env/secrets, Firecrawl v2 REST client, on-disk cache."""

import json
import os
from pathlib import Path

import requests
from dotenv import load_dotenv

load_dotenv()

FIRECRAWL_API_KEY = os.environ.get("FIRECRAWL_API_KEY", "")
SCREENER_SESSIONID = os.environ.get("SCREENER_SESSIONID", "")

FIRECRAWL_BASE_URL = "https://api.firecrawl.dev/v2"

BASE_DIR = Path(__file__).resolve().parent
CACHE_DIR = BASE_DIR / "_cache"
OUT_DIR = BASE_DIR / "out"


def screener_cookie_header():
    if not SCREENER_SESSIONID:
        raise RuntimeError("SCREENER_SESSIONID missing — set it in stock_precheck/.env")
    return {"Cookie": f"sessionid={SCREENER_SESSIONID}"}


def cache_path(ticker, module, ext="json"):
    d = CACHE_DIR / ticker
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{module}.{ext}"


def load_cache(ticker, module, ext="json"):
    p = cache_path(ticker, module, ext)
    if not p.exists():
        return None
    if ext == "json":
        return json.loads(p.read_text())
    return p.read_bytes()


def save_cache(ticker, module, data, ext="json"):
    p = cache_path(ticker, module, ext)
    if ext == "json":
        p.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        p.write_bytes(data)
    return p


def firecrawl_request(endpoint, payload, timeout=90):
    if not FIRECRAWL_API_KEY:
        raise RuntimeError("FIRECRAWL_API_KEY missing — set it in stock_precheck/.env")
    url = f"{FIRECRAWL_BASE_URL}/{endpoint.lstrip('/')}"
    headers = {
        "Authorization": f"Bearer {FIRECRAWL_API_KEY}",
        "Content-Type": "application/json",
    }
    resp = requests.post(url, headers=headers, json=payload, timeout=timeout)
    resp.raise_for_status()
    return resp.json()
