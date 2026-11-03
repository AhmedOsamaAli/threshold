"""Places from the map's tiles, over synthetic tiles and a mock host: no network. The cases that matter: a tile is read to
the right positions and names, points that are no business are left out, a place outside the walk is not counted, a tile
list that points elsewhere is refused, and when the tiles cannot be read the scan says so (and Overpass is asked instead)."""
from __future__ import annotations

import asyncio
import gzip
import math
import re
from dataclasses import dataclass

import httpx
import pytest

from app import osm, tiles
from app.catchment import Catchment, circle_catchment, circle_ring
from tests.fakes import SITE, offset

VERSION = "20261101_080013_pt"
TILEJSON = {"tiles": [f"https://tiles.openfreemap.org/planet/{VERSION}/{{z}}/{{x}}/{{y}}.pbf"], "version": "3.16.0"}


# ---------- A tile encoder, the reverse of what app.tiles reads ----------

def varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        out.append(byte | 0x80 if value else byte)
        if not value:
            return bytes(out)


def field(number: int, wire: int, payload: bytes | int) -> bytes:
    head = varint(number << 3 | wire)
    return head + (varint(payload) if isinstance(payload, int) else varint(len(payload)) + payload)


def zigzag(value: int) -> int:
    return (value << 1) ^ (value >> 63)


def to_tile(lat: float, lon: float, x: int, y: int, z: int = 14, extent: int = 4096) -> tuple[int, int]:
    """Where a point lies in tile (x, y), in the tile's own units (outside 0..extent is the tile's buffer)."""
    n = 2 ** z
    sine = math.sin(math.radians(lat))
    y_fraction = (0.5 - math.log((1 + sine) / (1 - sine)) / (4 * math.pi)) * n
    return round(((lon + 180) / 360 * n - x) * extent), round((y_fraction - y) * extent)


@dataclass
class Poi:
    name: str
    cls: str
    sub: str
    lat: float
    lon: float
    fid: int | None = None
    english: str | None = None


def poi_layer(pois: list[Poi], x: int, y: int) -> bytes:
    keys = ["class", "subclass", "name", "name:en", "rank"]
    values: list[bytes] = []

    def index(text: str) -> int:
        raw = field(1, 2, text.encode())
        if raw not in values:
            values.append(raw)
        return values.index(raw)

    features = []
    for poi in pois:
        tags = []
        for key, text in (("class", poi.cls), ("subclass", poi.sub), ("name", poi.name), ("name:en", poi.english)):
            if text:
                tags += [keys.index(key), index(text)]
        tags += [keys.index("rank"), len(values)]  # a number, which the reader must skip over
        values.append(field(4, 0, 7))
        px, py = to_tile(poi.lat, poi.lon, x, y)
        feature = b"" if poi.fid is None else field(1, 0, poi.fid)
        feature += field(2, 2, b"".join(varint(t) for t in tags)) + field(3, 0, 1)
        feature += field(4, 2, b"".join(varint(g) for g in (9, zigzag(px), zigzag(py))))
        features.append(feature)
    body = field(1, 2, b"poi") + b"".join(field(2, 2, f) for f in features)
    body += b"".join(field(3, 2, k.encode()) for k in keys) + b"".join(field(4, 2, v) for v in values) + field(5, 0, 4096)
    return field(3, 2, body)


def other_layer(name: str) -> bytes:
    """A layer the reader must skip, with a feature and a key so that it has something to skip."""
    body = field(1, 2, name.encode()) + field(2, 2, field(3, 0, 2)) + field(3, 2, b"class") + field(5, 0, 4096)
    return field(3, 2, body)


def tile_of_pois(pois: list[Poi], x: int, y: int) -> bytes:
    return other_layer("housenumber") + poi_layer(pois, x, y) + other_layer("water")


# ---------- What a tile says ----------

def test_a_tile_is_read_to_its_points_names_and_positions():
    x, y = 4869, 6202
    lat, lon = offset(300, 45)
    pois = [
        Poi("Corner Cafe", "cafe", "cafe", lat, lon, fid=123451),
        Poi("روتو", "cafe", "cafe", lat + 0.001, lon, fid=99992, english="Rotto"),
        Poi("", "cafe", "cafe", lat, lon + 0.001),  # unnamed: not a place anyone can be sent to
    ]
    found = tiles.decode_points(tile_of_pois(pois, x, y), 14, x, y)
    assert [(p["name"], p["name_en"], p["cls"], p["sub"], p["fid"]) for p in found] == [
        ("Corner Cafe", None, "cafe", "cafe", 123451), ("روتو", "Rotto", "cafe", "cafe", 99992)]
    assert (found[0]["lat"], found[0]["lon"]) == pytest.approx((lat, lon), abs=3e-5)  # within about two metres


def test_a_tile_without_the_layer_or_with_nothing_in_it_has_no_points():
    assert tiles.decode_points(b"", 14, 0, 0) == []
    assert tiles.decode_points(other_layer("water"), 14, 0, 0) == []
    assert tiles.decode_points(poi_layer([], 0, 0), 14, 0, 0) == []


@pytest.mark.parametrize("damaged", [b"\x1a\xff", b"\x1a\x05abc", b"\x0f\x01"])
def test_a_damaged_tile_is_an_error_not_a_guess(damaged):
    with pytest.raises((ValueError, IndexError)):
        tiles.decode_points(damaged, 14, 0, 0)


def test_tile_coordinates_follow_the_standard_map_grid():
    assert tiles.tile_of(51.5, 0.0) == (8192, 5448)  # London, by the OpenStreetMap wiki's formula
    assert tiles._lonlat(1, 1, 0, 4096, 2048, 2048) == pytest.approx((90.0, 66.51326), abs=1e-5)


def test_the_tiles_under_a_walk_are_few_and_a_huge_area_has_none_to_read():
    walk = circle_catchment(*SITE, 10)
    covering = tiles.tiles_covering(walk.ring)
    assert covering is not None and 1 <= len(covering) <= 4
    assert tiles.tiles_covering(circle_ring(*SITE, 60_000)) is None


@pytest.mark.parametrize(("cls", "sub", "tags", "label"), [
    ("cafe", "cafe", {"amenity": "cafe"}, None),
    ("beer", "pub", {"amenity": "pub"}, None),
    ("bakery", "bakery", {"shop": "bakery"}, None),
    ("grocery", "supermarket", {"shop": "supermarket"}, None),
    ("shop", "convenience", {"shop": "convenience"}, None),
    ("library", "books", {"shop": "books"}, None),
    ("hairdresser", "hairdresser", {"shop": "hairdresser"}, None),
    ("yoga", "yoga", {"leisure": "fitness_centre", "sport": "yoga"}, "yoga studio"),
    ("park", "park", {"leisure": "park"}, None),
])
def test_a_class_and_subclass_become_the_tags_the_rules_read(cls, sub, tags, label):
    assert tiles.tags_for(cls, sub) == (tags, label)


@pytest.mark.parametrize(("name", "tags", "label"), [
    ("Push Fitness", {"leisure": "fitness_centre"}, "gym"),
    ("Crossfit Outbreak", {"leisure": "fitness_centre"}, "gym"),
    ("Eastern District YMCA", {"leisure": "fitness_centre"}, "gym"),
    ("City Gym", {"leisure": "fitness_centre"}, "gym"),
    ("Fitnessstudio Mitte", {"leisure": "fitness_centre"}, "gym"),
    ("The Grappling Club", {"leisure": "fitness_centre"}, "gym"),
    ("Loom Yoga", {"leisure": "fitness_centre", "sport": "yoga"}, "yoga studio"),
    ("Moss Pilates", {"leisure": "fitness_centre", "sport": "pilates"}, "pilates studio"),
    ("Schwimmhalle Kreuzberg", {"leisure": "sports_centre"}, "sports centre"),
    ("Sommerbad Kreuzberg", {"leisure": "sports_centre"}, "sports centre"),
    ("Lucozade Power League", {"leisure": "sports_centre"}, "sports centre"),
    ("Gymnasium Hall", {"leisure": "sports_centre"}, "sports centre"),  # a school's hall, not a gym
])
def test_a_sports_centre_is_a_gym_only_when_its_name_says_so(name, tags, label):
    assert tiles.tags_for("sports_centre", "sports_centre", name) == (tags, label)


@pytest.mark.parametrize(("cls", "sub"), [("bus", "bus_stop"), ("parking", "parking"), ("school", "school"),
                                           ("place_of_worship", "christian"), ("office", "lawyer"), ("shop", "")])
def test_points_that_are_no_business_and_no_park_are_left_out(cls, sub):
    assert tiles.tags_for(cls, sub) is None


def test_the_feature_id_says_which_openstreetmap_element_a_place_is():
    point = {"cls": "cafe", "sub": "cafe", "name": "A", "name_en": None, "lat": 1.0, "lon": 2.0}
    assert tiles.element_of({**point, "fid": 38153941811})[0]["type"] == "node"
    assert (tiles.element_of({**point, "fid": 38153941811})[0]["id"]) == 3815394181
    assert tiles.element_of({**point, "fid": 1638969302})[0]["type"] == "way"
    assert tiles.element_of({**point, "fid": 192374713})[0]["type"] == "relation"
    nameless = tiles.element_of({**point, "fid": None})[0]
    assert nameless["type"] == "point" and tiles.element_of({**point, "fid": None})[0]["id"] == nameless["id"]  # stable


# ---------- The client ----------

CAFE = offset(150, 0)
FAR_CAFE = offset(700, 90)
OUTSIDE = offset(2500, 0)
POIS = [
    Poi("Near Cafe", "cafe", "cafe", *CAFE, fid=111),
    Poi("Far Cafe", "cafe", "cafe", *FAR_CAFE, fid=222),
    Poi("The Park", "park", "park", *offset(400, 180), fid=333),
    Poi("Bus Stop 9", "bus", "bus_stop", *offset(50, 0), fid=441),
    Poi("Out Of Reach", "cafe", "cafe", *OUTSIDE, fid=551),
    Poi("Sports Hall", "sports_centre", "sports_centre", *offset(250, 270), fid=662),
    Poi("Iron Fitness", "sports_centre", "sports_centre", *offset(180, 45), fid=881),
    Poi("Cafe Arabica", "cafe", "cafe", *offset(120, 90), fid=771, english="Cafe Arabica"),
]


def host(pois=POIS, seen: list[str] | None = None, tilejson=None, tile_status: int = 200, tilejson_status: int = 200,
         tile_body=None):
    seen = seen if seen is not None else []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request.url.path)
        assert request.headers["user-agent"].startswith("Threshold/")
        if request.url.path == "/planet":
            return httpx.Response(tilejson_status, json=tilejson or TILEJSON)
        found = re.fullmatch(rf"/planet/{VERSION}/14/(\d+)/(\d+)\.pbf", request.url.path)
        assert found, request.url.path
        if tile_status != 200:
            return httpx.Response(tile_status)
        body = tile_body if tile_body is not None else tile_of_pois(pois, int(found.group(1)), int(found.group(2)))
        return httpx.Response(200, content=gzip.compress(body), headers={"Content-Encoding": "gzip"})

    return httpx.MockTransport(handle), seen


def client(tmp_path, transport, **kwargs) -> tiles.TileClient:
    return tiles.TileClient(tmp_path, transport=transport, **kwargs)


def scan(c: tiles.TileClient, catchment: Catchment | None = None) -> osm.Scan:
    return asyncio.run(c.scan(catchment or circle_catchment(*SITE, 10)))


def test_the_places_inside_the_walk_come_from_the_tiles(tmp_path):
    transport, seen = host()
    c = client(tmp_path, transport)
    found = scan(c)
    assert found.checked and found.source == tiles.SOURCE and found.as_of == "2026-11-01T08:00:13Z"
    assert found.unpinned == frozenset({"barber", "studio"})
    names = {p["name"] for p in found.places}
    assert names == {"Near Cafe", "Far Cafe", "The Park", "Sports Hall", "Iron Fitness", "Cafe Arabica"}  # no bus stop, none out of reach
    by_name = {p["name"]: p for p in found.places}
    assert by_name["Near Cafe"]["id"] == "node/11" and by_name["Near Cafe"]["tags"] == {"amenity": "cafe", "name": "Near Cafe"}
    assert by_name["Sports Hall"]["id"] == "way/66" and by_name["Sports Hall"]["label"] == "sports centre"
    assert by_name["Iron Fitness"]["label"] == "gym" and by_name["Iron Fitness"]["tags"]["leisure"] == "fitness_centre"
    assert "label" not in by_name["Near Cafe"]
    assert found.kind_notes["gym"].startswith("Here a gym is recognised by its name")
    assert by_name["The Park"]["tags"]["leisure"] == "park"
    assert seen.count("/planet") == 1 and c.calls == len(seen) - 1  # the list once, then one request for each tile


def test_a_place_in_the_buffer_of_two_tiles_counts_once(tmp_path):
    transport, seen = host()
    covering = tiles.tiles_covering(circle_catchment(*SITE, 10).ring)
    assert covering is not None
    found = scan(client(tmp_path, transport))
    assert [p["name"] for p in found.places].count("Near Cafe") == 1
    assert len(seen) - 1 == len(covering)


def test_a_name_in_another_script_is_shown_in_english(tmp_path):
    transport, _ = host([Poi("روتو", "cafe", "cafe", *CAFE, fid=111, english="Rotto")])
    [place] = scan(client(tmp_path, transport)).places
    assert place["name"] == "Rotto" and "روتو" in place["names"]


def test_tiles_already_read_are_not_read_again(tmp_path):
    transport, seen = host()
    first = scan(client(tmp_path, transport))
    before = len(seen)
    second_client = client(tmp_path, transport)
    second = scan(second_client)
    assert [p["name"] for p in second.places] == [p["name"] for p in first.places]
    assert len(seen) - before == 1 and second_client.cache_hits >= 1  # only the tile list, which names the build


def test_an_empty_tile_is_no_error(tmp_path):
    transport, _ = host(tile_status=404)
    found = scan(client(tmp_path, transport))
    assert found.checked and found.places == []


@pytest.mark.parametrize("trouble", ["tilejson", "tile", "damaged"])
def test_when_the_tiles_cannot_be_read_the_scan_says_so(tmp_path, trouble):
    options = {"tilejson": {"tilejson_status": 503}, "tile": {"tile_status": 500}, "damaged": {"tile_body": b"\x1a\xff"}}[trouble]
    transport, _ = host(**options)
    found = scan(client(tmp_path, transport))
    assert found.checked is False and found.reason == "unavailable" and found.note == osm.NOTES["unavailable"]


@pytest.mark.parametrize("address", ["https://evil.example/planet/{z}/{x}/{y}.pbf", "http://tiles.openfreemap.org/{z}/{x}/{y}.pbf",
                                     "https://tiles.openfreemap.org.evil.example/{z}/{x}/{y}.pbf", "https://tiles.openfreemap.org/x.pbf"])
def test_a_tile_list_that_points_elsewhere_is_refused(tmp_path, address):
    transport, seen = host(tilejson={"tiles": [address]})
    found = scan(client(tmp_path, transport))
    assert found.checked is False
    assert seen == ["/planet"]  # nothing was asked of the other host


def test_an_area_too_large_to_read_is_said_to_be_too_large_and_nothing_is_asked(tmp_path):
    transport, seen = host()
    huge = Catchment(*SITE, 10, "circle", circle_ring(*SITE, 60_000))
    found = scan(client(tmp_path, transport), huge)
    assert found.checked is False and found.reason == "too_big" and found.note == osm.NOTES["too_big"]
    assert seen == []


def test_the_last_tile_address_is_used_when_the_list_cannot_be_read_again(tmp_path):
    transport, _ = host()
    c = client(tmp_path, transport)
    assert scan(c).checked
    c._template = (c._template[0], c._template[1] - tiles.TEMPLATE_MAX_AGE_S - 1)  # an hour has passed
    down, seen = host(tilejson_status=503)
    c._http = httpx.AsyncClient(transport=down, headers={"User-Agent": osm.USER_AGENT})
    assert scan(c).checked  # served from the tiles kept on disk, under the address it knew


# ---------- Tiles first, Overpass as the backup ----------

class Source:
    def __init__(self, found: osm.Scan) -> None:
        self.found, self.calls, self.closed = found, 0, False

    async def scan(self, catchment) -> osm.Scan:
        self.calls += 1
        return self.found

    async def aclose(self) -> None:
        self.closed = True


def test_overpass_is_asked_only_when_the_tiles_could_not_be_read():
    good, backup = Source(osm.Scan(True, [], tiles.SOURCE)), Source(osm.Scan(True, [], "overpass"))
    places = tiles.Places(good, backup)
    assert asyncio.run(places.scan(circle_catchment(*SITE, 10))).source == tiles.SOURCE and backup.calls == 0
    failed = Source(osm.Scan(False, note=osm.NOTES["unavailable"]))
    assert asyncio.run(tiles.Places(failed, backup).scan(circle_catchment(*SITE, 10))).source == "overpass" and backup.calls == 1


def test_when_neither_can_be_read_the_answer_is_the_tiles_and_a_huge_area_is_not_sent_on():
    nothing = osm.Scan(False, note=osm.NOTES["unavailable"])
    first, second = Source(nothing), Source(osm.Scan(False, note="slow"))
    assert asyncio.run(tiles.Places(first, second).scan(circle_catchment(*SITE, 10))) is nothing
    big, backup = Source(osm.Scan(False, note=osm.NOTES["too_big"], reason="too_big")), Source(osm.Scan(True, []))
    assert asyncio.run(tiles.Places(big, backup).scan(circle_catchment(*SITE, 10))).reason == "too_big" and backup.calls == 0


def test_places_closes_both_sources():
    a, b = Source(osm.Scan(True)), Source(osm.Scan(True))
    asyncio.run(tiles.Places(a, b).aclose())
    assert a.closed and b.closed
