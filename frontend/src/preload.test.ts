import { afterEach, describe, expect, it, vi } from "vitest";
import { preloadLink, preloadRoute, routeOf } from "./preload";

const spies = vi.hoisted(() => ({ privacy: vi.fn(), founders: vi.fn() }));

vi.mock("./chunks", () => ({
  privacyChunk: { preload: spies.privacy },
  foundersChunk: { preload: spies.founders },
}));

const BASE = "https://walkin.test/founders";
const TOKEN = "Av7v5rcNyjXToUQ9JyFkEyHFEHJ_jijs";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("what an address needs", () => {
  it("starts the chunk that draws each page", () => {
    preloadRoute({ page: "privacy" });
    expect(spies.privacy).toHaveBeenCalledTimes(1);
    expect(spies.founders).not.toHaveBeenCalled();

    preloadRoute({ page: "home" });
    preloadRoute({ page: "founders" });
    preloadRoute({ page: "start-campaign" });
    preloadRoute({ page: "my-campaigns" });
    preloadRoute({ page: "campaign", id: "c4f1e2", pledge: null, cancelled: false });
    preloadRoute({ page: "receipt", token: TOKEN });
    expect(spies.founders).toHaveBeenCalledTimes(6);
    expect(spies.privacy).toHaveBeenCalledTimes(1);
  });

  it("starts nothing for an address the app has no page for", () => {
    preloadRoute({ page: "not-found", path: "/s/099134cbfaec" });
    expect(spies.founders).not.toHaveBeenCalled();
    expect(spies.privacy).not.toHaveBeenCalled();
  });

  it("reads a link's route, and none for a link that leaves the app", () => {
    expect(routeOf("/p/c4f1e2?pledge=5O190127TN364715T", BASE)).toEqual({
      page: "campaign",
      id: "c4f1e2",
      pledge: "5O190127TN364715T",
      cancelled: false,
    });
    expect(routeOf(`https://walkin.test/r/${TOKEN}`, BASE)).toEqual({ page: "receipt", token: TOKEN });
    expect(routeOf("https://www.paypal.com/", BASE)).toBeNull();
    expect(routeOf("http://[", BASE)).toBeNull();
  });

  it("starts the code of a link's page, and nothing for a link that leaves the app", () => {
    vi.stubGlobal("window", { location: { href: BASE } });
    preloadLink("https://www.paypal.com/");
    expect(spies.founders).not.toHaveBeenCalled();
    expect(spies.privacy).not.toHaveBeenCalled();
    preloadLink("/privacy");
    expect(spies.privacy).toHaveBeenCalledTimes(1);
    preloadLink("/founders/start");
    expect(spies.founders).toHaveBeenCalledTimes(1);
  });
});
