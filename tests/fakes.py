"""Stand-ins for the external services the tests do not reach: the routing service and the address search."""
from __future__ import annotations

import math

from app.catchment import circle_catchment

SITE = (40.0, -73.0)


def offset(distance: float, bearing: float) -> tuple[float, float]:
    """The point `distance` metres from SITE on a compass bearing, as (lat, lon)."""
    lat, lon = SITE
    return (lat + distance * math.cos(math.radians(bearing)) / 111_320,
            lon + distance * math.sin(math.radians(bearing)) / (111_320 * math.cos(math.radians(lat))))


class FakeWalker:
    async def walk(self, lat: float, lon: float, minutes: int = 10):
        return circle_catchment(lat, lon, minutes)

    async def area(self, lat: float, lon: float, reach):
        # Walks go through walk(), so a test that overrides it still holds them.
        if reach.travel == "walk":
            return await self.walk(lat, lon, reach.minutes)
        return circle_catchment(lat, lon, reach.minutes, reach)

    async def aclose(self) -> None:
        pass


class StubGeocoder:
    async def search(self, query: str) -> list[dict]:
        return [{"label": f"{query}, Testville", "lat": SITE[0], "lon": SITE[1]}]

    async def reverse(self, lat: float, lon: float, wanted=None) -> dict | None:
        return {"label": "1 Test Street, Testville", "address": "1, Test Street, Testville, Testland"}

    async def aclose(self) -> None:
        pass
