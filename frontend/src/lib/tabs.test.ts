import { describe, expect, it } from "vitest";
import { parseRoute, type Route } from "./routes";
import { currentTab, TABS } from "./tabs";

describe("the main tabs", () => {
  it("are the three places, in the order the bar shows them", () => {
    expect(TABS.map((tab) => tab.label)).toEqual(["Browse", "Ask", "Check a spot"]);
    expect(TABS.map((tab) => tab.href)).toEqual(["/browse", "/ask", "/spot"]);
  });

  it("each open the page the router knows by the tab's own id", () => {
    for (const tab of TABS) expect(parseRoute(tab.href, "").page).toBe(tab.id);
  });

  it("say what each is for", () => {
    for (const tab of TABS) expect(tab.title.length).toBeGreaterThan(20);
  });

  it("leave out starting a campaign, which is something to do and not a place to be", () => {
    expect(TABS.map((tab) => tab.id)).not.toContain("start-campaign");
  });
});

describe("the tab of the page on show", () => {
  it("is found for each of the three places", () => {
    expect(currentTab({ page: "browse" })).toBe("browse");
    expect(currentTab({ page: "ask" })).toBe("ask");
    expect(currentTab({ page: "spot" })).toBe("spot");
  });

  it("is none on any other page", () => {
    const others: Route[] = [
      { page: "home" },
      { page: "start-campaign" },
      { page: "my-campaigns" },
      { page: "privacy" },
      { page: "proof", id: "c1" },
      { page: "receipt", token: "t".repeat(32) },
      { page: "campaign", id: "c1", pledge: null, cancelled: false },
      { page: "not-found", path: "/nowhere" },
    ];
    for (const route of others) expect(currentTab(route)).toBeNull();
  });
});
