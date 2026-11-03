"""Check a spot: what OpenStreetMap lists inside a 10-minute walk of an address, for one kind of business.

It shows supply, never demand: how many places of the kind are listed nearby, the nearest of them with their distances and
what OpenStreetMap's volunteers wrote down about each (opening hours, website, phone), the parks, and what else is around.
Demand is what the pledges measure. Nothing here is a guess: when the map data or the routing service does not answer, the
answer says so and carries no counts, and a kind of business that no single tag pins down (or that the data read cannot
tell apart) gets no count of its own kind. OpenStreetMap is volunteers' work and thinner in some cities than others, so
every answer says it can be incomplete.

Data © OpenStreetMap contributors, available under the Open Database License (www.openstreetmap.org/copyright)."""
from __future__ import annotations

import asyncio
import logging
import re
import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from . import osm, tiles
from .catchment import Catchment
from .geo import distance_m
from .intent import squash
from .services import Services

WALK_MINUTES = 10
TOTAL_SECONDS = 45.0  # how long a visitor waits; the free public servers are volunteers' and can be slow
SLOW = ("OpenStreetMap's free servers are slow right now. The check goes on in the background: ask again in a minute and "
        "the answer will be waiting.")
LISTED = 30  # the nearest places of the kind an answer names (a busy street has more; the count says how many)
DETAILED = 12  # of those, how many get their details read from OpenStreetMap
DETAILS_SECONDS = 4.0  # the most the details may add to a visitor's wait
GREEN = 3
GREEN_LEISURE = frozenset({"park", "garden", "playground", "nature_reserve", "dog_park"})
TOP_KINDS = 5
DOTS = 80
RING_POINTS = 60
KEPT_FOR_S = 24 * 3600.0
KEPT_MOST = 500
OSM_ID = re.compile(r"^(node|way|relation)/\d+$")
SOURCE = {"name": "OpenStreetMap contributors", "url": "https://www.openstreetmap.org/copyright"}
NOTE = "This shows what is open nearby, not what people want. Pledges measure demand."
INCOMPLETE = "OpenStreetMap is mapped by volunteers and can be incomplete, so check the street before relying on a count."

# Kinds of business no single OpenStreetMap tag pins down get no count of their own kind; what is around is still shown.
UNMAPPED = ("shop", "kids", "services", "other")
# Rules for kinds the shared table (app.osm) leaves unmapped because a bare tag is not specific enough elsewhere.
EXTRA = {
    "restaurant": ("amenity=restaurant",),
    "bar": ("amenity=bar|pub|biergarten",),
    "dance": ("amenity=dancing_school", "leisure=dance", "sport=dance"),
}
EXTRA_KINDS = {key: osm.kind_from(key, rules) for key, rules in EXTRA.items()}


def _kinds(*keys: str) -> tuple[osm.Kind, ...]:
    return tuple(EXTRA_KINDS[key] if key in EXTRA_KINDS else osm.KINDS[key] for key in keys)


@dataclass(frozen=True)
class SpotKind:
    singular: str
    plural: str
    tags: tuple[osm.Kind, ...]


SPOT_KINDS: dict[str, SpotKind] = {
    "cafe": SpotKind("café", "cafés", _kinds("cafe")),
    "restaurant": SpotKind("restaurant", "restaurants", _kinds("restaurant")),
    "bakery": SpotKind("bakery", "bakeries", _kinds("bakery")),
    "bar": SpotKind("bar", "bars", _kinds("bar")),
    "gym": SpotKind("gym", "gyms", _kinds("gym")),
    "studio": SpotKind("fitness or dance studio", "fitness or dance studios", _kinds("yogastudio", "pilatesstudio", "dance")),
    "salon": SpotKind("salon", "salons", _kinds("hairsalon", "beautysalon", "nailsalon")),
    "barber": SpotKind("barber", "barbers", _kinds("barbershop")),
    "bookstore": SpotKind("bookstore", "bookstores", _kinds("bookstore")),
    "grocery": SpotKind("grocery store", "grocery stores", _kinds("grocerystore")),
}

# What else counts as a business around: any shop or craft, and these amenities, leisure places and galleries. Parking,
# schools, places of worship and the like are named in OpenStreetMap too, but are no one's competition.
BUSINESS_AMENITIES = frozenset({
    "cafe", "restaurant", "fast_food", "bar", "pub", "ice_cream", "food_court", "biergarten", "nightclub", "pharmacy", "bank",
    "cinema", "theatre", "dentist", "doctors", "veterinary", "car_wash", "car_rental", "driving_school", "dancing_school",
    "language_school", "music_school", "childcare", "marketplace", "spa",
})
BUSINESS_LEISURE = frozenset({
    "fitness_centre", "sports_centre", "dance", "amusement_arcade", "bowling_alley", "escape_game", "spa", "sauna", "studio",
})
LABELS = {
    "amenity=cafe": "café", "amenity=restaurant": "restaurant", "amenity=fast_food": "fast food", "amenity=bar": "bar",
    "amenity=pub": "pub", "amenity=ice_cream": "ice cream", "amenity=pharmacy": "pharmacy", "amenity=bank": "bank",
    "amenity=dentist": "dentist", "amenity=doctors": "doctor", "amenity=veterinary": "vet",
    "amenity=dancing_school": "dance school", "amenity=childcare": "childcare",
    "shop=bakery": "bakery", "shop=pastry": "bakery", "shop=clothes": "clothing store", "shop=convenience": "convenience store",
    "shop=supermarket": "supermarket", "shop=greengrocer": "grocery store", "shop=hairdresser": "hair salon",
    "shop=beauty": "beauty salon", "shop=books": "bookstore", "shop=gift": "gift shop", "shop=florist": "florist",
    "shop=mobile_phone": "phone store", "shop=butcher": "butcher", "shop=jewelry": "jeweler", "shop=shoes": "shoe store",
    "shop=sports": "sports store", "shop=second_hand": "second-hand store", "shop=variety_store": "variety store",
    "leisure=fitness_centre": "gym", "leisure=sports_centre": "sports centre", "leisure=dance": "dance studio",
}


def is_business(tags: dict[str, str]) -> bool:
    return bool(
        tags.get("shop") or tags.get("craft") or tags.get("amenity") in BUSINESS_AMENITIES
        or tags.get("leisure") in BUSINESS_LEISURE or tags.get("tourism") == "gallery"
    )


def label_of(tags: dict[str, str]) -> str:
    """What a place is, in plain words: 'café', 'hair salon', 'clothing store'."""
    main = osm.main_tag(tags)
    if main is None:
        return "place"
    return LABELS.get(main) or main.partition("=")[2].replace("_", " ")


def kind_label(place: dict) -> str:
    """What a place is, in plain words: the label its source gave it where the tags alone would mislabel it."""
    return place.get("label") or label_of(place["tags"])


def distance_text(metres: float) -> str:
    """'180 m', '1.2 km': to the nearest 10 m under a kilometre."""
    rounded = round(metres / 10) * 10
    return f"{max(10, rounded)} m" if rounded < 1000 else f"{metres / 1000:.1f} km"


def summary_of(spec: SpotKind | None, kind: str, count: int | None, around: int, nearest: list[dict], circle: bool,
               unpinned: bool = False) -> str:
    """The answer in a sentence, written from the numbers and nothing else."""
    walk = f"a {WALK_MINUTES}-minute walk" if not circle else f"about a {WALK_MINUTES}-minute walk (a circle, not the streets)"
    if unpinned:
        return (f"The map data this check reads cannot tell {kind} businesses from other places, so there is no count of their "
                f"own kind to compare. {around} businesses are listed inside {walk} of this address.")
    if spec is None or count is None:
        return (f"OpenStreetMap has no single tag for {kind} businesses, so there is no count of their own kind to compare. "
                f"{around} businesses are listed inside {walk} of this address.")
    if count == 0:
        return f"OpenStreetMap lists no {spec.plural} inside {walk} of this address. {INCOMPLETE}"
    if count == 1:
        return f"One {spec.singular} is listed inside {walk} of this address, {distance_text(nearest[0]['distance_m'])} away."
    return (f"{count} {spec.plural} are listed inside {walk} of this address; the nearest is "
            f"{distance_text(nearest[0]['distance_m'])} away.")


def unchecked(place: dict, kind: str, reason: str, now: datetime) -> dict:
    """An answer with no numbers at all: it says why OpenStreetMap could not be read."""
    return {
        "place": place, "kind": kind, "walk_minutes": WALK_MINUTES, "checked": False, "reason": reason,
        "same_kind": None, "around": None, "area": None,
        "summary": f"Could not check this spot right now: {reason}",
        "source": {**SOURCE, "as_of": None}, "checked_at": now.isoformat(timespec="seconds"), "note": NOTE,
    }


def ring_of(area: Any) -> list[list[float]]:
    """The walking area's outline as [lat, lon] pairs, at most RING_POINTS of them, without the closing point."""
    return [[lat, lon] for lon, lat in osm.simplify(area.ring, RING_POINTS)]


log = logging.getLogger("threshold")
# Checks that outlasted their visitor's patience, kept here so they finish and fill the caches for the next ask.
_BACKGROUND: set[asyncio.Task] = set()


def _finished(task: asyncio.Task) -> None:
    _BACKGROUND.discard(task)
    if not task.cancelled() and task.exception() is not None:
        log.info("A check of a spot that went on in the background failed: %s", task.exception())


async def _read(services: Services, lat: float, lon: float) -> tuple[Catchment, osm.Scan]:
    """The walking area, then the places OpenStreetMap lists inside it; each is cached on disk by what it asked."""
    assert services.osm is not None
    area = await services.walker.walk(lat, lon, WALK_MINUTES)
    return area, await services.osm.scan(area)


async def _details(services: Services, ids: list[str]) -> dict[str, dict]:
    """What OpenStreetMap's volunteers wrote down about these places, for those that have anything; best effort."""
    if services.details is None or not ids:
        return {}
    try:
        return await asyncio.wait_for(services.details.lookup(ids), DETAILS_SECONDS)
    except Exception:  # the answer is complete without them
        return {}


def neighbor_of(place: dict, metres: float, details: dict | None) -> dict:
    """One place of the asked kind as an answer names it; 'osm' is its page on OpenStreetMap ('node/123') when it has one."""
    return {
        "name": squash(place["name"], 80), "kind": kind_label(place), "distance_m": round(metres), "lat": place["lat"],
        "lon": place["lon"], "osm": place["id"] if OSM_ID.match(place["id"]) else None, "details": details or None,
    }


async def check_spot(services: Services, lat: float, lon: float, kind: str, label: str, now: datetime) -> dict:
    """What OpenStreetMap lists inside a walk of this point, for this kind of business. Never raises: a service that does
    not answer in time makes the answer unchecked, with no numbers, and a check that is only slow goes on in the
    background, so asking again a little later finds its answer in the caches."""
    place = {"label": squash(label, 160), "lat": lat, "lon": lon}
    if services.osm is None:
        return unchecked(place, kind, "OpenStreetMap places are not set up on this server.", now)
    task = asyncio.ensure_future(_read(services, lat, lon))
    try:
        area, scan = await asyncio.wait_for(asyncio.shield(task), TOTAL_SECONDS)
    except TimeoutError:
        _BACKGROUND.add(task)
        task.add_done_callback(_finished)
        return unchecked(place, kind, SLOW, now)
    except Exception as exc:  # whatever else went wrong, the answer is still no numbers
        log.warning("Check a spot failed: %s", type(exc).__name__)
        return unchecked(place, kind, osm.NOTES["unavailable"], now)
    if not scan.checked:
        return unchecked(place, kind, scan.note or osm.NOTES["unavailable"], now)
    circle = area.source == "circle"
    spec = SPOT_KINDS.get(kind)
    unpinned = spec is not None and kind in scan.unpinned  # the data read cannot tell this kind apart: no count of its own
    if unpinned:
        spec = None
    businesses = [p for p in scan.places if is_business(p["tags"])]
    metres = {p["id"]: distance_m(lat, lon, p["lat"], p["lon"]) for p in scan.places}
    same = sorted((p for p in businesses if spec and any(k.matches(p["tags"]) for k in spec.tags)), key=lambda p: metres[p["id"]])
    kinds = Counter(kind_label(p) for p in businesses)
    same_ids = {p["id"] for p in same}
    others = sorted((p for p in businesses if p["id"] not in same_ids), key=lambda p: metres[p["id"]])
    listed = same[:LISTED]
    found = await _details(services, [p["id"] for p in listed[:DETAILED] if OSM_ID.match(p["id"])])
    nearest = [neighbor_of(p, metres[p["id"]], found.get(p["id"])) for p in listed]
    parks = sorted((p for p in scan.places if p["tags"].get("leisure") in GREEN_LEISURE), key=lambda p: metres[p["id"]])
    green = [{"name": squash(p["name"], 80), "kind": p["tags"]["leisure"].replace("_", " "), "distance_m": round(metres[p["id"]])}
             for p in parks[:GREEN]]
    count = len(same) if spec else None
    note = INCOMPLETE if not circle else (
        f"{INCOMPLETE} The routing service did not answer, so the area is a circle of the same walking radius, not the streets.")
    if kind in scan.kind_notes:
        note = f"{note} {scan.kind_notes[kind]}"
    dots = [[p["lat"], p["lon"], 1] for p in same[:DOTS]]
    dots += [[p["lat"], p["lon"], 0] for p in others[: DOTS - len(dots)]]
    source = {**SOURCE, "as_of": scan.as_of}
    if scan.source == tiles.SOURCE:
        source["name"] = "OpenStreetMap contributors, through OpenFreeMap"
    return {
        "place": place, "kind": kind, "walk_minutes": WALK_MINUTES, "checked": True, "reason": None,
        "same_kind": {"count": count, "nearest": nearest} if spec else None,
        "around": {
            "count": len(businesses), "dots": dots,
            "top_kinds": [{"kind": name, "count": n} for name, n in kinds.most_common(TOP_KINDS)], "green": green,
        },
        "area": {"ring": ring_of(area), "source": "circle" if circle else "walk"},
        "summary": summary_of(spec, kind, count, len(businesses), nearest, circle, unpinned),
        "source": source, "checked_at": now.isoformat(timespec="seconds"), "note": f"{NOTE} {note}",
    }


class SpotBook:
    """Checks that worked, kept for a day by the point (to four decimals, about 10 m) and the kind, so a place asked about
    twice costs OpenStreetMap one request. An answer with no numbers is never kept."""

    def __init__(self, kept_for: float = KEPT_FOR_S, most: int = KEPT_MOST) -> None:
        self.kept_for, self.most = kept_for, most
        self._kept: dict[tuple[float, float, str], tuple[float, dict]] = {}

    @staticmethod
    def key(lat: float, lon: float, kind: str) -> tuple[float, float, str]:
        return round(lat, 4), round(lon, 4), kind

    def get(self, lat: float, lon: float, kind: str) -> dict | None:
        kept = self._kept.get(self.key(lat, lon, kind))
        if kept is None or time.monotonic() - kept[0] >= self.kept_for:
            return None
        return kept[1]

    def put(self, lat: float, lon: float, kind: str, answer: dict) -> None:
        if not answer.get("checked"):
            return
        if len(self._kept) >= self.most:
            for old in sorted(self._kept, key=lambda key: self._kept[key][0])[: max(1, self.most // 5)]:
                self._kept.pop(old, None)
        self._kept[self.key(lat, lon, kind)] = (time.monotonic(), answer)
