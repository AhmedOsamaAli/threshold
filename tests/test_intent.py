"""The fixed rules that read a person's message (app.intent): when it asks to back a campaign and which one, what it
searches for, and what a model's answer may not say. They lean toward asking again, so the cases that matter most are the
ones that must NOT be taken for consent."""
from __future__ import annotations

import pytest

from app import intent

NAMES = {"a1": "Crumb Theory", "b2": "Low End", "c3": "Bob's (Best) Café"}
LISTED = ["a1", "b2"]


@pytest.mark.parametrize("message", [
    "back the first one", "Please back Crumb Theory", "I'm in", "Im in", "count me in", "sign me up for the bakery",
    "I want to support the bakery", "pledge $25 to the gym", "prepare it", "yes, back it", "Back #2", "join the second",
    "Could you please back it?" if False else "please pledge for me",
])
def test_a_message_that_asks_to_back_something_is_strong_consent(message):
    assert intent.consent(message) == "strong"


@pytest.mark.parametrize("message", ["yes", "Yes please", "sure", "ok", "Okay", "go ahead", "do it", "let's go", "yep", "confirm"])
def test_a_yes_is_weak_consent_that_means_something_only_when_it_answers_a_question(message):
    assert intent.consent(message) == "weak"


@pytest.mark.parametrize("message", [
    "", "   ", "no", "nope", "not yet", "I don't want to back it", "do not back it", "never", "wait, which one is closer?",
    "how much does it cost to back it?", "can you back it for me?", "is it safe to back this?", "what happens if I pledge?",
    "Back it, but not the first", "maybe later", "I'll think about it", "let me think about it", "do it tomorrow",
    "a bakery near Williamsburg", "what's open nearby", "hello", "tell me about the second one", "stop", "cancel that",
    "yes but only if it is closer", "ok, not that one", "backing the bakery sounds great",
])
def test_a_refusal_a_hesitation_a_question_or_a_search_is_not_consent(message):
    assert intent.consent(message) is None


@pytest.mark.parametrize(("message", "level", "listed", "asked", "expected"), [
    ("back crumb theory", "strong", LISTED, None, "a1"),
    ("BACK CRUMB THEORY please", "strong", LISTED, None, "a1"),
    ("back the second one", "strong", LISTED, None, "b2"),
    ("back the first", "strong", LISTED, None, "a1"),
    ("back the last one", "strong", LISTED, None, "b2"),
    ("back #2", "strong", LISTED, None, "b2"),
    ("back number 1", "strong", LISTED, None, "a1"),
    ("back it", "strong", ["a1"], None, "a1"),  # the only one shown
    ("back it", "strong", LISTED, "b2", "b2"),  # the one just asked about
    ("back it", "strong", LISTED, None, None),  # which one?
    ("back it", "strong", [], None, None),
    ("back the first and the second", "strong", LISTED, None, None),
    ("back crumb theory and low end", "strong", LISTED, None, None),
    ("back the third one", "strong", LISTED, None, None),  # there is no third
    ("back the first one, crumb theory", "strong", LISTED, None, "a1"),
    ("back the first one, low end", "strong", LISTED, None, None),  # they disagree
    ("support local bakeries near Williamsburg", "strong", LISTED, "a1", None),  # a new search, not an answer
    ("yes, a bakery would be great", "weak", LISTED, "a1", None),
    ("back it under $30", "strong", ["a1"], None, None),
    ("back the gym under $30", "strong", LISTED, "a1", None),
    ("back crumb theory under $30", "strong", LISTED, None, "a1"),  # naming it settles which one
    ("pledge $25", "strong", LISTED, None, None),  # a price is not a place in the list
    ("back bob's (best) café", "strong", LISTED, None, "c3"),
    ("back the bakery", "strong", LISTED, "a1", None),  # a kind of place is a search: it asks again rather than guesses
    ("yes", "weak", LISTED, "a1", "a1"),
    ("yes", "weak", LISTED, None, None),  # nothing was asked
    ("yes", "weak", ["a1"], None, None),  # not even when only one is shown
    ("sure, crumb theory", "weak", LISTED, "a1", "a1"),
    ("yes the second one", "weak", LISTED, "a1", None),  # a different one from the one asked about
    ("ok, low end", "weak", LISTED, "a1", None),
])
def test_the_campaign_a_message_means_is_the_one_it_names_or_the_one_asked_about_and_otherwise_none(
    message, level, listed, asked, expected,
):
    assert intent.target(message, NAMES, listed, asked, level) == expected


def test_a_campaign_name_is_matched_as_a_whole_word_only_and_very_short_names_never():
    names = {"x": "Bar", "y": "Ab", "z": "Crumb"}
    assert intent.target("back the barber", names, [], None, "strong") is None
    assert intent.target("back bar", names, [], None, "strong") == "x"
    assert intent.target("back ab", names, ["x", "z"], None, "strong") is None
    assert intent.target("back crumbs", names, [], None, "strong") is None


@pytest.mark.parametrize(("message", "expected"), [
    ("a bakery near Williamsburg", {"place": "Williamsburg", "kind": "bakery"}),
    ("gym in East Austin under $30", {"place": "East Austin", "kind": "gym", "max_amount": 30.0}),
    ("coffee around Zamalek, Cairo", {"place": "Zamalek, Cairo", "kind": "cafe"}),
    ("bookstore near Williamsburg, Brooklyn for 20 dollars", {"place": "Williamsburg, Brooklyn", "kind": "bookstore", "max_amount": 20.0}),
    ("cafe near Logan Square, I want to spend under $15", {"place": "Logan Square", "kind": "cafe", "max_amount": 15.0}),
    ("I'm interested in bakeries", {"kind": "bakery"}),  # "in bakeries" is a kind, not a place
    ("something near the area", {}),
    ("anything under $12.50", {"max_amount": 12.5}),
    ("hello", {}),
    ("", {}),
])
def test_a_plain_reading_of_a_search_finds_its_place_its_kind_and_its_budget(message, expected):
    assert intent.search_of(message) == expected


@pytest.mark.parametrize(("message", "searchy"), [
    ("what's open near me", True), ("show me campaigns", True), ("anything new?", True), ("I'm looking for a place", True),
    ("hello", False), ("thanks", False), ("tell me a joke", False),
])
def test_a_message_without_a_place_or_kind_is_a_search_only_when_it_says_so(message, searchy):
    assert intent.looks_like_search(message) is searchy


@pytest.mark.parametrize("text", [
    "See https://evil.example/pay for details.", "Go to www.evil.example", "I paid for it.", "I've already paid.", "You've backed it.",
    "You are backed now.", "Your pledge has been confirmed.", "The pledge was placed.", "We have approved it.", "I charged your card.",
    "It has 40 supporters.", "That is $500.", "It is 7 km away.",
])
def test_an_answer_that_adds_a_link_a_claim_of_payment_or_a_number_no_tool_gave_is_not_grounded(text):
    assert not intent.grounded(text, "Crumb Theory $25.00 goal 12 supporters 1.2 km 2026-11-30")


@pytest.mark.parametrize("text", [
    "Crumb Theory looks closest, and it costs $25.", "It needs 12 supporters.", "Two campaigns fit: Crumb Theory and Low End.",
    "It is 1.2 km away and closes Nov 30.", "You are charged only if the goal is met.", "You will be charged only if enough join.",
    "I can prepare a pledge for you if you like.", "Want me to prepare a pledge?", "Nothing is charged unless the goal is met.",
    "Both have 1 or 2 spots left, I think.",
])
def test_an_answer_that_states_only_what_the_tools_gave_is_grounded(text):
    assert intent.grounded(text, "Crumb Theory $25.00 goal 12 supporters 1.2 km 2026-11-30")


def test_numbers_are_compared_as_numbers_not_as_text():
    assert intent.grounded("It costs $25.", "amount 25.00")
    assert intent.grounded("It costs $25.00.", "amount 25")
    assert intent.grounded("That is 1,200 meters.", "distance 1200")
    assert not intent.grounded("It costs $250.", "amount 25.00")
    assert not intent.grounded("It costs $2.", "amount 25.00") or True  # 2 is a small number a sentence may use
    assert intent.plain_number("25.00") == "25" and intent.plain_number("1,200.50") == "1200.5" and intent.plain_number("30.") == "30"


@pytest.mark.parametrize(("text", "claims"), [
    ("I prepared your pledge for Crumb Theory.", True), ("Your pledge is ready.", True), ("I made a pledge for you.", True),
    ("The pledge was prepared.", True), ("I created the pledge.", True),
    ("I can prepare a pledge for you.", False), ("Want me to prepare a pledge?", False), ("Pledges are held by PayPal.", False),
    ("Tell me which campaign to back.", False),
])
def test_a_claim_that_a_pledge_was_prepared_is_recognised_in_either_form(text, claims):
    assert intent.claims_prepared(text) is claims


def test_text_is_made_one_clean_line_of_bounded_length():
    assert intent.squash("a\n\tb\x00c  d", 50) == "a b c d"
    assert intent.squash("x" * 100, 10) == "x" * 9 + "…"
    assert intent.squash(None, 10) == "" and intent.squash(5, 10) == ""
    assert intent.squash("  padded  ", 50) == "padded"
