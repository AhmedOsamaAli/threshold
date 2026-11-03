"""Check a spot: GET /api/spot?address=...&kind=bakery (or lat= and lon= instead of an address) says what OpenStreetMap lists
inside a 10-minute walk of the place for that kind of business (app.spot). It shows what is open nearby, never what people
want, and says so when OpenStreetMap could not be read."""
from __future__ import annotations

from typing import Annotated

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from ..payments.records import BusinessKind
from ..ratelimit import client_ip
from ..spot import check_spot

router = APIRouter(prefix="/api")


@router.get("/spot")
async def spot(
    request: Request,
    kind: Annotated[BusinessKind, Query(description="The kind of business to look for")],
    address: Annotated[str | None, Query(min_length=3, max_length=160, description="An address, neighborhood or city")] = None,
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lon: Annotated[float | None, Query(ge=-180, le=180)] = None,
    label: Annotated[str | None, Query(max_length=160, description="What to call the point (lat and lon), in the answer")] = None,
) -> dict:
    """What OpenStreetMap lists within a 10-minute walk of an address (or of lat and lon), for one kind of business."""
    by_address = address is not None and bool(address.strip())
    by_point = lat is not None and lon is not None
    if (lat is None) != (lon is None) or by_address == by_point:
        raise HTTPException(422, "Give an address, or both lat and lon, and not both.")
    state = request.app.state
    if not state.spot_limiter.allow(client_ip(request)):
        raise HTTPException(429, "Too many checks from this address. Try again later.")
    name = f"{lat:.5f}, {lon:.5f}" if by_point else ""
    if by_point and label and label.strip():
        name = " ".join(label.split())
    label = name
    if by_address:
        try:
            hits = await state.services.geocoder.search(address.strip())
        except httpx.HTTPError as exc:
            raise HTTPException(502, "Address search is unavailable right now.") from exc
        if not hits:
            raise HTTPException(404, "No place found for that address. Try a street, a neighborhood or a city.")
        lat, lon, label = hits[0]["lat"], hits[0]["lon"], hits[0].get("label") or address.strip()
    assert lat is not None and lon is not None
    kept = state.spots.get(lat, lon, kind)
    if kept is not None:
        return {**kept, "place": {**kept["place"], "label": label[:160]}}
    answer = await check_spot(state.services, lat, lon, kind, label, state.now())
    state.spots.put(lat, lon, kind, answer)
    return answer
