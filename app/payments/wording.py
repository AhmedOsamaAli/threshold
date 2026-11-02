"""The word lists and small readers the campaign pitch's rules (app.payments.pledges) check a line against: category
words anyone may use in a name, nationalities and cuisines that keep their capital inside a sentence, superlatives and
walking phrases a pitch may not use without proof, and how an item reads in the middle of a sentence."""
from __future__ import annotations

import re

from ..catchment import area_text

# Category words that are names of real places somewhere ("Diner", "Bakery") but are free for anyone to use.
COMMON_NAME_WORDS = {
    "bar", "cafe", "café", "coffee", "diner", "bakery", "deli", "grill", "kitchen", "tavern", "pub", "market",
    "wine", "tea", "bistro", "brasserie", "lounge", "club", "studio", "shop", "store", "gallery", "pizza",
    "pizzeria", "trattoria", "cantina", "taqueria", "restaurant", "eatery", "canteen", "corner", "local",
}

# Words that keep their capital inside a sentence: nationalities and cuisines ('Mexican', 'Middle Eastern', 'Tex-Mex').
NATIONAL = re.compile(r"^[A-Z][a-z]+(an|ese|ish|ic|ian|ern)$")
NOT_NATIONAL = {"Vegan", "Organic", "Classic", "Music", "Public", "Electric", "Ethnic", "Exotic", "Comic"}
PROPER_WORDS = {"Greek", "Thai", "French", "Dutch", "Basque", "Creole", "Cajun", "Swiss", "Czech", "Kosher", "Halal"}

SUPERLATIVE = re.compile(
    r"#\s*1\b|\bno\.?\s*1\b|\bnumber\s+one\b|\b(?:best|cheapest|finest|greatest|tastiest|freshest|fastest|"
    r"(?:top|highest|best)[- ]rated|(?:world[- ])?famous|renowned|legendary|iconic|award[- ]winning|unbeat(?:able|en)|"
    r"unmatched|unrivall?ed|unparalleled|ultimate|world[- ]class|best[- ]in[- ]class|lowest[- ]priced|lowest prices?|"
    r"most (?:popular|loved|beloved|famous|authentic|delicious|trusted|celebrated))\b",
    re.IGNORECASE,
)
# A walk away, said of a drive or a road distance: untrue there ('Walk in and say hello' is no distance).
WALKING = re.compile(
    r"\b(?:short\s+walk|walk(?:ing)?\s+distance|on\s+foot|minutes?\s+walk|min\s+walk|steps\s+(?:from|away))\b",
    re.IGNORECASE,
)


def is_walk(area: str | int) -> bool:
    return area_text(area).endswith(" walk")


def mid_sentence(item: str) -> str:
    """'Kouign amann' as it reads inside a sentence; 'Neapolitan pizza' and 'BLT' keep their capitals."""
    first = item.split()[0] if item.split() else ""
    proper = bool(NATIONAL.match(first)) and first not in NOT_NATIONAL or first in PROPER_WORDS or len(first) > 1 and first.isupper()
    return item if proper else item[:1].lower() + item[1:]
