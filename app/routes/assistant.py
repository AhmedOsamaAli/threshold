"""The Ask page's assistant: POST /api/assistant takes the conversation so far, the person's latest message last, and answers
with the assistant's reply, the campaigns it put on the page, and, when the person asked to back one and their limits allow
it, a pledge prepared for them to approve in PayPal (app.assistant). The person's limits come in the X-Limits header, as they
do for any assistant (app.trust.limits)."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from .. import assistant
from ..ratelimit import client_ip
from ..trust import limits as limit_rules
from .campaigns import CAMPAIGN_ID

router = APIRouter(prefix="/api")


class TurnIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: Literal["user", "assistant"]
    content: str = Field(max_length=600)
    shown: list[str] = Field(default_factory=list, max_length=12, description="The campaigns an assistant turn put on the page")
    asked: str | None = Field(None, max_length=32, description="The campaign an assistant turn asked about backing")


class AskIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    messages: list[TurnIn] = Field(min_length=1, max_length=12, description="The conversation, the person's message last")
    back: str | None = Field(None, pattern=CAMPAIGN_ID, description="The campaign whose Back it button the person pressed")


@router.post("/assistant")
async def ask(
    request: Request, body: AskIn, limits_token: str | None = Header(None, alias=limit_rules.HEADER),
) -> dict:
    """One assistant turn. The assistant works inside the limits in X-Limits and can only prepare a pledge: the person
    approves it in PayPal."""
    last = body.messages[-1]
    if last.role != "user" or not last.content.strip():
        raise HTTPException(422, "The last message must be the person's, and not empty.")
    if not request.app.state.assistant_limiter.allow(client_ip(request)):
        raise HTTPException(429, "Too many messages from this address. Try again later.")
    turns = [
        assistant.Turn(turn.role, turn.content, tuple(turn.shown), turn.asked or "") for turn in body.messages
    ]
    return assistant.public(await assistant.ask(request, turns, limits_token, body.back))
