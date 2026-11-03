"""Places from the map's own tiles, with Overpass as the backup.

The map this app shows is OpenFreeMap's, drawn from OpenStreetMap, and its tiles carry a layer of named points of
interest: every cafe, shop, gym and park a volunteer mapped, with a class and a subclass ('cafe/cafe', 'shop/convenience').
Reading the few tiles under a walking area is a handful of static files from one host. The Overpass servers that used to
answer are volunteers' and are often too busy (in November 2026 most of them timed out), so the tiles come first and
Overpass is asked only when they cannot be read (Places).

A tile keeps no tags but that class and subclass, and the subclass is the OpenStreetMap tag's own value ('cafe' is
amenity=cafe). Each place gets the few tags the app's rules read (app.osm, app.spot), so one set of rules serves both
sources. Two kinds of business that no tile can tell apart (a barber from a hair salon, a dance or pilates studio from a
yoga one) are named in UNPINNED, and a scan from here counts none of them.

Tiles come from the host the map's own tile list names, four at a time at most, with this app named in the User-Agent: what
OpenFreeMap asks of apps that read areas (3,000 tiles or 50 MB at most, 4 requests at once at most).
Data © OpenStreetMap contributors (www.openstreetmap.org/copyright), tiles by OpenFreeMap (openfreemap.org).
"""
from __future__ import annotations

import asyncio
import gzip
import json
import logging
import math
import re
import struct
import time
import zlib
from collections.abc import Iterator
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx

from . import jsonio, osm, tls
from .catchment import Catchment

log = logging.getLogger("threshold")

TILEJSON_URL = "https://tiles.openfreemap.org/planet"
TILE_HOST = "openfreemap.org"  # the tile list may only point at this host (or one under it)
ZOOM = 14  # the most detailed tiles OpenFreeMap serves, and the ones that keep every point of interest
LAYER = "poi"
MAX_TILES = 12  # a walk is a kilometre or two across, so one to four tiles; more is an area too large to read this way
PARALLEL = 4  # the most OpenFreeMap allows an app that reads areas
TIMEOUT_S = 10.0  # one request
BUDGET_S = 25.0  # a whole scan
TEMPLATE_MAX_AGE_S = 3600.0  # the tiles' address changes with each weekly build
MAX_AGE_S = 7 * 24 * 3600.0
SOURCE = "OpenFreeMap tiles"
UNPINNED = frozenset({"barber", "studio"})

WANTED = frozenset({"class", "subclass", "name", "name:en"})


class TileError(RuntimeError):
    pass


class _TooBig(Exception):
    pass


# ---------- Reading a tile ----------
#
# A tile is a Mapbox Vector Tile: protocol buffers, read here directly (no library). A tile holds layers; a layer holds its
# name, its keys and values, and features that point into them. Only the point features of the point-of-interest layer are
# read, and of their properties only the four the app uses.

def _varint(data: bytes, pos: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        byte = data[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return result, pos
        shift += 7


def _fields(data: bytes) -> Iterator[tuple[int, Any]]:
    """(field number, value) of each field in a protobuf message: an integer for a varint, else the field's bytes."""
    pos, end = 0, len(data)
    while pos < end:
        key, pos = _varint(data, pos)
        number, wire = key >> 3, key & 7
        if wire == 0:
            value, pos = _varint(data, pos)
        elif wire == 2:
            length, pos = _varint(data, pos)
            value = data[pos:pos + length]
            pos += length
        elif wire == 1:
            value = data[pos:pos + 8]
            pos += 8
        elif wire == 5:
            value = data[pos:pos + 4]
            pos += 4
        else:
            raise ValueError(f"unsupported wire type {wire}")
        if pos > end:
            raise ValueError("a field runs past the end of its message")
        yield number, value


def _packed(data: bytes) -> list[int]:
    out, pos = [], 0
    while pos < len(data):
        value, pos = _varint(data, pos)
        out.append(value)
    return out


def _zigzag(value: int) -> int:
    return (value >> 1) ^ -(value & 1)


def _value(raw: bytes) -> object:
    """The value a layer's value message holds."""
    for number, value in _fields(raw):
        if number == 1:
            return value.decode("utf-8", "replace")
        if number == 2:
            return struct.unpack("<f", value)[0]
        if number == 3:
            return struct.unpack("<d", value)[0]
        if number == 4:
            return value - (1 << 64) if value >= 1 << 63 else value
        if number == 5:
            return value
        if number == 6:
            return _zigzag(value)
        if number == 7:
            return bool(value)
    return None


def _lonlat(z: int, x: int, y: int, extent: int, px: int, py: int) -> tuple[float, float]:
    n = 2 ** z
    lon = (x + px / extent) / n * 360.0 - 180.0
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + py / extent) / n))))
    return lon, lat


def decode_points(tile: bytes, z: int, x: int, y: int) -> list[dict]:
    """The named points of a tile's point-of-interest layer: {'fid', 'cls', 'sub', 'name', 'name_en', 'lat', 'lon'}.
    'fid' is the feature's id: the OpenStreetMap id times ten, plus 1 for a node, 2 for a way or 3 for a relation."""
    for number, layer in _fields(tile):
        if number != 3:
            continue
        name: str | None = None
        extent = 4096
        keys: list[str] = []
        values: list[bytes] = []
        features: list[bytes] = []
        for n, value in _fields(layer):
            if n == 1:
                name = value.decode("utf-8", "replace")
                if name != LAYER:
                    break  # not the layer wanted: the rest of it is skipped unread
            elif n == 2:
                features.append(value)
            elif n == 3:
                keys.append(value.decode("utf-8", "replace"))
            elif n == 4:
                values.append(value)
            elif n == 5:
                extent = value
        if name == LAYER:
            return _points(features, keys, values, extent, z, x, y)
    return []


def _points(features: list[bytes], keys: list[str], values: list[bytes], extent: int, z: int, x: int, y: int) -> list[dict]:
    found: list[dict] = []
    read: dict[int, object] = {}
    for raw in features:
        fid: int | None = None
        tags: list[int] = []
        kind = 0
        geometry: list[int] = []
        for n, value in _fields(raw):
            if n == 1:
                fid = value
            elif n == 2:
                tags = _packed(value)
            elif n == 3:
                kind = value
            elif n == 4:
                geometry = _packed(value)
        if kind != 1 or len(geometry) < 3 or geometry[0] & 7 != 1:  # a point: MoveTo, then its position
            continue
        props: dict[str, object] = {}
        for i in range(0, len(tags) - 1, 2):
            key = keys[tags[i]]
            if key in WANTED:
                index = tags[i + 1]
                if index not in read:
                    read[index] = _value(values[index])
                props[key] = read[index]
        name, cls = props.get("name"), props.get("class")
        if not isinstance(name, str) or not name.strip() or not isinstance(cls, str):
            continue
        lon, lat = _lonlat(z, x, y, extent, _zigzag(geometry[1]), _zigzag(geometry[2]))
        sub, english = props.get("subclass"), props.get("name:en")
        found.append({
            "fid": fid, "cls": cls, "sub": sub if isinstance(sub, str) else "", "name": name.strip(),
            "name_en": english.strip() if isinstance(english, str) and english.strip() else None,
            "lat": round(lat, 6), "lon": round(lon, 6),
        })
    return found


def tile_of(lat: float, lon: float, z: int = ZOOM) -> tuple[int, int]:
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(max(-85.0511, min(85.0511, lat))))) / math.pi) / 2.0 * n)
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def tiles_covering(ring: list[tuple[float, float]]) -> list[tuple[int, int]] | None:
    """The tiles a (lon, lat) ring lies in; None when they are more than MAX_TILES."""
    lons, lats = [p[0] for p in ring], [p[1] for p in ring]
    x0, y0 = tile_of(max(lats), min(lons))
    x1, y1 = tile_of(min(lats), max(lons))
    if (x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES:
        return None
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]


# ---------- What a tile's class and subclass say a place is ----------

# Amenities among the subclasses: the subclass is the amenity's own value.
AMENITIES = frozenset({
    "cafe", "restaurant", "fast_food", "bar", "pub", "nightclub", "ice_cream", "pharmacy", "bank", "cinema", "theatre", "dentist",
    "doctors", "veterinary", "car_wash", "childcare", "marketplace", "biergarten", "food_court", "dancing_school",
    "language_school", "music_school", "driving_school",
})
# Classes whose subclass is a shop's own value (shop=bakery is class 'bakery', subclass 'bakery').
SHOP_CLASSES = frozenset({
    "shop", "grocery", "clothing_store", "jewelry", "bakery", "hairdresser", "alcohol_shop", "bicycle", "car", "music", "laundry",
    "florist", "butcher",
})
# Class and subclass that stand for something other than their own value.
SPECIAL: dict[str, tuple[dict[str, str], str | None]] = {
    "yoga/yoga": ({"leisure": "fitness_centre", "sport": "yoga"}, "yoga studio"),
    "library/books": ({"shop": "books"}, None),
    "art_gallery/gallery": ({"tourism": "gallery"}, None),
    "park/park": ({"leisure": "park"}, None),
    "garden/garden": ({"leisure": "garden"}, None),
    "playground/playground": ({"leisure": "playground"}, None),
}
# Fitness centres and sports centres share one subclass ('sports_centre'): a swimming hall, a football club and a gym alike.
# A gym is told by its name, which is a guess, and said to be one (KIND_NOTES): better than counting every pool as a gym.
YOGA = re.compile(r"yoga", re.I)
PILATES = re.compile(r"pilates", re.I)
GYM_NAME = re.compile(
    r"fitness|crossfit|workout|bootcamp|boot camp|bodybuild|powerlift|weightlift|calisthenic|strength|conditioning|athletic club|"
    r"health club|ymca|ywca|boxing|kickbox|grappling|jiu.?jitsu|martial|karate|judo|\bmma\b|barre|spin studio|cycling studio|"
    r"orangetheory|\bf45\b|crunch|equinox|puregym|anytime|life ?time|curves|\bgyms?\b|\bfit\b",
    re.I,
)
# What a source that counts a kind only roughly says about it, shown with its answer.
KIND_NOTES = {
    "gym": "Here a gym is recognised by its name (fitness, gym, crossfit, boxing...), so some are missed and a few may be no gym.",
    "salon": "In this map data barbers are listed with hair salons.",
}


def tags_for(cls: str, sub: str, name: str = "") -> tuple[dict[str, str], str | None] | None:
    """The OpenStreetMap tags a tile's class and subclass (and, for a sports centre, its name) stand for, and a label where
    the tags alone would mislabel the place; None for the many points of interest that are no business and no park (bus
    stops, parking, schools)."""
    if cls == "sports_centre" and sub == "sports_centre":
        if YOGA.search(name):
            return {"leisure": "fitness_centre", "sport": "yoga"}, "yoga studio"
        if PILATES.search(name):
            return {"leisure": "fitness_centre", "sport": "pilates"}, "pilates studio"
        if GYM_NAME.search(name):
            return {"leisure": "fitness_centre"}, "gym"
        return {"leisure": "sports_centre"}, "sports centre"
    special = SPECIAL.get(f"{cls}/{sub}")
    if special is not None:
        return dict(special[0]), special[1]
    if sub in AMENITIES:
        return {"amenity": sub}, None
    if cls in SHOP_CLASSES and sub:
        return {"shop": sub}, None
    return None


def element_of(point: dict) -> tuple[dict, str | None] | None:
    """A point as an element osm.places_inside reads, and the label it asks for; None when it is none of ours."""
    found = tags_for(point["cls"], point["sub"], point["name"])
    if found is None:
        return None
    tags, label = found
    tags = {**tags, "name": point["name"]}
    if point.get("name_en"):
        tags["name:en"] = point["name_en"]
    fid = point.get("fid")
    if isinstance(fid, int) and fid >= 10 and fid % 10 in (1, 2, 3):
        kind, number = ("node", "way", "relation")[fid % 10 - 1], fid // 10
    else:  # no OpenStreetMap id: the place still counts, and has no page to link to
        kind, number = "point", zlib.crc32(f"{point['name']}|{point['lat']:.5f}|{point['lon']:.5f}".encode())
    return {"type": kind, "id": number, "lat": point["lat"], "lon": point["lon"], "tags": tags}, label


def _version(template: str) -> str:
    found = re.search(r"/planet/([0-9A-Za-z_]+)/", template)
    return found.group(1) if found else "current"


def _as_of(version: str) -> str | None:
    found = re.match(r"(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})", version)
    return "{}-{}-{}T{}:{}:{}Z".format(*found.groups()) if found else None


def _save(cache_file: Path, points: list[dict]) -> None:
    try:
        jsonio.write(cache_file, json.dumps(points, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    except OSError:  # a cache that cannot be written only costs the next scan a download
        log.debug("A map tile could not be cached", exc_info=True)


# ---------- The client ----------

class TileClient:
    """Reads the places inside an area from the map's tiles; each tile's points are kept on disk by tile and build."""

    def __init__(
        self,
        cache_dir: Path,
        tilejson: str = TILEJSON_URL,
        timeout: float = TIMEOUT_S,
        budget: float = BUDGET_S,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._cache_dir = cache_dir
        self._tilejson = tilejson
        self._budget = budget
        self._http = httpx.AsyncClient(
            headers={"User-Agent": osm.USER_AGENT}, timeout=timeout, transport=transport, verify=tls.context(),
            follow_redirects=True,
        )
        self._gate = asyncio.Semaphore(PARALLEL)
        self._lock = asyncio.Lock()
        self._template: tuple[str, float] | None = None
        self.calls = 0
        self.cache_hits = 0

    async def aclose(self) -> None:
        await self._http.aclose()

    async def scan(self, catchment: Catchment) -> osm.Scan:
        """The named places the map's tiles show inside the area; never raises: when the tiles cannot be read in time, the
        scan says so and the caller goes on without it (or asks Overpass)."""
        try:
            return await asyncio.wait_for(self._scan(catchment), self._budget)
        except _TooBig:
            return osm.Scan(False, note=osm.NOTES["too_big"], reason="too_big")
        except (TileError, TimeoutError, httpx.HTTPError) as exc:
            log.warning("Map tiles not read: %s", str(exc) or type(exc).__name__)
        except Exception:  # an answer shaped unlike any seen so far must not stop the caller either
            log.warning("Map tile scan failed", exc_info=True)
        return osm.Scan(False, note=osm.NOTES["unavailable"])

    async def _scan(self, catchment: Catchment) -> osm.Scan:
        tiles = tiles_covering(catchment.ring)
        if tiles is None:
            raise _TooBig
        template = await self._template_now()
        version = _version(template)
        batches = await asyncio.gather(*(self._points(template, version, x, y) for x, y in tiles))
        elements: dict[tuple[str, int], dict] = {}
        labels: dict[str, str] = {}
        for batch in batches:
            for point in batch:
                made = element_of(point)
                if made is None:
                    continue
                element, label = made
                elements.setdefault((element["type"], element["id"]), element)
                if label:
                    labels[f"{element['type']}/{element['id']}"] = label
        places = osm.places_inside(elements.values(), catchment.contains)
        for place in places:
            if place["id"] in labels:
                place["label"] = labels[place["id"]]
        return osm.Scan(True, places, SOURCE, _as_of(version), unpinned=UNPINNED, kind_notes=KIND_NOTES)

    async def _template_now(self) -> str:
        """The tiles' address, with {z}, {x} and {y} in it; read from the tile list, and kept for an hour."""
        async with self._lock:
            now = time.monotonic()
            if self._template and now - self._template[1] < TEMPLATE_MAX_AGE_S:
                return self._template[0]
            try:
                response = await self._http.get(self._tilejson)
                response.raise_for_status()
                listed = response.json().get("tiles") or []
                template = next((t for t in listed if isinstance(t, str) and all(k in t for k in ("{z}", "{x}", "{y}"))), None)
                host = (urlsplit(template).hostname or "") if template else ""
                if template is None or urlsplit(template).scheme != "https" or not (host == TILE_HOST or host.endswith("." + TILE_HOST)):
                    raise TileError("the tile list names no usable tile address")
            except (httpx.HTTPError, ValueError, TileError) as exc:
                if self._template:  # an address a little old beats none
                    log.warning("The tile list could not be read (%s); using the last address", type(exc).__name__)
                    return self._template[0]
                raise TileError(f"the tile list could not be read ({type(exc).__name__})") from exc
            self._template = (template, now)
            return template

    async def _points(self, template: str, version: str, x: int, y: int) -> list[dict]:
        cache_file = self._cache_dir / f"{re.sub(r'[^0-9A-Za-z_]', '', version)}-{ZOOM}-{x}-{y}.json"
        saved = await asyncio.to_thread(jsonio.read, cache_file)
        if saved and time.time() - saved[1] < MAX_AGE_S and isinstance(saved[0], list):
            self.cache_hits += 1
            return saved[0]
        data = await self._download(template.replace("{z}", str(ZOOM)).replace("{x}", str(x)).replace("{y}", str(y)))
        try:
            points = decode_points(data, ZOOM, x, y) if data else []
        except (ValueError, IndexError, struct.error) as exc:
            raise TileError("a tile could not be read") from exc
        await asyncio.to_thread(_save, cache_file, points)
        return points

    async def _download(self, url: str) -> bytes | None:
        """One tile's bytes; None when nothing is mapped under it (the host has no such tile)."""
        async with self._gate:
            for attempt in (1, 2):
                self.calls += 1
                try:
                    response = await self._http.get(url)
                except httpx.HTTPError as exc:
                    if attempt == 2:
                        raise TileError(type(exc).__name__) from exc
                    await asyncio.sleep(0.3)
                    continue
                if response.status_code == 404:
                    return None
                if response.status_code == 200:
                    data = response.content
                    try:
                        return gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data
                    except (OSError, EOFError) as exc:
                        raise TileError("a tile arrived damaged") from exc
                if attempt == 2:
                    raise TileError(f"HTTP {response.status_code}")
                await asyncio.sleep(0.3)
        raise TileError("no answer")  # not reached: the loop returns or raises


class Places:
    """The places inside an area: from the map's tiles, and from Overpass only when the tiles could not be read."""

    def __init__(self, tiles: osm.PlaceSource, overpass: osm.PlaceSource) -> None:
        self._tiles = tiles
        self._overpass = overpass

    async def scan(self, catchment: Catchment) -> osm.Scan:
        first = await self._tiles.scan(catchment)
        if first.checked or first.reason == "too_big":
            return first
        second = await self._overpass.scan(catchment)
        return second if second.checked else first

    async def aclose(self) -> None:
        await self._tiles.aclose()
        await self._overpass.aclose()
