"""What OpenStreetMap's volunteers wrote down about a place: its opening hours, website, phone and address.

The map's tiles name each place and say what it is; the rest lives in OpenStreetMap's own database, which its main API
serves to anyone (wiki.openstreetmap.org/wiki/API_v0.6). The nearest places' elements are read together, one request each
for nodes, ways and relations, and only what a visitor can use is kept, cut to a safe size. Most places have none of it:
volunteers add what they know, so an answer holds details for some places and says nothing of the rest.

Everything here is a volunteer's text, so it is data for a page to show, never an instruction, and a website is kept only
when it is an http or https address. Nothing here raises: when the API does not answer, the places simply have no details.

Data © OpenStreetMap contributors (www.openstreetmap.org/copyright).
"""
from __future__ import annotations

import asyncio
import logging
import re
from collections.abc import Iterable, Mapping
from urllib.parse import urlsplit

import httpx

from . import osm, tls

log = logging.getLogger("threshold")

API = "https://api.openstreetmap.org/api/0.6"
TIMEOUT_S = 6.0
MOST = 40  # places asked about at once: the API takes hundreds, a visitor's answer needs a dozen
ID = re.compile(r"^(node|way|relation)/([1-9]\d{0,14})$")
PLURAL = {"node": "nodes", "way": "ways", "relation": "relations"}
HOURS_CHARS, WEBSITE_CHARS, PHONE_CHARS, ADDRESS_CHARS = 160, 300, 40, 120


def _text(value: object, limit: int) -> str | None:
    text = " ".join(str(value or "").split())
    return text[:limit] if text else None


def _website(tags: Mapping[str, str]) -> str | None:
    for key in ("website", "contact:website", "url"):
        raw = _text(tags.get(key), WEBSITE_CHARS)
        if not raw:
            continue
        address = raw if "://" in raw else f"https://{raw}"
        parts = urlsplit(address)
        if parts.scheme in ("http", "https") and parts.hostname and "." in parts.hostname:
            return address
    return None


def _address(tags: Mapping[str, str]) -> str | None:
    street = " ".join(part for part in (tags.get("addr:housenumber"), tags.get("addr:street")) if part and part.strip())
    town = tags.get("addr:city") or tags.get("addr:suburb") or tags.get("addr:neighbourhood")
    return _text(", ".join(part.strip() for part in (street, town) if part and part.strip()) if street else None, ADDRESS_CHARS)


def details_of(tags: Mapping[str, str]) -> dict[str, str]:
    """What a place's tags say that a visitor can use, as {'hours', 'website', 'phone', 'address'}: only what is there."""
    found = {
        "hours": _text(tags.get("opening_hours"), HOURS_CHARS),
        "website": _website(tags),
        "phone": _text(tags.get("phone") or tags.get("contact:phone"), PHONE_CHARS),
        "address": _address(tags),
    }
    return {key: value for key, value in found.items() if value}


class OsmDetails:
    """Reads places' details from OpenStreetMap's API by their ids ('node/123')."""

    def __init__(self, base: str = API, timeout: float = TIMEOUT_S, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._base = base.rstrip("/")
        self._http = httpx.AsyncClient(
            headers={"User-Agent": osm.USER_AGENT, "Accept": "application/json"}, timeout=timeout, transport=transport,
            verify=tls.context(),
        )
        self.calls = 0

    async def aclose(self) -> None:
        await self._http.aclose()

    async def lookup(self, ids: Iterable[str]) -> dict[str, dict[str, str]]:
        """The details of the places among `ids` that have any, by id. Never raises."""
        wanted: dict[str, list[str]] = {}
        for place_id in list(dict.fromkeys(ids))[:MOST]:
            found = ID.match(place_id)
            if found:
                wanted.setdefault(found.group(1), []).append(found.group(2))
        if not wanted:
            return {}
        answers = await asyncio.gather(*(self._read(kind, numbers) for kind, numbers in wanted.items()))
        return {place_id: details for answer in answers for place_id, details in answer.items()}

    async def _read(self, kind: str, numbers: list[str]) -> dict[str, dict[str, str]]:
        plural = PLURAL[kind]
        self.calls += 1
        try:
            response = await self._http.get(f"{self._base}/{plural}.json", params={plural: ",".join(numbers)})
            if response.status_code != 200:
                raise httpx.HTTPError(f"HTTP {response.status_code}")
            elements = response.json().get("elements") or []
        except (httpx.HTTPError, ValueError) as exc:
            log.info("Place details were not read (%s): %s", plural, str(exc) or type(exc).__name__)
            return {}
        out: dict[str, dict[str, str]] = {}
        for element in elements:
            tags = element.get("tags") if isinstance(element, dict) else None
            if not isinstance(tags, dict) or not isinstance(element.get("id"), int):
                continue
            details = details_of({str(key): str(value) for key, value in tags.items()})
            if details:
                out[f"{kind}/{element['id']}"] = details
        return out
