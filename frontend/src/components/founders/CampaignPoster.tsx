import type { Campaign } from "../../api/founders";
import { PosterSection } from "./PosterSection";

export function CampaignPoster({ campaign }: { campaign: Campaign }) {
  return <section className="cp-sec cp-campaign-poster" aria-label="Your campaign poster">
    <h2 className="cp-h">A poster for your founding supporters</h2>
    <PosterSection campaign={campaign} />
  </section>;
}
