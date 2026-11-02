"""Rate limits for the public demo: per-client sliding windows."""
from __future__ import annotations

import hmac
import time
from collections import defaultdict, deque

from fastapi import Request

from .config import settings


class RateLimiter:
    def __init__(self, limit: int, window_s: int) -> None:
        self.limit, self.window_s = limit, window_s
        self._hits: dict[str, deque] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        now = time.time()
        hits = self._hits[key]
        while hits and now - hits[0] > self.window_s:
            hits.popleft()
        if len(hits) >= self.limit:
            return False
        hits.append(now)
        return True


def client_ip(request: Request) -> str:
    # Behind the Cloudflare front door every request arrives from Cloudflare, so the front door sends the visitor's
    # address in X-Client-IP, trusted only with the secret the two share.
    secret = settings.proxy_secret
    if secret and hmac.compare_digest(request.headers.get("x-proxy-secret", "").encode(), secret.encode()):
        visitor = request.headers.get("x-client-ip", "").strip()
        if visitor:
            return visitor
    # The hosting proxy appends the address it saw, so the last entry cannot be forged by the client.
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[-1].strip()
    return request.client.host if request.client else "unknown"
