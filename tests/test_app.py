"""The app as a whole: what it answers beside campaigns and accounts (health, the map's lookups, the web app's pages), the
API only without the React build, and the endpoints that are gone."""
from __future__ import annotations

import asyncio
import logging

import httpx
import pytest
from fastapi.testclient import TestClient

from app.llm import LLM
from app.main import Services, create_app
from tests.account_fakes import configure, make_client
from tests.fakes import SITE, FakeWalker, StubGeocoder


@pytest.fixture(autouse=True)
def settings(monkeypatch):
    return configure(monkeypatch)


def services() -> Services:
    return Services(walker=FakeWalker(), llm=LLM("", None, "test-model"), geocoder=StubGeocoder())


def test_health_config_and_the_map_lookups():
    with make_client() as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json() == {"ok": True, "llm": False, "model": None, "models": [], "resting": {}}
        config = client.get("/api/config")
        assert config.status_code == 200 and set(config.json()) == {"google_client_id", "dev_login", "paypal"}
        walk = client.get("/api/catchment", params={"lat": SITE[0], "lon": SITE[1], "minutes": 15}).json()
        assert walk["minutes"] == 15 and walk["radius_m"] > 1100 and walk["travel"] == "walk"
        assert client.get("/api/geocode", params={"q": "Main Street"}).json()[0]["lat"] == SITE[0]
        assert client.get("/api/reverse", params={"lat": SITE[0], "lon": SITE[1]}).json()["label"]
        assert client.get("/api/campaigns").json() == {"campaigns": []}
        page = client.get("/")
        assert page.status_code == 200 and "Walk-in" in page.text
        assert "frame-ancestors 'none'" in page.headers["content-security-policy"]


@pytest.mark.parametrize("params, status", [
    ({"minutes": 4}, 400),
    ({"minutes": 61}, 400),
    ({"travel": "drive", "minutes": 90}, 400),
    ({"travel": "distance"}, 400),
    ({"travel": "distance", "km": 150}, 400),
    ({"travel": "boat"}, 422),
    ({"lat": 123}, 422),
    ({"lon": -181}, 422),
])
def test_the_catchment_rejects_bad_input(params, status):
    with make_client() as client:
        asked = {"lat": SITE[0], "lon": SITE[1], **params}
        assert client.get("/api/catchment", params=asked).status_code == status


def test_a_drive_or_a_road_distance_is_traced_too():
    with make_client() as client:
        drive = client.get("/api/catchment", params={"lat": SITE[0], "lon": SITE[1], "travel": "drive", "minutes": 20})
        assert drive.json()["label"] == "20-minute drive" and drive.json()["short"] == "20-min drive"
        road = client.get("/api/catchment", params={"lat": SITE[0], "lon": SITE[1], "travel": "distance", "km": 25})
        assert road.json()["label"] == "25 km drive" and road.json()["km"] == 25.0


def test_the_endpoints_that_are_gone_are_gone():
    with make_client() as client:
        for method, path in (
            ("GET", "/api/run"), ("GET", "/api/runs/abc123"), ("POST", "/api/design"), ("GET", "/api/kits/abc123"),
            ("POST", "/api/kits"), ("GET", "/api/examples"), ("GET", "/api/places"), ("GET", "/api/heatmap"),
            ("GET", "/api/presets"), ("GET", "/api/me/places"), ("POST", "/api/campaigns"), ("POST", "/api/campaigns/draft"),
        ):
            answer = client.request(method, path)
            assert answer.status_code in (404, 405), (method, path, answer.status_code)
        assert set(client.get("/api/config").json()) == {"google_client_id", "dev_login", "paypal"}


def test_shared_links_open_the_web_app_and_leave_the_api_alone(web_build):
    with make_client() as client:
        home = client.get("/")
        assert "<title>Walk-in</title>" in home.text
        for path in ("/me", "/privacy", "/p/abc123", "/founders", "/founders/start", "/r/abc123", "/ask", "/spot", "/proof/abc123"):
            page = client.get(path)
            assert page.status_code == 200 and page.text == home.text, path
            for header in ("content-security-policy", "x-content-type-options", "referrer-policy", "cache-control"):
                if header == "referrer-policy" and path.startswith("/r/"):  # a private receipt's link stays out of referrers
                    assert page.headers[header] == "no-referrer"
                else:
                    assert page.headers[header] == home.headers[header], (path, header)
        missing = client.get("/api/campaigns/abc123")
        assert missing.status_code == 404 and missing.json() == {"detail": "Campaign not found."}
        assert client.get("/p/abc123/more").status_code == 404
        assert client.get("/examples").status_code == 404 and client.get("/s/abc123").status_code == 404
        assert client.get("/app.js").content == (web_build / "app.js").read_bytes()


def test_without_the_react_build_the_server_serves_the_api_only(tmp_path, caplog):
    built = services()
    with caplog.at_level(logging.WARNING, logger="walkin"):
        app = create_app(lambda: built, web_root=tmp_path / "no-build")
    assert "frontend/dist is missing (npm run build in frontend/): serving the API only" in caplog.messages
    with TestClient(app) as client:
        assert client.get("/api/health").status_code == 200
        for path in ("/", "/me", "/privacy", "/p/abc123"):
            assert client.get(path).status_code == 404, path


def test_the_health_check_never_touches_the_database(database_url):
    app = create_app(lambda: services(), database_url)

    async def check() -> int:
        async with app.router.lifespan_context(app):
            await app.state.db.engine.dispose()

            def refuse(*args, **kwargs):
                raise AssertionError("GET /api/health touched the database")

            app.state.db.engine.sync_engine.pool.connect = refuse
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://testserver") as client:
                response = await client.get("/api/health")
                assert response.json()["ok"] is True
                return response.status_code

    assert asyncio.run(check()) == 200
