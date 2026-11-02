"""Users and their sessions.

A user is only what signing in needs: Google's subject id, the email and name to show who is signed in, and the
profile picture's URL for the avatar. Sessions hold a hash of their cookie and when they expire, nothing else.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from .database import Database
from .tables import sessions, users

USER = (users.c.id, users.c.email, users.c.name, users.c.picture)


class AccountStore:
    def __init__(self, database: Database) -> None:
        self._engine = database.engine

    async def sign_in(self, subject: str, email: str, name: str, picture: str | None) -> dict:
        """The user signing in, created the first time; their email, name and picture are kept as Google has them now."""
        values = {"email": email[:320], "name": name[:200], "picture": picture[:1024] if picture else None}
        async with self._engine.begin() as connection:
            found = (await connection.execute(select(users.c.id).where(users.c.subject == subject))).first()
            if found:
                await connection.execute(update(users).where(users.c.id == found.id).values(**values))
                return {"id": found.id, **values}
        user_id = uuid.uuid4().hex
        try:
            async with self._engine.begin() as connection:
                await connection.execute(users.insert().values(id=user_id, subject=subject, **values))
        except IntegrityError:  # the same person signed in twice at once, and the other request created them
            return await self.sign_in(subject, email, name, picture)
        return {"id": user_id, **values}

    async def open_session(self, user_id: str, token_hash: str, expires_at: datetime) -> None:
        async with self._engine.begin() as connection:
            await connection.execute(sessions.insert().values(token_hash=token_hash, user_id=user_id, expires_at=expires_at))

    async def session(self, token_hash: str, now: datetime) -> tuple[dict, datetime] | None:
        """The session's user and when it expires; None when the session is unknown or over (then it is deleted)."""
        query = (
            select(*USER, sessions.c.expires_at)
            .join(users, users.c.id == sessions.c.user_id)
            .where(sessions.c.token_hash == token_hash)
        )
        async with self._engine.connect() as connection:
            row = (await connection.execute(query)).mappings().first()
        if row is None:
            return None
        if row["expires_at"] <= now:
            await self.close_session(token_hash)
            return None
        return {key: row[key] for key in ("id", "email", "name", "picture")}, row["expires_at"]

    async def extend_session(self, token_hash: str, expires_at: datetime) -> None:
        async with self._engine.begin() as connection:
            await connection.execute(update(sessions).where(sessions.c.token_hash == token_hash).values(expires_at=expires_at))

    async def close_session(self, token_hash: str) -> None:
        async with self._engine.begin() as connection:
            await connection.execute(delete(sessions).where(sessions.c.token_hash == token_hash))

    async def purge_sessions(self, now: datetime) -> int:
        async with self._engine.begin() as connection:
            result = await connection.execute(delete(sessions).where(sessions.c.expires_at <= now))
        return result.rowcount

    async def delete(self, user_id: str) -> None:
        """Deletes a user and their sessions in one transaction. Their campaigns stay, without an owner."""
        async with self._engine.begin() as connection:
            await connection.execute(delete(sessions).where(sessions.c.user_id == user_id))
            await connection.execute(delete(users).where(users.c.id == user_id))
