import { describe, expect, it } from "vitest";
import { absoluteUrl, googleMapsUrl, safeUrl, shortLink } from "./url";

describe("absoluteUrl", () => {
  it("makes a path the API returns a link to share", () => {
    expect(absoluteUrl("/p/c4f1e2", "https://threshold.example")).toBe("https://threshold.example/p/c4f1e2");
  });
});

describe("shortLink", () => {
  it("prints a link without its scheme and tags", () => {
    expect(shortLink("https://www.goldenhour.cafe/?utm_source=poster")).toBe("goldenhour.cafe");
    expect(shortLink("https://goldenhour.cafe/menu/?utm_source=poster")).toBe("goldenhour.cafe/menu");
    expect(shortLink("not a url")).toBe("not a url");
  });
});

describe("safeUrl", () => {
  it("allows https images and inline raster data, and nothing else", () => {
    expect(safeUrl("https://lh3.googleusercontent.com/a.jpg")).toBe("https://lh3.googleusercontent.com/a.jpg");
    expect(safeUrl("data:image/jpeg;base64,AAAA")).toBe("data:image/jpeg;base64,AAAA");
    expect(safeUrl("http://example.com/a.jpg")).toBeNull();
    expect(safeUrl("data:image/svg+xml;base64,AAAA")).toBeNull();
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});

describe("googleMapsUrl", () => {
  it("searches Google Maps for the coordinates, to six decimals", () => {
    expect(googleMapsUrl(30.0626, 31.2197)).toBe("https://www.google.com/maps/search/?api=1&query=30.062600,31.219700");
    expect(googleMapsUrl(40.7350123, -73.9750987)).toBe("https://www.google.com/maps/search/?api=1&query=40.735012,-73.975099");
  });
});
