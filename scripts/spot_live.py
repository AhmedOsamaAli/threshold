"""Checks six real addresses against the public map services (Nominatim, Valhalla and Overpass) and prints what Check a spot
says for each. Not part of the test suite: it needs the network and the free servers' good will, so it asks one thing at a
time. Run it from the repository's root:  .venv\\Scripts\\python.exe scripts\\spot_live.py"""
from __future__ import annotations

import asyncio
import sys
import tempfile
import time
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.catchment import CatchmentService  # noqa: E402
from app.geocode import Geocoder  # noqa: E402
from app.llm import LLM  # noqa: E402
from app.osm import OsmClient  # noqa: E402
from app.services import Services  # noqa: E402
from app.spot import check_spot  # noqa: E402

CASES = (
    ("Williamsburg, Brooklyn", "bakery"),
    ("East Austin, Texas", "cafe"),
    ("Logan Square, Chicago", "gym"),
    ("Zamalek, Cairo", "cafe"),
    ("Kreuzberg, Berlin", "bookstore"),
    ("Shibuya, Tokyo", "bar"),
)
PAUSE_S = 3.0


async def main() -> None:
    with tempfile.TemporaryDirectory() as folder:
        root = Path(folder)
        services = Services(
            walker=CatchmentService(root / "walk"), llm=LLM("", None, "none"), geocoder=Geocoder(), osm=OsmClient(root / "osm"),
        )
        print(f"{'address':26} {'kind':10} {'checked':8} {'of kind':8} {'nearest':9} {'around':7} {'area':8} {'seconds':7}")
        try:
            for address, kind in CASES:
                started = time.monotonic()
                try:
                    hits = await services.geocoder.search(address)
                except Exception as exc:  # the free address search can be slow or refuse
                    print(f"{address:26} {kind:10} address search failed: {type(exc).__name__}")
                    continue
                if not hits:
                    print(f"{address:26} {kind:10} address not found")
                    continue
                answer = await check_spot(services, hits[0]["lat"], hits[0]["lon"], kind, hits[0]["label"], datetime.now(UTC))
                seconds = time.monotonic() - started
                if not answer["checked"]:
                    print(f"{address:26} {kind:10} {'no':8} {'-':8} {'-':9} {'-':7} {'-':8} {seconds:7.1f}  ({answer['reason']})")
                else:
                    same = answer["same_kind"]
                    nearest = f"{same['nearest'][0]['distance_m']} m" if same and same["nearest"] else "-"
                    count = str(same["count"]) if same else "n/a"
                    print(f"{address:26} {kind:10} {'yes':8} {count:8} {nearest:9} {answer['around']['count']:<7} "
                          f"{answer['area']['source']:8} {seconds:7.1f}")
                await asyncio.sleep(PAUSE_S)
        finally:
            await services.aclose()


if __name__ == "__main__":
    asyncio.run(main())
