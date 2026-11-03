"""The outside world the app talks to, in one place: the routing service (walks and drives), the places in an area (the map's
tiles, then OpenStreetMap's Overpass servers), OpenStreetMap's details of a place, Nominatim, Google's sign-in keys, the AI
chain, the saved AI answers and PayPal. app.main builds the real ones; tests swap in fakes."""
from __future__ import annotations

from dataclasses import dataclass, field

from . import auth
from .answers import AnswerCache
from .catchment import CatchmentService
from .geocode import Geocoder
from .llm import LLM
from .osm import PlaceSource
from .osmdetails import OsmDetails
from .payments.paypal import PayPalClient


@dataclass
class Services:
    """Everything the endpoints talk to; swapped for fakes in tests."""

    walker: CatchmentService
    llm: LLM
    geocoder: Geocoder
    answers: AnswerCache = field(default_factory=lambda: AnswerCache(None))
    osm: PlaceSource | None = None  # the places inside an area; without it, no area is read
    details: OsmDetails | None = None  # opening hours, website and phone of a place, when OpenStreetMap has them
    google: auth.GoogleKeys = field(default_factory=auth.GoogleKeys)
    paypal: PayPalClient | None = None  # pledges and payouts; without it nobody can pledge

    async def aclose(self) -> None:
        if self.osm is not None:
            await self.osm.aclose()
        if self.details is not None:
            await self.details.aclose()
        if self.paypal is not None:
            await self.paypal.aclose()
        for service in (self.walker, self.geocoder, self.google):
            await service.aclose()
