import { describe, expect, it, vi } from "vitest";
import { DEFAULT_POSTER_APPEARANCE } from "../lib/posterBrand";
import { createPosterDesignStore } from "./poster";

describe("a campaign's poster design", () => {
  it("restores and updates one campaign's design without changing other campaigns'", () => {
    const values = new Map<string, string>([["walk-in-poster:campaign:a", '{"choice":"botanical"}']]);
    const store = createPosterDesignStore(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
    }));
    expect(store.get("campaign:a")).toContain("botanical");
    const changed = { ...DEFAULT_POSTER_APPEARANCE, accent: "#214c37", logo: "data:image/png;base64,logo", leadPerk: "Opening invitation" };
    expect(store.save("campaign:a", changed)).toBe(true);
    expect(JSON.parse(store.get("campaign:a") ?? "{}")).toEqual(changed);
    expect(store.get("campaign:other")).toBeNull();
  });

  it("notifies every subscriber of a save, and stops notifying one that unmounts", () => {
    const store = createPosterDesignStore(() => null);
    const first = vi.fn(), second = vi.fn();
    const leave = store.subscribe(first);
    store.subscribe(second);
    store.save("campaign:a", DEFAULT_POSTER_APPEARANCE);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    leave();
    store.save("campaign:a", { ...DEFAULT_POSTER_APPEARANCE, accent: "#214c37" });
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("keeps the design for this visit if storage is denied", () => {
    const store = createPosterDesignStore(() => { throw new Error("storage denied"); });
    expect(store.get("campaign:a")).toBeNull();
    const changed = { ...DEFAULT_POSTER_APPEARANCE, accent: "#214c37" };
    expect(store.save("campaign:a", changed)).toBe(false);
    expect(JSON.parse(store.get("campaign:a") ?? "{}")).toEqual(changed);
  });
});
