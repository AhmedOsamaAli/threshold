import { useMemo, useState } from "react";
import type { CampaignCard } from "../../api/founders";
import { moneyText, timeLeft } from "../../lib/founders";
import { Link } from "../Link";
import { useHold } from "../map/hoverHold";
import { PlaceMap, type MapPin } from "../map/PlaceMap";

/** The pins of the open campaigns: each says its pledge, as a price tag on a map does, and reads out where and how far along. */
export function campaignPins(campaigns: readonly CampaignCard[]): MapPin[] {
  return campaigns.map((campaign) => ({
    id: campaign.id,
    lat: campaign.place.lat,
    lon: campaign.place.lon,
    label: moneyText(campaign.amount),
    title: `${campaign.name}, ${campaign.place.label}: pledge ${moneyText(campaign.amount)}, ${campaign.supporters} of ${campaign.goal} neighbors`,
  }));
}

function CampaignMapCard({ campaign, now, onPointerEnter, onPointerLeave, onClose }: {
  campaign: CampaignCard;
  now: number;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
  onClose: () => void;
}) {
  const left = timeLeft(campaign.deadline, now);
  return (
    <div
      className="place-card"
      role="dialog"
      aria-label={campaign.name}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div className="pc-head">
        <span className="pin-mark pill" aria-hidden="true">
          {moneyText(campaign.amount)}
        </span>
        <div className="pc-title">
          <h3 className="pc-name">{campaign.name}</h3>
          <p className="pc-role mono">{campaign.place.label}</p>
        </div>
        <button type="button" className="pc-close" aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      <p className="pc-known">
        <b>{campaign.supporters}</b> of {campaign.goal} neighbors · pledge {moneyText(campaign.amount)} · {left.closed ? "closing" : left.text}
      </p>
      <Link className="pc-link" href={campaign.url}>
        See the campaign<span aria-hidden="true"> →</span>
      </Link>
    </div>
  );
}

/**
 * The open campaigns on a street map, each a price tag at its address: pointing at one (or at its card in the list) lights
 * both, and pressing it opens a small card with a link to the campaign. The map shows every campaign at once; zoom in for
 * the street.
 */
export function CampaignsMap({ campaigns, now, lit, onLit }: {
  campaigns: readonly CampaignCard[];
  now: number;
  /** The campaign lit from the list, or by a pin. */
  lit: string | null;
  onLit: (id: string | null) => void;
}) {
  const pins = useMemo(() => campaignPins(campaigns), [campaigns]);
  const [previewed, setPreviewed] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const hold = useHold(() => {
    onLit(null);
    setPreviewed(null);
  });

  function point(id: string | null, how: "pointer" | "focus") {
    if (id !== null) {
      hold.enter();
      onLit(id);
      if (how === "pointer") setPreviewed(id);
      return;
    }
    if (how === "focus") {
      hold.cancel();
      onLit(null);
      return;
    }
    hold.leave();
  }

  const campaign = campaigns.find((each) => each.id === (open ?? previewed));
  return (
    <PlaceMap
      className="wide"
      gentle
      label={`A map of the ${campaigns.length} open campaigns, each marked with its pledge`}
      pins={pins}
      active={open ?? lit}
      onPoint={point}
      onSelect={(id) => {
        hold.cancel();
        setPreviewed(null);
        setOpen(id);
      }}
      onBackground={() => {
        setOpen(null);
      }}
      fallback={<p className="pm-note">The map is not available, so the campaigns are listed below.</p>}
    >
      {campaign ? (
        <CampaignMapCard
          campaign={campaign}
          now={now}
          onPointerEnter={() => {
            hold.enter();
          }}
          onPointerLeave={() => {
            hold.leave();
          }}
          onClose={() => {
            setOpen(null);
            setPreviewed(null);
          }}
        />
      ) : null}
    </PlaceMap>
  );
}
