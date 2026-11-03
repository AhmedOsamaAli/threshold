import { describe, expect, it } from "vitest";
import type { CampaignCard } from "../../api/founders";
import { campaignPins } from "./CampaignsMap";

const card = (patch: Partial<CampaignCard> = {}): CampaignCard => ({
  id: "abc123",
  url: "/p/abc123",
  title: "Be a founding supporter of Rye & Rise Bakery",
  name: "Rye & Rise Bakery",
  place: { label: "Bedford Ave, Williamsburg, Brooklyn", lat: 40.7176, lon: -73.9573 },
  distance_km: null,
  amount: "18.00",
  goal: 40,
  supporters: 3,
  total: "54.00",
  deadline: "2026-11-29T16:32:00Z",
  ...patch,
});

describe("the campaigns' pins", () => {
  it("is a price tag at each address, read out with where and how far along", () => {
    const [pin] = campaignPins([card()]);
    expect(pin).toEqual({
      id: "abc123",
      lat: 40.7176,
      lon: -73.9573,
      label: "$18",
      title: "Rye & Rise Bakery, Bedford Ave, Williamsburg, Brooklyn: pledge $18, 3 of 40 neighbors",
    });
  });

  it("keeps the order of the list, and has none for no campaigns", () => {
    expect(campaignPins([card({ id: "a" }), card({ id: "b", amount: "10.00" })]).map((pin) => [pin.id, pin.label])).toEqual([["a", "$18"], ["b", "$10"]]);
    expect(campaignPins([])).toEqual([]);
  });
});
