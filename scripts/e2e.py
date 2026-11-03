"""End-to-end run of the whole product against a running server and PayPal's sandbox, as people use it.

One campaign is funded: its first pledge is prepared by the assistant (a search, then "yes", inside limits the neighbor set),
the others by neighbors who each set their own limits; every neighbor approves in PayPal (headless Chromium, locale en_US)
and the campaign's page holds the pledge. The proof is read back (each pledge's signed terms against PayPal's own record),
the owner closes the campaign, it settles and the owner is paid out. A second campaign is cancelled short of its goal and
every hold is released. A pledge beyond a neighbor's limits is refused. Prints each step's status, never secrets.

    python scripts/e2e.py [--server http://127.0.0.1:8781] [--amount 5.00]

Start the server first, from the repository's root, with the development login, its own address and its own database (the
settings come from .env, or from the file ENV_FILE names, which may live outside the repository):

    $env:ENV_FILE="C:\\path\\to\\.env"; $env:DATABASE_URL="sqlite:///C:/path/e2e.db"; $env:AUTH_DEV_LOGIN="true"
    $env:PUBLIC_URL="http://127.0.0.1:8781"; $env:PAYPAL_WEBHOOK_ID=""; python -m uvicorn app.main:app --port 8781

Needs in the env file: the sandbox app's PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET, three US personal sandbox buyers
(PAYPAL_SANDBOX_BUYER_EMAIL and _PASSWORD, with _2 and _3 siblings: a goal counts distinct PayPal accounts, at least 3),
CRON_SECRET (to run the settlement pass the scheduler would), and optionally PAYPAL_SANDBOX_PAYOUT_EMAIL (the owner's
PayPal email, which receives the payout; the first buyer's by default). Run it with a Python that has httpx and playwright.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
import time
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from sandbox_money_flows import approve, buyers, env_file  # noqa: E402

LIMITS = "X-Limits"
PLACE = {"address": "Zamalek, Cairo, Egypt", "lat": 30.0626, "lon": 31.2197}
BAKERY = {"kind": "bakery", "description": "A neighborhood bakery for the morning crowd.",
          "why_here": "Neighbors here walk to their bakery."}
GYM = {"kind": "gym", "description": "A small strength gym with coached classes.", "why_here": "Neighbors here walk to their gym."}
failures: list[str] = []


def check(label: str, ok: bool, detail: object = "") -> bool:
    print(f"  {'ok  ' if ok else 'FAIL'} {label}{f': {detail}' if detail != '' else ''}")
    if not ok:
        failures.append(label)
    return ok


def step(label: str, response: httpx.Response, *keys: str) -> dict:
    try:
        body = response.json()
    except ValueError:
        body = {}
    shown = {key: body.get(key) for key in keys} if keys and isinstance(body, dict) else ""
    if response.status_code >= 400 and isinstance(body, dict):
        shown = {"detail": body.get("detail"), **({"code": body["code"]} if "code" in body else {}),
                 **({"problems": body["problems"]} if "problems" in body else {})}
    print(f"{label}: {response.status_code} {shown}")
    return body if isinstance(body, dict) else {}


async def start(http: httpx.AsyncClient, business: dict, name: str, amount: str, payout: str) -> str | None:
    terms = {**business, **PLACE, "name": name, "amount": amount, "goal": 3, "perk": None,
             "deadline": (datetime.now(UTC) + timedelta(days=7)).isoformat()}
    drafted = step(f"draft {name}", await http.post("/api/business-campaigns/draft", json=terms), "title", "problems")
    if drafted.get("problems") or not drafted.get("title"):
        return None
    created = step(f"create {name}", await http.post("/api/business-campaigns", json={
        **terms, "payout_email": payout, **{key: drafted[key] for key in ("title", "pitch", "perks")},
    }), "id", "url")
    return created.get("id")


async def mint(server: str, **changes) -> str:
    """Limits a neighbor sets on the Ask page: the token an assistant presents."""
    body = {"max_pledge": "20.00", "max_total": "20.00", "max_count": 2, "days": 1, **changes}
    async with httpx.AsyncClient(base_url=server, timeout=60) as neighbor:
        response = await neighbor.post("/api/limits", json=body)
        print(f"neighbor sets limits ({body['max_pledge']} each, {body['max_total']} in all): {response.status_code}")
        response.raise_for_status()
        return response.json()["token"]


async def approve_and_hold(server: str, browser, campaign_id: str, approve_url: str, order_id: str, buyer, label: str) -> dict:
    """The neighbor approves in PayPal and comes back to the campaign's page, which holds the pledge."""
    context = await browser.new_context(locale="en-US")
    page = await context.new_page()
    landed = await approve(page, approve_url, label, buyer, back=f"{server}/p/{campaign_id}")
    await context.close()
    query = parse_qs(urlsplit(landed).query)
    reference = (query.get("pledge") or query.get("token") or [order_id])[0]
    async with httpx.AsyncClient(base_url=server, timeout=90) as neighbor:  # no account, no cookie
        return step(f"{label} is held", await neighbor.post(f"/api/campaigns/{campaign_id}/pledges/{reference}/authorize"),
                    "status")


async def pledge_by_assistant(server: str, browser, campaign_id: str, buyer, label: str) -> dict | None:
    """A search, the assistant's question, a "yes": the pledge it prepares, approved by the neighbor in PayPal."""
    token = await mint(server)
    async with httpx.AsyncClient(base_url=server, timeout=120, headers={LIMITS: token}) as neighbor:
        first = step(f"{label}: asks the assistant", await neighbor.post("/api/assistant", json={
            "messages": [{"role": "user", "content": "a bakery near Zamalek, Cairo"}]}), "mode", "shown", "asked")
        check("the assistant shows the campaign and asks before preparing anything",
              first.get("shown") == [campaign_id] and first.get("asked") == campaign_id and first.get("pledge") is None, first.get("reply"))
        said = step(f"{label}: says yes", await neighbor.post("/api/assistant", json={"messages": [
            {"role": "user", "content": "a bakery near Zamalek, Cairo"},
            {"role": "assistant", "content": first["reply"], "shown": first["shown"], "asked": first["asked"]},
            {"role": "user", "content": "yes"}]}), "mode", "asked")
        prepared = said.get("pledge")
        if not check("the assistant prepares one pledge", bool(prepared), said.get("reply")):
            return None
        print(f"  prepared: ${prepared['amount']}, ref {prepared['ref']}, receipt {prepared['receipt'][:6]}…, "
              f"left of the limits ${(prepared.get('limits') or {}).get('remaining')}")
        order_id = prepared["approve_url"].rsplit("token=", 1)[-1]
        held = await approve_and_hold(server, browser, campaign_id, prepared["approve_url"], order_id, buyer, label)
        check("PayPal holds the pledge", held.get("status") == "authorized", held.get("status"))
        # A second pledge to the same campaign under the same limits is refused: one pledge to a campaign.
        again = await neighbor.post(f"/api/campaigns/{campaign_id}/pledges", json={"flow": "redirect"})
        check("a second pledge to the same campaign under the same limits is refused", again.status_code == 403,
              again.json().get("code") if again.status_code != 200 else "accepted")
        return prepared


async def pledge_by_page(server: str, browser, campaign_id: str, buyer, label: str, **limits) -> dict | None:
    """A neighbor with limits of their own pledges to the campaign; PayPal's page, then the campaign's page, hold it."""
    token = await mint(server, **limits)
    async with httpx.AsyncClient(base_url=server, timeout=90, headers={LIMITS: token}) as neighbor:
        order = step(f"{label} pledges (redirect)", await neighbor.post(
            f"/api/campaigns/{campaign_id}/pledges", json={"flow": "redirect"}), "order_id", "ref")
        if not order.get("approve_url"):
            return None
    held = await approve_and_hold(server, browser, campaign_id, order["approve_url"], order["order_id"], buyer, label)
    check(f"{label}: PayPal holds the pledge", held.get("status") == "authorized", held.get("status"))
    return order


async def show_proof(http: httpx.AsyncClient, campaign_id: str, title: str) -> dict:
    proof = step(f"proof ({title})", await http.get(f"/api/campaigns/{campaign_id}/proof"))
    summary = proof.get("summary") or {}
    print(f"  summary: {summary}")
    for pledge in proof.get("pledges") or []:
        print(f"  pledge {pledge['ref']}: {pledge['state']}, verified {pledge['verified']}, checks {pledge['checks']}, "
              f"problems {pledge['problems']}")
    print(f"  outcome: {proof.get('outcome')}")
    return proof


async def run(server: str, amount: str) -> int:
    from playwright.async_api import async_playwright

    env = env_file()
    found = buyers()
    run_id = uuid.uuid4().hex[:6]
    async with httpx.AsyncClient(base_url=server, timeout=120) as owner:
        config = (await owner.get("/api/config")).json()
        paypal = config.get("paypal") or {}
        print(f"config: PayPal enabled {paypal.get('enabled')}, {paypal.get('environment')}, dev login {config.get('dev_login')}")
        if not paypal.get("enabled") or paypal.get("environment") != "sandbox" or not config.get("dev_login"):
            print("The server needs PayPal (sandbox) and AUTH_DEV_LOGIN=true with a PUBLIC_URL that is not https.")
            return 1
        if len(found) < 3:
            print("Three different sandbox buyers are needed (see this script's docstring).")
            return 1
        step("owner signs in", await owner.post("/api/auth/dev", json={"email": f"e2e-{run_id}@example.com", "name": "E2E Owner"}))
        payout = env.get("PAYPAL_SANDBOX_PAYOUT_EMAIL") or found[0][0]
        funded_id = await start(owner, BAKERY, f"E2E Bakery {run_id}", amount, payout)
        missed_id = await start(owner, GYM, f"E2E Gym {run_id}", amount, payout)
        if not funded_id or not missed_id:
            return 1

        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True)
            try:
                print("\n== The funded campaign")
                await pledge_by_assistant(server, browser, funded_id, found[0], "neighbor 1 (assistant)")
                await pledge_by_page(server, browser, funded_id, found[1], "neighbor 2")
                await pledge_by_page(server, browser, funded_id, found[2], "neighbor 3")
                view = step("campaign", await owner.get(f"/api/campaigns/{funded_id}"), "status", "progress")
                funded = (view.get("progress") or {}).get("funded")
                check("three different neighbors fund the goal", bool(funded), (view.get("progress") or {}).get("supporters"))
                proof = await show_proof(owner, funded_id, "three holds")
                check("all three pledges verify against PayPal", (proof.get("summary") or {}).get("verified") == 3,
                      proof.get("summary"))

                print("\n== The campaign that falls short")
                limits = await mint(server)
                async with httpx.AsyncClient(base_url=server, timeout=90, headers={LIMITS: limits}) as neighbor:
                    order = step("neighbor 1 pledges (redirect)", await neighbor.post(
                        f"/api/campaigns/{missed_id}/pledges", json={"flow": "redirect"}), "order_id")
                held = await approve_and_hold(server, browser, missed_id, order["approve_url"], order["order_id"], found[0], "neighbor 1")
                check("PayPal holds the one pledge", held.get("status") == "authorized", held.get("status"))
            finally:
                await browser.close()

        print("\n== The funded campaign closes, settles and pays out")
        closed = step("owner closes early", await owner.post(f"/api/campaigns/{funded_id}/close"), "status", "accepting")
        secret = env.get("CRON_SECRET")
        deadline = time.monotonic() + 150
        while secret and time.monotonic() < deadline:
            step("settlement pass", await owner.post("/api/cron/settle", headers={"X-Cron-Secret": secret}), "settled")
            status = (await owner.get(f"/api/campaigns/{funded_id}")).json()
            payout_state = ((status.get("owner") or {}).get("payout") or {})
            print(f"  status {status.get('status')}, payout {payout_state}")
            if payout_state.get("status") in ("paid", "failed"):
                break
            await asyncio.sleep(10)
        proof = await show_proof(owner, funded_id, "settled")
        outcome = proof.get("outcome") or {}
        collected = outcome.get("collected") or {}
        check("the campaign is collected", outcome.get("status") == "collected", outcome.get("status"))
        check("three pledges were collected", collected.get("count") == 3, collected)
        pay = outcome.get("payout") or {}
        check("the owner is paid and PayPal's batch agrees", pay.get("status") == "paid" and pay.get("check") == "matches", pay)
        print(f"  closed: {closed}")

        print("\n== The campaign that fell short is cancelled: every hold is released")
        step("owner cancels", await owner.post(f"/api/campaigns/{missed_id}/cancel"), "status", "accepting")
        deadline = time.monotonic() + 90
        while secret and time.monotonic() < deadline:
            step("settlement pass", await owner.post("/api/cron/settle", headers={"X-Cron-Secret": secret}), "settled")
            proof = (await owner.get(f"/api/campaigns/{missed_id}/proof")).json()
            states = [pledge["state"] for pledge in proof.get("pledges") or []]
            if states and all(state in ("voided", "withdrawn", "expired") for state in states):
                break
            await asyncio.sleep(8)
        proof = await show_proof(owner, missed_id, "released")
        outcome = proof.get("outcome") or {}
        check("the campaign is cancelled", outcome.get("status") == "cancelled", outcome.get("status"))
        check("the hold is released and nobody was charged", outcome.get("released") == 1 and not outcome.get("collected"), outcome)

    print()
    if failures:
        print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
        return 1
    print("All checks passed.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--server", default="http://127.0.0.1:8781")
    parser.add_argument("--amount", default="5.00", help="each pledge, 5.00 to 200.00")
    options = parser.parse_args()
    return asyncio.run(run(options.server.rstrip("/"), options.amount))


if __name__ == "__main__":
    sys.exit(main())
