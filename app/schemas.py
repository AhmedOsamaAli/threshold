"""Typed shapes of the JSON API that need one, so responses are validated and documented at /docs."""
from __future__ import annotations

from pydantic import BaseModel, Field


class Health(BaseModel):
    ok: bool
    llm: bool = Field(description="The language model that drafts campaign words is configured")
    model: str | None
    models: list[str] = Field(description="The model and its fallbacks, in order")
    resting: dict[str, float] = Field(description="Models resting after rate limits, with seconds left")


class Catchment(BaseModel):
    minutes: int
    source: str = Field(description="'street network' when traced over the streets, 'circle' when routing is unavailable")
    ring: list[list[float]] = Field(description="The area's outline as [lat, lon] points")
    area_km2: float
    radius_m: int = Field(description="Radius of a circle with the same area")
    travel: str = Field("walk", description="'walk', 'drive' or 'distance'")
    km: float | None = Field(None, description="The road distance, for travel 'distance'")
    label: str = Field("", description="The area in a sentence: '10-minute walk', '30-minute drive', '25 km drive'")
    short: str = Field("", description="'10-min walk', '30-min drive', '25 km drive'")


class GeocodeHit(BaseModel):
    label: str | None
    lat: float
    lon: float
