"""Reading a person's message with fixed rules instead of a model: whether it asks to back a campaign, which one, and what
to search for.

The assistant (app.assistant) uses these to decide what the server will allow, whatever a model says, and to answer when no
model can. Every rule leans toward asking again: a pledge nobody asked for is the mistake that matters, and a question
costs the person one more word."""
from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Literal

Consent = Literal["strong", "weak"]

# Words that ask to back something by themselves; "yes" and its kin mean it only as the answer to a question the server
# itself asked (see target).
STRONG = re.compile(r"\b(back|pledge|support|join|sign me up|prepare|i'?m in|count me in)\b", re.I)
WEAK = re.compile(r"\b(yes|yep|yeah|yup|sure|ok|okay|confirm|go ahead|do it|let'?s go|please do|proceed)\b", re.I)
NEGATION = re.compile(
    r"\b(don'?t|do not|dont|not|never|no|nope|stop|cancel|without|wait|hold on|instead|maybe|later|tomorrow|unsure|"
    r"think about|let me think|if|unless|but|only)\b|n't\b", re.I)
QUESTION = re.compile(r"^\s*(how|what|why|when|where|who|which|can|could|would|should|is|are|does|do|did|will|may)\b", re.I)
COMMAND = re.compile(r"^\s*(please\s+)?(back|pledge|support|join|prepare|sign me up|go ahead|do it)\b", re.I)
ORDINALS = (
    (re.compile(r"\b(first|1st)\b|#\s?1\b|\bnumber\s+1\b", re.I), 0),
    (re.compile(r"\b(second|2nd)\b|#\s?2\b|\bnumber\s+2\b", re.I), 1),
    (re.compile(r"\b(third|3rd)\b|#\s?3\b|\bnumber\s+3\b", re.I), 2),
    (re.compile(r"\b(fourth|4th)\b|#\s?4\b|\bnumber\s+4\b", re.I), 3),
    (re.compile(r"\blast\b", re.I), -1),
)
KIND_WORDS = {
    "bakery": ("bakery", "bakeries", "bread", "pastry", "pastries", "baker"),
    "cafe": ("cafe", "cafes", "café", "cafés", "coffee"),
    "restaurant": ("restaurant", "restaurants", "dinner", "brunch", "diner"),
    "bar": ("bar", "bars", "pub", "pubs", "cocktail", "brewery", "taproom"),
    "gym": ("gym", "gyms", "fitness", "crossfit", "climbing"),
    "studio": ("studio", "studios", "yoga", "pilates", "dance"),
    "salon": ("salon", "salons", "hair", "nails"),
    "barber": ("barber", "barbers", "barbershop"),
    "bookstore": ("bookstore", "bookstores", "bookshop", "books"),
    "grocery": ("grocery", "groceries", "supermarket", "market"),
    "kids": ("kids", "children", "daycare", "toy", "playground"),
    "shop": ("shop", "shops", "boutique", "store"),
    "services": ("repair", "laundry", "tailor"),
}
PLACE = re.compile(
    r"\b(?:near|in|around|at|close to|next to|by|within walking distance of)\s+([^.;!?\n]{3,80}?)"
    r"(?=\s+(?:i\b|i'|my\b|under|for|with|and|but|please|that|which|where|because)\b|[.;!?\n]|$)", re.I)
FILLER = frozenset({"the", "a", "an", "my", "me", "here", "town", "area", "neighborhood", "neighbourhood", "city", "of", "some", "any"})
BUDGET = re.compile(r"\$\s?(\d+(?:\.\d{1,2})?)|\b(\d+(?:\.\d{1,2})?)\s*(?:dollars|usd|bucks)\b", re.I)
SEARCHY = re.compile(
    r"\b(find|show|list|search|open|campaigns?|anything|something|new|opening|nearby|around|local|available|looking|"
    r"look for|what'?s)\b", re.I)
# What a model must not say: a link, or that money moved or something was confirmed. Only PayPal and the page do those.
PAID = re.compile(
    r"\b(?:i|you|we)(?:'ve| have)?\s+(?:just\s+|already\s+)?(?:paid|pledged|backed|charged|bought|purchased|approved|"
    r"completed|confirmed)\b|\b(?:your|the) pledge (?:is|has been|was)\s+(?:confirmed|complete|completed|placed|made|approved|"
    r"held)\b|\b(?:you are|you're|you were) (?:charged|backed|signed up)\b(?!\s+only)", re.I)
PREPARED = re.compile(
    r"\b(?:prepared|created|placed|made|set up)\b[^.!?]{0,40}\bpledge\b|\bpledge\b[^.!?]{0,40}\b(?:is|has been|was)\s+"
    r"(?:prepared|ready|created|placed|made)\b", re.I)
LINK = re.compile(r"https?://\S+|www\.\S+", re.I)
NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")


def squash(value: object, limit: int) -> str:
    """Text for a prompt or a card: one line, no control characters, cut to `limit`."""
    text = re.sub(r"[\x00-\x1f\x7f]+", " ", value if isinstance(value, str) else "")
    text = " ".join(text.split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def consent(message: str) -> Consent | None:
    """Whether a message asks to go ahead and back a campaign, and how plainly. A refusal, a hesitation or a question that
    only asks about backing ("how much would it cost to back it?") is not consent."""
    text = message.strip()
    if not text or NEGATION.search(text):
        return None
    if QUESTION.match(text) and not COMMAND.match(text):
        return None
    if STRONG.search(text):
        return "strong"
    return "weak" if WEAK.search(text) else None


def target(
    message: str, names: Mapping[str, str], listed: Sequence[str], asked: str | None, level: Consent,
) -> str | None:
    """The one campaign a message that asks to back something means, or None when that is unclear.

    It is the campaign the message names, or the one at a place in the list shown last ("the second one"); failing both,
    the one the assistant just asked about, or the only one shown. A "yes" and its kin mean only the campaign the assistant
    asked about: it must be asked, and nothing else may be named."""
    lowered = message.lower()
    chosen = {
        campaign_id for campaign_id, name in names.items()
        if len(name) >= 3 and re.search(rf"(?<!\w){re.escape(name.lower())}(?!\w)", lowered)
    }
    for pattern, index in ORDINALS:
        if pattern.search(message):
            try:
                chosen.add(listed[index])
            except IndexError:
                return None
    if len(chosen) > 1:
        return None
    if chosen:
        found = next(iter(chosen))
    elif search_of(message):
        return None  # it searches for something: a new request, not an answer about the campaign just shown
    elif asked:
        found = asked
    elif level == "strong" and len(listed) == 1:
        found = listed[0]
    else:
        return None
    return found if level == "strong" or found == asked else None


def kind_in(text: str) -> str | None:
    words = set(re.findall(r"[\wé]+", text.lower()))
    return next((kind for kind, names in KIND_WORDS.items() if words & set(names)), None)


def place_in(text: str) -> str | None:
    found = PLACE.search(text)
    if not found:
        return None
    place = squash(found.group(1), 80).strip(" ,")
    words = re.findall(r"[\wé]+", place.lower())
    kinds = {word for names in KIND_WORDS.values() for word in names}
    if len(place) < 3 or all(word in kinds or word in FILLER for word in words):
        return None  # "interested in bakeries" names a kind of place, not a place
    return place


def budget_in(text: str) -> float | None:
    found = BUDGET.search(text)
    return float(found.group(1) or found.group(2)) if found else None


def search_of(message: str) -> dict:
    """What a plain reading of the message searches for: its place, its kind of business and its budget."""
    args: dict = {}
    if place := place_in(message):
        args["place"] = place
    if kind := kind_in(message):
        args["kind"] = kind
    if (budget := budget_in(message)) is not None:
        args["max_amount"] = budget
    return args


def looks_like_search(message: str) -> bool:
    return bool(SEARCHY.search(message))


def plain_number(number: str) -> str:
    text = number.replace(",", "").rstrip(".")
    return text.rstrip("0").rstrip(".") if "." in text else text


def grounded(text: str, evidence: str) -> bool:
    """Whether an answer states nothing the tools did not give: no link, no claim that money moved or was confirmed, and
    no number that is not in what the tools returned or the person wrote."""
    if LINK.search(text) or PAID.search(text):
        return False
    known = {plain_number(token) for token in NUMBER.findall(evidence)} | {"0", "1", "2", "3", "4", "5", "6"}
    return all(plain_number(token) in known for token in NUMBER.findall(text))


def claims_prepared(text: str) -> bool:
    """Whether an answer says a pledge was prepared."""
    return bool(PREPARED.search(text))
