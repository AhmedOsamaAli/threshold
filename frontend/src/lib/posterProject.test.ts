import { describe, expect, it } from "vitest";
import { posterForCampaign } from "./posterProject";

const business = {
  name: "Golden Hour Bakery",
  concept: { genre: "bakery", summary: "A neighborhood bakery with sourdough and pastries. Baked on site from 6 am." },
  place: { label: "14 Cedar Street, Brooklyn, New York, USA", lat: 40.6782, lon: -73.9442, area: "" },
  pitch: "Back it now and be a founding neighbor.",
};

describe("what a poster takes from a campaign", () => {
  it("takes the business's name and place, and its description's first sentence as the tagline", () => {
    expect(posterForCampaign(business)).toEqual({
      name: "Golden Hour Bakery",
      tagline: "A neighborhood bakery with sourdough and pastries.",
      location: "14 Cedar Street, Brooklyn, New York, USA",
      identity: { kind: "bakery", keywords: [business.concept.summary, business.pitch] },
    });
  });

  it("falls back to the kind of business when the first sentence is too long to print", () => {
    const long = `${"A bakery with sourdough, laminated pastries and coffee ".repeat(3)}baked on site.`;
    expect(posterForCampaign({ ...business, concept: { genre: "bakery", summary: long } }).tagline).toBe("bakery");
  });

  it("prints no tagline from an empty description beyond the kind of business", () => {
    expect(posterForCampaign({ ...business, concept: { genre: "gym", summary: "  " } }).tagline).toBe("gym");
  });
});
