"""Fakes for the accounts tests: Google's signing keys, settings for the app's modules, a clock tests move, a model
endpoint that records what it is sent, and an app wired to them over fake routing and address services."""
from __future__ import annotations

import json
import sys
import time
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import httpx
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.auth import GoogleKeys
from app.llm import LLM
from app.main import Services, create_app
from tests.fakes import FakeWalker, StubGeocoder

CLIENT_ID = "1234-test.apps.googleusercontent.com"
ACCOUNT_SETTINGS = {
    "google_client_id": CLIENT_ID, "session_days": 30, "auth_dev_login": True, "allowed_origins": (), "public_url": "",
}


def configure(monkeypatch, **changes):
    """Every app module sees these settings (as tests/conftest.py does for the database)."""
    from app import config

    settings = replace(config.settings, **{**ACCOUNT_SETTINGS, **changes})
    for name, module in list(sys.modules.items()):
        if name == "app" or name.startswith("app."):
            for attribute, value in list(vars(module).items()):
                if isinstance(value, config.Settings):
                    monkeypatch.setattr(module, attribute, settings)
    return settings


class Clock:
    """The app's clock (and a fake service's), moved by tests."""

    def __init__(self) -> None:
        self.now = datetime.now(UTC).replace(microsecond=0)

    def __call__(self) -> datetime:
        return self.now

    def advance(self, **delta: float) -> datetime:
        self.now += timedelta(**delta)
        return self.now


class GoogleSigner:
    """Google's side of Sign in with Google: an RSA key, the JWKS that publishes it, and ID tokens it signs."""

    def __init__(self, kid: str = "google-key-1", max_age: int = 3600) -> None:
        self.kid = kid
        self.private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.max_age = max_age
        self.fetches = 0

    def jwks(self) -> dict:
        public = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(self.private.public_key()))
        return {"keys": [{**public, "kid": self.kid, "use": "sig", "alg": "RS256"}]}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.fetches += 1
        return httpx.Response(200, json=self.jwks(), headers={"cache-control": f"public, max-age={self.max_age}, must-revalidate"})

    def keys(self, clock=time.monotonic) -> GoogleKeys:
        return GoogleKeys(http_client=httpx.AsyncClient(transport=httpx.MockTransport(self)), clock=clock)

    def token(self, key=None, kid: str | None = None, algorithm: str = "RS256", **claims) -> str:
        now = int(time.time())
        payload = {
            "iss": "https://accounts.google.com", "aud": CLIENT_ID, "azp": CLIENT_ID, "sub": "1000001",
            "email": "owner@example.com", "email_verified": True, "name": "Olive Owner",
            "picture": "https://lh3.googleusercontent.com/a/photo", "iat": now, "exp": now + 3600, **claims,
        }
        payload = {name: value for name, value in payload.items() if value is not None}
        return jwt.encode(payload, key or self.private, algorithm=algorithm, headers={"kid": kid or self.kid})


def recording_llm(sent: list[dict]) -> LLM:
    """An OpenAI-compatible model that records every request it is sent and answers each with an empty JSON object,
    so the evidence rules write everything."""
    def handler(request: httpx.Request) -> httpx.Response:
        sent.append(json.loads(request.content))
        message = {"role": "assistant", "content": "{}"}
        return httpx.Response(200, json={"id": "x", "object": "chat.completion", "created": 0, "model": "test-model",
                                         "choices": [{"index": 0, "finish_reason": "stop", "message": message}]})

    return LLM("test-key", "https://llm.test/v1/", "test-model",
               http_client=httpx.AsyncClient(transport=httpx.MockTransport(handler)))


def make_client(
    google: GoogleSigner | None = None, clock: Clock | None = None, database_url: str | None = None,
    base_url: str = "http://testserver", llm: LLM | None = None, services: dict | None = None, **app_options,
) -> TestClient:
    """The app over fake routing and address services and a rules-only model (unless `llm`), with this Google and
    clock; `services` and `app_options` add to Services and create_app."""
    built = Services(
        walker=FakeWalker(), llm=llm or LLM("", None, "test-model"), geocoder=StubGeocoder(),
        google=google.keys() if google else GoogleKeys(), **(services or {}),
    )
    app = create_app(lambda: built, database_url, **app_options)
    if clock is not None:
        app.state.now = clock
    return TestClient(app, base_url=base_url)


def dev_sign_in(client: TestClient, email: str = "owner@example.com", name: str = "Olive Owner") -> dict:
    response = client.post("/api/auth/dev", json={"email": email, "name": name})
    assert response.status_code == 200, response.text
    return response.json()["user"]
