import { describe, expect, it } from "vitest";
import { fitLines, layoutPoster, POSTER_H, POSTER_M, POSTER_W, roughMeasure, type PosterText } from "./poster";

const TERMS = "Back it before it opens: pledge $25, charged only if 40 neighbors join by Nov 30.";
const TEXT: PosterText = {
  name: "Golden Hour", tagline: "Morning bread and coffee.",
  headline: "A founders' loaf every Saturday", back: TERMS, perks: [], location: null,
};
const INNER = POSTER_W - POSTER_M * 2;

describe("one customer-first poster layout", () => {
  it("uses the hero area for the business, with the perk it leads with under its name", () => {
    const layout = layoutPoster(TEXT, roughMeasure);
    expect(layout.fits).toBe(true);
    expect(layout.art.height).toBeGreaterThan(100);
    expect(layout.name.size).toBeGreaterThan(60);
    expect(layout.headline?.y[0]).toBeGreaterThan(layout.name.y.at(-1) ?? 0);
    expect(layout.art.y).toBeGreaterThan(layout.headline?.y.at(-1) ?? 0);
  });

  it("balances long names instead of shrinking them", () => {
    for (const name of ["The Kouign Amann Society of East Austin", "A".repeat(60)]) {
      const layout = layoutPoster({ ...TEXT, name, tagline: null }, roughMeasure);
      expect(layout.name.lines).toHaveLength(2);
      expect(layout.name.size).toBeGreaterThanOrEqual(26);
      expect(layout.name.widths.every((width) => width <= INNER + .5)).toBe(true);
    }
  });

  it("keeps every real perk and every word of the pledge terms", () => {
    const perks = ["Your name on the founders' wall", "An invitation to the opening", "A thank-you from the owner"];
    const layout = layoutPoster({ ...TEXT, headline: "10% off every visit in the first year", perks, location: "East Austin, Texas" }, roughMeasure);
    expect(layout.fits).toBe(true);
    expect(layout.headlineLabelY).not.toBeNull();
    expect(layout.perks.map((perk) => perk.lines.join(" "))).toEqual(perks);
    expect(layout.back?.lines.join(" ")).toBe(TERMS);
    expect(layout.location?.lines.join(" ")).toBe("East Austin, Texas");
    expect(layout.perks.flatMap((perk) => perk.lines).some((line) => line.endsWith("…"))).toBe(false);
    expect(layout.back?.y.at(-1)).toBeLessThan(POSTER_H - 60);
  });

  it("gives artwork less space before it would hide perks", () => {
    const plain = layoutPoster(TEXT, roughMeasure);
    const perks = ["A private preview with the founders before the doors open to everyone else", "Your name on the wall by the door, painted by a local artist",
      "A thank-you from the owner at the opening night party for founders", "An invitation to the first anniversary dinner with the whole team"];
    const backed = layoutPoster({ ...TEXT, perks }, roughMeasure);
    expect(backed.art.height).toBeLessThan(plain.art.height);
    expect(backed.name).toEqual(plain.name);
  });

  it("surfaces overflow rather than silently dropping money terms", () => {
    const back = `${TERMS} `.repeat(8).trim();
    const layout = layoutPoster({ ...TEXT, back }, roughMeasure);
    expect(layout.fits).toBe(false);
    expect(layout.problem).toMatch(/no perks or terms have been omitted/i);
    expect(layout.back?.lines.join(" ")).toBe(back);
  });

  it("keeps the QR block within the printed sheet, with the terms beside it", () => {
    const { qr, back } = layoutPoster(TEXT, roughMeasure);
    expect(qr.x + qr.size).toBe(POSTER_W - POSTER_M);
    expect(qr.y + qr.size).toBeLessThan(POSTER_H - POSTER_M);
    expect(back?.widths.every((width) => width <= qr.x - POSTER_M)).toBe(true);
  });

  it("can shorten optional labels, never perks or terms, with an explicit ellipsis", () => {
    expect(fitLines("one two three four five", 9, (line) => line.length, 2)).toEqual(["one two", "three…"]);
  });
});
