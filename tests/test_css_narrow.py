"""Guards on styles that keep a page inside a narrow screen (frontend/src/styles/*.css), which no browser-less test can otherwise see."""
from __future__ import annotations

import re
from pathlib import Path

STYLES = Path(__file__).resolve().parents[1] / "frontend" / "src" / "styles"


def rule(css: str, selector: str) -> str:
    """The declarations of the rule for exactly this selector."""
    match = re.search(re.escape(selector) + r"\s*\{([^{}]*)\}", css)
    assert match, f"{selector} was not found: has the stylesheet changed shape?"
    return match.group(1)


def test_the_assistants_examples_wrap_inside_their_pill_on_a_narrow_screen():
    """A pill never wraps by default (.ghost is white-space: nowrap), and "A gym in Logan Square, Chicago under $30" is 335 px
    wide: wider than a 320 or 340 px phone, so the Ask page scrolled sideways. The examples may wrap, and are never wider than
    the row they are in."""
    css = (STYLES / "ask.css").read_text(encoding="utf-8")
    button = rule(css, ".ask-suggestions .ghost")
    assert "white-space: normal" in button and "max-width: 100%" in button
    item = rule(css, ".ask-suggestions li")
    assert "min-width: 0" in item and "max-width: 100%" in item
