import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import type { Limits, LimitsRequest, MadeLimits } from "../api/trust";
import { createLimitsStore, LIMITS_STORAGE_KEY, type LimitsApi } from "./limits";

const REQUEST: LimitsRequest = { max_pledge: "30.00", max_total: "60.00", max_count: 3, days: 1 };

const limitsOf = (patch: Partial<Limits> = {}): Limits => ({
  currency: "USD",
  max_pledge: "30.00",
  max_total: "60.00",
  max_count: 3,
  near: null,
  kinds: null,
  expires_at: "2026-11-04T12:00:00Z",
  ...patch,
});

function keeper(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

function made(token: string, patch: Partial<Limits> = {}): MadeLimits {
  return { token, header: "X-Limits", limits: limitsOf(patch) };
}

function apiOf(patch: Partial<LimitsApi> = {}): LimitsApi {
  return {
    make: () => Promise.resolve(made("token-1")),
    read: () => Promise.resolve({ limits: limitsOf({ used: "25.00", remaining: "35.00", pledges: 1 }) }),
    ...patch,
  };
}

const ended = (code: string) => new ApiError("Those limits have ended.", 401, true, { code });

describe("the limits a person sets", () => {
  it("start with none", () => {
    expect(createLimitsStore(apiOf(), keeper()).get()).toEqual({ token: null, limits: null, busy: false, error: null });
  });

  it("are remembered by this browser, and read again from the server", async () => {
    const store = createLimitsStore(apiOf(), keeper({ [LIMITS_STORAGE_KEY]: "kept-token" }));
    expect(store.get()).toMatchObject({ token: "kept-token", limits: null });
    await store.refresh();
    expect(store.get().limits).toMatchObject({ used: "25.00", remaining: "35.00" });
  });

  it("are set with the token the server made, kept for the next visit", async () => {
    const browser = keeper();
    const store = createLimitsStore(apiOf(), browser);
    const told: boolean[] = [];
    store.subscribe(() => {
      told.push(store.get().busy);
    });
    expect(await store.create(REQUEST)).toBe(true);
    expect(store.get()).toMatchObject({ token: "token-1", busy: false, error: null });
    expect(store.get().limits?.max_total).toBe("60.00");
    expect(browser.data.get(LIMITS_STORAGE_KEY)).toBe("token-1");
    expect(told).toEqual([true, false]);
  });

  it("keep the old ones when new ones cannot be set, and say why", async () => {
    const browser = keeper({ [LIMITS_STORAGE_KEY]: "old-token" });
    const store = createLimitsStore(
      apiOf({ make: () => Promise.reject(new ApiError("That is more than the most.", 422, true)) }),
      browser,
    );
    expect(await store.create(REQUEST)).toBe(false);
    expect(store.get()).toMatchObject({ token: "old-token", busy: false, error: "That is more than the most." });
    expect(browser.data.get(LIMITS_STORAGE_KEY)).toBe("old-token");
    store.clearError();
    expect(store.get().error).toBeNull();
  });

  it("are dropped when the server says they have ended or are not its own", async () => {
    for (const code of ["limits_expired", "limits_invalid", "limits_required"]) {
      const browser = keeper({ [LIMITS_STORAGE_KEY]: "old-token" });
      const store = createLimitsStore(apiOf({ read: () => Promise.reject(ended(code)) }), browser);
      await store.refresh();
      expect(store.get()).toMatchObject({ token: null, limits: null });
      expect(browser.data.has(LIMITS_STORAGE_KEY)).toBe(false);
    }
  });

  it("stay as they were when the server cannot be reached", async () => {
    const store = createLimitsStore(apiOf({ read: () => Promise.reject(new TypeError("offline")) }), keeper({ [LIMITS_STORAGE_KEY]: "old-token" }));
    await store.refresh();
    expect(store.get().token).toBe("old-token");
  });

  it("are not brought back by a read that was asked before they were removed", async () => {
    let answer: (value: { limits: Limits }) => void = () => undefined;
    const slow = new Promise<{ limits: Limits }>((resolve) => {
      answer = resolve;
    });
    const store = createLimitsStore(apiOf({ read: () => slow }), keeper({ [LIMITS_STORAGE_KEY]: "old-token" }));
    const reading = store.refresh();
    store.clear();
    answer({ limits: limitsOf() });
    await reading;
    expect(store.get()).toMatchObject({ token: null, limits: null });
  });

  it("are not replaced by a read that was asked before new ones were set", async () => {
    let answer: (value: { limits: Limits }) => void = () => undefined;
    const slow = new Promise<{ limits: Limits }>((resolve) => {
      answer = resolve;
    });
    const store = createLimitsStore(apiOf({ read: () => slow }), keeper({ [LIMITS_STORAGE_KEY]: "old-token" }));
    const reading = store.refresh();
    await store.create(REQUEST);
    answer({ limits: limitsOf({ max_total: "999.00" }) });
    await reading;
    expect(store.get().limits?.max_total).toBe("60.00");
  });

  it("are removed, in the browser too", async () => {
    const browser = keeper();
    const store = createLimitsStore(apiOf(), browser);
    await store.create(REQUEST);
    store.clear();
    expect(store.get()).toMatchObject({ token: null, limits: null });
    expect(browser.data.size).toBe(0);
  });

  it("take what a pledge answered with only while there are limits", async () => {
    const store = createLimitsStore(apiOf(), keeper());
    store.update(limitsOf({ remaining: "5.00" }));
    expect(store.get().limits).toBeNull();
    await store.create(REQUEST);
    store.update(limitsOf({ remaining: "5.00" }));
    expect(store.get().limits?.remaining).toBe("5.00");
  });

  it("are asked for nothing when there are none", async () => {
    let asked = 0;
    const store = createLimitsStore(
      apiOf({
        read: () => {
          asked += 1;
          return Promise.resolve({ limits: limitsOf() });
        },
      }),
      keeper(),
    );
    await store.refresh();
    expect(asked).toBe(0);
  });

  it("work for this visit in a browser that will not keep them", async () => {
    const refusing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    const store = createLimitsStore(apiOf(), refusing);
    expect(store.get().token).toBeNull();
    expect(await store.create(REQUEST)).toBe(true);
    expect(store.get().token).toBe("token-1");
    expect(() => {
      store.clear();
    }).not.toThrow();
  });
});
