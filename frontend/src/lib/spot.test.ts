import { describe, expect, it } from "vitest";
import type { Spot } from "../api/spot";
import { metresText, planOf, SPOT_EXAMPLES, topKindsText } from "./spot";

const spot = (patch: Partial<Pick<Spot, "place" | "area" | "around">> = {}): Pick<Spot, "place" | "area" | "around"> => ({
  place: { label: "Zamalek, Cairo", lat: 30, lon: 31 },
  area: {
    ring: [
      [30.01, 31],
      [30, 31.01],
      [29.99, 31],
      [30, 30.99],
    ],
    source: "walk",
  },
  around: { count: 3, top_kinds: [], dots: [] },
  ...patch,
});

describe("a spot's plan", () => {
  it("draws nothing for a check with no area", () => {
    expect(planOf(spot({ area: null }))).toBeNull();
    expect(planOf(spot({ area: { ring: [[30, 31]], source: "circle" } }))).toBeNull();
  });

  it("puts the address at the centre of the square, and the walk inside it", () => {
    const plan = planOf(spot(), 320);
    expect(plan?.centre).toEqual({ x: 160, y: 160 });
    const points = (plan?.ring.split(" ") ?? []).map((pair) => pair.split(",").map(Number));
    expect(points).toHaveLength(4);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(320);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(320);
    }
  });

  it("puts north at the top", () => {
    const plan = planOf(spot({ around: { count: 2, top_kinds: [], dots: [[30.005, 31, 1], [29.995, 31, 0]] } }));
    const [north, south] = plan?.dots ?? [];
    expect(north?.y).toBeLessThan(160);
    expect(south?.y).toBeGreaterThan(160);
    expect(north).toMatchObject({ x: 160, same: true });
    expect(south).toMatchObject({ x: 160, same: false });
  });

  it("scales the east-west distances to the latitude, so a walk is round, not stretched", () => {
    // At 60 degrees north a degree of longitude is half as long as one of latitude.
    const plan = planOf({
      place: { label: "Oslo", lat: 60, lon: 10 },
      area: {
        ring: [
          [60.01, 10],
          [60, 10.02],
          [59.99, 10],
          [60, 9.98],
        ],
        source: "walk",
      },
      around: { count: 0, top_kinds: [], dots: [] },
    });
    const points = (plan?.ring.split(" ") ?? []).map((pair) => pair.split(",").map(Number));
    const xs = points.map(([x]) => x ?? 0);
    const ys = points.map(([, y]) => y ?? 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(Math.max(...ys) - Math.min(...ys), 0);
  });

  it("leaves out a place that falls outside the plan", () => {
    const plan = planOf(spot({ around: { count: 2, top_kinds: [], dots: [[30, 31, 1], [31, 32, 0]] } }));
    expect(plan?.dots).toHaveLength(1);
    expect(plan?.dots[0]).toMatchObject({ same: true });
  });
});

describe("a distance and a list of kinds", () => {
  it("is in metres to the nearest ten under a kilometre, then in kilometres, as the server's sentences say it", () => {
    expect(metresText(413)).toBe("410 m");
    expect(metresText(57)).toBe("60 m");
    expect(metresText(4)).toBe("10 m");
    expect(metresText(999.6)).toBe("1.0 km");
    expect(metresText(1234)).toBe("1.2 km");
    expect(metresText(12_600)).toBe("13 km");
  });

  it("lists the kinds around, the most listed first as the server sent them", () => {
    expect(topKindsText([{ kind: "cafe", count: 12 }, { kind: "restaurant", count: 8 }])).toBe("cafe 12, restaurant 8");
    expect(topKindsText([])).toBe("");
  });

  it("has examples that name a kind the form offers", () => {
    expect(SPOT_EXAMPLES.length).toBeGreaterThan(0);
    for (const example of SPOT_EXAMPLES) expect(example.address.length).toBeGreaterThan(2);
  });
});
