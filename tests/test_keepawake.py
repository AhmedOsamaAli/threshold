"""Keeping a free Render instance awake: the app visits its own health check every few minutes while it runs, on the days
it is asked to."""
from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta, timezone

import httpx
import pytest

from app import config, main
from app.keepawake import inside, keep_awake
from tests.account_fakes import make_client

URL = "https://threshold.example/api/health"


def visits(*answers: int | Exception) -> list[httpx.Request]:
    """Runs the loop, a visit every 10 ms, until it has had each answer in turn; returns the requests it made."""
    seen: list[httpx.Request] = []

    async def scenario() -> None:
        done = asyncio.Event()

        def reply(request: httpx.Request) -> httpx.Response:
            seen.append(request)
            answer = answers[min(len(seen), len(answers)) - 1]
            if len(seen) >= len(answers):
                done.set()
            if isinstance(answer, Exception):
                raise answer
            return httpx.Response(answer)

        task = asyncio.create_task(keep_awake(URL, every=0.01, transport=httpx.MockTransport(reply)))
        await asyncio.wait_for(done.wait(), 5)
        task.cancel()
        await asyncio.wait([task])
        assert task.cancelled()  # stopped by the cancel, not by an error

    asyncio.run(scenario())
    return seen


def test_it_visits_the_health_check_again_and_again():
    seen = visits(200, 200, 200)
    assert [(request.method, str(request.url)) for request in seen] == [("GET", URL)] * 3
    assert seen[0].headers["user-agent"] == "Threshold keep-awake"


def test_a_failed_visit_does_not_stop_the_next():
    assert len(visits(httpx.ConnectError("unreachable"), 503, 200)) == 3


def test_it_is_on_only_with_an_address(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("KEEP_AWAKE_URL", raising=False)
    assert config.Settings().keep_awake_url == ""  # development and tests
    monkeypatch.setenv("KEEP_AWAKE_URL", " https://threshold-pledge.pages.dev/api/health ")
    assert config.Settings().keep_awake_url == "https://threshold-pledge.pages.dev/api/health"


@pytest.mark.parametrize("url", [URL, ""])
def test_the_app_runs_it_while_it_runs(monkeypatch: pytest.MonkeyPatch, url: str):
    calls: list[str] = []
    window = (date(2026, 12, 1), date(2026, 12, 16))

    async def fake_keep_awake(target: str, windows=()) -> None:
        calls.append(f"start {target} {list(windows)}")
        try:
            await asyncio.Event().wait()
        finally:
            calls.append("stop")

    monkeypatch.setattr(main, "keep_awake", fake_keep_awake)
    monkeypatch.setattr(main, "settings", replace(main.settings, keep_awake_url=url, keep_awake_windows=(window,)))
    with make_client() as client:
        assert client.get("/api/health").status_code == 200
    assert calls == ([f"start {URL} {[window]}", "stop"] if url else [])


# ---------- On the days that matter ----------

WINDOWS = ((date(2026, 11, 9), date(2026, 11, 16)), (date(2026, 12, 1), date(2026, 12, 16)))


def test_a_window_includes_its_first_and_last_day_and_nothing_around_them():
    at = lambda *parts: datetime(*parts, tzinfo=UTC)  # noqa: E731
    assert inside(WINDOWS, at(2026, 11, 9, 0, 0)) and inside(WINDOWS, at(2026, 11, 16, 23, 59))
    assert inside(WINDOWS, at(2026, 12, 1, 0, 0)) and inside(WINDOWS, at(2026, 12, 16, 23, 59))
    assert not inside(WINDOWS, at(2026, 11, 8, 23, 59)) and not inside(WINDOWS, at(2026, 11, 17, 0, 0))
    assert not inside(WINDOWS, at(2026, 11, 30, 12, 0)) and not inside(WINDOWS, at(2026, 12, 17, 0, 0))


def test_the_day_is_the_utc_day_whatever_zone_the_clock_is_in():
    cairo = timezone(timedelta(hours=2))
    # 01:30 in Cairo on Nov 9 is still Nov 8 in UTC, outside the window; 01:30 in Cairo on Nov 17 is Nov 16 in UTC, inside it.
    assert not inside(WINDOWS, datetime(2026, 11, 9, 1, 30, tzinfo=cairo))
    assert inside(WINDOWS, datetime(2026, 11, 17, 1, 30, tzinfo=cairo))


def test_without_windows_every_day_counts():
    assert inside((), datetime(2026, 1, 1, tzinfo=UTC)) and inside([], datetime(2030, 6, 6, tzinfo=UTC))


def test_windows_are_read_from_the_environment_and_a_bad_one_is_left_out(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("KEEP_AWAKE_WINDOWS", raising=False)
    assert config.Settings().keep_awake_windows == ()
    monkeypatch.setenv("KEEP_AWAKE_WINDOWS", " 2026-11-09/2026-11-16 , 2026-12-01/2026-12-16,2026-12-20 ")
    assert config.Settings().keep_awake_windows == (*WINDOWS, (date(2026, 12, 20), date(2026, 12, 20)))
    monkeypatch.setenv("KEEP_AWAKE_WINDOWS", "soon/later,2026-12-16/2026-12-01,2026-13-01/2026-13-02,2026-11-09/2026-11-16")
    assert config.Settings().keep_awake_windows == (WINDOWS[0],)  # the malformed and the backwards are dropped, the rest kept


def test_it_visits_only_on_the_days_inside_its_windows():
    clock = {"now": datetime(2026, 11, 20, 12, 0, tzinfo=UTC)}  # between the windows
    seen: list[httpx.Request] = []

    def reply(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200)

    async def scenario() -> tuple[int, int]:
        task = asyncio.create_task(keep_awake(
            URL, every=0.01, transport=httpx.MockTransport(reply), windows=WINDOWS, now=lambda: clock["now"],
        ))
        await asyncio.sleep(0.2)  # many visits would have come by now
        outside = len(seen)
        clock["now"] = datetime(2026, 12, 2, 12, 0, tzinfo=UTC)  # a window starts
        for _ in range(100):
            if len(seen) >= 3:
                break
            await asyncio.sleep(0.01)
        inside_count = len(seen)
        clock["now"] = datetime(2026, 12, 17, 12, 0, tzinfo=UTC)  # it ends
        await asyncio.sleep(0.05)
        settled = len(seen)
        await asyncio.sleep(0.2)
        assert len(seen) == settled  # no more once it has ended
        task.cancel()
        await asyncio.wait([task])
        return outside, inside_count

    outside, inside_count = asyncio.run(scenario())
    assert outside == 0 and inside_count >= 3
