"""Guards on the street map's pin styles (frontend/src/styles/map.css), which no browser-less test can otherwise see."""
from __future__ import annotations

import re
from pathlib import Path

CSS_FILE = Path(__file__).resolve().parents[1] / "frontend" / "src" / "styles" / "map.css"
CSS = re.sub(r"/\*.*?\*/", "", CSS_FILE.read_text(encoding="utf-8"), flags=re.S)
RULE = re.compile(r"([^{}]+)\{([^{}]*)\}")
# What would move, scale or turn an element, or give it a place of its own.
PLACING = re.compile(r"(?:^|[;\s])(?:scale|translate|rotate|transform|zoom|inset|top|left|right|bottom|margin[\w-]*|offset[\w-]*)\s*:")


def rules_on(subject: str) -> list[tuple[str, str]]:
    """The rules whose last compound selector is `subject` itself (`.mk`, `.mk:hover`, `.mk.on`), not one of its descendants."""
    found = []
    for selectors, body in RULE.findall(CSS):
        for selector in (part.strip() for part in selectors.split(",")):
            last = selector.split()[-1] if selector.split() else ""
            if re.fullmatch(re.escape(subject) + r"(?:[.:\[]\S*)?", last):
                found.append((selector, body))
    return found


def test_a_pins_button_is_never_scaled_moved_or_turned():
    """MapLibre places the button with its own transform, from the map's corner. A `scale` on the button is applied after that
    translate and about the corner, so on hover the pin jumps away from the pointer, loses its hover, comes back, and flickers
    for as long as the pointer rests on it (seen on the live site, up to 200 px). Only the face inside it may grow."""
    rules = rules_on(".mk")
    assert rules, "the pin's rules were not found: has the stylesheet changed shape?"
    for selector, body in rules:
        assert not PLACING.search(body), f"{selector} places the pin's button: {body.strip()}"
        transition = re.search(r"transition\s*:([^;]*)", body)
        assert not transition or not re.search(r"scale|transform|translate", transition.group(1)), selector


def test_the_pin_grows_through_its_face_on_hover_and_when_lit():
    lit = [body for selector, body in rules_on(".mk-face") if selector == ".mk.on .mk-face"]
    assert any(re.search(r"scale\s*:\s*1\.2", body) for body in lit), "a lit pin's face should grow"
    face = " ".join(body for selector, body in rules_on(".mk-face") if selector == ".mk-face")
    assert "transition" in face and "scale" in face, "the face is what animates"
    hover = re.search(r"@media \(hover: hover\)\s*\{\s*\.mk:hover \.mk-face\s*\{([^{}]*)\}", CSS)
    assert hover and re.search(r"scale\s*:\s*1\.2", hover.group(1)), "hover is for pointers that have it, so a tap leaves no pin raised"
