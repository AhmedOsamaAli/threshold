"""The limits a person gives an assistant: the most for one pledge, the most in all, how many pledges, how far from a
point, which kinds of place, and for how long. They are a signed token (a JWS, algorithm EdDSA) that the person's own page
mints; an assistant presents it with every pledge it prepares, and the server checks it against the campaign before PayPal
is asked for an approval link. The model never writes, reads past or edits it: the limits come from the person's browser or
from the environment the assistant's tools run in, and a refusal is the server's, whatever the campaign's text says.

A limit holds for what is prepared, not for what the person approves: the person still approves every pledge in PayPal,
and a pledge nobody approves holds no money. Prepared pledges count against the limits for an hour, held and collected
ones for as long as they stand."""
from __future__ import annotations

import uuid
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

import jwt

from ..db.campaigns import distance_km
from ..payments import pledges
from ..payments.paypal import decimal_amount
from ..payments.records import CURRENCY, KINDS, iso, major, minor
from .keys import Signer

HEADER = "X-Limits"
MAX_TOTAL = Decimal("1000.00")
MAX_COUNT = 10
MAX_NEAR_KM = 100.0
MIN_DAYS, MAX_DAYS = 1 / 24, 30.0
# How long a pledge that was prepared and not approved still counts against the limits.
PREPARED_FOR = timedelta(hours=1)
MAX_TOKEN = 2048


class LimitsError(Exception):
    """Why a pledge was not prepared, or limits were not made: `code` is for programs, `detail` for the person."""

    def __init__(self, code: str, detail: str, status: int = 403) -> None:
        super().__init__(detail)
        self.code, self.detail, self.status = code, detail, status


@dataclass(frozen=True)
class Limits:
    jti: str
    issued: datetime
    expires: datetime
    currency: str
    max_pledge_cents: int
    max_total_cents: int
    max_count: int
    near: tuple[float, float, float] | None = None  # latitude, longitude and kilometres
    kinds: tuple[str, ...] | None = None


@dataclass(frozen=True)
class Usage:
    """What the pledges prepared or held under one token add up to."""

    cents: int = 0
    count: int = 0
    campaigns: frozenset[str] = frozenset()


def usage_of(rows: Iterable[Mapping[str, Any]]) -> Usage:
    found = list(rows)
    return Usage(sum(int(row["amount_cents"]) for row in found), len(found), frozenset(row["campaign_id"] for row in found))


def make(
    *, max_pledge: Any, max_total: Any, max_count: Any, days: Any, near: Mapping[str, Any] | None,
    kinds: Iterable[str] | None, now: datetime, currency: str = CURRENCY,
) -> Limits:
    """New limits on the person's terms; LimitsError (422) says what is wrong, in plain words."""
    problems: list[str] = []

    def amount(value: Any, label: str, low: Decimal, high: Decimal) -> Decimal | None:
        try:
            found = decimal_amount(value)
        except (TypeError, ValueError, InvalidOperation):
            found = None
        if found is None or not found.is_finite() or not low <= found <= high or found != found.quantize(Decimal("0.01")):
            problems.append(f"The {label} must be from {low} to {high}, in dollars and cents.")
            return None
        return found

    one = amount(max_pledge, "limit for one pledge", pledges.MIN_AMOUNT, pledges.MAX_AMOUNT)
    total = amount(max_total, "limit in all", one or pledges.MIN_AMOUNT, MAX_TOTAL)
    if isinstance(max_count, bool) or not isinstance(max_count, int) or not 1 <= max_count <= MAX_COUNT:
        problems.append(f"The number of pledges must be 1 to {MAX_COUNT}.")
    if isinstance(days, bool) or not isinstance(days, (int, float)) or not MIN_DAYS <= days <= MAX_DAYS:
        problems.append("The limits must last from an hour to 30 days.")
    place = None
    if near is not None:
        try:
            lat, lon, km = float(near["lat"]), float(near["lon"]), float(near["km"])
        except (KeyError, TypeError, ValueError):
            lat = lon = km = float("nan")
        if not (-90 <= lat <= 90 and -180 <= lon <= 180 and 0 < km <= MAX_NEAR_KM):
            problems.append(f"The place needs a latitude, a longitude and a distance of up to {MAX_NEAR_KM:g} km.")
        else:
            place = (lat, lon, km)
    chosen = None
    if kinds is not None:
        chosen = tuple(dict.fromkeys(kinds))
        if not chosen or any(kind not in KINDS for kind in chosen):
            problems.append("Choose kinds of place from the list, or none to allow any.")
    if problems:
        raise LimitsError("invalid_limits", " ".join(problems), 422)
    assert one is not None and total is not None and isinstance(max_count, int) and isinstance(days, (int, float))
    moment = now.astimezone(UTC).replace(microsecond=0)
    return Limits(
        jti=uuid.uuid4().hex, issued=moment, expires=moment + timedelta(days=days), currency=currency.upper(),
        max_pledge_cents=minor(one, currency), max_total_cents=minor(total, currency), max_count=max_count,
        near=place, kinds=chosen,
    )


def encode(signer: Signer, limits: Limits) -> str:
    claims: dict[str, Any] = {
        "v": 1, "jti": limits.jti, "iat": int(limits.issued.timestamp()), "exp": int(limits.expires.timestamp()),
        "cur": limits.currency, "max_pledge_cents": limits.max_pledge_cents, "max_total_cents": limits.max_total_cents,
        "max_count": limits.max_count,
    }
    if limits.near:
        claims["near"] = dict(zip(("lat", "lon", "km"), limits.near, strict=True))
    if limits.kinds:
        claims["kinds"] = list(limits.kinds)
    return jwt.encode(claims, signer.key, algorithm="EdDSA", headers={"kid": signer.kid})


def decode(signer: Signer, token: str | None, now: datetime) -> Limits:
    """The limits a token carries; LimitsError when it is missing, not ours, altered, malformed or past its end."""
    if not token or not token.strip():
        raise LimitsError("limits_required", "An assistant needs the limits its person set before it can prepare a pledge.")
    token = token.strip()
    refused = LimitsError("limits_invalid", "These limits are not valid: ask the person to set them again.")
    if len(token) > MAX_TOKEN:
        raise refused
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "EdDSA" or header.get("kid") != signer.kid:
            raise refused
        claims = jwt.decode(
            token, signer.public, algorithms=["EdDSA"],
            options={"verify_exp": False, "verify_iat": False, "verify_nbf": False, "require": ["jti", "iat", "exp"]},
        )
        limits = _limits_of(claims)
    except (jwt.PyJWTError, KeyError, TypeError, ValueError) as exc:
        raise refused from exc
    if limits.expires <= now:
        raise LimitsError("limits_expired", "These limits have ended: ask the person to set new ones.")
    return limits


def _limits_of(claims: Mapping[str, Any]) -> Limits:
    if claims.get("v") != 1:
        raise ValueError("version")
    ints = {key: claims[key] for key in ("iat", "exp", "max_pledge_cents", "max_total_cents", "max_count")}
    if any(isinstance(value, bool) or not isinstance(value, int) or value < 0 for value in ints.values()):
        raise ValueError("numbers")
    near = claims.get("near")
    kinds = claims.get("kinds")
    if kinds is not None and (not isinstance(kinds, list) or not all(isinstance(kind, str) for kind in kinds)):
        raise ValueError("kinds")
    if not isinstance(claims["jti"], str) or not isinstance(claims["cur"], str):
        raise ValueError("text")
    return Limits(
        jti=claims["jti"], issued=datetime.fromtimestamp(ints["iat"], UTC), expires=datetime.fromtimestamp(ints["exp"], UTC),
        currency=claims["cur"], max_pledge_cents=ints["max_pledge_cents"], max_total_cents=ints["max_total_cents"],
        max_count=ints["max_count"],
        near=(float(near["lat"]), float(near["lon"]), float(near["km"])) if near else None,
        kinds=tuple(kinds) if kinds else None,
    )


def check(limits: Limits, row: Mapping[str, Any], usage: Usage) -> None:
    """Passes a pledge to this campaign, or raises LimitsError for the first limit it would break."""
    amount, currency = int(row["amount_cents"]), str(row["currency"]).upper()

    def money_text(cents: int) -> str:
        return f"{major(cents, currency)} {currency}"

    if currency != limits.currency:
        raise LimitsError("wrong_currency", f"These limits are in {limits.currency}; this campaign takes {currency}.")
    if row["id"] in usage.campaigns:
        raise LimitsError("already_pledged", "A pledge to this campaign was already prepared under these limits.")
    kind = str(((row.get("offer") or {}).get("concept") or {}).get("genre") or "")
    if limits.kinds and kind not in limits.kinds:
        raise LimitsError("wrong_kind", f"This is a {kind or 'business of another kind'}; the limits allow {', '.join(limits.kinds)} only.")
    if limits.near:
        lat, lon, km = limits.near
        away = distance_km(lat, lon, float(row["lat"]), float(row["lon"]))
        if away > km:
            raise LimitsError("too_far", f"This place is {away:.1f} km from the point you chose, and the limit is {km:g} km.")
    if amount > limits.max_pledge_cents:
        raise LimitsError(
            "over_pledge_limit",
            f"This pledge is {money_text(amount)} and the limit for one pledge is {money_text(limits.max_pledge_cents)}.",
        )
    if usage.count >= limits.max_count:
        raise LimitsError("too_many_pledges", f"The limits allow {limits.max_count} pledges, and that many are already prepared or held.")
    if usage.cents + amount > limits.max_total_cents:
        raise LimitsError(
            "over_total_limit",
            f"{money_text(usage.cents)} is already prepared or held under these limits, and {money_text(amount)} more "
            f"would pass the limit of {money_text(limits.max_total_cents)} in all.",
        )


def view(limits: Limits, usage: Usage | None = None) -> dict:
    """The limits as the person sees them, with what is used when it is known."""
    used = usage or Usage()
    shown: dict[str, Any] = {
        "currency": limits.currency,
        "max_pledge": major(limits.max_pledge_cents, limits.currency),
        "max_total": major(limits.max_total_cents, limits.currency),
        "max_count": limits.max_count,
        "near": dict(zip(("lat", "lon", "km"), limits.near, strict=True)) if limits.near else None,
        "kinds": list(limits.kinds) if limits.kinds else None,
        "expires_at": iso(limits.expires),
    }
    if usage is not None:
        shown["used"] = major(used.cents, limits.currency)
        shown["remaining"] = major(max(limits.max_total_cents - used.cents, 0), limits.currency)
        shown["pledges"] = used.count
    return shown
