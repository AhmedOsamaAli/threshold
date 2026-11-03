import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Campaign } from "../../api/founders";
import type { Spot } from "../../api/spot";
import { aroundText, CampaignPlace } from "./CampaignPlace";

const campaign = (patch: Partial<Campaign> = {}): Campaign =>
  ({
    id: "a1b2c3",
    name: "Rye & Rise Bakery",
    place: { label: "Bedford Ave, Williamsburg, Brooklyn", lat: 40.7181, lon: -73.9572, area: "Brooklyn" },
    concept: { genre: "bakery", summary: "Sourdough." },
    ...patch,
  }) as Campaign;

describe("what a campaign says about what is around it", () => {
  const spot = (patch: Partial<Spot>): Spot =>
    ({
      walk_minutes: 10,
      summary: "6 bakeries are listed inside a 10-minute walk of this address; the nearest is 10 m away.",
      same_kind: { count: 6, nearest: [] },
      around: { count: 560, top_kinds: [], dots: [], green: [] },
      ...patch,
    }) as Spot;

  it("is the server's sentence when it counted the kind", () => {
    expect(aroundText(spot({}))).toBe("6 bakeries are listed inside a 10-minute walk of this address; the nearest is 10 m away.");
  });

  it("is only how many businesses are listed when the kind could not be counted", () => {
    expect(aroundText(spot({ same_kind: null }))).toBe("560 businesses are listed inside a 10-minute walk of this address.");
  });

  it("is nothing when there is nothing to say", () => {
    expect(aroundText(spot({ same_kind: null, around: null }))).toBeNull();
  });
});

describe("where the campaign will be", () => {
  it("shows the place on a map at once, named for assistive technology, with a way out to Google Maps", () => {
    const html = renderToStaticMarkup(<CampaignPlace campaign={campaign()} />);
    expect(html).toContain("Where it will be");
    expect(html).toContain('aria-label="A map of Bedford Ave, Williamsburg, Brooklyn, where Rye &amp; Rise Bakery plans to open"');
    expect(html).toContain("place-map small");
    expect(html).toContain("Loading the map…");
    expect(html).toContain("https://www.google.com/maps/search/?api=1&amp;query=40.718100,-73.957200");
  });

  it("claims nothing about what is around until the check has answered, and says it is checking meanwhile", () => {
    const html = renderToStaticMarkup(<CampaignPlace campaign={campaign()} />);
    expect(html).not.toContain("Already around");
    expect(html).toContain("Checking what is already around…");
  });

  it("has a map for a kind of business the check does not know, and nothing more", () => {
    const html = renderToStaticMarkup(<CampaignPlace campaign={campaign({ concept: { genre: "Cocktail bar", summary: "Drinks." } })} />);
    expect(html).toContain("place-map small");
    expect(html).not.toContain("Already around");
    expect(html).not.toContain("Checking what is already around"); // there is nothing to check for it
  });
});
