import { describe, expect, it } from "vitest";
import { absoluteUrl, googleMapsUrl, googlePlaceUrl, osmPageUrl, safeUrl, shortLink, webLink } from "./url";

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

describe("googlePlaceUrl", () => {
  it("searches Google Maps for a place by name, around its coordinates, so its card with the ratings opens", () => {
    expect(googlePlaceUrl("Mandarine Koueider", 30.0631, 31.2199)).toBe(
      "https://www.google.com/maps/search/Mandarine%20Koueider/@30.063100,31.219900,18z",
    );
  });

  it("keeps a name with symbols or another script inside its own path segment", () => {
    const url = googlePlaceUrl("Rye & Rise/Bakery ?#", 40.7, -73.9);
    expect(url.startsWith("https://www.google.com/maps/search/")).toBe(true);
    expect(url).toContain("Rye%20%26%20Rise%2FBakery%20%3F%23");
    expect(new URL(url).pathname.split("/")).toHaveLength(5); // /maps/search/<name>/@lat,lon,zoom
    expect(googlePlaceUrl("روتو", 30, 31)).toContain("%D8%B1%D9%88%D8%AA%D9%88");
  });
});

describe("osmPageUrl", () => {
  it("links the page of a node, a way or a relation, and nothing else", () => {
    expect(osmPageUrl("node/3815394181")).toBe("https://www.openstreetmap.org/node/3815394181");
    expect(osmPageUrl("way/210716506")).toBe("https://www.openstreetmap.org/way/210716506");
    expect(osmPageUrl("relation/5245173")).toBe("https://www.openstreetmap.org/relation/5245173");
    for (const bad of ["point/12345", "node/abc", "node/0", "node/1/2", "../node/1", "https://evil.example/node/1", "", null, undefined]) {
      expect(osmPageUrl(bad)).toBeNull();
    }
  });
});

describe("webLink", () => {
  it("opens a place's own website only when it is a web address", () => {
    expect(webLink("https://corner.example/menu")).toBe("https://corner.example/menu");
    expect(webLink("http://corner.example")).toBe("http://corner.example/");
    for (const bad of ["javascript:alert(1)", "data:text/html,<script>1</script>", "ftp://corner.example", "corner.example", "", 42, null, undefined]) {
      expect(webLink(bad)).toBeNull();
    }
  });
});
