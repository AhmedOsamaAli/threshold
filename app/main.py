"""The composition root: builds the services from the settings, and the app around them: its lifespan (database,
stores, limits, background work), its middleware (security headers, cookies, cache policy, gzip), its routes
(app.routes) and the web app's static files.

Layers, from the outside in: routes (app.routes) -> the pledge rules and settlement (app.payments, app.settlement) ->
clients of the outside world (Valhalla, Overpass, Nominatim, the AI chain, PayPal: app.services) and storage (app.db,
the disk caches). Campaigns, pledges, settlement and payouts with PayPal plug in through
app.payments.founders.
"""
from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import auth, cache_policy
from .answers import AnswerCache
from .catchment import CatchmentService
from .config import ROOT, settings
from .db import AccountStore, Database
from .db.tables import utcnow
from .geocode import Geocoder
from .keepawake import keep_awake
from .osm import OsmClient
from .osmdetails import OsmDetails
from .payments import founders
from .payments.paypal import PayPalClient
from .providers import build_llm
from .ratelimit import RateLimiter
from .response_cache import GZIP_LEVEL, GZIP_MIN_BYTES, ResponseCache
from .routes import account, maps, meta
from .services import Services
from .tiles import Places, TileClient

log = logging.getLogger("threshold")

# Per client and hour (app.ratelimit), so one visitor cannot spend the free quotas everyone shares.
MAP_REQUESTS_PER_HOUR = 200
SIGN_INS_PER_HOUR = 30
# create_app's settlement period when none is given: SETTLE_EVERY_S, read when the app starts.
SETTLE_FROM_SETTINGS = -1.0

# Sign in with Google loads its script, button frame and styles from accounts.google.com/gsi
# (developers.google.com/identity/gsi/web/guides/get-google-api-clientid#content_security_policy). PayPal's JavaScript
# SDK (v6) loads its script and checkout frames from paypal.com, the sandbox's or the live one (docs/CONTRACT.md). The
# street map (MapLibre) asks OpenFreeMap for its style, tiles, fonts and icons, and runs its worker from this site's own files.
# The same policy as frontend/public/_headers (Cloudflare Pages) and vite.config.ts (preview).
GOOGLE_SIGN_IN = "https://accounts.google.com/gsi/"
PAYPAL = "https://www.sandbox.paypal.com https://www.paypal.com"
MAP_TILES = "https://tiles.openfreemap.org"
CONTENT_SECURITY_POLICY = "; ".join([
    "default-src 'self'",
    f"script-src 'self' {GOOGLE_SIGN_IN}client {PAYPAL}",
    f"style-src 'self' 'unsafe-inline' {GOOGLE_SIGN_IN}style",
    "img-src 'self' data: https:",
    "font-src 'self'",
    f"connect-src 'self' {GOOGLE_SIGN_IN} {PAYPAL} {MAP_TILES}",
    f"frame-src {GOOGLE_SIGN_IN} {PAYPAL}",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
])
# FastAPI's interactive API docs load Swagger UI and ReDoc from jsDelivr, with one inline bootstrap script.
DOCS_POLICY = "; ".join([
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "worker-src blob:",
    "frame-ancestors 'none'",
])


def default_services() -> Services:
    paypal = None
    if settings.paypal_enabled:
        paypal = PayPalClient(settings.paypal_client_id, settings.paypal_client_secret, settings.paypal_api_base)
    return Services(
        walker=CatchmentService(settings.walk_cache_dir),
        llm=build_llm(settings),
        geocoder=Geocoder(),
        answers=AnswerCache(settings.agent_cache_dir, enabled=settings.agent_cache),
        osm=Places(TileClient(settings.cache_dir / "tiles"), OsmClient(settings.cache_dir / "osm")),
        details=OsmDetails(),
        paypal=paypal,
    )


class RevalidatingStaticFiles(StaticFiles):
    """Static files that browsers must revalidate, so a redeploy is picked up immediately.

    Vite's hashed bundles under assets/ never change, so those are cached for a year.
    """

    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        immutable = path.startswith("assets/") and response.status_code == 200
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable" if immutable else "no-cache"
        return response


WEB_ROOT = ROOT / "frontend" / "dist"  # the React build: npm run build in frontend/


def create_app(
    services_factory: Callable[[], Services] = default_services, database_url: str | None = None,
    web_root: Path | None = None, settle_every: float | None = SETTLE_FROM_SETTINGS,
) -> FastAPI:
    """The app. `database_url` overrides DATABASE_URL; tests give each app a SQLite file of its own. `web_root` overrides
    the React build it serves (WEB_ROOT); without its index.html, the app serves the API only. `settle_every` is the
    settlement loop's period in seconds (SETTLE_EVERY_S unless given); None or 0 turns the loop off."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        database = Database(database_url or settings.database_url)
        await database.migrate()
        accounts = AccountStore(database)
        await accounts.purge_sessions(utcnow())
        services = services_factory()
        app.state.services = services
        app.state.db = database
        app.state.accounts = accounts
        app.state.map_limiter = RateLimiter(MAP_REQUESTS_PER_HOUR, 3600)
        app.state.auth_limiter = RateLimiter(SIGN_INS_PER_HOUR, 3600)
        app.state.responses = ResponseCache(settings.response_cache_mb * 1024 * 1024)
        keeper = (
            asyncio.create_task(keep_awake(settings.keep_awake_url, windows=settings.keep_awake_windows))
            if settings.keep_awake_url else None
        )
        every = settings.settle_every if settle_every == SETTLE_FROM_SETTINGS else settle_every
        try:
            async with founders.running(app, every):
                yield
        finally:
            if keeper:
                keeper.cancel()
                await asyncio.wait([keeper])
            await services.aclose()
            await database.dispose()

    app = FastAPI(
        title="Threshold",
        version="1.0.0",
        description=(
            "Threshold: neighbors back a new place before it opens. An owner describes a business and starts a campaign "
            "(POST /api/business-campaigns), and neighbors back it with PayPal (GET /api/campaigns finds them): PayPal "
            "only holds each pledge, and everyone is charged only if enough neighbors join by the deadline. An assistant "
            "(POST /api/assistant) can prepare a pledge inside limits the person sets (POST /api/limits), and "
            "GET /api/campaigns/{id}/proof checks a campaign's signed pledges against PayPal. GET /api/spot lists what "
            "OpenStreetMap shows within a ten-minute walk. The endpoints are JSON, and sign-in with Google keeps an "
            "owner's campaigns in GET /api/me/campaigns."
        ),
        lifespan=lifespan,
    )
    app.state.now = utcnow  # the app's clock; tests move it
    app.state.origin_exempt = frozenset()  # API paths called from elsewhere than a page (founders.CALLBACKS)

    # JSON travels four times smaller from Render to the front door. Added before the security middleware, so it sits
    # inside it and sees each response whole (bodies under GZIP_MIN_BYTES go as they are).
    app.add_middleware(GZipMiddleware, minimum_size=GZIP_MIN_BYTES, compresslevel=GZIP_LEVEL)

    @app.middleware("http")
    async def security(request: Request, call_next):
        """Turns away unsafe API calls from other sites' pages, sets the cookies endpoints queued, and the headers.
        PayPal's webhook and the scheduled settlement are no page's calls: each proves itself otherwise."""
        if request.url.path in app.state.origin_exempt or auth.origin_allowed(request):
            response = await call_next(request)
            auth.apply_cookies(request, response)
        else:
            response = JSONResponse({"detail": "This request came from a page that may not use this API."}, 403)
        docs = request.url.path in ("/docs", "/redoc")
        response.headers.setdefault("Content-Security-Policy", DOCS_POLICY if docs else CONTENT_SECURITY_POLICY)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        private_receipt = request.url.path.startswith(("/r/", "/api/receipts/"))
        response.headers.setdefault("Referrer-Policy", "no-referrer" if private_receipt else "strict-origin-when-cross-origin")
        # Google's sign-in opens a popup when the browser has no FedCM, and the popup must be able to answer this page.
        response.headers.setdefault("Cross-Origin-Opener-Policy", "same-origin-allow-popups")
        cache_policy.guard(request, response)
        return response

    for routes in (meta, maps, account):
        app.include_router(routes.router)
    founders.install(app)
    root = web_root or WEB_ROOT
    if not (root / "index.html").exists():
        log.warning("frontend/dist is missing (npm run build in frontend/): serving the API only")
        return app

    # The owner's page (/me) and the privacy note (/privacy), besides the pages in founders.PAGES (a campaign, the open
    # campaigns, starting one, a pledge's private receipt, the assistant, a proof, Check a spot), are pages of the web app.
    @app.get("/me", include_in_schema=False)
    @app.get("/privacy", include_in_schema=False)
    async def shared_page() -> FileResponse:
        return FileResponse(root / "index.html", headers={"Cache-Control": "no-cache"})

    for path in founders.PAGES:
        app.add_api_route(path, shared_page, include_in_schema=False)
    app.mount("/", RevalidatingStaticFiles(directory=root, html=True), name="web")
    return app


app = create_app()
