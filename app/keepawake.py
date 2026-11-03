"""Keeps a free Render instance awake. Render puts a free web service to sleep after 15 minutes without a visit, and the
first visit after that waits about a minute while it wakes, so the app visits a health check every few minutes:
KEEP_AWAKE_URL, the front door's, so each visit leaves Render and comes back in from outside like a visitor's. The health
check reads no database, so Neon still scales to zero between visits.

A workspace's 750 free hours a month keep one instance awake all month, not two. KEEP_AWAKE_WINDOWS limits the visits to
the days it matters ('2026-12-01/2026-12-16': UTC days, both included, several separated by commas): outside them the
instance sleeps when idle and wakes for whoever comes, and the hours stay for the days that need them. Without windows
it visits on every day."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable, Sequence
from datetime import UTC, date, datetime

import httpx

from . import tls

log = logging.getLogger("threshold")

# Seconds between visits: every 5 minutes leaves room for a failed visit inside Render's 15.
EVERY_S = 300.0


def inside(windows: Sequence[tuple[date, date]], at: datetime) -> bool:
    """Whether the moment falls on a day inside the windows (UTC, first and last day included); no windows: always."""
    if not windows:
        return True
    day = at.astimezone(UTC).date()
    return any(first <= day <= last for first, last in windows)


async def keep_awake(
    url: str, every: float = EVERY_S, transport: httpx.AsyncBaseTransport | None = None,
    windows: Sequence[tuple[date, date]] = (), now: Callable[[], datetime] = lambda: datetime.now(UTC),
) -> None:
    """Visits `url` every `every` seconds until cancelled, on the days inside `windows` (every day without any). A failed
    visit is logged, and the next one comes on time."""
    async with httpx.AsyncClient(
        timeout=30, headers={"User-Agent": "Threshold keep-awake"}, transport=transport, verify=tls.context(),
    ) as client:
        while True:
            await asyncio.sleep(every)
            if not inside(windows, now()):
                continue
            try:
                response = await client.get(url)
            except httpx.HTTPError as error:
                log.warning("Keep-awake: visiting %s failed (%s)", url, error)
                continue
            if response.status_code != 200:
                log.warning("Keep-awake: %s answered %s", url, response.status_code)
