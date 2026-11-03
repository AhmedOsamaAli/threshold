"""Seeds showcase campaigns the way an owner starts them: the draft of the words, then publishing them.

It runs the app inside this process with the development sign-in, against whatever DATABASE_URL points at: a local file by
default, or the hosted database. A hosted site signs in with Google only, so this is how it gets its showcase campaigns.
Never set PUBLIC_URL for it: the development sign-in is off when a site is hosted.

    python scripts/seed_demo.py --payout owner@example.com             # all of them
    python scripts/seed_demo.py --payout owner@example.com --only rye  # one, picked by a word of its name
    python scripts/seed_demo.py --payout owner@example.com --days 2    # deadlines two days away, for a short test

The businesses are made up, and every page says its pledges are demo ones. A campaign lasts at most 27 days, so a showcase
seeded for a judging period is seeded again when the first one runs out: running this again starts every business whose
campaign is no longer open, and leaves the open ones alone.
"""
from __future__ import annotations

import argparse
import os
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["AUTH_DEV_LOGIN"] = "1"
os.environ.pop("PUBLIC_URL", None)

SHOWCASE = [
    {"name": "Rye & Rise Bakery", "kind": "bakery", "address": "Bedford Ave, Williamsburg, Brooklyn", "lat": 40.7176,
     "lon": -73.9573, "amount": "18.00", "goal": 40,
     "description": "A neighborhood bakery for sourdough, rye loaves and morning pastries, baked on site every day.",
     "why_here": "Bedford Ave is a street neighbors already walk on every morning.", "perk": "A founding-supporter loaf on opening day"},
    {"name": "Kent Street Coffee", "kind": "cafe", "address": "Kent St, Greenpoint, Brooklyn", "lat": 40.7298,
     "lon": -73.9547, "amount": "14.00", "goal": 45,
     "description": "A small coffee bar with filter coffee, espresso and a few tables for people who work nearby.",
     "why_here": "Many people here work from home and look for somewhere to sit.", "perk": None},
    {"name": "Third Shift Coffee", "kind": "cafe", "address": "East Cesar Chavez St, East Austin, Texas", "lat": 30.2549,
     "lon": -97.7186, "amount": "12.00", "goal": 50,
     "description": "A neighborhood cafe open early for shift workers and late for students, with coffee and breakfast tacos.",
     "why_here": "East Austin has people coming off night shifts who want breakfast.", "perk": None},
    {"name": "Logan Square Strength", "kind": "gym", "address": "Milwaukee Ave, Logan Square, Chicago", "lat": 41.9296,
     "lon": -87.7077, "amount": "25.00", "goal": 30,
     "description": "A small strength gym with coached classes and open floor hours, for people who dislike big gyms.",
     "why_here": "Logan Square has many apartments and a few small gyms.", "perk": "Two founding-member coaching sessions"},
    {"name": "Nile Page Books", "kind": "bookstore", "address": "26th of July St, Zamalek, Cairo", "lat": 30.0626,
     "lon": 31.2197, "amount": "10.00", "goal": 25,
     "description": "An independent bookstore with Arabic and English books and a reading corner for children.",
     "why_here": "Zamalek is a walkable island where people read in cafes.", "perk": None},
    {"name": "Brick & Bloom Studio", "kind": "studio", "address": "Bergmannstrasse, Kreuzberg, Berlin", "lat": 52.4894,
     "lon": 13.3939, "amount": "20.00", "goal": 20,
     "description": "A small studio for yoga and pilates classes in a bright room, taught in German and English.",
     "why_here": "Kreuzberg neighbors want classes within walking distance.", "perk": None},
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--payout", required=True, help="the PayPal email the owner is paid at (a sandbox business account)")
    parser.add_argument("--owner", default="demo-owner@example.com", help="the development sign-in's email")
    parser.add_argument("--only", help="seed only the campaigns whose name contains this")
    parser.add_argument("--days", type=float, default=26, help="how many days away each deadline is (1 to 27)")
    args = parser.parse_args()

    from fastapi.testclient import TestClient

    from app.main import create_app

    chosen = [item for item in SHOWCASE if not args.only or args.only.lower() in item["name"].lower()]
    if not chosen:
        print(f"No showcase campaign has {args.only!r} in its name.")
        return 2
    failed = 0
    with TestClient(create_app()) as client:
        # One account starts them all, so the limits meant for a stranger's few campaigns an hour are lifted here.
        client.app.state.campaign_limiter.limit = 1000
        client.app.state.draft_limiter.limit = 1000
        signed = client.post("/api/auth/dev", json={"email": args.owner, "name": "Demo owner"})
        if signed.status_code != 200:
            print(f"Could not sign in: {signed.status_code} {signed.text}. Is PUBLIC_URL set? Leave it unset for this.")
            return 1
        listed = client.get("/api/me/campaigns").json()["campaigns"]
        for item in chosen:
            # A title reads "Be a founding supporter of <name>": a campaign still open for this business is not started again.
            if any(item["name"] in (entry.get("title") or "") and entry.get("status") == "open" for entry in listed):
                print(f"Already open: {item['name']}")
                continue
            deadline = (datetime.now(UTC) + timedelta(days=args.days)).replace(microsecond=0).isoformat()
            terms = {key: value for key, value in item.items()} | {"deadline": deadline}
            drafted = client.post("/api/business-campaigns/draft", json=terms)
            if drafted.status_code != 200:
                failed += 1
                print(f"Not drafted: {item['name']}: {drafted.status_code} {drafted.text}")
                continue
            words = drafted.json()
            body = {**terms, "payout_email": args.payout, **{key: words[key] for key in ("title", "pitch", "perks")}}
            created = client.post("/api/business-campaigns", json=body)
            if created.status_code != 200:
                failed += 1
                print(f"Not started: {item['name']}: {created.status_code} {created.text}")
                continue
            print(f"Started: {item['name']}: {created.json()['url']} (\"{words['title']}\")")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
