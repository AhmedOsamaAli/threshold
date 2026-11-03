"""Address search through OpenStreetMap Nominatim, throttled to its 1 request/second policy and cached."""
from __future__ import annotations

import asyncio
import re
import time

import httpx

from . import tls

# Parts of a search match's full line that say little to a reader: administrative areas.
ADMINISTRATIVE = re.compile(r"\b(?:county|township|parish|borough|governorate|prefecture|district|municipality)\b", re.I)


def short_place(full: str | None) -> str:
    """A search match's full line as a few words for a sentence: 'Williamsburg, Brooklyn, Kings County, New York, 11249,
    United States' is 'Williamsburg, Brooklyn'. Without the country, the postcode and the counties, the first two parts."""
    parts = [part.strip() for part in (full or "").split(",") if part.strip()]
    if len(parts) > 2:
        parts = parts[:-1]  # the country
    named = [part for part in parts if not any(char.isdigit() for char in part) and not ADMINISTRATIVE.search(part)]
    return ", ".join((named or parts)[:2])


class Geocoder:
    def __init__(self, http_client: httpx.AsyncClient | None = None) -> None:
        self._cache: dict[str, list[dict]] = {}
        self._lock = asyncio.Lock()
        self._last = 0.0
        self._http = http_client or httpx.AsyncClient(
            base_url="https://nominatim.openstreetmap.org",
            headers={"User-Agent": "Threshold/0.1 (+https://github.com/AhmedOsamaAli/threshold)"},
            timeout=15,
            verify=tls.context(),
        )

    async def _get(self, path: str, params: dict, headers: dict | None = None) -> httpx.Response:
        """One Nominatim request, a second after the last."""
        async with self._lock:
            wait = 1.0 - (time.time() - self._last)
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                return await self._http.get(path, params=params, headers=headers)
            finally:
                self._last = time.time()

    async def search(self, query: str) -> list[dict]:
        key = query.strip().lower()
        if key in self._cache:
            return self._cache[key]
        response = await self._get(
            "/search", {"q": query, "format": "jsonv2", "limit": 5}, headers={"Accept-Language": "en"},
        )
        response.raise_for_status()
        results = [
            {"label": item.get("display_name"), "lat": float(item["lat"]), "lon": float(item["lon"])}
            for item in response.json()
        ]
        self._cache[key] = results
        return results

    async def aclose(self) -> None:
        await self._http.aclose()
