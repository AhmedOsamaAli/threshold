import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CampaignCard } from "../../api/founders";
import { CampaignTile, distanceText } from "./CampaignTile";

const NOW = Date.parse("2026-11-20T10:00:00Z");

const campaign = (patch: Partial<CampaignCard> = {}): CampaignCard => ({
  id: "c1",
  url: "/p/c1",
  title: "Be a founding supporter of Rye & Rise Bakery",
  name: "Rye & Rise Bakery",
  place: { label: "Bedford Ave, Williamsburg, Brooklyn", lat: 40.7181, lon: -73.9572 },
  distance_km: null,
  amount: "18.00",
  goal: 40,
  supporters: 12,
  total: "216.00",
  deadline: "2026-11-29T18:58:00Z",
  ...patch,
});

describe("a campaign's tile", () => {
  it("says what it is, where, how far along and what a pledge is, with a link to the campaign", () => {
    const html = renderToStaticMarkup(<CampaignTile campaign={campaign()} now={NOW} />);
    expect(html).toContain('href="/p/c1"');
    expect(html).toContain("Be a founding supporter of Rye &amp; Rise Bakery");
    expect(html).toContain("Bedford Ave, Williamsburg, Brooklyn");
    expect(html).toContain("<b>12</b> of 40 neighbors");
    expect(html).toContain("$216 held");
    expect(html).toContain("Pledge $18");
    expect(html).toContain("9 days left");
  });

  it("invites the first neighbor when there is none, and does not say $0 is held", () => {
    const html = renderToStaticMarkup(<CampaignTile campaign={campaign({ supporters: 0, total: "0.00" })} now={NOW} />);
    expect(html).toContain("<b>0</b> of 40 neighbors");
    expect(html).toContain("be the first to back it");
    expect(html).not.toContain("$0 held");
  });

  it("sets its title at the heading level it is given", () => {
    expect(renderToStaticMarkup(<CampaignTile campaign={campaign()} now={NOW} />)).toContain("<h2 ");
    expect(renderToStaticMarkup(<CampaignTile campaign={campaign()} now={NOW} level={3} />)).toContain("<h3 ");
  });

  it("is lit when pointed at elsewhere, and says how far away it is when it knows", () => {
    expect(renderToStaticMarkup(<CampaignTile campaign={campaign()} now={NOW} lit />)).toContain("data-lit");
    expect(renderToStaticMarkup(<CampaignTile campaign={campaign()} now={NOW} />)).not.toContain("data-lit");
    expect(renderToStaticMarkup(<CampaignTile campaign={campaign({ distance_km: 2.4 })} now={NOW} />)).toContain("2.4 km away");
  });

  it("says closing once the deadline has passed", () => {
    expect(renderToStaticMarkup(<CampaignTile campaign={campaign({ deadline: "2026-11-01T00:00:00Z" })} now={NOW} />)).toContain("Closing");
  });
});

describe("a distance in words", () => {
  it("rounds a short one to 10 m and a long one to a tenth of a kilometre, or a whole one past 10", () => {
    expect(distanceText(0.18)).toBe("180 m away");
    expect(distanceText(0.004)).toBe("10 m away");
    expect(distanceText(2.44)).toBe("2.4 km away");
    expect(distanceText(14.6)).toBe("15 km away");
  });
});
