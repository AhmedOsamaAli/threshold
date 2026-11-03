"""Opens a session for a test owner straight in the database, for a script that has to act as an owner on a hosted site,
where only Google signs in (the development sign-in is off there).

The cookie's value goes to a file, never to the screen, and the session lasts a day (--hours). The same test account is used
every time, so the campaigns it starts stay together. Run it with DATABASE_URL set to the database of the site to act on:

    python scripts/mint_session.py --out owner-session.txt [--email e2e-owner@example.com] [--hours 24]

Then give the file to scripts/e2e.py with E2E_SESSION_FILE. Delete the file when done: whoever holds it is that owner.
"""
from __future__ import annotations

import argparse
import asyncio
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import auth  # noqa: E402
from app.config import settings  # noqa: E402
from app.db.accounts import AccountStore  # noqa: E402
from app.db.database import Database  # noqa: E402

MAX_HOURS = 72.0


async def mint(database_url: str, email: str, hours: float = 24.0) -> str:
    """Opens a session for the test owner `email` in the database and returns the value of its cookie."""
    database = Database(database_url)
    try:
        accounts = AccountStore(database)
        user = await accounts.sign_in(f"test:{email}", email, "Test owner", None)  # its own kind of account: not Google's, not dev's
        token = auth.new_token()
        await accounts.open_session(user["id"], auth.token_hash(token), datetime.now(UTC) + timedelta(hours=hours))
        return token
    finally:
        await database.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--out", required=True, help="the file the cookie's value is written to")
    parser.add_argument("--email", default="e2e-owner@example.com", help="the test owner's email")
    parser.add_argument("--hours", type=float, default=24.0, help=f"how long the session lasts (at most {MAX_HOURS:g})")
    args = parser.parse_args()
    if not 0 < args.hours <= MAX_HOURS:
        print(f"--hours must be more than 0 and at most {MAX_HOURS:g}.")
        return 2
    token = asyncio.run(mint(settings.database_url, args.email, args.hours))
    Path(args.out).write_text(token, encoding="utf-8")
    backend = settings.database_url.split(":", 1)[0].split("+", 1)[0]
    print(f"Opened a session for {args.email} in the {backend} database, valid {args.hours:g} h; the cookie's value is in {args.out}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
