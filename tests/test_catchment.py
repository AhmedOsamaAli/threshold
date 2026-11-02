import asyncio
import json
import math

import httpx
import pytest

from app import catchment as walk


def test_circle_ring_area_matches_pi_r_squared():
    ring = walk.circle_ring(40.0, -73.0, 800, vertices=72)
    area = walk.ring_area_m2(ring, 40.0)
    expected = math.pi * 800**2
    assert abs(area - expected) / expected < 0.01


def test_point_in_ring():
    ring = walk.circle_ring(40.0, -73.0, 800)
    assert walk.point_in_ring(40.0, -73.0, ring)
    assert not walk.point_in_ring(40.02, -73.0, ring)


def test_parse_isochrone_keeps_largest_ring_and_closes_it():
    data = {"features": [{"geometry": {"type": "MultiPolygon", "coordinates": [
        [[[0, 0], [1, 0], [1, 1]]],
        [[[0, 0], [2, 0], [2, 2], [0, 2]]],
    ]}}]}
    ring = walk.parse_isochrone(data)
    assert ring[0] == ring[-1]
    assert len(ring) == 5


def test_parse_isochrone_rejects_empty_payloads():
    assert walk.parse_isochrone({}) is None
    assert walk.parse_isochrone({"features": [{"geometry": {"type": "Polygon", "coordinates": [[[0, 0]]]}}]}) is None


def test_circle_catchment_shape():
    catchment = walk.circle_catchment(40.0, -73.0, 10)
    assert catchment.source == "circle"
    assert 780 <= catchment.radius_m <= 800
    public = catchment.public()
    assert public["minutes"] == 10
    assert public["ring"][0] == [catchment.ring[0][1], catchment.ring[0][0]]
    assert catchment.contains(40.0, -73.0)


def contour(minutes: int, radius_m: float) -> dict:
    ring = walk.circle_ring(40.0, -73.0, radius_m)
    return {"properties": {"contour": float(minutes)}, "geometry": {"type": "Polygon", "coordinates": [[list(p) for p in ring]]}}


def service(tmp_path, reply: dict | None, seen: list | None = None) -> walk.CatchmentService:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(json.loads(request.content))
        return httpx.Response(200, json=reply) if reply is not None else httpx.Response(503)

    svc = walk.CatchmentService(tmp_path)
    svc._http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return svc


def test_one_request_traces_the_walk_and_the_longer_walk_supply_is_compared_with(tmp_path):
    seen: list = []
    # Valhalla sends the larger contour first.
    svc = service(tmp_path, {"features": [contour(20, 1300), contour(10, 700)]}, seen)
    got = asyncio.run(svc.walk(40.0, -73.0, 10))
    assert [c["time"] for c in seen[0]["contours"]] == [10, 20]
    assert got.source == "street network" and 690 <= got.radius_m <= 710
    assert math.isclose(got.around_area_m2, math.pi * 1300 ** 2, rel_tol=0.02)
    # Both come back from the cache, without another request.
    again = asyncio.run(service(tmp_path, None).walk(40.0, -73.0, 10))
    assert again.ring == got.ring and again.around == got.around


def test_a_walk_cached_before_the_around_area_is_traced_again(tmp_path):
    old = walk.circle_ring(40.0, -73.0, 700)
    key = __import__("hashlib").sha1(b"40.00000,-73.00000,10").hexdigest()
    (tmp_path / f"walk-{key}.json").write_text(json.dumps({"source": "street network", "ring": old}), encoding="utf-8")
    got = asyncio.run(service(tmp_path, {"features": [contour(20, 1300), contour(10, 700)]}).walk(40.0, -73.0, 10))
    assert got.around is not None


def test_without_routing_the_walk_is_a_circle_and_nothing_is_cached(tmp_path):
    got = asyncio.run(service(tmp_path, None).walk(40.0, -73.0, 10))
    assert got.source == "circle" and got.around is None and not list(tmp_path.iterdir())
    # A walk without a believable longer walk keeps the walk, and is cached that way: supply then uses the circle.
    small = asyncio.run(service(tmp_path, {"features": [contour(20, 100), contour(10, 700)]}).walk(40.0, -73.0, 10))
    assert small.source == "street network" and small.around is None
    assert asyncio.run(service(tmp_path, None).walk(40.0, -73.0, 10)).ring == small.ring


def test_a_walk_cached_before_the_around_area_survives_a_routing_failure(tmp_path):
    old = walk.circle_ring(40.0, -73.0, 650)
    key = __import__("hashlib").sha1(b"40.00000,-73.00000,10").hexdigest()
    (tmp_path / f"walk-{key}.json").write_text(json.dumps({"source": "street network", "ring": old}), encoding="utf-8")
    got = asyncio.run(service(tmp_path, None).walk(40.0, -73.0, 10))
    assert got.source == "street network" and got.ring == [tuple(p) for p in old] and got.around is None


def test_parse_isochrone_picks_a_contour_by_its_minutes():
    data = {"features": [contour(20, 1300), contour(10, 700)]}
    ten, twenty = walk.parse_isochrone(data, 10), walk.parse_isochrone(data, 20)
    assert walk.ring_area_m2(ten, 40.0) < walk.ring_area_m2(twenty, 40.0)
    assert walk.parse_isochrone(data, 15) is None


def test_a_decimal_road_distance_matches_valhallas_contour_cut_to_two_decimals():
    ring = walk.circle_ring(40.0, -73.0, 1500)
    data = {"features": [{"properties": {"contour": 2.29},
                          "geometry": {"type": "Polygon", "coordinates": [[list(p) for p in ring]]}}]}
    assert walk.parse_isochrone(data, 2.3) is not None
    assert walk.parse_isochrone(data, 2.4) is None


# ---------- The area: walk, drive or road distance ----------

def test_the_area_names_itself_in_sentences_and_chips():
    assert walk.Reach("walk", 10).label == "10-minute walk" and walk.Reach("walk", 10).short == "10-min walk"
    assert walk.Reach("drive", 30).label == "30-minute drive" and walk.Reach("drive", 30).short == "30-min drive"
    assert walk.Reach("distance", 10, 25.0).label == "25 km drive" and walk.Reach("distance", 10, 2.5).label == "2.5 km drive"
    assert walk.area_text(10) == "10-minute walk" and walk.area_text("30-minute drive") == "30-minute drive"


def test_the_area_compared_with_is_twice_as_long_within_what_the_router_answers():
    assert walk.Reach("walk", 10).around == walk.Reach("walk", 20)
    assert walk.Reach("drive", 40).around == walk.Reach("drive", 60)  # capped at the router's 60 minutes
    assert walk.Reach("drive", 60).around is None
    assert walk.Reach("distance", 10, 30.0).around.km == 60.0
    assert walk.Reach("distance", 10, 100.0).around is None


@pytest.mark.parametrize("travel, minutes, km, message", [
    ("walk", 4, None, "Walk time must be 5 to 60 minutes"),
    ("drive", 90, None, "Drive time must be 5 to 60 minutes"),
    ("distance", 10, None, "A road distance must be 1 to 100 km"),
    ("distance", 10, 150, "A road distance must be 1 to 100 km"),
    ("boat", 10, None, "The area must be a walk, a drive or a road distance"),
])
def test_an_area_the_router_cannot_trace_is_refused_in_plain_words(travel, minutes, km, message):
    with pytest.raises(ValueError, match=message):
        walk.make_reach(travel, minutes, km)


def test_a_custom_walk_or_distance_is_kept_as_asked():
    assert walk.make_reach("walk", 7) == walk.Reach("walk", 7)
    assert walk.make_reach("distance", None, 12.34) == walk.Reach("distance", 10, 12.3)


def test_a_drive_is_traced_by_car_with_its_longer_drive(tmp_path):
    seen: list = []
    reply = {"features": [contour(40, 16_000), contour(20, 9_000)]}
    got = asyncio.run(service(tmp_path, reply, seen).area(40.0, -73.0, walk.Reach("drive", 20)))
    assert seen[0]["costing"] == "auto" and seen[0]["contours"] == [{"time": 20}, {"time": 40}]
    assert got.source == "street network" and got.travel == "drive" and got.label == "20-minute drive"
    assert got.around is not None and got.around_label == "40-minute drive"
    public = got.public()
    assert public["travel"] == "drive" and public["label"] == "20-minute drive" and public["short"] == "20-min drive"


def test_a_road_distance_is_traced_as_a_distance_and_cached_apart_from_walks(tmp_path):
    seen: list = []
    reply = {"features": [contour(25, 18_000)]}
    got = asyncio.run(service(tmp_path, reply, seen).area(40.0, -73.0, walk.Reach("distance", 10, 25.0)))
    assert seen[0]["contours"] == [{"distance": 25.0}, {"distance": 50.0}]
    assert got.travel == "distance" and got.km == 25.0 and got.label == "25 km drive"
    # Without the longer outline, a circle stands in for it, and the words say so.
    assert got.around is None and got.around_label == "area twice as wide as the 25 km drive"
    again = asyncio.run(service(tmp_path, None, []).area(40.0, -73.0, walk.Reach("distance", 10, 25.0)))
    assert again.ring == got.ring
    assert asyncio.run(service(tmp_path, None, []).walk(40.0, -73.0, 10)).source == "circle"  # not the drive's outline


def test_without_routing_a_drive_falls_back_to_a_circle_sized_for_driving(tmp_path):
    got = asyncio.run(service(tmp_path, None, []).area(40.0, -73.0, walk.Reach("drive", 10)))
    assert got.source == "circle" and got.travel == "drive"
    assert 3_900 <= got.radius_m <= 4_000  # 400 m a minute
    road = walk.circle_catchment(40.0, -73.0, 10, walk.Reach("distance", 10, 20.0))
    assert 13_800 <= road.radius_m <= 14_000  # 0.7 of the road distance


def test_drive_and_distance_outlines_have_believable_sizes():
    city_drive = walk.circle_ring(40.0, -73.0, 6_000)
    assert walk.plausible(city_drive, 40.0, 10, walk.Reach("drive", 10))
    assert not walk.plausible(walk.circle_ring(40.0, -73.0, 40), 40.0, 10, walk.Reach("drive", 10))
    assert not walk.plausible(walk.circle_ring(40.0, -73.0, 30_000), 40.0, 10, walk.Reach("distance", 10, 20.0))
