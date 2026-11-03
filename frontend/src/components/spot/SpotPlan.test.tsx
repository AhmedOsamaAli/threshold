import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Spot } from "../../api/spot";
import { SpotPlan } from "./SpotPlan";

const spot: Spot = {
  place: { label: "Zamalek, Cairo", lat: 30, lon: 31 },
  kind: "cafe",
  walk_minutes: 10,
  checked: true,
  reason: null,
  same_kind: { count: 2, nearest: [] },
  around: {
    count: 3,
    top_kinds: [],
    dots: [
      [30.002, 31, 1],
      [29.998, 31.001, 1],
      [30, 30.999, 0],
    ],
  },
  area: {
    ring: [
      [30.01, 31],
      [30, 31.01],
      [29.99, 31],
      [30, 30.99],
    ],
    source: "walk",
  },
  summary: "2 cafes are listed within a ten-minute walk.",
  source: { name: "OpenStreetMap", url: "https://www.openstreetmap.org", as_of: null },
  checked_at: "2026-11-03T12:00:00Z",
  note: "Listed places only.",
};

describe("a spot's plan", () => {
  it("draws the walking area, the address and every place, the asked kind filled", () => {
    const html = renderToStaticMarkup(<SpotPlan spot={spot} />);
    expect(html).toContain("<svg");
    expect(html).toContain('role="img"');
    expect(html).toContain("<polygon");
    expect(html.match(/class="spot-dot same"/g)).toHaveLength(2);
    expect(html.match(/class="spot-dot"/g)).toHaveLength(1);
    expect(html).toContain("Filled dots: 2 listed cafe places. Hollow dots: 1 other places.");
    expect(html).toContain("10-minute walk along streets");
  });

  it("says when the area is a circle and not the streets", () => {
    const html = renderToStaticMarkup(<SpotPlan spot={{ ...spot, area: spot.area && { ...spot.area, source: "circle" } }} />);
    expect(html).toContain("a circle of that radius, not the streets");
  });

  it("draws nothing for a check that found nothing to draw", () => {
    expect(renderToStaticMarkup(<SpotPlan spot={{ ...spot, checked: false, area: null, around: null }} />)).toBe("");
  });
});
