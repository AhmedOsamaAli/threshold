import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Spot, SpotNeighbor } from "../../api/spot";
import { SpotMap } from "./SpotMap";

const neighbor = (index: number, patch: Partial<SpotNeighbor> = {}): SpotNeighbor => ({
  name: `Cafe ${index}`,
  kind: "café",
  distance_m: 100 * index,
  lat: 30 + index / 1000,
  lon: 31,
  osm: `node/${index}`,
  details: null,
  ...patch,
});

const spot = (nearest: SpotNeighbor[], patch: Partial<Spot> = {}): Spot => ({
  place: { label: "Zamalek, Cairo", lat: 30, lon: 31 },
  kind: "cafe",
  walk_minutes: 10,
  checked: true,
  reason: null,
  same_kind: { count: nearest.length, nearest },
  around: { count: 40, top_kinds: [{ kind: "restaurant", count: 12 }, { kind: "café", count: 9 }], dots: [], green: [] },
  area: { ring: [[30.01, 31], [30, 31.01], [29.99, 31], [30, 30.99]], source: "walk" },
  summary: "9 cafés are listed within a ten-minute walk.",
  source: { name: "OpenStreetMap contributors", url: "https://www.openstreetmap.org/copyright", as_of: null },
  checked_at: "2026-11-03T12:00:00Z",
  note: "Listed places only.",
  ...patch,
});

describe("a spot's map and the places beside it", () => {
  it("lists every place of the kind, nearest first, each numbered, with how far and how long the walk is", () => {
    const html = renderToStaticMarkup(<SpotMap spot={spot([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => neighbor(n)))} />);
    for (let n = 1; n <= 12; n++) expect(html).toContain(`Cafe ${n}<`);
    expect(html.match(/class="sp-row/g)).toHaveLength(12);
    expect(html.indexOf("Cafe 1<")).toBeLessThan(html.indexOf("Cafe 2<"));
    expect(html).toContain("100 m · 1 min");
    expect(html).toContain("1.2 km · 15 min");
    expect(html).toContain("<b>12</b> listed cafe places in the walk");
    expect(html).toContain("numbers: the nearest cafe places (zoom in for every number)");
  });

  it("says how many of the places are listed when there are more than the answer names", () => {
    const html = renderToStaticMarkup(<SpotMap spot={spot([1, 2, 3].map((n) => neighbor(n)), { same_kind: { count: 82, nearest: [1, 2, 3].map((n) => neighbor(n)) } })} />);
    expect(html).toContain("Nearest of the same kind · 3 of 82");
    expect(html).toContain("<b>82</b> listed cafe places in the walk");
  });

  it("names the map for assistive technology and says what the colors and numbers are", () => {
    const html = renderToStaticMarkup(<SpotMap spot={spot([neighbor(1), neighbor(2)])} />);
    expect(html).toContain('aria-label="A map of the 10-minute walk from Zamalek, Cairo, with 2 cafe places numbered"');
    expect(html).toContain("Blue: 10 minutes on foot along streets · numbers: the nearest cafe places");
    expect(html).toContain("Loading the map…");
  });

  it("says when the walking area is a circle and not the streets", () => {
    const html = renderToStaticMarkup(<SpotMap spot={spot([neighbor(1)], { area: { ring: [[30.01, 31], [30, 31.01], [29.99, 31]], source: "circle" } })} />);
    expect(html).toContain("a circle of that radius, not the streets");
  });

  it("each row opens a card, so it announces a dialog", () => {
    const html = renderToStaticMarkup(<SpotMap spot={spot([neighbor(1)])} />);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("place-card");
  });

  it("lists what is around, and the parks when there are some", () => {
    const html = renderToStaticMarkup(
      <SpotMap spot={spot([neighbor(1)], { around: { count: 40, top_kinds: [{ kind: "restaurant", count: 12 }], dots: [], green: [{ name: "Linden Park", kind: "park", distance_m: 300 }] } })} />,
    );
    expect(html).toContain("40 places of any kind listed around");
    expect(html).toContain("restaurant 12");
    expect(html).toContain("Parks and gardens in the walk");
    expect(html).toContain("Linden Park (300 m)");
  });

  it("shows no list and no count for a kind the data cannot count, but still the map and what is around", () => {
    const html = renderToStaticMarkup(<SpotMap spot={spot([], { same_kind: null })} />);
    expect(html).not.toContain("sp-row");
    expect(html).not.toContain("listed cafe");
    expect(html).toContain("40 places of any kind listed around");
    expect(html).toContain("pm-canvas");
  });

  it("speaks of one place in the singular", () => {
    expect(renderToStaticMarkup(<SpotMap spot={spot([neighbor(1)])} />)).toContain("<b>1</b> listed cafe place in the walk");
  });
});
