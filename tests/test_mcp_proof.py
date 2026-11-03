"""check_proof: a campaign's proof, told in plain words, from the shape app/trust/proof.py sends. No network."""
from __future__ import annotations

import asyncio
from datetime import UTC

import httpx
import pytest
from mcp.shared.memory import create_connected_server_and_client_session

from mcp_server import threshold_mcp
from mcp_server.threshold_mcp import TEST_MODE, ThresholdError
from tests.test_mcp_server import BASE, CAMPAIGN_ID, fail, founders

PROOF_PATH = f"/api/campaigns/{CAMPAIGN_ID}/proof"
FINGERPRINT = "ab" * 32


def pledge(ref: str, **changes) -> dict:
    """A pledge as the proof lists it: its public reference, never the id that can withdraw it."""
    return {
        "ref": ref, "how": "page", "state": "authorized", "amount": "25.00", "held_at": "2026-11-18T12:00:00Z",
        "ids": {"authorization": "AUTH-PRIVATE-1", "capture": None},
        "signed": {"terms_hash": FINGERPRINT, "signature": f"signature-of-{ref}"},
        "checks": {"signature": "valid", "hash": "valid", "unchanged": True, "paypal": "matches", "invoice": True, "amount": True},
        "problems": [], "verified": True,
    } | changes


def proof(pledges: list[dict], **changes) -> dict:
    verdicts = [item["verified"] for item in pledges]
    return {
        "campaign": {
            "id": CAMPAIGN_ID, "title": "Back the bakery this block is missing", "business": "Crumb Theory", "status": "open",
            "amount": "25.00", "currency": "USD", "goal": 40, "deadline": "2026-11-30T23:59:00Z",
        },
        "terms": {"v": 1, "campaign": CAMPAIGN_ID, "amount": "25.00", "currency": "USD", "goal": 40},
        "terms_hash": FINGERPRINT,
        "key": {"jwks": "/api/keys", "kid": "k1", "persistent": True},
        "paypal_environment": "sandbox",
        "checked_at": "2026-11-20T15:00:00Z",
        "summary": {
            "listed": len(pledges), "verified": verdicts.count(True), "differs": verdicts.count(False),
            "unconfirmed": verdicts.count(None), "prepared": 0,
        },
        "pledges": pledges,
        "outcome": {"status": "open", "funded": False, "held": len(pledges), "released": 0, "collected": None, "payout": None},
    } | changes


def check(body, **options) -> str:
    api = founders(**{PROOF_PATH: lambda request: httpx.Response(200, json=body)})
    return asyncio.run(api.threshold(zone=UTC, **options).proof(CAMPAIGN_ID))


def test_a_proof_with_mixed_results_says_each_check_and_what_differs():
    differs = pledge("1c7e55aa90d2", verified=False, problems=["PayPal holds $20.00, not the pledged $25.00."], checks={
        "signature": "valid", "hash": "valid", "unchanged": True, "paypal": "differs", "invoice": True, "amount": False})
    unconfirmed = pledge("3d0b88f1e6a4", verified=None, checks={
        "signature": "missing", "hash": "missing", "unchanged": None, "paypal": "unavailable", "invoice": None, "amount": None})
    body = proof([pledge("9f2c41a07bd3"), differs, unconfirmed], summary={
        "listed": 3, "verified": 1, "differs": 1, "unconfirmed": 1, "prepared": 2})
    body["outcome"] |= {"released": 1}

    assert check(body).splitlines() == [
        "## Proof for Crumb Theory",
        "3 pledges: 1 verified, 1 differs, 1 unconfirmed. 2 more pledges prepared, not approved yet.",
        "Each pledge is signed with the exact terms it was made under, and Threshold asked PayPal whether its own record "
        "agrees (Nov 20, 2026, 3:00 PM UTC).",
        "The campaign's terms now have the fingerprint abababababababab…",
        "- 9f2c41a07bd3 ($25, held by PayPal): verified: signature and fingerprint match; terms unchanged since the pledge; "
        "PayPal's record agrees; PayPal's order carries the terms' fingerprint; the amount is the same in PayPal.",
        "- 1c7e55aa90d2 ($25, held by PayPal): DIFFERS: signature and fingerprint match; terms unchanged since the pledge; "
        "PayPal's record differs; PayPal's order carries the terms' fingerprint; the amount differs in PayPal. "
        "What differs: PayPal holds $20.00, not the pledged $25.00.",
        "- 3d0b88f1e6a4 ($25, held by PayPal): unconfirmed: not signed; PayPal did not answer.",
        "",
        "3 holds on the neighbors' PayPal accounts. Nothing is collected unless the goal is met.",
        "1 hold released or withdrawn: those neighbors were never charged.",
        TEST_MODE,
        "",
        f"Proof page: {BASE}/proof/{CAMPAIGN_ID}",
    ]


def test_a_tampered_signature_or_changed_terms_are_not_called_verified():
    tampered = pledge("aa11bb22cc33", verified=False, checks={
        "signature": "invalid", "hash": "valid", "unchanged": False, "paypal": "not_checked", "invoice": None, "amount": None})
    line = check(proof([tampered])).splitlines()[4]
    assert line == ("- aa11bb22cc33 ($25, held by PayPal): DIFFERS: the signed terms do not match; terms changed since the "
                    "pledge; PayPal was not asked.")


def test_a_campaign_nobody_has_pledged_to_has_nothing_to_check_and_no_money_moved():
    lines = check(proof([], summary={"listed": 0, "verified": 0, "differs": 0, "unconfirmed": 0, "prepared": 0})).splitlines()
    assert lines[1] == "No pledge is held yet."
    assert "No money has moved." in lines
    waiting = check(proof([], summary={"listed": 0, "verified": 0, "differs": 0, "unconfirmed": 0, "prepared": 3}))
    assert "3 pledges prepared, waiting for approval in PayPal." in waiting


def test_the_collected_money_and_the_payout_are_told_with_what_paypal_says_of_the_batch():
    paid = proof([pledge(f"{index:012x}", state="captured") for index in range(1, 4)], outcome={
        "status": "collected", "funded": True, "held": 0, "released": 0,
        "collected": {"count": 3, "gross": "75.00", "fee": "2.55", "net": "72.45"},
        "payout": {"status": "paid", "amount": "72.45", "batch": "BATCH1", "item": "ITEM1", "check": "matches", "paypal": "SUCCESS"},
    })
    lines = check(paid).splitlines()
    assert "$75 collected from 3 neighbors, PayPal's fee $2.55, $72.45 to the owner." in lines
    assert "Payout of $72.45 to the owner: paid. PayPal's batch agrees." in lines
    assert ("- 000000000001 ($25, collected): verified: signature and fingerprint match; terms unchanged since the pledge; "
            "PayPal's record agrees; PayPal's order carries the terms' fingerprint; the amount is the same in PayPal.") in lines

    unknown_fee = paid | {"outcome": paid["outcome"] | {"collected": {"count": 3, "gross": "75.00", "fee": None, "net": None},
                                                         "payout": None}}
    assert "$75 collected from 3 neighbors." in check(unknown_fee).splitlines()


def test_only_ten_pledges_are_listed_and_a_live_server_has_no_test_mode_notice():
    many = proof([pledge(f"{index:012x}") for index in range(1, 14)], paypal_environment="live")
    lines = check(many).splitlines()
    assert sum(line.startswith("- ") for line in lines) == 10
    assert "…and 3 more, on the proof page." in lines
    assert TEST_MODE not in lines


def test_no_id_a_name_or_a_signature_is_passed_on():
    text = check(proof([pledge("9f2c41a07bd3", payer={"email_address": "buyer@example.com"})]))
    for private in ("AUTH-PRIVATE-1", "signature-of-9f2c41a07bd3", "buyer@example.com", FINGERPRINT):
        assert private not in text


def test_a_proof_link_works_as_well_as_a_campaign_link():
    for given in (f"{BASE}/proof/{CAMPAIGN_ID}", f"{BASE}/p/{CAMPAIGN_ID}", CAMPAIGN_ID):
        api = founders(**{PROOF_PATH: lambda request: httpx.Response(200, json=proof([pledge("9f2c41a07bd3")]))})
        assert asyncio.run(api.threshold(zone=UTC).proof(given)).startswith("## Proof for Crumb Theory\n")
        assert [request.url.path for request in api.requests] == [PROOF_PATH]


def test_a_missing_campaign_or_an_unreadable_proof_says_so_in_plain_words():
    gone = founders(**{PROOF_PATH: lambda request: httpx.Response(404, json={"detail": "Campaign not found."})})
    assert fail(call=gone.threshold().proof(CAMPAIGN_ID)) == (
        "Campaign not found. Check the id or link; find_campaigns lists the open campaigns.")
    for body in ([], {"pledges": []}, {"summary": []}):
        api = founders(**{PROOF_PATH: lambda request, body=body: httpx.Response(200, json=body)})
        assert fail(call=api.threshold().proof(CAMPAIGN_ID)) == (
            "Threshold sent a proof this tool cannot read. Try again later.")
    with pytest.raises(ThresholdError, match="A campaign id is up to 64 letters"):
        asyncio.run(founders().threshold().proof("../api/keys"))


def test_check_proof_is_a_read_only_tool_over_the_mcp_protocol(monkeypatch):
    api = founders(**{PROOF_PATH: lambda request: httpx.Response(200, json=proof([pledge("9f2c41a07bd3")]))})
    monkeypatch.setattr(threshold_mcp, "connect", lambda: api.threshold(zone=UTC))

    async def session():
        async with create_connected_server_and_client_session(threshold_mcp.mcp) as client:
            tools = {tool.name: tool for tool in (await client.list_tools()).tools}
            return tools["check_proof"], await client.call_tool("check_proof", {"campaign_id": CAMPAIGN_ID})

    tool, answer = asyncio.run(session())
    assert (tool.annotations.readOnlyHint, tool.annotations.idempotentHint, tool.annotations.openWorldHint) == (True, True, True)
    assert tool.inputSchema["required"] == ["campaign_id"] and set(tool.inputSchema["properties"]) == {"campaign_id"}
    assert not answer.isError and answer.content[0].text.startswith("## Proof for Crumb Theory\n1 pledge: 1 verified.")
    assert [(request.method, request.url.path) for request in api.requests] == [("GET", PROOF_PATH)]  # it asks, and only reads
    assert "check_proof" in threshold_mcp.mcp.instructions
