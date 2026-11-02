"""The outside world the app talks to, in one place: the routing service (walks and drives), OpenStreetMap, Nominatim,
Google's sign-in keys, the AI chain, the saved AI answers and PayPal. app.main builds the real ones; tests swap in
fakes."""
from __future__ import annotations

from dataclasses import dataclass, field

from . import auth
from .answers import AnswerCache
from .catchment import CatchmentService
from .geocode import Geocoder
from .llm import LLM
from .osm import OsmClient
from .payments.paypal import PayPalClient


@dataclass
class Services:
    """Everything the endpoints talk to; swapped for fakes in tests."""

    walker: CatchmentService
    llm: LLM
    geocoder: Geocoder
    answers: AnswerCache = field(default_factory=lambda: AnswerCache(None))
    osm: OsmClient | None = None  # OpenStreetMap's places inside an area; without it, no area is read
    google: auth.GoogleKeys = field(default_factory=auth.GoogleKeys)
    paypal: PayPalClient | None = None  # Walk-in Founders' pledges and payouts; without it nobody can pledge

    async def aclose(self) -> None:
        if self.osm is not None:
            await self.osm.aclose()
        if self.paypal is not None:
            await self.paypal.aclose()
        for service in (self.walker, self.geocoder, self.google):
            await service.aclose()
