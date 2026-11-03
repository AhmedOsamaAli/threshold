"""Check a spot over fake map services: what OpenStreetMap lists inside a walk of an address, for one kind of business. The
cases that matter are the honest ones: places outside the walking area are not counted, a kind no single tag pins down gets
no count, and when OpenStreetMap does not answer there is no number at all."""
from __future__ import annotations

import asyncio
from datetime import UTC, datetime

import httpx
import pytest

from app import osm, spot
from app.catchment import circle_catchment
from app.payments.records import KINDS
from app.ratelimit import RateLimiter
from app.services import Services
from tests import account_fakes
from tests.fakes import SITE, FakeWalker, StubGeocoder, offset

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=UTC)
KEYS = {"place", "kind", "walk_minutes", "checked", "reason", "same_kind", "around", "area", "summary", "source", "checked_at", "note"}


def place(index: int, name: str, metres: float, bearing: float = 0, **tags: str) -> dict:
    """A place OpenStreetMap lists `metres` from the test site, as osm.places_inside gives it."""
    lat, lon = offset(metres, bearing)
    return {"id": f"node/{index}", "name": name, "names": [name], "lat": lat, "lon": lon, "tags": {"name": name, **tags}}


class FakeOsm:
    """OpenStreetMap's places, those inside the area a scan is asked about. With `remember`, an answer once given is kept,
    as the real client's cache keeps it, so a scan that outlasted its visitor leaves its answer for the next ask."""

    def __init__(self, *places: dict, checked: bool = True, note: str | None = None, delay: float = 0.0,
                 as_of: str | None = "2026-11-01T06:00:00Z", remember: bool = False, fail: bool = False) -> None:
        self.places, self.checked, self.note, self.delay, self.as_of = list(places), checked, note, delay, as_of
        self.remember, self.fail, self._kept = remember, fail, None
        self.calls = 0

    async def scan(self, catchment) -> osm.Scan:
        self.calls += 1
        if self._kept is not None:
            return self._kept
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail:
            raise RuntimeError("an answer shaped unlike any seen")
        if not self.checked:
            return osm.Scan(False, note=self.note or osm.NOTES["unavailable"])
        found = osm.Scan(True, [p for p in self.places if catchment.contains(p["lat"], p["lon"])], "https://overpass.test", self.as_of)
        if self.remember:
            self._kept = found
        return found

    async def aclose(self) -> None:
        pass


class StreetWalker(FakeWalker):
    """A router that answers: the walking area follows the streets (here, as a circle of the same size)."""

    async def walk(self, lat: float, lon: float, minutes: int = 10):
        area = circle_catchment(lat, lon, minutes)
        area.source = "street network"
        return area


class NoAddress(StubGeocoder):
    async def search(self, query: str) -> list[dict]:
        return []


class AddressDown(StubGeocoder):
    async def search(self, query: str) -> list[dict]:
        raise httpx.ConnectError("no route")


def services(fake: FakeOsm | None, walker=None, geocoder=None) -> Services:
    return Services(walker=walker or StreetWalker(), llm=account_fakes.LLM("", None, "test-model"), geocoder=geocoder or StubGeocoder(), osm=fake)


def check(fake: FakeOsm | None, kind: str = "bakery", walker=None) -> dict:
    return asyncio.run(spot.check_spot(services(fake, walker), SITE[0], SITE[1], kind, "1 Test Street", NOW))


BAKERIES = (
    place(1, "Far Loaf", 700, 90, shop="bakery"),
    place(2, "Near Loaf", 150, 0, shop="bakery"),
    place(3, "Sweet Pastry", 420, 180, shop="pastry"),
    place(4, "Out Of Reach", 1200, 0, shop="bakery"),  # outside a 10-minute walk
    place(5, "Corner Cafe", 100, 270, amenity="cafe"),
    place(6, "Car Park", 50, 0, amenity="parking"),  # named in OpenStreetMap, no one's competition
    place(7, "Town School", 80, 0, amenity="school"),
)


def test_the_places_of_the_kind_inside_the_walk_are_counted_and_listed_nearest_first():
    answer = check(FakeOsm(*BAKERIES))
    assert answer["checked"] is True and answer["reason"] is None and set(answer) == KEYS
    assert answer["same_kind"]["count"] == 3
    assert [(p["name"], p["kind"]) for p in answer["same_kind"]["nearest"]] == [
        ("Near Loaf", "bakery"), ("Sweet Pastry", "bakery"), ("Far Loaf", "bakery")]
    assert [p["distance_m"] for p in answer["same_kind"]["nearest"]] == pytest.approx([150, 420, 700], abs=3)
    assert answer["around"]["count"] == 4  # three bakeries and the cafe: a car park and a school are no business
    assert answer["around"]["top_kinds"] == [{"kind": "bakery", "count": 3}, {"kind": "café", "count": 1}]
    assert answer["summary"] == "3 bakeries are listed inside a 10-minute walk of this address; the nearest is 150 m away."
    assert (answer["place"], answer["kind"], answer["walk_minutes"]) == (
        {"label": "1 Test Street", "lat": SITE[0], "lon": SITE[1]}, "bakery", 10)
    assert answer["source"] == {"name": "OpenStreetMap contributors", "url": "https://www.openstreetmap.org/copyright",
                                "as_of": "2026-11-01T06:00:00Z"}
    assert answer["checked_at"] == "2026-11-03T12:00:00+00:00"
    assert answer["note"].startswith("This shows what is open nearby, not what people want. Pledges measure demand.")
    assert "incomplete" in answer["note"]


def test_the_walking_area_and_the_places_on_it_are_drawn_from_what_was_counted():
    answer = check(FakeOsm(*BAKERIES))
    ring = answer["area"]["ring"]
    assert answer["area"]["source"] == "walk" and 3 <= len(ring) <= spot.RING_POINTS
    assert all(len(point) == 2 and -90 <= point[0] <= 90 and -180 <= point[1] <= 180 for point in ring)
    dots = answer["around"]["dots"]
    assert [dot[2] for dot in dots] == [1, 1, 1, 0] and all(len(dot) == 3 for dot in dots)  # the kind's own first
    assert len(dots) == answer["around"]["count"]


@pytest.mark.parametrize(("kind", "tags", "decoy"), [
    ("cafe", {"amenity": "cafe"}, {"shop": "bakery"}),
    ("restaurant", {"amenity": "restaurant"}, {"amenity": "cafe"}),
    ("bakery", {"shop": "bakery"}, {"amenity": "cafe"}),
    ("bar", {"amenity": "pub"}, {"amenity": "restaurant"}),
    ("gym", {"leisure": "fitness_centre"}, {"leisure": "fitness_centre", "sport": "yoga"}),
    ("studio", {"leisure": "fitness_centre", "sport": "yoga"}, {"shop": "books"}),
    ("studio", {"amenity": "dancing_school"}, {"shop": "books"}),
    ("salon", {"shop": "hairdresser"}, {"shop": "hairdresser", "hairdresser": "barber"}),
    ("barber", {"shop": "hairdresser", "hairdresser": "barber"}, {"shop": "hairdresser"}),
    ("bookstore", {"shop": "books"}, {"shop": "bakery"}),
    ("grocery", {"shop": "supermarket"}, {"shop": "convenience"}),
])
def test_each_kind_of_business_is_found_by_its_own_tags_and_not_by_a_look_alike(kind, tags, decoy):
    answer = check(FakeOsm(place(1, "The One", 100, **tags), place(2, "The Decoy", 200, **decoy)), kind)
    assert [p["name"] for p in answer["same_kind"]["nearest"]] == ["The One"] and answer["same_kind"]["count"] == 1
    assert answer["around"]["count"] == 2


def test_kinds_no_single_tag_pins_down_get_no_count_of_their_own_but_what_is_around_is_still_shown():
    answer = check(FakeOsm(*BAKERIES), "shop")
    assert answer["checked"] is True and answer["same_kind"] is None and answer["around"]["count"] == 4
    assert [dot[2] for dot in answer["around"]["dots"]] == [0, 0, 0, 0]
    assert answer["summary"] == ("OpenStreetMap has no single tag for shop businesses, so there is no count of their own kind to "
                                 "compare. 4 businesses are listed inside a 10-minute walk of this address.")


def test_every_kind_of_business_the_product_knows_is_either_checked_or_said_to_be_unmapped():
    assert set(KINDS) == set(spot.SPOT_KINDS) | set(spot.UNMAPPED) and not set(spot.SPOT_KINDS) & set(spot.UNMAPPED)
    assert all(spec.tags and spec.singular and spec.plural for spec in spot.SPOT_KINDS.values())


def test_a_rule_that_reads_a_tag_the_query_drops_is_refused_when_it_is_written():
    assert osm.kind_from("ok", ["amenity=restaurant"]).matches({"amenity": "restaurant"})
    with pytest.raises(ValueError, match="does not keep"):
        osm.kind_from("bad", ["wheelchair=yes"])


@pytest.mark.parametrize(("count", "nearest", "words"), [
    (0, [], "OpenStreetMap lists no bakeries inside a 10-minute walk of this address. OpenStreetMap is mapped by volunteers"),
    (1, [{"distance_m": 184}], "One bakery is listed inside a 10-minute walk of this address, 180 m away."),
    (2, [{"distance_m": 1234}, {"distance_m": 2000}],
     "2 bakeries are listed inside a 10-minute walk of this address; the nearest is 1.2 km away."),
])
def test_the_sentence_is_written_from_the_numbers(count, nearest, words):
    assert spot.summary_of(spot.SPOT_KINDS["bakery"], "bakery", count, 9, nearest, circle=False).startswith(words)


def test_a_circle_for_the_walking_area_is_said_in_the_sentence_and_the_note():
    answer = check(FakeOsm(*BAKERIES), walker=FakeWalker())
    assert answer["area"]["source"] == "circle"
    assert "(a circle, not the streets)" in answer["summary"] and "a circle of the same walking radius" in answer["note"]
    assert check(FakeOsm(*BAKERIES))["area"]["source"] == "walk"


@pytest.mark.parametrize(("metres", "text"), [(3, "10 m"), (184, "180 m"), (186, "190 m"), (994, "990 m"), (995, "1.0 km"), (1234, "1.2 km")])
def test_distances_are_to_the_nearest_ten_metres_then_in_kilometres(metres, text):
    assert spot.distance_text(metres) == text


def test_when_openstreetmap_does_not_answer_the_check_carries_no_number_at_all():
    answer = check(FakeOsm(*BAKERIES, checked=False))
    assert answer["checked"] is False and answer["reason"] == "OpenStreetMap did not answer in time."
    assert answer["same_kind"] is None and answer["around"] is None and answer["area"] is None
    assert answer["summary"] == "Could not check this spot right now: OpenStreetMap did not answer in time."
    assert set(answer) == KEYS and "3" not in answer["summary"]
    assert check(FakeOsm(checked=False, note="The area is too large for OpenStreetMap's free servers."))["reason"].startswith("The area is too large")


def test_a_check_that_takes_too_long_is_unchecked_not_slow(monkeypatch):
    monkeypatch.setattr(spot, "TOTAL_SECONDS", 0.05)
    answer = check(FakeOsm(*BAKERIES, delay=2.0))
    assert answer["checked"] is False and answer["reason"] == spot.SLOW and answer["same_kind"] is None
    assert "ask again in a minute" in answer["summary"]


def test_a_slow_check_goes_on_in_the_background_and_the_next_ask_finds_its_answer(monkeypatch):
    monkeypatch.setattr(spot, "TOTAL_SECONDS", 0.05)
    fake = FakeOsm(*BAKERIES, delay=0.3, remember=True)

    async def twice() -> tuple[dict, dict]:
        sv = services(fake)
        first = await spot.check_spot(sv, SITE[0], SITE[1], "bakery", "1 Test Street", NOW)
        await asyncio.sleep(0.6)  # the visitor goes away and comes back; the check finishes meanwhile
        return first, await spot.check_spot(sv, SITE[0], SITE[1], "bakery", "1 Test Street", NOW)

    first, second = asyncio.run(twice())
    assert (first["checked"], first["reason"]) == (False, spot.SLOW)
    assert second["checked"] is True and second["same_kind"]["count"] == 3 and fake.calls == 2


def test_a_scan_that_fails_in_a_way_nobody_expected_still_gives_no_numbers():
    answer = check(FakeOsm(*BAKERIES, fail=True))
    assert answer["checked"] is False and answer["reason"] == osm.NOTES["unavailable"] and answer["around"] is None


def test_a_server_without_openstreetmap_says_so_instead_of_counting():
    answer = check(None)
    assert answer["checked"] is False and answer["reason"] == "OpenStreetMap places are not set up on this server."


def test_names_from_openstreetmap_are_kept_as_text_of_bounded_length():
    wild = place(1, "Bad\nName\t" + "x" * 300, 100, shop="bakery")
    [shown] = check(FakeOsm(wild))["same_kind"]["nearest"]
    assert "\n" not in shown["name"] and "\t" not in shown["name"] and len(shown["name"]) <= 80


def test_the_busiest_kinds_and_the_dots_are_bounded():
    crowd = [place(i, f"Place {i}", 10 + i, i * 7 % 360, shop=f"kind{i % 9}") for i in range(200)]
    answer = check(FakeOsm(*crowd), "bakery")
    assert len(answer["around"]["top_kinds"]) == spot.TOP_KINDS and len(answer["around"]["dots"]) == spot.DOTS
    assert answer["around"]["count"] == 200 and answer["same_kind"]["count"] == 0 and answer["same_kind"]["nearest"] == []


# The endpoint

def spot_client(fake: FakeOsm | None, geocoder=None):
    """The app with this OpenStreetMap, a router that answers and, when given, this address search."""
    client = account_fakes.make_client(services={"osm": fake})
    return SpotApp(client, geocoder)


class SpotApp:
    def __init__(self, client, geocoder) -> None:
        self.client, self.geocoder = client, geocoder

    def __enter__(self):
        client = self.client.__enter__()
        client.app.state.services.walker = StreetWalker()
        if self.geocoder is not None:
            client.app.state.services.geocoder = self.geocoder
        return client

    def __exit__(self, *error):
        return self.client.__exit__(*error)


def test_an_address_is_found_and_checked_and_the_answer_has_exactly_the_documented_keys():
    fake = FakeOsm(*BAKERIES)
    with spot_client(fake) as client:
        response = client.get("/api/spot", params={"address": "Crumb Street 1", "kind": "bakery"})
        assert response.status_code == 200 and response.headers["cache-control"] == "no-store"
        answer = response.json()
        assert set(answer) == KEYS and answer["place"] == {"label": "Crumb Street 1, Testville", "lat": SITE[0], "lon": SITE[1]}
        assert answer["same_kind"]["count"] == 3 and answer["checked"] is True


def test_a_point_is_checked_without_an_address_search():
    with spot_client(FakeOsm(*BAKERIES), geocoder=AddressDown()) as client:
        answer = client.get("/api/spot", params={"lat": SITE[0], "lon": SITE[1], "kind": "bakery"}).json()
        assert answer["place"]["label"] == "40.00000, -73.00000" and answer["same_kind"]["count"] == 3


@pytest.mark.parametrize("params", [
    {"kind": "bakery"},
    {"kind": "bakery", "address": "Crumb Street", "lat": 40, "lon": -73},
    {"kind": "bakery", "lat": 40},
    {"kind": "bakery", "lon": -73},
    {"address": "Crumb Street"},
    {"kind": "casino", "address": "Crumb Street"},
    {"kind": "bakery", "address": "ab"},
    {"kind": "bakery", "address": "   "},
    {"kind": "bakery", "lat": 91, "lon": 0},
    {"kind": "bakery", "lat": 0, "lon": 181},
])
def test_the_endpoint_wants_a_kind_and_either_an_address_or_a_point(params):
    fake = FakeOsm(*BAKERIES)
    with spot_client(fake) as client:
        assert client.get("/api/spot", params=params).status_code == 422 and fake.calls == 0


def test_an_address_nobody_knows_and_an_address_search_that_is_down_are_told_apart():
    fake = FakeOsm(*BAKERIES)
    with spot_client(fake, geocoder=NoAddress()) as client:
        missing = client.get("/api/spot", params={"address": "Nowhereville", "kind": "bakery"})
        assert missing.status_code == 404 and "No place found" in missing.json()["detail"]
    with spot_client(fake, geocoder=AddressDown()) as client:
        down = client.get("/api/spot", params={"address": "Crumb Street", "kind": "bakery"})
        assert down.status_code == 502 and down.json()["detail"] == "Address search is unavailable right now."
    assert fake.calls == 0


def test_a_check_that_worked_is_kept_for_a_day_and_one_that_did_not_is_never_kept():
    fake = FakeOsm(*BAKERIES)
    with spot_client(fake) as client:
        first = client.get("/api/spot", params={"address": "Crumb Street 1", "kind": "bakery"}).json()
        second = client.get("/api/spot", params={"address": "Crumb Street 1", "kind": "bakery"}).json()
        assert fake.calls == 1 and second == first
        other_kind = client.get("/api/spot", params={"address": "Crumb Street 1", "kind": "cafe"}).json()
        assert fake.calls == 2 and other_kind["kind"] == "cafe"
        relabelled = client.get("/api/spot", params={"lat": SITE[0], "lon": SITE[1], "kind": "bakery"}).json()
        assert fake.calls == 2 and relabelled["place"]["label"] == "40.00000, -73.00000" and relabelled["same_kind"] == first["same_kind"]
    down = FakeOsm(*BAKERIES, checked=False)
    with spot_client(down) as client:
        assert client.get("/api/spot", params={"address": "Crumb Street 1", "kind": "bakery"}).json()["checked"] is False
        client.get("/api/spot", params={"address": "Crumb Street 1", "kind": "bakery"})
        assert down.calls == 2


def test_the_kept_checks_are_bounded_and_expire():
    book = spot.SpotBook(kept_for=0.0, most=3)
    answer = {"checked": True}
    book.put(1.0, 2.0, "bakery", answer)
    assert book.get(1.0, 2.0, "bakery") is None  # past its time at once
    book = spot.SpotBook(most=3)
    for n in range(5):
        book.put(float(n), 0.0, "bakery", answer)
    assert len(book._kept) <= 3 and book.get(4.0, 0.0, "bakery") == answer
    book.put(9.0, 9.0, "bakery", {"checked": False})
    assert book.get(9.0, 9.0, "bakery") is None


def test_checks_are_limited_per_address():
    with spot_client(FakeOsm(*BAKERIES)) as client:
        client.app.state.spot_limiter = RateLimiter(2, 3600)
        params = {"address": "Crumb Street 1", "kind": "bakery"}
        assert [client.get("/api/spot", params=params).status_code for _ in range(3)] == [200, 200, 429]
