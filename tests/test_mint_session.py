"""scripts/mint_session.py: a session opened straight in the database signs the test owner in, and its cookie never reaches the
screen."""
from __future__ import annotations

import asyncio
import importlib.util
import sys
from dataclasses import replace
from pathlib import Path

import pytest

from app import auth
from tests.account_fakes import make_client

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "mint_session.py"


@pytest.fixture(scope="module")
def mint_session():
    spec = importlib.util.spec_from_file_location("mint_session", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def use(client, token: str | None) -> None:
    """The browser holds exactly this cookie: the server's renewals set a copy of their own, which would be sent as well."""
    client.cookies.clear()
    if token is not None:
        client.cookies.set(auth.SESSION_COOKIE, token)


def test_a_minted_session_signs_the_test_owner_in(tmp_path, mint_session):
    url = f"sqlite:///{(tmp_path / 'minted.db').as_posix()}"
    with make_client(database_url=url) as client:  # starts the app, which brings the database up to date
        assert client.get("/api/me/campaigns").status_code == 401  # nobody is signed in yet
        token = asyncio.run(mint_session.mint(url, "e2e-owner@example.com", 2))
        use(client, token)
        signed = client.get("/api/me/campaigns")
        assert signed.status_code == 200 and signed.json() == {"campaigns": []}
        use(client, token[:-1] + ("a" if token[-1] != "a" else "b"))
        assert client.get("/api/me/campaigns").status_code == 401  # a cookie that was not minted is no session


def test_the_same_email_is_the_same_owner_and_each_session_is_its_own(tmp_path, mint_session):
    url = f"sqlite:///{(tmp_path / 'minted.db').as_posix()}"
    with make_client(database_url=url) as client:
        first = asyncio.run(mint_session.mint(url, "e2e-owner@example.com"))
        second = asyncio.run(mint_session.mint(url, "e2e-owner@example.com"))
        assert first != second
        for token in (first, second):
            use(client, token)
            assert client.get("/api/me/campaigns").status_code == 200
        # Ending one session leaves the other: signing out in one place is not signing out everywhere.
        use(client, first)
        assert client.post("/api/auth/logout").status_code == 204
        use(client, first)
        assert client.get("/api/me/campaigns").status_code == 401
        use(client, second)
        assert client.get("/api/me/campaigns").status_code == 200


def test_the_cookie_goes_to_a_file_and_never_to_the_screen(tmp_path, monkeypatch, capsys, mint_session):
    url = f"sqlite:///{(tmp_path / 'minted.db').as_posix()}"
    out = tmp_path / "owner-session.txt"
    monkeypatch.setattr(mint_session, "settings", replace(mint_session.settings, database_url=url))
    monkeypatch.setattr(sys, "argv", ["mint_session.py", "--out", str(out), "--hours", "3"])
    with make_client(database_url=url):
        assert mint_session.main() == 0
    token = out.read_text(encoding="utf-8")
    shown = capsys.readouterr().out
    assert len(token) >= 40 and token not in shown
    assert "e2e-owner@example.com" in shown and "valid 3 h" in shown and str(out) in shown


@pytest.mark.parametrize("hours", ["0", "-1", "100"])
def test_a_session_cannot_last_forever_or_start_over(tmp_path, monkeypatch, capsys, mint_session, hours):
    out = tmp_path / "never.txt"
    monkeypatch.setattr(sys, "argv", ["mint_session.py", "--out", str(out), "--hours", hours])
    assert mint_session.main() == 2
    assert not out.exists() and "at most 72" in capsys.readouterr().out
