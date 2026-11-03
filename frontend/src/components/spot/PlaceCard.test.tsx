import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SpotNeighbor } from "../../api/spot";
import { PlaceCard } from "./PlaceCard";

const place: SpotNeighbor = {
  name: "Mandarine Koueider",
  kind: "café",
  distance_m: 57,
  lat: 30.0631,
  lon: 31.2199,
  osm: "node/2229263085",
  details: null,
};

const card = (patch: Partial<SpotNeighbor> = {}, props: { compact?: boolean } = {}) =>
  renderToStaticMarkup(<PlaceCard place={{ ...place, ...patch }} mark="1" onClose={() => undefined} onExpand={() => undefined} {...props} />);

describe("a place's card", () => {
  it("names the place, its kind, how far it is and how long the walk is", () => {
    const html = card();
    expect(html).toContain("Mandarine Koueider");
    expect(html).toContain("café · 60 m · 1 min on foot");
    expect(html).toContain('role="dialog"');
  });

  it("links the place's own page on OpenStreetMap and its card on Google Maps, each in a new tab", () => {
    const html = card();
    expect(html).toContain('href="https://www.openstreetmap.org/node/2229263085"');
    expect(html).toContain('href="https://www.google.com/maps/search/Mandarine%20Koueider/@30.063100,31.219900,18z"');
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
    expect(html).toContain("Ratings and photos on Google Maps");
    expect(html).toContain("Open it on OpenStreetMap");
    expect(html).toContain("(opens in a new tab)");
  });

  it("says plainly that OpenStreetMap has no ratings, and what it lacks for this place", () => {
    const html = card();
    expect(html).toContain("OpenStreetMap has no ratings or photos. Google Maps does.");
    expect(html).toContain("Nobody has added opening hours, an address, a phone or a website");
  });

  it("has no OpenStreetMap link for a place with no page there, and still links Google Maps", () => {
    const html = card({ osm: null });
    expect(html).not.toContain("openstreetmap.org/node");
    expect(html).not.toContain("Open it on OpenStreetMap");
    expect(html).toContain("google.com/maps/search/");
  });

  it("shows what the volunteers wrote down, the website as a link and the phone as one to call", () => {
    const html = card({
      details: { hours: "24/7", address: "12 Nile Street, Cairo", phone: "+20 2 1234 5678", website: "https://corner.example/menu" },
    });
    expect(html).toContain("Open 24 hours, every day");
    expect(html).toContain("12 Nile Street, Cairo");
    expect(html).toContain('href="tel:+20212345678"');
    expect(html).toContain('href="https://corner.example/menu"');
    expect(html).toContain(">corner.example/menu<");
    expect(html).not.toContain("Nobody has added");
  });

  it("never turns a website that is not a web address into a link", () => {
    const html = card({ details: { website: "javascript:alert(1)" } });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("Website");
  });

  it("shows markup in a volunteer's text as text", () => {
    const html = card({ name: "<img src=x onerror=alert(1)>", details: { hours: "<b>always</b>", address: "<script>1</script>" } });
    expect(html).not.toContain("<img src");
    expect(html).not.toContain("<b>always");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;b&gt;always&lt;/b&gt;");
  });

  it("is a small preview under the pointer: the name, the hours if known, the links and a way to the details", () => {
    const html = card({ details: { hours: "Mo-Fr 08:00-18:00", phone: "+1 555 0100" } }, { compact: true });
    expect(html).toContain("place-card preview");
    expect(html).toContain("Mo-Fr 08:00-18:00");
    expect(html).not.toContain("+1 555 0100");
    expect(html).not.toContain("OpenStreetMap has no ratings");
    expect(html).toContain("View details");
    expect(html).toContain("Ratings and photos on Google Maps");
  });

  it("can be closed", () => {
    expect(card()).toContain('aria-label="Close"');
  });
});
