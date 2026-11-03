"""OpenStreetMap places: which kinds of place OpenStreetMap's tags pin down, how names are matched, and how the Overpass
client asks, caches and fails without stopping its caller."""
import asyncio
import json
import math
import os
import time

import httpx
import pytest

from app import osm
from app.catchment import circle_catchment, ring_area_m2
from tests.fakes import SITE, offset

ENDPOINTS = ("https://first.test/api/interpreter", "https://second.test/api/interpreter", "https://third.test/api/interpreter")


# ---------- Kinds of place ----------

@pytest.mark.parametrize(("genre", "tags"), [
    ("Bakery", {"shop": "bakery"}),
    ("Bakery", {"shop": "pastry"}),  # Insomnia Cookies
    ("Bakery", {"amenity": "cafe", "cuisine": "coffee_shop;bakery"}),
    ("Coffee shop", {"amenity": "cafe"}),
    ("Coffee shop", {"amenity": "cafe", "cuisine": "coffee_shop;sandwich"}),
    ("Coffee shop", {"amenity": "fast_food", "cuisine": "donut;coffee_shop"}),
    ("Cafe", {"amenity": "cafe", "cuisine": "bubble_tea"}),
    ("Cocktail Bar", {"amenity": "bar", "cocktails": "yes"}),
    ("Wine Bar", {"amenity": "bar", "bar": "wine"}),
    ("Pub", {"amenity": "pub"}),
    ("Night club", {"amenity": "nightclub"}),
    ("Live music venue", {"amenity": "bar", "live_music": "yes"}),
    ("Live Music Venue", {"amenity": "music_venue"}),
    ("Mexican", {"amenity": "restaurant", "cuisine": "Tex-Mex"}),
    ("Tex-Mex", {"amenity": "restaurant", "cuisine": "tex-mex;breakfast"}),
    ("Taco restaurant", {"amenity": "fast_food", "cuisine": "tacos"}),
    ("Seafood", {"amenity": "restaurant", "cuisine": "seafood"}),
    ("Japanese", {"amenity": "restaurant", "cuisine": "sushi"}),
    ("Ramen", {"amenity": "restaurant", "cuisine": "ramen"}),
    ("Brunch", {"amenity": "restaurant", "cuisine": "brunch"}),
    ("Breakfast", {"amenity": "cafe", "cuisine": "breakfast;coffee_shop"}),
    ("Fast food restaurant", {"amenity": "fast_food"}),
    ("Hamburger restaurant", {"amenity": "fast_food", "cuisine": "burger"}),
    ("Ice cream shop", {"amenity": "ice_cream"}),
    ("Ice cream shop", {"shop": "ice_cream"}),
    ("Yoga studio", {"leisure": "fitness_centre", "sport": "yoga"}),
    ("Gym", {"leisure": "fitness_centre"}),
    ("Book store", {"shop": "books"}),
    ("Gift shop", {"shop": "gift"}),
    ("Art center", {"amenity": "arts_centre"}),
    ("Personal care", {"shop": "hairdresser"}),
    ("Barber shop", {"shop": "hairdresser", "hairdresser": "barber"}),
    ("Vegan", {"amenity": "restaurant", "diet:vegan": "only"}),
    ("Southern restaurant (US)", {"amenity": "restaurant", "cuisine": "soul_food"}),
    ("Brewery", {"craft": "brewery"}),
    ("Beer garden", {"amenity": "biergarten"}),
])
def test_osm_tags_that_make_a_place_of_the_kind(genre, tags):
    kind = osm.kind_of(genre)
    assert kind is not None and kind.matches(tags)


@pytest.mark.parametrize(("genre", "tags"), [
    ("Bakery", {"amenity": "restaurant", "cuisine": "mexican"}),  # a bakery by name only is not a bakery by its tags
    ("Bakery", {"amenity": "cafe", "cuisine": "coffee;pastry"}),  # a café that sells pastries
    ("Coffee shop", {"amenity": "cafe", "cuisine": "bubble_tea"}),
    ("Coffee shop", {"amenity": "cafe", "cuisine": "ice_cream"}),
    ("Cocktail Bar", {"amenity": "bar"}),  # a bar is not necessarily a cocktail bar
    ("Wine Bar", {"amenity": "bar", "drink:wine": "served"}),
    ("Sports Bar", {"amenity": "bar"}),
    ("Live music venue", {"amenity": "bar"}),
    ("Gym", {"leisure": "fitness_centre", "sport": "yoga"}),  # a yoga studio is not a gym
    ("Yoga studio", {"leisure": "fitness_centre"}),
    ("Tex-Mex", {"amenity": "restaurant", "cuisine": "mexican"}),
    ("Seafood", {"amenity": "restaurant", "cuisine": "sushi"}),
    ("Pub", {"amenity": "bar"}),
    ("Barber shop", {"shop": "hairdresser"}),
    ("Vegan", {"amenity": "restaurant", "diet:vegan": "yes"}),  # vegan options, not a vegan restaurant
])
def test_osm_tags_that_do_not(genre, tags):
    kind = osm.kind_of(genre)
    assert kind is not None and not kind.matches(tags)


@pytest.mark.parametrize("genre", [
    "New American", "Bar + Grill", "Bar & grill", "Takeout Restaurant", "Family restaurant", "Lunch restaurant",
    "Cultural center", "Board Game Cafe", "Wedding Bakery", "Snack bar", "Restaurant or cafe", "Club",
])
def test_kinds_no_tag_pins_down_are_not_mapped(genre):
    assert osm.kind_of(genre) is None


def test_genre_names_are_read_as_people_write_them():
    assert osm.kind_key("Bar + Grill") == osm.kind_key("Bar & grill") == "barandgrill"
    assert osm.kind_key("Southern restaurant (US)") == "southern"
    assert osm.kind_of("Book store") is osm.kind_of("Bookstore")
    assert osm.kind_of("Night Club") is osm.kind_of("Night club")
    assert osm.kind_of("Ice cream shop") is osm.kind_of("ice-cream  shop")
    assert osm.kind_of("A kind nobody maps") is None and osm.kind_of("") is None


def test_every_rule_reads_tags_the_query_keeps():
    query = osm.overpass_query(circle_catchment(*SITE, 10).ring)
    for key in osm.POI_KEYS:
        assert key in query
    assert osm.RULE_KEYS <= osm.KEEP_TAGS


# ---------- Names ----------

@pytest.mark.parametrize(("a", "b"), [
    ("Joe’s Bakery & Coffee Shop", "Joe's Bakery and Coffee Shop"),
    ("Joe's Bakery & Coffee Shop", "Joe's"),
    ("Café Olé", "Cafe Ole"),
    ("The Butcher's Daughter", "Butchers Daughter"),
    ("Mr. Natural", "Mr Natural"),
    ("Insomnia Cookies", "Insomnia Cookies - Austin"),
    ("Bufalina Due", "Bufalina"),
])
def test_names_that_name_one_place(a, b):
    assert osm.same_name(a, b)


@pytest.mark.parametrize(("a", "b"), [
    ("Uchi", "Uchiko"),
    ("Blue Bottle Coffee", "Blue Moon Bar"),
    ("The Bakery", "The Pizzeria"),
    ("Cisco's", "Joe's Bakery"),
])
def test_names_that_do_not(a, b):
    assert not osm.same_name(a, b)


def test_a_name_in_another_script_shows_in_english_and_matches_in_both():
    tags = {"name": "مقهى ريش", "name:en": "Cafe Riche", "amenity": "cafe"}
    assert osm.display_name(tags) == "Cafe Riche"
    assert osm.place_names(tags) == ["مقهى ريش", "Cafe Riche"]
    assert osm.display_name({"name": "Café de Flore", "name:en": "Flore Cafe"}) == "Café de Flore"


# ---------- Places ----------

def osm_place(index: int, name: str, at: tuple[float, float] = SITE, kind: str = "node", **tags) -> dict:
    return {"id": f"{kind}/{index}", "name": name, "names": [name], "lat": at[0], "lon": at[1],
            "tags": {"name": name, **tags}}


def test_the_places_of_a_kind_are_the_scanned_places_its_tags_match():
    scan = osm.Scan(True, [
        osm_place(1, "Joe’s Bakery & Coffee Shop", offset(300, 90), shop="bakery"),
        osm_place(2, "Insomnia Cookies", offset(200, 180), shop="pastry"),
        osm_place(3, "Corner Tacos", offset(100, 45), amenity="restaurant", cuisine="mexican"),
    ], as_of="2026-10-22T20:00:00Z")
    bakeries = [place for place in scan.places if osm.kind_of("Bakery").matches(place["tags"])]
    assert [place["name"] for place in bakeries] == ["Joe’s Bakery & Coffee Shop", "Insomnia Cookies"]
    assert [osm.main_tag(place["tags"]) for place in bakeries] == ["shop=bakery", "shop=pastry"]
    assert osm.place_url(bakeries[1]["id"]) == "https://www.openstreetmap.org/node/2"
    # The tacos place is no bakery, whatever it sells.
    assert [place["name"] for place in scan.places if osm.kind_of("Mexican").matches(place["tags"])] == ["Corner Tacos"]
    assert osm.main_tag({"name": "Nothing", "building": "yes"}) is None


def test_a_place_is_listed_once_when_it_is_drawn_twice_and_only_inside_the_area():
    walk = circle_catchment(*SITE, 10)
    near, building, far = offset(150, 30), offset(155, 30), offset(5000, 0)
    elements = osm.compact([
        {"type": "node", "id": 1, "lat": near[0], "lon": near[1], "tags": {"name": "Corner Crumb", "shop": "bakery"}},
        {"type": "way", "id": 2, "center": {"lat": building[0], "lon": building[1]},
         "tags": {"name": "Corner Crumb", "shop": "bakery", "building": "yes"}},
        {"type": "node", "id": 3, "lat": far[0], "lon": far[1], "tags": {"name": "Far Loaf", "shop": "bakery"}},
    ])
    assert [place["id"] for place in osm.places_inside(elements, walk.contains)] == ["node/1"]


# ---------- The query ----------

def test_a_long_ring_is_simplified_to_100_points_keeping_its_shape():
    lat, lon = SITE
    ring = [(lon + 0.01 * math.cos(2 * math.pi * i / 400) / math.cos(math.radians(lat)),
             lat + 0.01 * math.sin(2 * math.pi * i / 400)) for i in range(400)]
    ring.append(ring[0])
    simple = osm.simplify(ring)
    assert 3 <= len(simple) <= 100 and simple[0] == ring[0] and simple[-1] != simple[0]
    assert ring_area_m2(simple + [simple[0]], lat) == pytest.approx(ring_area_m2(ring, lat), rel=0.02)
    short = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 0.0)]
    assert osm.simplify(short) == short[:-1]


def test_the_query_asks_for_named_places_inside_the_polygon_in_lat_lon_order():
    walk = circle_catchment(*SITE, 10)
    query = osm.overpass_query(walk.ring)
    assert query.startswith("[out:json][timeout:10]") and query.endswith(");out center tags;")
    filters = query.split("(", 1)[1].split(");out")[0].split(";")
    assert [f.split('"]')[0] for f in filters if f] == [f'nw["{key}' for key in osm.POI_KEYS]
    assert all('"]["name"](poly:"' in f for f in filters if f)
    poly = query.split('poly:"')[1].split('"')[0].split()
    assert len(poly) == 2 * 40  # the circle's 40 points, without the closing one
    lon, lat = walk.ring[0]
    assert poly[:2] == [f"{lat:.5f}", f"{lon:.5f}"]


# ---------- The client ----------

def overpass_answer() -> dict:
    inside, also_inside, outside = offset(150, 30), offset(300, 200), offset(5000, 0)
    return {
        "osm3s": {"timestamp_osm_base": "2026-10-22T20:00:00Z"},
        "elements": [
            {"type": "node", "id": 1, "lat": inside[0], "lon": inside[1],
             "tags": {"name": "Corner Crumb", "shop": "bakery", "opening_hours": "Mo-Su 07:00-15:00"}},
            # The same bakery drawn as its building too.
            {"type": "way", "id": 2, "center": {"lat": inside[0] + 0.0001, "lon": inside[1]},
             "tags": {"name": "Corner Crumb", "shop": "bakery", "building": "yes"}},
            {"type": "way", "id": 3, "center": {"lat": also_inside[0], "lon": also_inside[1]},
             "tags": {"name": "Night Owl", "amenity": "nightclub"}},
            {"type": "node", "id": 4, "lat": outside[0], "lon": outside[1], "tags": {"name": "Far Bakery", "shop": "bakery"}},
            {"type": "node", "id": 5, "lat": inside[0], "lon": inside[1], "tags": {"shop": "bakery"}},
        ],
    }


def client(tmp_path, *answers, budget: float = osm.BUDGET_S) -> tuple[osm.OsmClient, list[httpx.Request]]:
    """An OsmClient whose instances answer in turn: a dict is a 200 answer, an int an HTTP status, an exception is raised."""
    seen: list[httpx.Request] = []
    queue = list(answers)

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        answer = queue.pop(0) if queue else 504
        if isinstance(answer, Exception):
            raise answer
        return httpx.Response(200, json=answer) if isinstance(answer, dict) else httpx.Response(answer)

    return osm.OsmClient(tmp_path, ENDPOINTS, budget=budget, transport=httpx.MockTransport(handle)), seen


def test_the_client_asks_the_next_instance_when_one_fails_and_caches_the_answer(tmp_path):
    walk = circle_catchment(*SITE, 10)
    client_, seen = client(tmp_path, 504, overpass_answer())
    scan = asyncio.run(client_.scan(walk))
    assert scan.checked and scan.source == "second.test" and scan.as_of == "2026-10-22T20:00:00Z"
    assert [(p["id"], p["name"]) for p in scan.places] == [("node/1", "Corner Crumb"), ("way/3", "Night Owl")]
    assert "opening_hours" not in scan.places[0]["tags"]  # only the tags the rules read are kept
    assert [str(r.url) for r in seen] == list(ENDPOINTS[:2])
    request = seen[1]
    assert "github.com/AhmedOsamaAli/threshold" in request.headers["user-agent"]
    assert request.method == "POST" and b"poly%3A" in request.content
    assert len(list(tmp_path.glob("*.json"))) == 1
    # A second scan of the same walk reads the cache; the instance that failed is asked last next time.
    again = asyncio.run(client_.scan(walk))
    assert again.places == scan.places and len(seen) == 2 and client_.cache_hits == 1
    assert client_._order() == [ENDPOINTS[1], ENDPOINTS[2], ENDPOINTS[0]]


@pytest.mark.parametrize("failure", [
    httpx.ConnectError("refused"),
    429,
    {"elements": [], "remark": "runtime error: Query timed out in \"query\" at line 1 after 11 seconds."},
    {"error": "no elements"},
    {"elements": [{"type": "node", "lat": 1.0, "lon": 2.0, "tags": {"name": "No id"}}]},
])
def test_when_no_instance_answers_the_scan_goes_on_unchecked(tmp_path, failure):
    client_, seen = client(tmp_path, failure, failure, failure, failure)
    walk = circle_catchment(*SITE, 10)
    scan = asyncio.run(client_.scan(walk))
    assert not scan.checked and scan.note == osm.NOTES["unavailable"] and len(seen) == 3
    assert not list(tmp_path.glob("*.json"))
    assert scan.reason == "unavailable" and scan.places == []
    # While every instance rests, a scan asks only the one that failed longest ago.
    assert client_._order() == [ENDPOINTS[0]]
    asyncio.run(client_.scan(walk))
    assert [str(r.url) for r in seen[3:]] == [ENDPOINTS[0]]


def test_an_old_answer_serves_when_every_instance_fails(tmp_path):
    walk = circle_catchment(*SITE, 10)
    client_, _ = client(tmp_path, overpass_answer())
    asyncio.run(client_.scan(walk))
    [cached] = tmp_path.glob("*.json")
    then = time.time() - osm.MAX_AGE_S - 3600
    os.utime(cached, (then, then))
    client_, seen = client(tmp_path, 504, 504, 504)
    scan = asyncio.run(client_.scan(walk))
    assert scan.checked and [p["name"] for p in scan.places] == ["Corner Crumb", "Night Owl"] and len(seen) == 3
    assert json.loads(cached.read_text(encoding="utf-8"))["source"] == "first.test"


def test_the_client_gives_up_when_its_time_is_spent(tmp_path):
    client_, seen = client(tmp_path, overpass_answer(), budget=0.5)
    scan = asyncio.run(client_.scan(circle_catchment(*SITE, 10)))
    assert not scan.checked and not seen
