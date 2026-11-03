import { afterEach, describe, expect, it, vi } from "vitest";
import { keepPrepared, PREPARED_FOR_MS, readPledge, takePrepared } from "./founders";

describe("a pledge remembered in this browser", () => {
  it("reads back what was stored", () => {
    const stored = JSON.stringify({ orderId: "5O190127TN364715T", at: "2026-10-26T10:00:00.000Z" });
    expect(readPledge(stored)).toEqual({ orderId: "5O190127TN364715T", at: "2026-10-26T10:00:00.000Z" });
  });

  it("keeps a valid private receipt without breaking older pledges", () => {
    const receipt = "x".repeat(32);
    const pledge = { orderId: "5O190127TN364715T", at: "2026-10-30", receipt };
    expect(readPledge(JSON.stringify(pledge))).toEqual(pledge);
    for (const invalid of ["../api/me", "", "x".repeat(33), 42]) {
      expect(readPledge(JSON.stringify({ ...pledge, receipt: invalid }))).toEqual({ orderId: pledge.orderId, at: pledge.at });
    }
  });

  it("ignores anything else, so a stranger's storage cannot withdraw some other order", () => {
    for (const stored of [
      null,
      "",
      "not json",
      "null",
      "[]",
      JSON.stringify({ orderId: "5O190127TN364715T" }),
      JSON.stringify({ orderId: 12, at: "2026-10-26" }),
      JSON.stringify({ orderId: "../../api/me", at: "2026-10-26" }),
      JSON.stringify({ orderId: "", at: "2026-10-26" }),
    ]) {
      expect(readPledge(stored)).toBeNull();
    }
  });
});

describe("a receipt prepared for a pledge not yet approved", () => {
  const RECEIPT = "Av7v5rcNyjXToUQ9JyFkEyHFEHJ_jijs";
  const NOW = Date.parse("2026-11-03T12:00:00Z");

  function stubStorage(): Map<string, string> {
    const data = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
        removeItem: (key: string) => void data.delete(key),
      },
    });
    return data;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("waits apart from the held pledges, and is given back once", () => {
    const data = stubStorage();
    keepPrepared("c4f1e2", RECEIPT, NOW);
    expect([...data.keys()].every((key) => !key.startsWith("walk-in-pledge"))).toBe(true);
    expect(takePrepared("c4f1e2", NOW + 60_000)).toBe(RECEIPT);
    expect(takePrepared("c4f1e2", NOW + 60_000)).toBeUndefined();
    expect(data.size).toBe(0);
  });

  it("is for its own campaign only", () => {
    stubStorage();
    keepPrepared("c4f1e2", RECEIPT, NOW);
    expect(takePrepared("d5a2f3", NOW)).toBeUndefined();
    expect(takePrepared("c4f1e2", NOW)).toBe(RECEIPT);
  });

  it("is forgotten once the person has been away from PayPal for a day", () => {
    stubStorage();
    keepPrepared("c4f1e2", RECEIPT, NOW);
    expect(takePrepared("c4f1e2", NOW + PREPARED_FOR_MS + 1)).toBeUndefined();
    keepPrepared("c4f1e2", RECEIPT, NOW);
    expect(takePrepared("c4f1e2", NOW + PREPARED_FOR_MS)).toBe(RECEIPT);
  });

  it("keeps nothing that is not a receipt, so storage cannot be used to name some other pledge", () => {
    const data = stubStorage();
    for (const bad of ["../api/me", "", "x".repeat(33), "x".repeat(31)]) keepPrepared("c4f1e2", bad, NOW);
    expect(data.size).toBe(0);
  });

  it("ignores whatever else is in storage", () => {
    const data = stubStorage();
    for (const stored of ["not json", "null", "[]", JSON.stringify({ receipt: RECEIPT }), JSON.stringify({ receipt: 5, at: NOW }), JSON.stringify({ receipt: "short", at: NOW }), JSON.stringify({ receipt: RECEIPT, at: "yesterday" })]) {
      data.set("walk-in-prepared:c4f1e2", stored);
      expect(takePrepared("c4f1e2", NOW)).toBeUndefined();
    }
  });

  it("does nothing where storage is refused", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("denied");
        },
        removeItem: () => {
          throw new Error("denied");
        },
      },
    });
    expect(() => {
      keepPrepared("c4f1e2", RECEIPT, NOW);
    }).not.toThrow();
    expect(takePrepared("c4f1e2", NOW)).toBeUndefined();
  });
});
