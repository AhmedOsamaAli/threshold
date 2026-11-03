import { afterEach, describe, expect, it, vi } from "vitest";
import { preloadLink, preloadRoute, routeOf } from "./preload";

const spies = vi.hoisted(() => ({ privacy: vi.fn(), campaigns: vi.fn(), home: vi.fn(), trust: vi.fn() }));

vi.mock("./chunks", () => ({
  privacyChunk: { preload: spies.privacy },
  campaignsChunk: { preload: spies.campaigns },
  homeChunk: { preload: spies.home },
  trustChunk: { preload: spies.trust },
}));

const BASE = "https://threshold.test/browse";
const TOKEN = "Av7v5rcNyjXToUQ9JyFkEyHFEHJ_jijs";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("what an address needs", () => {
  it("starts the chunk that draws each page", () => {
    preloadRoute({ page: "privacy" });
    expect(spies.privacy).toHaveBeenCalledTimes(1);
    expect(spies.campaigns).not.toHaveBeenCalled();

    preloadRoute({ page: "browse" });
    preloadRoute({ page: "start-campaign" });
    preloadRoute({ page: "my-campaigns" });
    preloadRoute({ page: "campaign", id: "c4f1e2", pledge: null, cancelled: false });
    preloadRoute({ page: "receipt", token: TOKEN });
    expect(spies.campaigns).toHaveBeenCalledTimes(5);
    expect(spies.privacy).toHaveBeenCalledTimes(1);
  });

  it("starts the home page's own chunk, and the trust chunk for the assistant, a proof and Check a spot", () => {
    preloadRoute({ page: "home" });
    expect(spies.home).toHaveBeenCalledTimes(1);
    expect(spies.campaigns).not.toHaveBeenCalled();

    preloadRoute({ page: "ask" });
    preloadRoute({ page: "spot" });
    preloadRoute({ page: "proof", id: "c4f1e2" });
    expect(spies.trust).toHaveBeenCalledTimes(3);
    expect(spies.home).toHaveBeenCalledTimes(1);
  });

  it("starts nothing for an address the app has no page for", () => {
    preloadRoute({ page: "not-found", path: "/s/099134cbfaec" });
    expect(spies.campaigns).not.toHaveBeenCalled();
    expect(spies.privacy).not.toHaveBeenCalled();
    expect(spies.home).not.toHaveBeenCalled();
    expect(spies.trust).not.toHaveBeenCalled();
  });

  it("reads a link's route, and none for a link that leaves the app", () => {
    expect(routeOf("/p/c4f1e2?pledge=5O190127TN364715T", BASE)).toEqual({
      page: "campaign",
      id: "c4f1e2",
      pledge: "5O190127TN364715T",
      cancelled: false,
    });
    expect(routeOf(`https://threshold.test/r/${TOKEN}`, BASE)).toEqual({ page: "receipt", token: TOKEN });
    expect(routeOf("https://www.paypal.com/", BASE)).toBeNull();
    expect(routeOf("http://[", BASE)).toBeNull();
  });

  it("starts the code of a link's page, and nothing for a link that leaves the app", () => {
    vi.stubGlobal("window", { location: { href: BASE } });
    preloadLink("https://www.paypal.com/");
    expect(spies.campaigns).not.toHaveBeenCalled();
    expect(spies.privacy).not.toHaveBeenCalled();
    preloadLink("/privacy");
    expect(spies.privacy).toHaveBeenCalledTimes(1);
    preloadLink("/start");
    expect(spies.campaigns).toHaveBeenCalledTimes(1);
  });
});
