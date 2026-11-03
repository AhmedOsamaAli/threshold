import { describe, expect, it } from "vitest";
import { hiddenPins, PILL_GAP, PIN_GAP, type PinSpot } from "./pins";

const pin = (id: string, x: number, y = 0, label = id): PinSpot => ({ id, label, x, y });

describe("which pins to hide", () => {
  it("hides none when they are all apart", () => {
    expect(hiddenPins([pin("1", 0), pin("2", 100), pin("3", 200)], null).size).toBe(0);
  });

  it("keeps the first of two that would cover each other, the nearer one in the list", () => {
    expect([...hiddenPins([pin("1", 0), pin("2", PIN_GAP - 1)], null)]).toEqual(["2"]);
    expect(hiddenPins([pin("1", 0), pin("2", PIN_GAP)], null).size).toBe(0); // exactly a gap apart is apart
  });

  it("measures the gap on both axes", () => {
    expect([...hiddenPins([pin("1", 0, 0), pin("2", 20, 20)], null)]).toEqual(["2"]); // 28 px apart on the diagonal
    expect(hiddenPins([pin("1", 0, 0), pin("2", 25, 25)], null).size).toBe(0); // 35 px
  });

  it("hides a pin only for the pins that are kept, not for one that is itself hidden", () => {
    // 2 hides behind 1; 3 is close to 2 but far enough from 1, so it stays.
    expect([...hiddenPins([pin("1", 0), pin("2", 20), pin("3", 45)], null)]).toEqual(["2"]);
  });

  it("never hides the lit pin, and hides the ones that would cover it instead", () => {
    expect([...hiddenPins([pin("1", 0), pin("2", 10)], "2")]).toEqual(["1"]);
    expect([...hiddenPins([pin("1", 0), pin("2", 10)], "1")]).toEqual(["2"]);
    expect(hiddenPins([pin("1", 0), pin("2", 10)], "nobody")).toEqual(new Set(["2"]));
  });

  it("needs more room for a pin that says a price", () => {
    const price = (id: string, x: number) => pin(id, x, 0, "$18");
    expect([...hiddenPins([price("a", 0), price("b", PILL_GAP - 1)], null)]).toEqual(["b"]);
    expect(hiddenPins([price("a", 0), price("b", PILL_GAP)], null).size).toBe(0);
    expect([...hiddenPins([price("a", 0), pin("2", 40)], null)]).toEqual(["2"]); // a number beside a price: the wider gap rules
  });

  it("copes with no pins", () => {
    expect(hiddenPins([], null).size).toBe(0);
    expect(hiddenPins([], "1").size).toBe(0);
  });
});
