import { describe, expect, it } from "vitest";
import {
  ASK_URL,
  BROWSE_URL,
  campaignUrl,
  HOME_URL,
  MY_CAMPAIGNS_URL,
  pageUrl,
  parseRoute,
  PRIVACY_URL,
  proofUrl,
  receiptUrl,
  SPOT_URL,
  START_CAMPAIGN_URL,
  type CampaignRoute,
  type Route,
} from "./routes";

const TOKEN = "A-b_".repeat(8);

describe("routes", () => {
  it("reads the pages with no id in their address, whatever the query or a closing slash", () => {
    expect(parseRoute("/", "")).toEqual({ page: "home" });
    expect(parseRoute("/", "?utm_source=poster")).toEqual({ page: "home" });
    expect(parseRoute("/browse", "")).toEqual({ page: "browse" });
    expect(parseRoute("/browse/", "?utm_source=poster")).toEqual({ page: "browse" });
    expect(parseRoute("/start", "")).toEqual({ page: "start-campaign" });
    expect(parseRoute("/start/", "?from=bar")).toEqual({ page: "start-campaign" });
    expect(parseRoute("/ask", "")).toEqual({ page: "ask" });
    expect(parseRoute("/ask/", "?from=home")).toEqual({ page: "ask" });
    expect(parseRoute("/spot", "")).toEqual({ page: "spot" });
    expect(parseRoute("/spot/", "?from=home")).toEqual({ page: "spot" });
    expect(parseRoute("/me", "")).toEqual({ page: "my-campaigns" });
    expect(parseRoute("/me/", "?utm_source=x")).toEqual({ page: "my-campaigns" });
    expect(parseRoute("/privacy", "")).toEqual({ page: "privacy" });
    expect(parseRoute("/privacy/", "?from=footer")).toEqual({ page: "privacy" });
  });

  it("opens a campaign's proof by the campaign's id", () => {
    const route = { page: "proof", id: "c4f1e2" } as const;
    expect(parseRoute("/proof/c4f1e2", "")).toEqual(route);
    expect(parseRoute("/proof/c4f1e2/", "?from=card")).toEqual(route);
    expect(proofUrl("c4f1e2")).toBe("/proof/c4f1e2");
    expect(pageUrl(route)).toBe("/proof/c4f1e2");
    for (const invalid of ["/proof", "/proof/", "/proof/a.b", `/proof/${"a".repeat(65)}`, "/proof/c4f1e2/extra"]) {
      expect(parseRoute(invalid, "")).toEqual({ page: "not-found", path: invalid });
    }
  });

  it("opens private receipts by their 32-character token, which a public campaign URL never carries", () => {
    const route = { page: "receipt", token: TOKEN } as const;
    expect(parseRoute(receiptUrl(TOKEN), "")).toEqual(route);
    expect(parseRoute(`${receiptUrl(TOKEN)}/`, "")).toEqual(route);
    expect(pageUrl(route)).toBe(`/r/${TOKEN}`);
    for (const invalid of ["/r/", "/r/short", `/r/${TOKEN}x`, `/r/${TOKEN}/extra`]) {
      expect(parseRoute(invalid, "")).toEqual({ page: "not-found", path: invalid });
    }
  });

  it("reads a campaign by its id, and what PayPal sent the supporter back with", () => {
    const plain: CampaignRoute = { page: "campaign", id: "c4f1e2", pledge: null, cancelled: false };
    expect(parseRoute("/p/c4f1e2", "")).toEqual(plain);
    expect(parseRoute("/p/c4f1e2/", "?utm_source=poster&utm_medium=qr")).toEqual(plain);
    expect(parseRoute(`/p/${"a".repeat(64)}`, "")).toEqual({ ...plain, id: "a".repeat(64) });
    // PayPal adds its own token and PayerID to the return address.
    expect(parseRoute("/p/c4f1e2", "?pledge=5O190127TN364715T&token=5O190127TN364715T&PayerID=QYR5Z8XDVJNXQ")).toEqual({
      ...plain,
      pledge: "5O190127TN364715T",
    });
    expect(parseRoute("/p/c4f1e2", "?cancelled=1&token=5O190127TN364715T")).toEqual({ ...plain, cancelled: true });
    // The server's own pledge id, which its return address carries.
    expect(parseRoute("/p/c4f1e2", "?pledge=pl_Zq3-x9KpL0&token=5O190127TN364715T&PayerID=QYR5Z8XDVJNXQ")).toEqual({
      ...plain,
      pledge: "pl_Zq3-x9KpL0",
    });
  });

  it("ignores a pledge that is not an order id, and a cancel that is not 1", () => {
    for (const search of ["?pledge=", "?pledge=a%20b", "?pledge=a/b", `?pledge=${"A".repeat(65)}`, "?cancelled=yes", "?cancelled=0"]) {
      expect(parseRoute("/p/c4f1e2", search)).toEqual({ page: "campaign", id: "c4f1e2", pledge: null, cancelled: false });
    }
  });

  it("has no page for every other address, and keeps the address it was asked for", () => {
    for (const path of [
      "",
      "/s/3f9a0c1b2d4e",
      "/k/tok_1",
      "/k/tok_1/dossier",
      "/examples",
      "/me/x",
      "/mine",
      "/privacy/x",
      "/privacy-policy",
      "/p",
      "/p/",
      "/p/a.b",
      "/p/a%20b",
      "/p/c4f1e2/extra",
      `/p/${"a".repeat(65)}`,
      "/pledge/c4f1e2",
      "/founder",
      "/founders",
      "/founders/start",
      "/browse/x",
      "/start/x",
      "/ask/x",
      "/spot/x",
      "/elsewhere",
    ]) {
      expect(parseRoute(path, "?sheet=1")).toEqual({ page: "not-found", path });
    }
  });

  it("builds each page's address and reads it back", () => {
    expect([HOME_URL, BROWSE_URL, START_CAMPAIGN_URL, ASK_URL, SPOT_URL, MY_CAMPAIGNS_URL, PRIVACY_URL]).toEqual([
      "/",
      "/browse",
      "/start",
      "/ask",
      "/spot",
      "/me",
      "/privacy",
    ]);
    const routes: Route[] = [
      { page: "home" },
      { page: "browse" },
      { page: "start-campaign" },
      { page: "ask" },
      { page: "spot" },
      { page: "my-campaigns" },
      { page: "privacy" },
      { page: "proof", id: "A-b_9" },
      { page: "receipt", token: TOKEN },
      { page: "campaign", id: "A-b_9", pledge: null, cancelled: false },
      { page: "not-found", path: "/elsewhere" },
    ];
    for (const route of routes) {
      const url = new URL(pageUrl(route), "https://threshold.example");
      expect(parseRoute(url.pathname, url.search)).toEqual(route);
    }
  });

  it("builds a campaign's address without PayPal's query, so returning from PayPal stays on the same page", () => {
    expect(campaignUrl("c4f1e2")).toBe("/p/c4f1e2");
    const back: CampaignRoute = { page: "campaign", id: "c4f1e2", pledge: "5O190127TN364715T", cancelled: false };
    expect(pageUrl(back)).toBe("/p/c4f1e2");
    expect(pageUrl({ ...back, pledge: null, cancelled: true })).toBe(pageUrl(back));
  });
});
