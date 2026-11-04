"""Guards on the front end's hover styles (frontend/src/styles/*.css), which no browser-less test can otherwise see.

A hover that moves, scales, turns or resizes the very element the pointer is on can take it out from under the pointer: the
element un-hovers, goes back, hovers again, and flickers for as long as the pointer rests on its edge. It happened twice: map
pins (a `scale` on the button MapLibre places with its own transform threw the pin up to 200 px away) and the campaign tile on
the home page (a 3 px lift left a pointer on its bottom edge outside it). The fix is the same each time: whatever moves is
inside a wrapper that does not, and the hover is on the wrapper (`.fd-tile:hover .fd-card`, `.mk:hover .mk-face`).
"""
from __future__ import annotations

import re
from pathlib import Path

STYLES = Path(__file__).resolve().parents[1] / "frontend" / "src" / "styles"
RULE = re.compile(r"([^{}]+)\{([^{}]*)\}")
# What moves an element, turns it, or changes its size.
MOVING = re.compile(
    r"(?:^|[;\s])(?:scale|translate|rotate|transform|zoom|inset|top|left|right|bottom|width|height|min-width|min-height"
    r"|max-width|max-height|margin[\w-]*|padding[\w-]*|offset[\w-]*)\s*:"
)


def without_comments(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def split_top_level(text: str, separators: str) -> list[str]:
    """Splits at the separators that are not inside parentheses or brackets (`:is(a, b)` stays whole)."""
    depth, start, pieces = 0, 0, []
    for index, char in enumerate(text):
        if char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        elif depth == 0 and char in separators:
            pieces.append(text[start:index])
            start = index + 1
    pieces.append(text[start:])
    return pieces


def subject_of(selector: str) -> str:
    """The last compound selector, which is what the rule styles: `.a:hover .b` styles `.b`, `.a:has(.b:hover)` styles `.a`."""
    pieces = [piece for piece in split_top_level(selector, " \t\r\n>+~") if piece.strip()]
    return pieces[-1] if pieces else ""


def hover_moves_its_own_target(css: str) -> list[str]:
    """The selectors whose hover moves, turns or resizes the element they style (or that the hovered thing is inside)."""
    found = []
    for selectors, body in RULE.findall(without_comments(css)):
        if not MOVING.search(body):
            continue
        for selector in (part.strip() for part in split_top_level(selectors, ",")):
            subject = subject_of(selector)
            # A pseudo-element (an underline that grows, a highlight that slides) is drawn inside its element: its box is the
            # same one the pointer is on, so it cannot take the element from under the pointer.
            if ":hover" in subject and "::" not in subject:
                found.append(selector)
    return found


def test_the_checker_sees_the_bugs_it_exists_for():
    assert hover_moves_its_own_target(".mk:hover { scale: 1.2; }") == [".mk:hover"]
    assert hover_moves_its_own_target(".fd-card:has(.fd-card-link:hover) { transform: translateY(-3px); }")
    assert hover_moves_its_own_target(".a:hover:not(.b), .c { margin-top: -2px; }") == [".a:hover:not(.b)"]
    assert hover_moves_its_own_target(".row:is(:hover, :focus) { height: 60px; }")
    # What is fine: the thing that moves is inside the thing that is hovered.
    assert not hover_moves_its_own_target(".fd-tile:hover .fd-card { transform: translateY(-3px); }")
    assert not hover_moves_its_own_target("@media (hover: hover) { .mk:hover .mk-face { scale: 1.2; } }")
    assert not hover_moves_its_own_target(".place-row:hover::before { transform: scaleX(1); }")
    assert not hover_moves_its_own_target(".go:hover:not(:disabled) i svg { transform: translateX(3px); }")
    assert not hover_moves_its_own_target(".text-link:hover span[aria-hidden] { transform: translateX(4px); }")
    assert not hover_moves_its_own_target(".go:hover:not(:disabled) { background: var(--ink); color: var(--on-ink); }")


def test_no_stylesheet_moves_what_it_is_hovered_on():
    sheets = sorted(STYLES.glob("*.css"))
    assert len(sheets) >= 10, "the stylesheets were not found: has the folder moved?"
    problems = {sheet.name: hover_moves_its_own_target(sheet.read_text(encoding="utf-8")) for sheet in sheets}
    problems = {name: found for name, found in problems.items() if found}
    assert not problems, (
        "a hover that moves or resizes the element the pointer is on makes it flicker at its edge; put what moves inside a "
        f"wrapper that does not, and hover the wrapper: {problems}"
    )


def test_a_pins_button_is_never_placed_by_the_stylesheet_and_its_face_grows_instead():
    """MapLibre places a pin's button with its own transform, from the map's corner: only the face inside it may grow."""
    css = without_comments((STYLES / "map.css").read_text(encoding="utf-8"))
    button = " ".join(body for selectors, body in RULE.findall(css) if re.search(r"(?:^|,)\s*\.mk(?:[.:\[]\S*)?\s*(?:,|$)", selectors))
    assert button, "the pin's rules were not found: has the stylesheet changed shape?"
    assert not MOVING.search(button), f"a rule places the pin's button: {button.strip()}"
    assert re.search(r"\.mk\.on \.mk-face\s*\{[^}]*scale\s*:\s*1\.2", css), "a lit pin's face should grow"
    assert re.search(r"@media \(hover: hover\)\s*\{\s*\.mk:hover \.mk-face\s*\{[^}]*scale\s*:\s*1\.2", css), (
        "hover is for pointers that have it, so a tap leaves no pin raised"
    )


def test_the_campaign_tile_lifts_inside_a_wrapper_that_stays_put():
    css = without_comments((STYLES / "founders.css").read_text(encoding="utf-8"))
    assert re.search(r"@media \(hover: hover\)\s*\{[^@]*\.fd-tile:hover \.fd-card\s*\{[^}]*translateY", css)
    assert ".fd-tile {" in css and not re.search(r"\.fd-tile\s*\{[^}]*(?:transform|translate|scale)", css)
