"""An owner starts a campaign from their own description of the business; all money and copy checks use the Founders
engine."""
from __future__ import annotations

import pytest

from app.db.tables import campaigns
from tests.founders_fakes import BUSINESS, Clock, FakePayPal, business_terms, configure, dev_sign_in, make_client
from tests.test_campaigns import pledge, table


@pytest.fixture
def business_world(monkeypatch):
    configure(monkeypatch)
    clock = Clock()
    paypal = FakePayPal(clock)
    with make_client(paypal=paypal, clock=clock) as client:
        dev_sign_in(client)
        yield client, paypal, clock


def terms(clock, **changes) -> dict:
    return business_terms(clock, 7, **{"perk": "10% off every visit in the first year", **changes})


def drafted(client, body):
    response = client.post("/api/business-campaigns/draft", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def publish(client, body, **edits):
    words = drafted(client, body)
    copy = {key: words[key] for key in ("title", "pitch", "perks")}
    return client.post("/api/business-campaigns", json={**body, "payout_email": "owner@example.com", **copy, **edits})


def test_an_owner_starts_a_campaign_and_it_is_never_presented_as_measured_evidence(business_world):
    client, _, clock = business_world
    response = publish(client, terms(clock))
    assert response.status_code == 200, response.text
    campaign_id = response.json()["id"]
    row = table(client, campaigns)[0]
    assert (row["user_id"], row["payout_email"]) == (client.get("/api/me").json()["user"]["id"], "owner@example.com")
    view = client.get(f"/api/campaigns/{campaign_id}").json()
    assert view["source"] == "owner"
    assert set(view) == {
        "id", "status", "accepting", "source", "name", "place", "concept", "evidence", "title", "pitch", "perks",
        "how_it_works", "amount", "currency", "goal", "deadline", "closed_at", "progress", "is_owner", "owner",
    }
    assert view["name"] == BUSINESS["name"] and view["evidence"] == [BUSINESS["why_here"]]
    assert client.get("/api/campaigns").json()["campaigns"][0]["id"] == campaign_id
    assert client.get("/api/me/campaigns").status_code == 200
    assert client.get("/founders/start").status_code == 200


def test_business_campaigns_use_the_same_real_hold_capture_and_payout_code(business_world):
    client, paypal, clock = business_world
    response = publish(client, terms(clock))
    assert response.status_code == 200, response.text
    campaign_id = response.json()["id"]
    for _ in range(3):
        pledge(client, campaign_id)
    closed = client.post(f"/api/campaigns/{campaign_id}/close")
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "collected" and closed.json()["progress"]["total"] == "75.00"
    assert len(paypal.calls(r"/v2/payments/authorizations/[^/]+/capture")) == 3
    assert len(paypal.calls(r"/v1/payments/payouts")) == 1


def test_editing_unproven_claims_is_refused(business_world):
    client, _, clock = business_world
    body = terms(clock)
    for title in ("The best place on the block", "The only cafe in East Austin"):
        response = publish(client, body, title=title)
        assert response.status_code == 422 and response.json()["problems"], response.text
    assert table(client, campaigns) == []


@pytest.mark.parametrize("changes", [
    {"goal": 0}, {"goal": 1}, {"amount": 25.0}, {"amount": "250.00"},
    {"name": "  "}, {"description": "        "}, {"address": "   "}, {"lat": 91}, {"lon": -181},
    {"kind": "not-a-kind"}, {"unknown_field": "made-up"},
])
def test_bad_business_terms_are_refused_before_any_campaign_is_stored(business_world, changes):
    client, _, clock = business_world
    response = client.post("/api/business-campaigns/draft", json=terms(clock, **changes))
    assert response.status_code == 422, response.text
    assert table(client, campaigns) == []


def test_starting_business_campaigns_requires_sign_in_and_is_rate_limited(business_world):
    client, _, clock = business_world
    body = terms(clock)
    words = drafted(client, body)
    payload = {**body, "payout_email": "owner@example.com",
               **{key: words[key] for key in ("title", "pitch", "perks")}}
    client.app.state.campaign_limiter.limit = 0
    assert client.post("/api/business-campaigns", json=payload).status_code == 429
    client.post("/api/auth/logout")
    assert client.post("/api/business-campaigns/draft", json=body).status_code == 401
    assert client.post("/api/business-campaigns", json=payload).status_code == 401
