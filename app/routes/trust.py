"""What a person can check: the service's public key, the limits they give an assistant, and a campaign's public proof.

GET /api/keys is a JWKS, the key that signed every pledge's terms and every limits token. POST /api/limits is for the
person's own page: it mints the limits token an assistant must present with every pledge it prepares, and GET /api/limits
reads one back with what is already used. GET /api/campaigns/{id}/proof is the campaign's record checked against PayPal."""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Header, HTTPException, Path, Request, Response
from pydantic import BaseModel, ConfigDict, Field

from ..cache_policy import STATIC
from ..config import settings
from ..payments.records import Problem
from ..ratelimit import client_ip
from ..trust import limits as limit_rules
from ..trust.proof import proof_of
from .campaigns import CAMPAIGN_ID, campaign_row

router = APIRouter(prefix="/api")


class LimitsRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    max_pledge: Any = Field(None, description='The most for one pledge, "5.00" to "200.00"', examples=["30.00"])
    max_total: Any = Field(None, description='The most in all, up to "1000.00"', examples=["50.00"])
    max_count: Any = Field(3, description="The most pledges, 1 to 10")
    days: Any = Field(1, description="How long the limits last, from an hour (0.05) to 30 days")
    near: dict[str, Any] | None = Field(None, description="Only campaigns within km of lat, lon", examples=[{"lat": 40.71, "lon": -73.96, "km": 3}])
    kinds: list[str] | None = Field(None, description="Only these kinds of business, or null for any")


def refused(error: limit_rules.LimitsError) -> Problem:
    return Problem(error.status, error.detail, code=error.code)


def allow(request: Request, limiter_name: str, doing: str) -> None:
    if not getattr(request.app.state, limiter_name).allow(client_ip(request)):
        raise HTTPException(429, f"Too many {doing} from this address. Try again later.")


@router.get("/keys")
async def keys(request: Request, response: Response) -> dict:
    """The public key that checks the signatures on pledge terms and limits."""
    response.headers["Cache-Control"] = STATIC
    return request.app.state.signer.jwks()


@router.post("/limits")
async def make_limits(request: Request, body: LimitsRequest) -> dict:
    """Limits for an assistant, signed: the person's own page calls this, and keeps the token. An assistant has no tool
    for it and is never given a way to change the limits it works within."""
    allow(request, "limits_limiter", "limits")
    state = request.app.state
    try:
        made = limit_rules.make(
            max_pledge=body.max_pledge, max_total=body.max_total, max_count=body.max_count, days=body.days,
            near=body.near, kinds=body.kinds, now=state.now(),
        )
    except limit_rules.LimitsError as exc:
        raise refused(exc) from exc
    return {"token": limit_rules.encode(state.signer, made), "header": limit_rules.HEADER, "limits": limit_rules.view(made)}


@router.get("/limits")
async def read_limits(request: Request, token: str | None = Header(None, alias=limit_rules.HEADER)) -> dict:
    """The limits a token carries, and what is already prepared or held under it."""
    state = request.app.state
    try:
        found = limit_rules.decode(state.signer, token, state.now())
    except limit_rules.LimitsError as exc:
        raise refused(exc) from exc
    used = limit_rules.usage_of(await state.campaigns.limit_usage(found.jti, state.now() - limit_rules.PREPARED_FOR))
    return {"limits": limit_rules.view(found, used)}


@router.get("/campaigns/{campaign_id}/proof")
async def proof(request: Request, campaign_id: str = Path(..., pattern=CAMPAIGN_ID)) -> dict:
    """The campaign's record, each pledge checked against PayPal now, and its signed terms checked."""
    allow(request, "proof_limiter", "proof checks")
    state = request.app.state
    row = await campaign_row(request, campaign_id)

    async def build() -> dict:
        client = state.services.paypal
        return await proof_of(
            row, await state.campaigns.pledges([campaign_id]), await state.campaigns.payout(campaign_id), state.signer,
            client if client is not None and client.configured else None, state.now(), settings.paypal_environment,
        )

    return await state.proofs.get(campaign_id, build)
