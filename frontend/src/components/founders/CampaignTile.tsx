import type { CampaignCard } from "../../api/founders";
import { heldText, moneyText, timeLeft } from "../../lib/founders";
import { Link } from "../Link";
import { ProgressBar } from "./ProgressBar";

/** "2.4 km away", "180 m away". */
export function distanceText(km: number): string {
  return km < 1 ? `${Math.max(10, Math.round((km * 1000) / 10) * 10)} m away` : `${km < 10 ? km.toFixed(1) : Math.round(km)} km away`;
}

interface CampaignTileProps {
  campaign: CampaignCard;
  now: number;
  /** Pointed at on the map or in the list. */
  lit?: boolean;
  /** The title's heading level, so it fits where the tile is set. */
  level?: 2 | 3;
}

/** One open campaign: what it is, where, how far along, and its link over the whole card. */
export function CampaignTile({ campaign, now, lit = false, level = 2 }: CampaignTileProps) {
  const left = timeLeft(campaign.deadline, now);
  const funded = campaign.supporters >= campaign.goal;
  const where = [campaign.place.label, campaign.distance_km === null ? null : distanceText(campaign.distance_km)].filter(Boolean);
  const Heading = level === 2 ? "h2" : "h3";
  return (
    <article className="fd-card" data-lit={lit || undefined}>
      <p className="fd-card-kicker mono">{where.join(" · ")}</p>
      <Heading className="fd-card-title">
        <Link className="fd-card-link" href={campaign.url}>
          {campaign.title}
        </Link>
      </Heading>
      <p className="fd-card-name">{campaign.name}</p>
      <div className="fd-card-progress">
        <p className="fd-card-count">
          <b>{campaign.supporters}</b> of {campaign.goal} neighbors
          <span className="fd-card-held"> · {campaign.supporters ? heldText("open", campaign.total) : "be the first to back it"}</span>
        </p>
        <ProgressBar supporters={campaign.supporters} goal={campaign.goal} funded={funded} label={`Neighbors backing ${campaign.name}`} />
      </div>
      <p className="fd-card-foot">
        <span className="fd-card-amount mono">Pledge {moneyText(campaign.amount)}</span>
        <span className="fd-card-left mono">{left.closed ? "Closing" : left.text}</span>
      </p>
    </article>
  );
}
