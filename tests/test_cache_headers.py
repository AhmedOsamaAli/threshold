"""Who may keep a copy of an API response (app.cache_policy): the Cache-Control table shared with the front door.

Public: the public settings, which change only with a deploy; they alone may be served stale while the backend is down
(stale-if-error). Everything else is no-store, and nothing public ever sets a cookie or depends on who asks."""
from __future__ import annotations

import pytest
from fastapi import Request, Response

from app import auth, cache_policy
from tests.account_fakes import configure, dev_sign_in, make_client

STATIC = "public, max-age=300, s-maxage=3600, stale-if-error=604800"
OWN = "public, max-age=60, s-maxage=600"  # a header a route might wrongly make public


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    return configure(monkeypatch)


def cache_control(response) -> str:
    return response.headers.get("cache-control", "")


def directives(header: str) -> dict[str, str | None]:
    """A Cache-Control header's directives, by name (lower case), with their values."""
    found: dict[str, str | None] = {}
    for part in header.split(","):
        name, _, value = part.strip().partition("=")
        if name:
            found[name.lower()] = value or None
    return found


def test_the_table_is_the_contract_with_the_front_door():
    assert cache_policy.STATIC == STATIC
    assert cache_policy.NO_STORE == "no-store"
    assert cache_policy.STALE_IF_ERROR == "stale-if-error=604800"  # a week


def test_only_what_belongs_to_no_visitor_may_be_served_stale():
    """stale-if-error (RFC 5861) lets the front door keep a copy for a week, for when the backend is down."""
    assert directives(STATIC)["stale-if-error"] == "604800"
    assert directives(STATIC)["s-maxage"] == "3600"


def test_the_public_settings_are_public():
    with make_client() as client:
        assert cache_control(client.get("/api/config")) == STATIC


def test_everything_else_is_no_store():
    with make_client() as client:
        answers = [
            client.get("/api/health"),
            client.get("/api/me"),
            client.get("/api/me/campaigns"),  # 401
            client.get("/api/campaigns"),
            client.get("/api/campaigns/unknown"),  # 404
            client.get("/api/catchment", params={"lat": 40.0, "lon": -73.0}),
            client.get("/api/geocode", params={"q": "Main Street"}),
            client.get("/api/reverse", params={"lat": 40.0, "lon": -73.0}),
            client.get("/api/catchment", params={"lat": 123, "lon": -73.0}),  # 422
            client.post("/api/auth/logout"),
            client.delete("/api/me"),  # 401
        ]
        for answer in answers:
            assert cache_control(answer) == "no-store", (answer.request.method, answer.request.url, answer.status_code)
        dev_sign_in(client)
        signed_in = [client.get("/api/me"), client.get("/api/me/campaigns")]
        assert [cache_control(a) for a in signed_in] == ["no-store", "no-store"]
        assert client.get("/").headers["cache-control"] == "no-cache"  # the web app's pages keep their own


def test_a_public_answer_is_the_same_for_everyone_and_sets_no_cookie():
    with make_client() as client:
        anonymous = client.get("/api/config")
        dev_sign_in(client)  # a session cookie now goes with every request
        assert client.cookies.get(auth.SESSION_COOKIE)
        again = client.get("/api/config", headers={"X-Forwarded-For": "203.0.113.7", "X-Client-IP": "198.51.100.9"})
        assert again.content == anonymous.content and cache_control(again) == STATIC
        assert "set-cookie" not in again.headers and "set-cookie" not in anonymous.headers
        client.cookies.clear()
        client.cookies.set(auth.SESSION_COOKIE, "expired-or-unknown")  # a stale cookie is not even read here
        stale = client.get("/api/config")
        assert "set-cookie" not in stale.headers and cache_control(stale) == STATIC


def test_the_guard_never_lets_a_cookie_a_write_or_an_error_be_public(tmp_path):
    with make_client(web_root=tmp_path / "no-build") as client:  # the API only, so the routes below are reached
        app = client.app

        @app.get("/api/test-public-with-cookie")
        async def public_with_cookie(request: Request, response: Response) -> dict:
            response.headers["Cache-Control"] = OWN
            auth.queue_cookie(request, auth.SESSION_COOKIE, "0" * 32, 60)
            return {}

        @app.post("/api/test-public-write")
        async def public_write(response: Response) -> dict:
            response.headers["Cache-Control"] = OWN
            return {}

        @app.get("/api/test-public-error")
        async def public_error() -> Response:
            return Response(status_code=503, headers={"Cache-Control": OWN})

        with_cookie = client.get("/api/test-public-with-cookie")
        assert "set-cookie" in with_cookie.headers and cache_control(with_cookie) == "no-store"
        assert cache_control(client.post("/api/test-public-write")) == "no-store"
        assert cache_control(client.get("/api/test-public-error")) == "no-store"


def test_whether_a_header_is_public():
    assert cache_policy.is_public("public, max-age=60") and not cache_policy.is_public("no-store")
    assert not cache_policy.is_public("private, max-age=60, publicity=1")
