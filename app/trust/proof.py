"""The public proof of a campaign: every pledge's state and what the money did, each checked against PayPal's own record
of the order, and each pledge's signed terms checked against the campaign's deal.

It shows what anyone may know: a short reference per pledge (never its id or its order id, which can withdraw it), the
PayPal ids of the hold and the collection (which mean nothing without PayPal's credentials), amounts and states. It names
no one. The checks are made live, a few at a time, and the answer is kept for a short while, so a page that many people
open costs PayPal one set of calls."""
from __future__ import annotations

import asyncio
import time
from collections.abc import Awaitable, Callable, Mapping
from datetime import datetime
from typing import Any

from ..payments import pledges
from ..payments.paypal import PayPalClient, PayPalError, decimal_amount, summarize_capture, summarize_payout
from ..payments.records import iso, major
from . import terms
from .keys import Signer, digest

LIVE_CHECKS = 40
IN_PARALLEL = 6
KEPT_FOR = 45.0
KEPT_MOST = 500
# The pledge states PayPal can confirm, and the PayPal state of the hold that agrees with each (a collected pledge is
# confirmed by its collection instead, as a renewed hold may have been collected rather than the original).
HOLD_STATES = {
    "authorized": {pledges.PledgeStatus.AUTHORIZED},
    "voided": {pledges.PledgeStatus.VOIDED},
    # A pledge withdrawn before it was approved never had a hold to void.
    "withdrawn": {pledges.PledgeStatus.VOIDED, pledges.PledgeStatus.CREATED},
    "declined": {pledges.PledgeStatus.DECLINED},
}
COLLECTED = ("captured", "refunded")
CHECKABLE = (*HOLD_STATES, *COLLECTED)
RELEASED = ("voided", "withdrawn", "expired")


class ProofBook:
    """Proofs kept for a short while, one per campaign, so a busy page is not a stream of PayPal calls."""

    def __init__(self, kept_for: float = KEPT_FOR) -> None:
        self.kept_for = kept_for
        self._kept: dict[str, tuple[float, dict]] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def get(self, campaign_id: str, make: Callable[[], Awaitable[dict]]) -> dict:
        async with self._locks.setdefault(campaign_id, asyncio.Lock()):
            kept = self._kept.get(campaign_id)
            if kept and time.monotonic() - kept[0] < self.kept_for:
                return kept[1]
            proof = await make()
            self._kept[campaign_id] = (time.monotonic(), proof)
            if len(self._kept) > KEPT_MOST:
                for old in sorted(self._kept, key=lambda key: self._kept[key][0])[: KEPT_MOST // 5]:
                    self._kept.pop(old, None)
                    self._locks.pop(old, None)
            return proof


def invoice_of(order: Mapping[str, Any]) -> str | None:
    units = [unit for unit in order.get("purchase_units") or [] if isinstance(unit, dict)]
    value = units[0].get("invoice_id") if units else None
    return value if isinstance(value, str) else None


def same_amount(shown: object, expected: str) -> bool:
    try:
        return decimal_amount(shown) == decimal_amount(expected)
    except (TypeError, ValueError):
        return False


async def live_check(client: PayPalClient, row: dict, pledge: dict) -> dict:
    """What PayPal says about a pledge's order now, against what we hold: the hold's state, or the collection, the amount
    and the terms' hash in the invoice id. `check` is matches, differs or unavailable."""
    try:
        order = await client.get_order(pledge["order_id"])
    except (PayPalError, ValueError):
        return {"check": "unavailable", "problems": []}
    expected = major(pledge["amount_cents"], row["currency"])
    problems: list[str] = []
    if pledge["status"] in COLLECTED:
        capture = summarize_capture(order)
        shown, state = capture["amount"], "captured" if capture["capture_id"] else "not collected"
        if not capture["capture_id"]:
            problems.append("PayPal shows no collection for this pledge.")
        elif pledge.get("capture_id") and capture["capture_id"] != pledge["capture_id"]:
            problems.append("PayPal names a different collection than our record.")
    else:
        hold = pledges.pledge_from_order(pledge["id"], order)
        shown, state = hold.amount, hold.status.value
        if hold.status not in HOLD_STATES[pledge["status"]]:
            problems.append(f"PayPal shows this hold as {state}, our record says {pledge['status']}.")
    if shown and not same_amount(shown, expected):
        problems.append(f"PayPal shows {shown}, our record says {expected}.")
    invoice = None
    if pledge.get("terms_hash"):
        invoice = invoice_of(order) == terms.invoice_id(terms.ref_of(pledge["id"]), pledge["terms_hash"])
        if not invoice:
            problems.append("PayPal's order does not carry this pledge's signed terms.")
    return {
        "check": "differs" if problems else "matches", "state": state, "invoice": invoice,
        "amount": None if not shown else same_amount(shown, expected), "problems": problems,
    }


async def payout_check(client: PayPalClient | None, payout: dict) -> dict:
    """The payout as we hold it, and as PayPal's batch shows it now."""
    ours = {
        "status": payout["status"], "amount": major(payout["amount_cents"], payout["currency"]),
        "batch": payout.get("batch_id"), "item": payout.get("item_id"),
    }
    if client is None or not payout.get("batch_id"):
        return {**ours, "check": "not_checked"}
    try:
        batch = await client.get_payout_batch(payout["batch_id"])
    except (PayPalError, ValueError):
        return {**ours, "check": "unavailable"}
    live = summarize_payout(batch)
    items = [item for item in batch.get("items") or [] if isinstance(item, dict)]
    paid = ((items[0].get("payout_item") or {}).get("amount") or {}).get("value") if items else None
    agrees = live["status"] == payout["status"] and (paid is None or same_amount(paid, ours["amount"]))
    return {**ours, "check": "matches" if agrees else "differs", "paypal": live["status"]}


def verdict(terms_check: dict, live: dict) -> bool | None:
    """True when everything that could be checked came out right, False when something did not, None when nothing
    could be confirmed (no signed terms, and PayPal not asked or not answering)."""
    if live["check"] == "differs" or "invalid" in (terms_check["signature"], terms_check["hash"]):
        return False
    if terms_check["unchanged"] is False:
        return False
    signed = terms_check["signature"] == "valid"
    return True if signed and live["check"] == "matches" else None


async def proof_of(
    row: dict, rows: list[dict], payout: dict | None, signer: Signer, client: PayPalClient | None, now: datetime,
    environment: str,
) -> dict:
    """The proof of one campaign, from its row, its pledges' rows and its payout row."""
    currency = row["currency"]
    current = terms.terms_of(row)
    listed = [pledge for pledge in rows if pledge["status"] != "created"]
    live: dict[str, dict] = {}
    if client is not None:
        gate = asyncio.Semaphore(IN_PARALLEL)
        paypal = client

        async def ask(pledge: dict) -> None:
            async with gate:
                live[pledge["id"]] = await live_check(paypal, row, pledge)

        await asyncio.gather(*(ask(pledge) for pledge in [p for p in listed if p["status"] in CHECKABLE][:LIVE_CHECKS]))
    items = []
    for pledge in listed:
        checked = terms.check(signer, pledge, current)
        seen = live.get(pledge["id"]) or {"check": "not_checked", "problems": []}
        items.append({
            "ref": terms.ref_of(pledge["id"]),
            "how": "assistant" if pledge["flow"] == "redirect" else "page",
            "state": pledge["status"],
            "amount": major(pledge["amount_cents"], currency),
            "held_at": iso(pledge["authorized_at"]),
            "ids": {"authorization": pledge["authorization_id"], "capture": pledge["capture_id"]},
            "signed": {"terms_hash": pledge.get("terms_hash"), "signature": pledge.get("terms_sig")},
            "checks": {
                "signature": checked["signature"], "hash": checked["hash"], "unchanged": checked["unchanged"],
                "paypal": seen["check"], "invoice": seen.get("invoice"), "amount": seen.get("amount"),
            },
            "problems": seen["problems"],
            "verified": verdict(checked, seen),
        })
    collected = [pledge for pledge in rows if pledge["status"] == "captured"]
    gross = sum(pledge["amount_cents"] for pledge in collected)
    known = all(pledge["net_cents"] is not None for pledge in collected)
    net = sum(pledge["net_cents"] for pledge in collected) if known else None
    return {
        "campaign": {
            "id": row["id"], "title": row["title"], "business": current["business"], "status": row["status"],
            "amount": current["amount"], "currency": currency, "goal": row["goal_count"], "deadline": current["deadline"],
        },
        "terms": current,
        "terms_hash": digest(current),
        "key": {"jwks": "/api/keys", "kid": signer.kid, "persistent": signer.persistent},
        "paypal_environment": environment,
        "checked_at": iso(now),
        "summary": {
            "listed": len(listed),
            "verified": sum(1 for item in items if item["verified"] is True),
            "differs": sum(1 for item in items if item["verified"] is False),
            "unconfirmed": sum(1 for item in items if item["verified"] is None),
            "prepared": sum(1 for pledge in rows if pledge["status"] == "created"),
        },
        "pledges": items,
        "outcome": {
            "status": row["status"],
            "funded": row["funded"],
            "held": sum(1 for pledge in rows if pledge["status"] == "authorized"),
            "released": sum(1 for pledge in rows if pledge["status"] in RELEASED),
            "collected": {
                "count": len(collected), "gross": major(gross, currency),
                "fee": major(gross - net, currency) if net is not None else None,
                "net": major(net, currency) if net is not None else None,
            } if collected else None,
            "payout": await payout_check(client, payout) if payout else None,
        },
    }
