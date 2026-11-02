"""Persistence: database URLs, the test-database guard, and the migration that builds the tables."""
from __future__ import annotations

import asyncio
import os
import ssl
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

import asyncpg
import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from sqlalchemy import inspect, make_url

from app import config, main
from app.config import ROOT, Settings
from app.db import AccountStore, Database, async_url
from app.db.database import MIGRATIONS
from app.db.tables import metadata
from app.llm import LLM
from tests.fakes import FakeWalker, StubGeocoder

# Made up, in the shape of Neon's connection strings.
NEON = (
    "postgresql://alex:AbC123dEf@ep-cool-darkness-123456.us-east-2.aws.neon.tech/neondb"
    "?sslmode=require&channel_binding=require"
)
TABLES = {"users", "sessions", "campaigns", "pledges", "payouts", "paypal_events"}


async def migrated(url: str) -> Database:
    database = Database(url)
    await database.migrate()
    return database


def test_a_test_only_ever_resolves_its_own_sqlite_file(database_url, tmp_path):
    """The guard: .env may name the production database, yet every way the app finds its database leads here."""
    target = make_url(database_url)
    assert target.get_backend_name() == "sqlite" and Path(target.database) == tmp_path / "walkin.db"
    resolved = {
        "environment": os.environ["DATABASE_URL"],
        "a new Settings()": Settings().database_url,
        "settings, which Alembic falls back to": config.settings.database_url,
        "create_app without a URL": main.settings.database_url,
    }
    assert resolved == dict.fromkeys(resolved, database_url)

    services = main.Services(walker=FakeWalker(), llm=LLM("", None, "test-model"), geocoder=StubGeocoder())
    app = main.create_app(lambda: services)

    async def opened():
        async with app.router.lifespan_context(app):
            return app.state.db.engine.url

    opened_url = asyncio.run(opened())
    assert (opened_url.get_backend_name(), opened_url.database) == ("sqlite", target.database)


def test_a_test_that_reaches_for_postgres_fails_instead_of_connecting():
    with pytest.raises(pytest.fail.Exception, match="opened a postgresql database"):
        Database("postgresql://walkin:secret@db.invalid/walkin")
    with pytest.raises(pytest.fail.Exception, match="tried to connect to Postgres"):
        asyncio.run(asyncpg.connect("postgresql://walkin:secret@db.invalid/walkin"))


def test_sqlite_urls_get_the_async_driver_and_their_folder(tmp_path):
    path = tmp_path / "data" / "walkin.db"
    url, connect_args = async_url(f"sqlite:///{path.as_posix()}")
    assert (url.drivername, url.database, connect_args) == ("sqlite+aiosqlite", path.as_posix(), {})
    assert path.parent.is_dir() and not path.exists()
    assert async_url("sqlite://")[0].drivername == "sqlite+aiosqlite"


def test_postgres_urls_get_asyncpg_and_tls_from_sslmode():
    url, connect_args = async_url(NEON)
    assert url.drivername == "postgresql+asyncpg" and not url.query and connect_args == {"ssl": "require"}
    assert (url.username, url.password, url.database) == ("alex", "AbC123dEf", "neondb")
    assert url.host == "ep-cool-darkness-123456.us-east-2.aws.neon.tech"

    url, connect_args = async_url("postgres://walkin:p%40ss@db.example.com:5433/walkin?sslmode=verify-full&sslrootcert=system")
    assert (url.drivername, url.password, url.port, dict(url.query)) == ("postgresql+asyncpg", "p@ss", 5433, {})
    verified = connect_args["ssl"]
    assert isinstance(verified, ssl.SSLContext) and verified.check_hostname and verified.verify_mode == ssl.CERT_REQUIRED
    assert async_url("postgresql+psycopg2://walkin:pw@localhost/walkin")[1] == {}
    with pytest.raises(ValueError):
        async_url("mysql://walkin:pw@localhost/walkin")


@pytest.mark.parametrize("pooled", [False, True], ids=["direct", "pooled"])
def test_both_neon_connection_strings_reach_asyncpg_as_it_needs_them(offline_postgres, pooled):
    neon = NEON.replace("-123456.", "-123456-pooler.") if pooled else NEON
    url, connect_args = async_url(neon)
    assert connect_args == ({"ssl": "require", "statement_cache_size": 0} if pooled else {"ssl": "require"})
    assert dict(url.query) == ({"prepared_statement_cache_size": "0"} if pooled else {})

    async def connect() -> dict:
        database = Database(neon)
        try:
            with pytest.raises(ConnectionRefusedError):
                async with database.engine.connect():
                    pass
            return database.engine.dialect.create_connect_args(database.engine.url)[1]
        finally:
            await database.dispose()

    dialect_options = asyncio.run(connect())
    # PgBouncer in transaction mode (Neon's pooler) cannot keep prepared statements: both caches are off when pooled.
    assert dialect_options.get("prepared_statement_cache_size") == (0 if pooled else None)
    sent = offline_postgres[-1]
    assert (sent["host"], sent["user"], sent["database"], sent["ssl"]) == (url.host, "alex", "neondb", "require")
    assert sent.get("statement_cache_size") == (0 if pooled else None)
    assert not {"sslmode", "channel_binding", "prepared_statement_cache_size"} & set(sent)


def test_migrations_build_exactly_the_tables_the_app_uses(database_url):
    async def build() -> tuple[list, list[str]]:
        database = await migrated(database_url)
        await database.migrate()  # nothing left to do the second time
        async with database.engine.connect() as connection:
            drift = await connection.run_sync(lambda c: compare_metadata(MigrationContext.configure(c), metadata))
            tables = await connection.run_sync(lambda c: inspect(c).get_table_names())
        await database.dispose()
        return drift, tables

    drift, tables = asyncio.run(build())
    assert drift == []
    assert set(tables) == {*metadata.tables, "alembic_version"} == {*TABLES, "alembic_version"}


def test_the_baseline_is_the_only_revision_and_can_be_undone(database_url):
    alembic_config = Config()
    alembic_config.set_main_option("script_location", str(MIGRATIONS))
    alembic_config.attributes["url"] = database_url
    command.upgrade(alembic_config, "head")
    assert sorted(path.name for path in (MIGRATIONS / "versions").glob("*.py")) == ["0001_baseline.py"]

    async def tables() -> set[str]:
        database = Database(database_url)
        async with database.engine.connect() as connection:
            names = await connection.run_sync(lambda c: set(inspect(c).get_table_names()))
        await database.dispose()
        return names

    assert asyncio.run(tables()) >= TABLES
    command.downgrade(alembic_config, "base")
    assert asyncio.run(tables()) == {"alembic_version"}


def test_the_alembic_command_line_migrates_the_database_it_is_given(database_url, tmp_path):
    # A separate process escapes the in-process guard, so the database is named twice: -x url and DATABASE_URL.
    assert make_url(database_url).get_backend_name() == "sqlite"
    arguments = [sys.executable, "-m", "alembic", "-c", str(ROOT / "alembic.ini"), "-x", f"url={database_url}",
                 "upgrade", "head"]
    subprocess.run(arguments, cwd=tmp_path, env={**os.environ, "DATABASE_URL": database_url}, check=True, capture_output=True)

    async def tables() -> list[str]:
        database = Database(database_url)
        async with database.engine.connect() as connection:
            names = await connection.run_sync(lambda c: inspect(c).get_table_names())
        await database.dispose()
        return names

    assert set(asyncio.run(tables())) >= TABLES


def test_the_account_store_signs_users_in_once_and_deletes_them_with_their_sessions(database_url):
    now = datetime.now(UTC)

    async def scenario() -> dict:
        database = await migrated(database_url)
        accounts = AccountStore(database)
        first = await accounts.sign_in("google:1", "owner@example.com", "Olive Owner", None)
        again = await accounts.sign_in("google:1", "owner@example.com", "Olive O.", "https://example.com/p.png")
        await accounts.open_session(first["id"], "hash-1", now + timedelta(days=1))
        await accounts.open_session(first["id"], "hash-2", now - timedelta(days=1))
        before = await accounts.session("hash-1", now)
        gone = await accounts.session("hash-2", now)  # over: forgotten as it is asked about
        purged = await accounts.purge_sessions(now)
        await accounts.delete(first["id"])
        after = await accounts.session("hash-1", now)
        await database.dispose()
        return {"first": first, "again": again, "before": before, "gone": gone, "purged": purged, "after": after}

    found = asyncio.run(scenario())
    assert found["again"]["id"] == found["first"]["id"] and found["again"]["name"] == "Olive O."
    assert found["before"][0]["email"] == "owner@example.com" and found["gone"] is None
    assert found["purged"] == 0 and found["after"] is None
