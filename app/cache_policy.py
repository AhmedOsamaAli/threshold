"""Who may keep a copy of an API response: the Cache-Control header, the one contract with the front door.

The public settings are the same for every visitor and change only with a deploy, so browsers and the front door
(frontend/functions, Cloudflare) may keep them. Everything else is no-store: the signed-in user and their campaigns,
every campaign's progress, every write, the health check and every error. The front door caches only a GET answered
200 with `public` and an s-maxage, without Set-Cookie, keyed by the URL alone, so a public response never depends on
who asks (no session, cookie or address in it) and never sets a cookie (guard).

Only what belongs to no visitor (the public settings) carries stale-if-error (RFC 5861): the front door may keep a stale
copy of it for a week and serve it while the backend is waking, down or erroring.
"""
from __future__ import annotations

from fastapi import Request, Response

STALE_IF_ERROR = "stale-if-error=604800"  # a week: what the front door may serve while the backend is down
STATIC = f"public, max-age=300, s-maxage=3600, {STALE_IF_ERROR}"  # GET /api/config: changes with a deploy
NO_STORE = "no-store"

CACHEABLE_METHODS = frozenset({"GET", "HEAD"})


def is_public(header: str) -> bool:
    """Whether a Cache-Control header lets shared caches (the front door) keep the response."""
    return "public" in (part.strip().lower() for part in header.split(","))


def guard(request: Request, response: Response) -> None:
    """The last word on an API response's Cache-Control (the security middleware calls it once the cookies are set):
    no-store unless its route made it public, and never public for anything but a 200 to a GET, nor with a cookie."""
    if not request.url.path.startswith("/api/"):
        return
    header = response.headers.get("cache-control")
    shareable = (
        request.method in CACHEABLE_METHODS and response.status_code == 200 and "set-cookie" not in response.headers
    )
    if not header or (is_public(header) and not shareable):
        response.headers["Cache-Control"] = NO_STORE
