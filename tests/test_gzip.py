"""Gzip from the backend: JSON goes out four times smaller to clients that accept it, and the same bytes once
decompressed; small bodies go as they are."""
from __future__ import annotations

import gzip
from urllib.parse import urlencode

import pytest

from tests.account_fakes import configure, make_client


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    return configure(monkeypatch)


def raw_get(client, path: str, accept: str | None) -> tuple[int, dict, bytes]:
    """A GET as it goes over the wire: no decoding by the test client."""
    async def call() -> tuple[int, dict, bytes]:
        messages: list[dict] = []
        asked = False
        route, _, query = path.partition("?")
        headers = [(b"host", b"testserver")] + ([(b"accept-encoding", accept.encode())] if accept else [])
        scope = {"type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": "GET", "scheme": "http",
                 "path": route, "raw_path": route.encode(), "root_path": "", "query_string": query.encode(),
                 "headers": headers, "client": ("127.0.0.1", 50000), "server": ("testserver", 80)}

        async def receive() -> dict:
            nonlocal asked
            if not asked:
                asked = True
                return {"type": "http.request", "body": b"", "more_body": False}
            return {"type": "http.disconnect"}

        async def send(message: dict) -> None:
            messages.append(message)

        await client.app(scope, receive, send)
        start = next(m for m in messages if m["type"] == "http.response.start")
        body = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
        return start["status"], {k.decode(): v.decode() for k, v in start["headers"]}, body

    return client.portal.call(call)


def test_json_goes_out_gzipped_to_clients_that_accept_it_and_as_it_is_to_others():
    with make_client() as client:
        path = "/api/catchment?" + urlencode({"lat": 40.0, "lon": -73.0, "minutes": 15})
        status, plain_headers, plain = raw_get(client, path, None)
        status_gz, headers, zipped = raw_get(client, path, "gzip, deflate, br")
        assert status == status_gz == 200 and "content-encoding" not in plain_headers
        assert headers["content-encoding"] == "gzip" and "accept-encoding" in headers["vary"].lower()
        assert gzip.decompress(zipped) == plain and len(zipped) * 2 < len(plain)
        assert headers["cache-control"] == plain_headers["cache-control"]
        _, headers, small = raw_get(client, "/api/health", "gzip")  # under 1 KB: not worth it
        assert "content-encoding" not in headers and small.startswith(b"{")
