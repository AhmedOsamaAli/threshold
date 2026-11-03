import { useEffect, useState } from "react";
import { founders, type CampaignCard } from "../../api/founders";
import { featuredOf } from "../../lib/founders";
import { useNow } from "../../lib/useNow";
import { Link } from "../Link";
import { CampaignTile } from "../founders/CampaignTile";
import { START_CAMPAIGN_URL } from "../../lib/routes";

type Load = { phase: "loading" } | { phase: "shown"; campaign: CampaignCard } | { phase: "none" };

/** A campaign that is open now, drawn the way Browse draws it, so the page shows a real one before it explains anything. */
export function LiveExample() {
  const now = useNow(60_000);
  const [load, setLoad] = useState<Load>({ phase: "loading" });

  useEffect(() => {
    const abort = new AbortController();
    founders.list(null, abort.signal).then(
      ({ campaigns }) => {
        const campaign = featuredOf(campaigns);
        setLoad(campaign ? { phase: "shown", campaign } : { phase: "none" });
      },
      () => {
        if (!abort.signal.aborted) setLoad({ phase: "none" });
      },
    );
    return () => {
      abort.abort();
    };
  }, []);

  if (load.phase === "shown") return <CampaignTile campaign={load.campaign} now={now} level={3} />;
  if (load.phase === "loading") {
    return (
      <div className="home-live-wait" aria-busy="true">
        <div className="sk" />
        <p className="sr-only" role="status">
          Looking for an open campaign…
        </p>
      </div>
    );
  }
  return (
    <p className="home-live-none">
      No campaign could be shown just now.{" "}
      <Link className="text-link" href={START_CAMPAIGN_URL}>
        Start one <span aria-hidden="true">→</span>
      </Link>
    </p>
  );
}
