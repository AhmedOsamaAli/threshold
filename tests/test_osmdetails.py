"""What OpenStreetMap's volunteers wrote down about a place, over a mock API: only what a visitor can use is kept, a website
is kept only when it is a web address, and when the API does not answer the places simply have no details."""
from __future__ import annotations

import asyncio

import httpx
import pytest

from app import osm
from app.osmdetails import ADDRESS_CHARS, HOURS_CHARS, MOST, WEBSITE_CHARS, OsmDetails, details_of


def test_the_details_a_visitor_can_use_are_kept():
    tags = {
        "name": "Corner Cafe", "amenity": "cafe", "opening_hours": "Mo-Fr 08:00-18:00; Sa 09:00-14:00",
        "website": "https://corner.example/menu", "phone": "+20 2 1234 5678",
        "addr:housenumber": "12", "addr:street": "26th of July Street", "addr:city": "Cairo",
    }
    assert details_of(tags) == {
        "hours": "Mo-Fr 08:00-18:00; Sa 09:00-14:00", "website": "https://corner.example/menu", "phone": "+20 2 1234 5678",
        "address": "12 26th of July Street, Cairo"}


def test_a_place_with_nothing_written_down_has_no_details():
    assert details_of({"name": "Corner Cafe", "amenity": "cafe", "cuisine": "coffee_shop"}) == {}


@pytest.mark.parametrize(("tags", "website"), [
    ({"website": "corner.example/menu"}, "https://corner.example/menu"),  # written without its scheme
    ({"contact:website": "http://corner.example"}, "http://corner.example"),
    ({"url": "https://corner.example"}, "https://corner.example"),
    ({"website": "javascript:alert(1)"}, None),
    ({"website": "data:text/html,<script>1</script>"}, None),
    ({"website": "ftp://corner.example"}, None),
    ({"website": "not a web address"}, None),
    ({"website": "localhost"}, None),
    ({"website": "javascript:alert(1)", "contact:website": "https://corner.example"}, "https://corner.example"),
])
def test_a_website_is_kept_only_when_it_is_a_web_address(tags, website):
    assert details_of(tags).get("website") == website


def test_long_texts_are_cut_and_blanks_are_dropped():
    found = details_of({"opening_hours": "Mo " * 200, "website": "https://corner.example/" + "a" * 400, "phone": "   ",
                        "addr:street": "Long Street " * 40, "addr:housenumber": "1"})
    assert len(found["hours"]) <= HOURS_CHARS and "phone" not in found
    assert len(found.get("website", "")) <= WEBSITE_CHARS and len(found["address"]) <= ADDRESS_CHARS


def test_a_town_alone_is_no_address():
    assert "address" not in details_of({"addr:city": "Cairo"})
    assert details_of({"addr:street": "Nile Corniche"})["address"] == "Nile Corniche"


def test_the_phone_may_be_the_contact_one():
    assert details_of({"contact:phone": "+1 555 0100"})["phone"] == "+1 555 0100"


# ---------- The client ----------

def api(answers: dict[str, object], seen: list[httpx.Request] | None = None):
    seen = seen if seen is not None else []

    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        assert request.headers["user-agent"] == osm.USER_AGENT
        answer = answers.get(request.url.path.rsplit("/", 1)[-1])
        if isinstance(answer, int):
            return httpx.Response(answer)
        if isinstance(answer, Exception):
            raise answer
        return httpx.Response(200, json=answer if answer is not None else {"elements": []})

    return httpx.MockTransport(handle), seen


def lookup(transport, *ids: str) -> dict:
    client = OsmDetails(transport=transport)
    return asyncio.run(client.lookup(ids))


def test_nodes_ways_and_relations_are_read_together_by_kind():
    transport, seen = api({
        "nodes.json": {"elements": [
            {"type": "node", "id": 11, "tags": {"name": "A", "opening_hours": "24/7"}},
            {"type": "node", "id": 12, "tags": {"name": "B"}},  # nothing worth keeping
            {"type": "node", "id": 13},  # no tags at all
        ]},
        "ways.json": {"elements": [{"type": "way", "id": 21, "tags": {"phone": "+1 555 0100"}}]},
    })
    found = lookup(transport, "node/11", "node/12", "node/13", "way/21", "relation/31")
    assert found == {"node/11": {"hours": "24/7"}, "way/21": {"phone": "+1 555 0100"}}
    asked = {request.url.path.rsplit("/", 1)[-1]: dict(request.url.params) for request in seen}
    assert asked == {"nodes.json": {"nodes": "11,12,13"}, "ways.json": {"ways": "21"}, "relations.json": {"relations": "31"}}


@pytest.mark.parametrize("bad", ["node/abc", "foo/1", "node/0", "node/-1", "node/1/2", "node/", "../node/1", "node/1;drop", ""])
def test_an_id_that_is_not_an_openstreetmap_element_is_never_asked_about(bad):
    transport, seen = api({})
    assert lookup(transport, bad) == {} and seen == []


def test_the_same_id_is_asked_once_and_no_more_than_most_are_asked():
    transport, seen = api({"nodes.json": {"elements": []}})
    lookup(transport, "node/5", "node/5", *[f"node/{n}" for n in range(100, 100 + 2 * MOST)])
    [request] = seen
    asked = request.url.params["nodes"].split(",")
    assert len(asked) == MOST and asked.count("5") == 1


@pytest.mark.parametrize("trouble", [503, 404, httpx.ConnectTimeout("slow"), httpx.ConnectError("no route")])
def test_when_the_api_does_not_answer_there_are_no_details_and_no_error(trouble):
    transport, _ = api({"nodes.json": trouble, "ways.json": {"elements": [{"type": "way", "id": 21, "tags": {"phone": "1"}}]}})
    assert lookup(transport, "node/11", "way/21") == {"way/21": {"phone": "1"}}  # one kind failing spares the other


def test_an_answer_that_is_not_json_is_no_details():
    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, content=b"<html>busy</html>")

    assert lookup(httpx.MockTransport(handle), "node/11") == {}


def test_an_element_shaped_unlike_any_seen_is_skipped():
    transport, _ = api({"nodes.json": {"elements": [None, "x", {"id": "11", "tags": {"phone": "1"}}, {"id": 12, "tags": ["a"]},
                                                     {"id": 13, "tags": {"phone": "+1 555 0100"}}]}})
    assert lookup(transport, "node/11", "node/12", "node/13") == {"node/13": {"phone": "+1 555 0100"}}
