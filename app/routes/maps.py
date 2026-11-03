"""The map's lookups: the area people can reach on foot from a point (GET /api/catchment), the same walking area Check a
spot draws, and address search through Nominatim (GET /api/geocode). Each is rate limited per client."""
from __future__ import annotations

from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Query, Request

from .. import schemas
from ..catchment import make_reach
from ..ratelimit import client_ip

router = APIRouter(prefix="/api")


@router.get("/catchment", response_model=schemas.Catchment)
async def catchment(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    minutes: int = Query(10),
    travel: Literal["walk", "drive", "distance"] = Query("walk"),
    km: float | None = Query(None),
) -> dict:
    try:
        reach = make_reach(travel, minutes, km)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    if not request.app.state.map_limiter.allow(client_ip(request)):
        raise HTTPException(429, "Too many map requests. Try again later.")
    walk = await request.app.state.services.walker.area(lat, lon, reach)
    return walk.public()


@router.get("/geocode", response_model=list[schemas.GeocodeHit])
async def geocode(request: Request, q: str = Query(..., min_length=3, max_length=160)) -> list[dict]:
    try:
        return await request.app.state.services.geocoder.search(q)
    except httpx.HTTPError as exc:
        raise HTTPException(502, "Address search is unavailable right now.") from exc
