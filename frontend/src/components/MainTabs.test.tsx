import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Route } from "../lib/routes";
import { MainTabs } from "./MainTabs";

const markup = (route: Route) => renderToStaticMarkup(<MainTabs route={route} />);

describe("the bar's main tabs", () => {
  it("are links in a navigation landmark, named for what they hold", () => {
    const html = markup({ page: "home" });
    expect(html).toMatch(/^<nav class="bar-tabs" aria-label="Main">/);
    expect(html.match(/<a /g)).toHaveLength(3);
    expect(html).not.toContain('role="tab"');
  });

  it("go to Browse, Ask and Check a spot, in that order", () => {
    const html = markup({ page: "home" });
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs).toEqual(["/browse", "/ask", "/spot"]);
    expect(html.indexOf(">Browse<")).toBeLessThan(html.indexOf(">Ask<"));
    expect(html.indexOf(">Ask<")).toBeLessThan(html.indexOf(">Check a spot<"));
  });

  it("each have a picture that assistive technology skips, and a tooltip that says what the place is for", () => {
    const html = markup({ page: "home" });
    expect(html.match(/<svg [^>]*aria-hidden="true"/g)).toHaveLength(3);
    expect(html).toContain('title="Ask an assistant to find a place and prepare a pledge, inside limits you set"');
  });

  it("mark only the page on show as current", () => {
    for (const [route, label] of [
      [{ page: "browse" }, "Browse"],
      [{ page: "ask" }, "Ask"],
      [{ page: "spot" }, "Check a spot"],
    ] as const) {
      const html = markup(route);
      expect(html.match(/aria-current="page"/g)).toHaveLength(1);
      expect(html).toMatch(new RegExp(`aria-current="page"[^>]*>.*?<span>${label}</span>`));
    }
  });

  it("mark none on a page that is not one of them", () => {
    expect(markup({ page: "home" })).not.toContain("aria-current");
    expect(markup({ page: "campaign", id: "c1", pledge: null, cancelled: false })).not.toContain("aria-current");
    expect(markup({ page: "start-campaign" })).not.toContain("aria-current");
  });
});
