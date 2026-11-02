"""The server's own facts: whether it is up and what it can reach (GET /api/health, which never reads the database,
so the keep-awake visits leave Neon asleep)."""
from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Request

from .. import schemas

if TYPE_CHECKING:
    from ..services import Services

router = APIRouter(prefix="/api")


@router.get("/health", response_model=schemas.Health)
async def health(request: Request) -> dict:
    services: Services = request.app.state.services
    llm = services.llm
    return {
        "ok": True,
        "llm": llm.enabled,
        "model": llm.model if llm.enabled else None,
        "models": llm.models if llm.enabled else [],
        "resting": llm.resting() if llm.enabled else {},
    }
