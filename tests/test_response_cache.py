"""Final responses served from memory (app.response_cache): kept only once final, the least recently opened leaving
first, read once at a time, dropped when forgotten, and sent gzipped to the clients that accept it."""
from __future__ import annotations

import asyncio
import gzip
import json

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from app.response_cache import GZIP_MIN_BYTES, Page, ResponseCache, json_response, page_response
from tests.account_fakes import configure, make_client


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    return configure(monkeypatch)


def entry(size: int) -> Page:
    return Page(b"x" * size)


def test_the_least_recently_opened_leave_first():
    cache = ResponseCache(budget=10)
    cache.put("a", entry(4))
    cache.put("b", entry(4))
    assert cache.get("a") is not None  # a is now the most recently opened
    cache.put("c", entry(4))  # over budget: b leaves
    assert cache.get("b") is None and cache.get("a") and cache.get("c")
    cache.put("huge", entry(11))  # larger than the whole budget: not kept, nothing else lost
    assert cache.get("huge") is None and cache.get("a") and cache.get("c")
    cache.put("a", entry(2))  # replaced, not counted twice
    assert cache.stats() == {"pages": 2, "bytes": 6, "hits": 5, "misses": 2}


def test_forgetting_pages_drops_them():
    cache = ResponseCache()
    for key in ("a", "b", "c"):
        cache.put(key, entry(1))
    cache.forget("a", "c", "never-kept")
    assert [cache.get(key) is not None for key in ("a", "b", "c")] == [False, True, False]
    assert cache.stats()["bytes"] == 1


def test_a_page_is_read_once_at_a_time_and_kept_only_when_final():
    async def scenario() -> tuple[list, list, ResponseCache]:
        cache, reads, gate = ResponseCache(), [], asyncio.Event()

        async def read() -> Page:
            reads.append(1)
            await gate.wait()
            return entry(3)

        async def unfinished() -> Page:
            reads.append(2)
            return Page(b"{}", final=False)

        waiting = [asyncio.ensure_future(cache.fetch("a", read)) for _ in range(3)]
        await asyncio.sleep(0)
        gate.set()
        pages = await asyncio.gather(*waiting)
        again = await cache.fetch("a", read)
        await cache.fetch("b", unfinished)
        await cache.fetch("b", unfinished)
        return reads, [*pages, again], cache

    reads, pages, cache = asyncio.run(scenario())
    assert reads == [1, 2, 2]  # one read for four askers; an unfinished page is read each time
    assert all(page is pages[0] for page in pages) and cache.stats()["pages"] == 1


def test_a_page_with_no_content_is_not_kept():
    async def scenario() -> tuple[Page | None, ResponseCache]:
        cache = ResponseCache()

        async def nothing() -> None:
            return None

        return await cache.fetch("a", nothing), cache

    page, cache = asyncio.run(scenario())
    assert page is None and cache.stats()["pages"] == 0


def test_a_page_read_while_pages_are_forgotten_is_not_kept():
    """Something deleted while a page showing it is being read: whoever asked before gets the answer, and memory keeps
    nothing of it (else what was deleted would be served from memory afterwards)."""
    async def scenario() -> tuple[Page | None, ResponseCache]:
        cache, gate = ResponseCache(), asyncio.Event()

        async def read() -> Page:
            await gate.wait()
            return entry(3)

        reading = asyncio.ensure_future(cache.fetch("a", read))
        await asyncio.sleep(0)  # the read is under way
        cache.forget("a")
        gate.set()
        return await reading, cache

    page, cache = asyncio.run(scenario())
    assert page is not None and page.size == 3
    assert cache.stats()["pages"] == 0 and cache.get("a") is None


def body_of(size: int) -> bytes:
    return json.dumps({"words": ["café"] * size}, ensure_ascii=False).encode("utf-8")


def asking(accept_encoding: str | None) -> Request:
    headers = [(b"accept-encoding", accept_encoding.encode())] if accept_encoding else []
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers})


def test_a_page_is_sent_gzipped_to_clients_that_accept_it_and_as_it_is_to_others():
    big = Page(body_of(500))
    assert big.size >= GZIP_MIN_BYTES and big.gzipped is big.gzipped  # made once
    gzipped = page_response(big, "public, max-age=60", asking("gzip, deflate, br"))
    plain = page_response(big, "public, max-age=60", asking(None))
    assert gzipped.headers["content-encoding"] == "gzip" and "content-encoding" not in plain.headers
    assert gzip.decompress(gzipped.body) == plain.body == big.body and len(gzipped.body) * 2 < len(plain.body)
    for response in (gzipped, plain):
        assert response.headers["cache-control"] == "public, max-age=60"
        assert response.headers["vary"] == "Accept-Encoding" and response.media_type == "application/json"

    small = Page(body_of(2))
    assert small.size < GZIP_MIN_BYTES
    answer = page_response(small, "no-store", asking("gzip"))  # not worth the work: sent as it is
    assert answer.body == small.body and "content-encoding" not in answer.headers and "vary" not in answer.headers
    assert json_response(b"{}", "no-store").headers["cache-control"] == "no-store"


def test_a_cached_page_goes_out_the_way_a_route_sends_it():
    app = FastAPI()
    cache = ResponseCache()
    page = Page(body_of(500))

    @app.get("/page")
    async def route(request: Request):
        found = await cache.fetch("page", lambda: asyncio.sleep(0, page))
        return page_response(found, "public, max-age=60", request)

    with TestClient(app) as client:
        first = client.get("/page", headers={"accept-encoding": "gzip"})
        second = client.get("/page", headers={"accept-encoding": "identity"})
        assert first.json() == second.json() == json.loads(page.body)  # the client undid the gzip
        assert cache.stats()["pages"] == 1 and cache.stats()["hits"] == 1  # the second came from memory


def test_the_app_keeps_a_cache_sized_by_its_settings(monkeypatch):
    configure(monkeypatch, response_cache_mb=3)
    with make_client() as client:
        cache = client.app.state.responses
        assert isinstance(cache, ResponseCache) and cache.budget == 3 * 1024 * 1024
