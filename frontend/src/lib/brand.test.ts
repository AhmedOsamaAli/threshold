import { describe, expect, it } from "vitest";
import { replays, WALK_IN_MS } from "./brand";

describe("replays", () => {
  it("plays the walk again on every click or tap, even while one is playing", () => {
    expect(replays("click", false, 0)).toBe(true);
    expect(replays("click", false, WALK_IN_MS * 3)).toBe(true);
  });

  it("previews it on hover or keyboard focus only once the last walk has ended", () => {
    expect(replays("preview", false, WALK_IN_MS - 1)).toBe(false);
    expect(replays("preview", false, WALK_IN_MS)).toBe(true);
  });

  it("never plays it with reduced motion", () => {
    expect(replays("click", true, WALK_IN_MS)).toBe(false);
    expect(replays("preview", true, WALK_IN_MS)).toBe(false);
  });
});
