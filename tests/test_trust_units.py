"""The signing key, a pledge's signed terms and the limits an assistant works within, without the app: what each one
proves, and that every way of tampering with it is caught."""
from __future__ import annotations

import base64
import hashlib
import json
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from app.trust import limits, terms
from app.trust.keys import Signer, b64, canonical, digest, unb64

NOW = datetime(2026, 11, 3, 12, 0, tzinfo=UTC)
LOOK = {"max_pledge": "30.00", "max_total": "60.00", "max_count": 3, "days": 1, "near": None, "kinds": None}


def campaign(**changes) -> dict:
    """A campaign's row as the store gives it."""
    return {
        "id": "c1", "title": "Open Morning Table", "currency": "USD", "amount_cents": 2500, "goal_count": 3,
        "deadline": NOW + timedelta(days=10), "payout_email": "Owner@Example.com", "lat": 30.26, "lon": -97.71,
        "offer": {"name": "Morning Table", "perk": "10% off", "how_it_works": "PayPal holds $25.00.",
                  "concept": {"genre": "cafe"}},
        **changes,
    }


def mint(signer: Signer, **changes) -> tuple[str, limits.Limits]:
    made = limits.make(now=NOW, **{**LOOK, **changes})
    return limits.encode(signer, made), made


# The key

def test_a_document_is_hashed_and_signed_as_one_canonical_text():
    assert canonical({"b": 1, "a": [1, 2]}) == b'{"a":[1,2],"b":1}'
    assert canonical({"a": 1, "b": [1, 2]}) == canonical({"b": [1, 2], "a": 1})
    assert canonical({"x": "café"}) == '{"x":"café"}'.encode()
    assert digest({"a": 1}) == hashlib.sha256(b'{"a":1}').hexdigest()
    assert unb64(b64(b"\xfb\xff\xfe")) == b"\xfb\xff\xfe" and "=" not in b64(b"ab")


def test_a_seed_always_gives_the_same_key_and_no_seed_gives_a_key_for_one_run():
    seed = Signer.new_seed()
    first, second = Signer.load(seed), Signer.load(seed)
    assert first.persistent and (first.kid, first.sign(b"x")) == (second.kid, second.sign(b"x"))
    one, other = Signer.load(""), Signer.load("  ")
    assert not one.persistent and one.kid != other.kid != first.kid
    assert len(unb64(seed)) == 32


@pytest.mark.parametrize("seed", ["not base64 at all!!", b64(b"too short"), b64(bytes(33))])
def test_a_seed_that_is_not_32_bytes_is_refused(seed):
    with pytest.raises(ValueError):
        Signer.load(seed)


def test_a_signature_proves_only_what_was_signed_and_only_by_this_key():
    signer, other = Signer.load(""), Signer.load("")
    signature = signer.sign(b"the terms")
    assert signer.verify(b"the terms", signature)
    assert not signer.verify(b"the terms.", signature)
    assert not other.verify(b"the terms", signature)
    assert not any(signer.verify(b"the terms", bad) for bad in ("", "!!!", signature[:-4], b64(bytes(64))))


def test_the_published_key_checks_signatures_by_itself_and_holds_nothing_secret():
    signer = Signer.load(Signer.new_seed())
    [key] = signer.jwks()["keys"]
    assert (key["kty"], key["crv"], key["alg"], key["use"], key["kid"]) == ("OKP", "Ed25519", "EdDSA", "sig", signer.kid)
    assert set(key) == {"kty", "crv", "x", "kid", "use", "alg"}  # no "d": the private half is never published
    public = Ed25519PublicKey.from_public_bytes(unb64(key["x"]))
    public.verify(unb64(signer.sign(b"hello")), b"hello")  # raises if it were wrong
    assert seed_is_not_in(signer.jwks(), signer)


def seed_is_not_in(published: dict, signer: Signer) -> bool:
    private = signer.key.private_bytes_raw()
    return b64(private) not in json.dumps(published) and private.hex() not in json.dumps(published)


# The terms

def test_the_terms_are_the_deal_and_name_the_payee_only_by_a_fingerprint():
    deal = terms.terms_of(campaign())
    assert deal == {
        "v": 1, "campaign": "c1", "business": "Morning Table", "title": "Open Morning Table", "amount": "25.00",
        "currency": "USD", "goal": 3, "deadline": "2026-11-13T12:00:00Z", "perk": "10% off",
        "how_it_works": "PayPal holds $25.00.", "payee": hashlib.sha256(b"owner@example.com").hexdigest()[:16],
    }
    assert "owner@example.com" not in json.dumps(deal).lower()
    assert terms.terms_of(campaign(payout_email="  owner@EXAMPLE.com "))["payee"] == deal["payee"]
    assert terms.terms_of(campaign(payout_email="other@example.com"))["payee"] != deal["payee"]


def test_a_pledge_is_signed_with_its_own_reference_and_the_terms_hash():
    signer = Signer.load("")
    deal = terms.terms_of(campaign())
    signed = terms.sign(signer, "a" * 32, deal)
    assert signed.hash == digest(deal) and len(signed.ref) == 12 and "a" * 12 not in signed.ref
    assert signed.invoice_id == f"{signed.ref}-{signed.hash[:16]}" and len(signed.invoice_id) == 29
    again = terms.sign(signer, "b" * 32, deal)
    assert (again.hash, again.ref != signed.ref, again.signature != signed.signature) == (signed.hash, True, True)
    assert terms.ref_of("a" * 32) == signed.ref  # the reference is derived, so the proof can recompute it


def stored(signed: terms.Signed, pledge_id: str) -> dict:
    return {"id": pledge_id, "terms": signed.terms, "terms_hash": signed.hash, "terms_sig": signed.signature}


def test_a_pledge_s_terms_check_out_while_nothing_changed():
    signer = Signer.load("")
    current = terms.terms_of(campaign())
    pledge = stored(terms.sign(signer, "p" * 32, current), "p" * 32)
    assert terms.check(signer, pledge, current) == {"signature": "valid", "hash": "valid", "unchanged": True}


def test_every_way_of_changing_what_a_pledge_was_promised_is_caught():
    signer = Signer.load("")
    current = terms.terms_of(campaign())
    signed = terms.sign(signer, "p" * 32, current)
    pledge = stored(signed, "p" * 32)

    # The owner's deal changed after the pledge: a new goal, amount, deadline, payee or wording.
    for change in ({"goal_count": 2}, {"amount_cents": 5000}, {"deadline": NOW + timedelta(days=3)},
                   {"payout_email": "thief@example.com"}, {"title": "Something else"}):
        changed = terms.check(signer, pledge, terms.terms_of(campaign(**change)))
        assert (changed["signature"], changed["hash"], changed["unchanged"]) == ("valid", "valid", False), change

    # The stored copy was edited, or the signature was moved to another pledge or swapped for another key's.
    edited = {**pledge, "terms": {**current, "goal": 1}}
    assert terms.check(signer, edited, current)["hash"] == "invalid"
    moved = {**pledge, "id": "q" * 32}
    assert terms.check(signer, moved, current)["signature"] == "invalid"
    forged = {**pledge, "terms_sig": Signer.load("").sign(canonical(terms.envelope_of(terms.ref_of("p" * 32), signed.hash)))}
    assert terms.check(signer, forged, current)["signature"] == "invalid"
    rehashed = {**edited, "terms_hash": digest(edited["terms"])}  # edited AND re-hashed: the signature no longer fits
    assert terms.check(signer, rehashed, current)["signature"] == "invalid"


def test_a_pledge_made_before_terms_were_signed_says_so():
    signer = Signer.load("")
    assert terms.check(signer, {"id": "p"}, terms.terms_of(campaign())) == {
        "signature": "missing", "hash": "missing", "unchanged": None}


# The limits

def test_limits_are_made_from_the_person_s_terms():
    made = limits.make(
        now=NOW, max_pledge="30.00", max_total="75.50", max_count=2, days=2,
        near={"lat": 40.7, "lon": -73.9, "km": 3}, kinds=["bakery", "cafe", "bakery"],
    )
    assert (made.max_pledge_cents, made.max_total_cents, made.max_count, made.currency) == (3000, 7550, 2, "USD")
    assert made.near == (40.7, -73.9, 3.0) and made.kinds == ("bakery", "cafe")
    assert made.expires - made.issued == timedelta(days=2) and made.issued.microsecond == 0
    assert len(made.jti) == 32 and limits.make(now=NOW, **LOOK).jti != limits.make(now=NOW, **LOOK).jti


@pytest.mark.parametrize(("change", "words"), [
    ({"max_pledge": "4.99"}, "limit for one pledge"),
    ({"max_pledge": "200.01"}, "limit for one pledge"),
    ({"max_pledge": "abc"}, "limit for one pledge"),
    ({"max_pledge": 30.5}, "limit for one pledge"),  # a float cannot hold cents
    ({"max_pledge": None}, "limit for one pledge"),
    ({"max_pledge": "10.005"}, "limit for one pledge"),
    ({"max_total": "20.00"}, "limit in all"),  # less than one pledge
    ({"max_total": "1000.01"}, "limit in all"),
    ({"max_count": 0}, "number of pledges"),
    ({"max_count": 11}, "number of pledges"),
    ({"max_count": True}, "number of pledges"),
    ({"max_count": "3"}, "number of pledges"),
    ({"days": 0}, "last from an hour to 30 days"),
    ({"days": 31}, "last from an hour to 30 days"),
    ({"days": "1"}, "last from an hour to 30 days"),
    ({"near": {"lat": 91, "lon": 0, "km": 1}}, "place needs"),
    ({"near": {"lat": 0, "lon": 0, "km": 0}}, "place needs"),
    ({"near": {"lat": 0, "lon": 0, "km": 101}}, "place needs"),
    ({"near": {"lat": 0, "lon": 0}}, "place needs"),
    ({"near": {"lat": "x", "lon": 0, "km": 1}}, "place needs"),
    ({"kinds": []}, "kinds of place"),
    ({"kinds": ["casino"]}, "kinds of place"),
])
def test_limits_outside_what_a_campaign_can_be_are_refused_in_plain_words(change, words):
    with pytest.raises(limits.LimitsError) as refused:
        limits.make(now=NOW, **{**LOOK, **change})
    assert (refused.value.code, refused.value.status) == ("invalid_limits", 422) and words in refused.value.detail


def test_limits_are_a_signed_token_that_any_jwt_library_checks_with_the_published_key():
    signer = Signer.load("")
    token, made = mint(signer, near={"lat": 40.7, "lon": -73.9, "km": 3}, kinds=["cafe"])
    [key] = signer.jwks()["keys"]
    claims = jwt.decode(
        token, Ed25519PublicKey.from_public_bytes(unb64(key["x"])), algorithms=["EdDSA"],
        options={"verify_exp": False, "verify_iat": False},
    )
    assert jwt.get_unverified_header(token) == {"alg": "EdDSA", "typ": "JWT", "kid": signer.kid}
    assert claims["jti"] == made.jti and claims["max_pledge_cents"] == 3000 and claims["kinds"] == ["cafe"]
    assert limits.decode(signer, token, NOW) == made


def parts(token: str) -> list[str]:
    return token.split(".")


def forge(header: dict, claims: dict, signature: str = "") -> str:
    def encoded(value: dict) -> str:
        return b64(json.dumps(value).encode())

    return f"{encoded(header)}.{encoded(claims)}.{signature}"


@pytest.mark.parametrize("token", [None, "", "   "])
def test_a_pledge_prepared_without_limits_is_asked_for_them(token):
    with pytest.raises(limits.LimitsError) as refused:
        limits.decode(Signer.load(""), token, NOW)
    assert refused.value.code == "limits_required" and refused.value.status == 403


def test_limits_that_were_altered_forged_or_are_not_ours_are_refused():
    signer = Signer.load("")
    token, _ = mint(signer)
    head, body, signature = parts(token)
    claims = json.loads(unb64(body))

    def refused(text: str) -> str:
        with pytest.raises(limits.LimitsError) as caught:
            limits.decode(signer, text, NOW)
        return caught.value.code

    assert refused("garbage") == refused("a.b.c") == refused(token + "x") == "limits_invalid"
    assert refused(f"{head}.{b64(json.dumps({**claims, 'max_pledge_cents': 99999999}).encode())}.{signature}") == "limits_invalid"
    assert refused(forge({"alg": "none", "typ": "JWT", "kid": signer.kid}, claims)) == "limits_invalid"
    assert refused(forge({"alg": "HS256", "typ": "JWT", "kid": signer.kid}, claims, b64(b"x" * 32))) == "limits_invalid"
    other = Signer.load("")
    assert refused(limits.encode(other, limits.make(now=NOW, **LOOK))) == "limits_invalid"  # another key's, its own kid
    pretend = jwt.encode(claims, other.key, algorithm="EdDSA", headers={"kid": signer.kid})
    assert refused(pretend) == "limits_invalid"  # another key's, claiming ours
    assert refused(token[:-4] + "AAAA") == "limits_invalid"
    assert refused("x" * (limits.MAX_TOKEN + 1)) == "limits_invalid"
    assert limits.decode(signer, f" {token} ", NOW).jti == claims["jti"]  # a copied token's spaces are forgiven


def test_limits_end_when_they_say_and_not_a_second_later():
    signer = Signer.load("")
    token, made = mint(signer, days=1)
    assert limits.decode(signer, token, made.expires - timedelta(seconds=1)).jti == made.jti
    with pytest.raises(limits.LimitsError) as ended:
        limits.decode(signer, token, made.expires)
    assert (ended.value.code, ended.value.status) == ("limits_expired", 403)


def test_signed_limits_with_malformed_claims_are_refused_not_crashed_on():
    signer = Signer.load("")
    base = {"v": 1, "jti": "j", "iat": 1, "exp": 4102444800, "cur": "USD", "max_pledge_cents": 100,
            "max_total_cents": 200, "max_count": 1}
    for broken in ({"v": 2}, {"max_count": "1"}, {"max_pledge_cents": -5}, {"max_total_cents": True},
                   {"kinds": "cafe"}, {"kinds": [1]}, {"jti": 7}, {"cur": None}, {"near": {"lat": 1}}):
        token = jwt.encode({**base, **broken}, signer.key, algorithm="EdDSA", headers={"kid": signer.kid})
        with pytest.raises(limits.LimitsError) as refused:
            limits.decode(signer, token, NOW)
        assert refused.value.code == "limits_invalid", broken
    missing = jwt.encode({key: value for key, value in base.items() if key != "jti"}, signer.key, algorithm="EdDSA",
                         headers={"kid": signer.kid})
    with pytest.raises(limits.LimitsError):
        limits.decode(signer, missing, NOW)


def used(cents: int = 0, count: int = 0, *campaigns: str) -> limits.Usage:
    return limits.Usage(cents, count, frozenset(campaigns))


@pytest.mark.parametrize(("changes", "usage", "code", "words"), [
    ({}, used(), None, ""),
    ({"amount_cents": 3000}, used(), None, ""),  # exactly the limit is allowed
    ({"amount_cents": 3001}, used(), "over_pledge_limit", "30.00 USD"),
    ({}, used(3500, 1), None, ""),  # exactly the total is allowed
    ({}, used(3501, 1), "over_total_limit", "35.01 USD is already prepared"),
    ({}, used(3501, 1), "over_total_limit", "60.00 USD in all"),
    ({}, used(2000, 3), "too_many_pledges", "3 pledges"),
    ({}, used(0, 1, "c1"), "already_pledged", ""),
    ({"currency": "EUR"}, used(), "wrong_currency", "USD"),
    ({"offer": {"concept": {"genre": "gym"}}}, used(), "wrong_kind", "cafe, bakery"),
    ({"lat": 40.0, "lon": -73.9}, used(), "too_far", "limit is 5 km"),
])
def test_a_pledge_is_prepared_only_inside_every_limit(changes, usage, code, words):
    kinds = ["cafe", "bakery"] if code == "wrong_kind" else None
    near = {"lat": 30.26, "lon": -97.71, "km": 5} if code in ("too_far", None) else None
    made = limits.make(now=NOW, **{**LOOK, "kinds": kinds, "near": near})
    row = campaign(**changes)
    if code is None:
        assert limits.check(made, row, usage) is None
        return
    with pytest.raises(limits.LimitsError) as refused:
        limits.check(made, row, usage)
    assert (refused.value.code, refused.value.status) == (code, 403) and words in refused.value.detail


def test_the_limits_are_shown_with_what_is_used_and_what_is_left():
    made = limits.make(now=NOW, **{**LOOK, "kinds": ["cafe"], "near": {"lat": 1, "lon": 2, "km": 3}})
    alone = limits.view(made)
    assert alone["max_pledge"] == "30.00" and alone["max_total"] == "60.00" and "used" not in alone
    assert alone["kinds"] == ["cafe"] and alone["near"] == {"lat": 1.0, "lon": 2.0, "km": 3.0}
    assert alone["expires_at"] == "2026-11-04T12:00:00Z"
    shown = limits.view(made, used(2500, 1, "c1"))
    assert (shown["used"], shown["remaining"], shown["pledges"]) == ("25.00", "35.00", 1)
    assert limits.view(made, used(9000, 3))["remaining"] == "0.00"


def test_usage_adds_up_the_pledges_it_is_given():
    rows = [{"campaign_id": "a", "amount_cents": 2500}, {"campaign_id": "b", "amount_cents": 1000}]
    assert limits.usage_of(rows) == used(3500, 2, "a", "b")
    assert limits.usage_of([]) == used()


def test_the_header_name_is_the_one_the_assistant_sends():
    assert limits.HEADER == "X-Limits"
    assert base64.urlsafe_b64decode(b64(b"x") + "==") == b"x"
