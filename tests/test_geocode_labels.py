"""The address search's answers as people read them: asked in English, and a match's long line cut to a few words for a
sentence."""
from __future__ import annotations

import asyncio

import httpx
import pytest

from app.geocode import Geocoder, short_place


@pytest.mark.parametrize(("full", "short"), [
    ("Williamsburg, Brooklyn, Kings County, New York, 11249, United States", "Williamsburg, Brooklyn"),
    ("Williamsburg, Virginia, United States", "Williamsburg, Virginia"),
    ("Rockville, Montgomery County, Maryland, United States", "Rockville, Maryland"),
    ("East Austin, Austin, Travis County, Texas, 78702, United States", "East Austin, Austin"),
    ("Logan Square, Chicago, West Chicago Township, Cook County, Illinois, 60647, United States", "Logan Square, Chicago"),
    ("Zamalek, Cairo, Cairo Governorate, 11561, Egypt", "Zamalek, Cairo"),
    ("Kreuzberg, Friedrichshain-Kreuzberg, Berlin, 10999, Germany", "Kreuzberg, Friedrichshain-Kreuzberg"),
    ("Paris, France", "Paris, France"),
    ("Testville, Testville", "Testville, Testville"),
    ("Zamalek", "Zamalek"),
    ("", ""),
    (None, ""),
])
def test_a_long_line_is_cut_to_the_first_two_parts_that_name_a_place(full, short):
    assert short_place(full) == short


def test_a_line_of_nothing_but_counties_and_numbers_is_cut_by_position_instead():
    assert short_place("Cook County, 60647, Region 4, United States") == "Cook County, 60647"


def test_the_search_asks_nominatim_in_english_and_keeps_the_answer():
    asked: list[httpx.Request] = []

    def answer(request: httpx.Request) -> httpx.Response:
        asked.append(request)
        return httpx.Response(200, json=[{"display_name": "Zamalek, Cairo, Egypt", "lat": "30.06", "lon": "31.22"}])

    async def scenario() -> list[dict]:
        geocoder = Geocoder(httpx.AsyncClient(base_url="https://nominatim.test", transport=httpx.MockTransport(answer)))
        try:
            first = await geocoder.search("Zamalek")
            assert await geocoder.search(" zamalek ") == first
            return first
        finally:
            await geocoder.aclose()

    assert asyncio.run(scenario()) == [{"label": "Zamalek, Cairo, Egypt", "lat": 30.06, "lon": 31.22}]
    assert len(asked) == 1  # the same words, however they are cased, are read from the cache
    assert asked[0].url.path == "/search" and asked[0].headers["Accept-Language"] == "en"
