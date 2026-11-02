import type { Campaign } from "../api/founders";
import type { PosterInput } from "./poster";

/** The first sentence of the description, when it is short enough to print as the poster's tagline. */
function completeShortLine(text: string): string | null {
  const first = text.trim().split(/(?<=[.!?])\s+/)[0] ?? "";
  return first && first.length <= 100 ? first : null;
}

/** A campaign already keeps its business and terms, so its poster needs nothing else. */
export function posterForCampaign(campaign: Pick<Campaign, "name" | "concept" | "place" | "pitch">): PosterInput {
  return {
    name: campaign.name,
    tagline: completeShortLine(campaign.concept.summary) ?? campaign.concept.genre,
    location: campaign.place.label,
    identity: { kind: campaign.concept.genre, keywords: [campaign.concept.summary, campaign.pitch] },
  };
}
