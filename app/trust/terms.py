"""A pledge's terms: what the supporter was shown, signed by the service and written into PayPal's own record of the order.

The terms are the campaign's deal (business, amount, goal, deadline, perk, how it works, a fingerprint of who is paid). A
pledge keeps them with a signature over their hash and the pledge's public reference, and PayPal's order carries the same
hash in its invoice_id ("<reference>-<first 16 hex of the hash>"). Anyone can then check, from the public proof, that the
deal was never changed after the pledge: the signature is the service's, the hash fits the terms, PayPal's order names
that hash, and the campaign's terms today still hash to it."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass

from ..payments.records import iso, major
from .keys import Signer, canonical, digest

VERSION = 1
# How much of the terms' hash the PayPal order carries; the pledge keeps all of it.
INVOICE_HASH = 16


def ref_of(pledge_id: str) -> str:
    """A pledge's public reference, a one-way short form of its id: the id itself withdraws the pledge, so it is never shown."""
    return hashlib.sha256(pledge_id.encode("utf-8")).hexdigest()[:12]


def payee_of(email: str) -> str:
    """A fingerprint of the PayPal account that is paid, so the deal fixes who is paid without publishing the address."""
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()[:16]


def terms_of(row: dict) -> dict:
    """The deal as a campaign's row holds it now."""
    offer = row["offer"] or {}
    return {
        "v": VERSION,
        "campaign": row["id"],
        "business": offer.get("name") or row["title"],
        "title": row["title"],
        "amount": major(row["amount_cents"], row["currency"]),
        "currency": row["currency"],
        "goal": row["goal_count"],
        "deadline": iso(row["deadline"]),
        "perk": offer.get("perk"),
        "how_it_works": offer.get("how_it_works") or "",
        "payee": payee_of(row["payout_email"]),
    }


def envelope_of(ref: str, terms_hash: str) -> dict:
    """What the signature covers: the pledge's reference and the hash of the terms it was made under."""
    return {"v": VERSION, "ref": ref, "terms": terms_hash}


def invoice_id(ref: str, terms_hash: str) -> str:
    return f"{ref}-{terms_hash[:INVOICE_HASH]}"


@dataclass(frozen=True)
class Signed:
    terms: dict
    hash: str
    signature: str
    ref: str
    invoice_id: str


def sign(signer: Signer, pledge_id: str, terms: dict) -> Signed:
    """The terms of a new pledge, signed for it."""
    terms_hash, ref = digest(terms), ref_of(pledge_id)
    signature = signer.sign(canonical(envelope_of(ref, terms_hash)))
    return Signed(terms, terms_hash, signature, ref, invoice_id(ref, terms_hash))


def check(signer: Signer, pledge: dict, current: dict) -> dict:
    """What a stored pledge's terms prove: whether the signature is the service's over this pledge and hash, whether the
    stored terms hash to it, and whether the campaign's terms today still hash to it (None when nothing was signed)."""
    terms, terms_hash, signature = pledge.get("terms"), pledge.get("terms_hash"), pledge.get("terms_sig")
    if not terms or not terms_hash or not signature:
        return {"signature": "missing", "hash": "missing", "unchanged": None}
    signed = signer.verify(canonical(envelope_of(ref_of(pledge["id"]), terms_hash)), signature)
    return {
        "signature": "valid" if signed else "invalid",
        "hash": "valid" if digest(terms) == terms_hash else "invalid",
        "unchanged": digest(current) == terms_hash,
    }
