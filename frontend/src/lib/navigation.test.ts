import { describe, expect, it } from "vitest";
import { isPlainClick } from "./navigation";

describe("isPlainClick", () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

  it("handles a plain primary click in place", () => {
    expect(isPlainClick(click)).toBe(true);
  });

  it("leaves modified, middle and already handled clicks to the browser", () => {
    expect(isPlainClick({ ...click, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...click, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...click, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...click, altKey: true })).toBe(false);
    expect(isPlainClick({ ...click, button: 1 })).toBe(false);
    expect(isPlainClick({ ...click, defaultPrevented: true })).toBe(false);
  });
});
