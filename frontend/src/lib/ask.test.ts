import { describe, expect, it } from "vitest";
import type { AskAnswer } from "../api/assistant";
import type { Limits } from "../api/trust";
import {
  DEFAULT_LIMITS_FORM,
  MAX_CHARS,
  MAX_TURNS,
  distanceText,
  dollars,
  leftText,
  limitsLines,
  limitsProblems,
  limitsRequestOf,
  turnsOf,
  usedShare,
  whenText,
  type LimitsForm,
  type Message,
} from "./ask";

const form = (patch: Partial<LimitsForm> = {}): LimitsForm => ({ ...DEFAULT_LIMITS_FORM, ...patch });

const limits = (patch: Partial<Limits> = {}): Limits => ({
  currency: "USD",
  max_pledge: "30.00",
  max_total: "60.00",
  max_count: 3,
  near: null,
  kinds: null,
  expires_at: "2026-11-15T12:00:00Z",
  ...patch,
});

describe("an amount as typed", () => {
  it("is dollars and cents, or nothing", () => {
    expect(dollars("30")).toBe("30.00");
    expect(dollars("$30")).toBe("30.00");
    expect(dollars(" 30.5 ")).toBe("30.50");
    for (const bad of ["", "abc", "-5", "1e3", "30.555", "1,000", "1234567", "$"]) expect(dollars(bad)).toBeNull();
  });
});

describe("the limits form", () => {
  it("starts with limits that are fine as they are", () => {
    expect(limitsProblems(DEFAULT_LIMITS_FORM)).toEqual({});
  });

  it("keeps one pledge between the server's own bounds", () => {
    expect(limitsProblems(form({ maxPledge: "4.99" })).maxPledge).toBeDefined();
    expect(limitsProblems(form({ maxPledge: "5", maxTotal: "5" }))).toEqual({});
    expect(limitsProblems(form({ maxPledge: "200", maxTotal: "200" }))).toEqual({});
    expect(limitsProblems(form({ maxPledge: "200.01", maxTotal: "300" })).maxPledge).toBeDefined();
    expect(limitsProblems(form({ maxPledge: "lots" })).maxPledge).toBeDefined();
  });

  it("keeps the total above one pledge and below the most", () => {
    expect(limitsProblems(form({ maxTotal: "29" })).maxTotal).toBe("At least as much as one pledge.");
    expect(limitsProblems(form({ maxTotal: "1000" }))).toEqual({});
    expect(limitsProblems(form({ maxTotal: "1000.01" })).maxTotal).toBeDefined();
    expect(limitsProblems(form({ maxTotal: "" })).maxTotal).toBeDefined();
  });

  it("takes only a whole number of pledges, from one to ten", () => {
    for (const bad of ["0", "11", "2.5", "x", ""]) expect(limitsProblems(form({ maxCount: bad })).maxCount).toBeDefined();
    for (const good of ["1", "10"]) expect(limitsProblems(form({ maxCount: good })).maxCount).toBeUndefined();
  });

  it("asks about the distance only once a place is set", () => {
    expect(limitsProblems(form({ nearKm: "banana" }))).toEqual({});
    const near = { lat: 40.7, lon: -74 };
    for (const bad of ["", "0", "-1", "101", "far"]) expect(limitsProblems(form({ near, nearKm: bad })).nearKm).toBeDefined();
    expect(limitsProblems(form({ near, nearKm: "100" }))).toEqual({});
  });

  it("makes the request the server takes", () => {
    expect(limitsRequestOf(DEFAULT_LIMITS_FORM)).toEqual({ max_pledge: "30.00", max_total: "60.00", max_count: 3, days: 1 });
    expect(limitsRequestOf(form({ duration: "hour" }))?.days).toBeCloseTo(1 / 24);
    expect(limitsRequestOf(form({ duration: "month" }))?.days).toBe(30);
    expect(
      limitsRequestOf(form({ kinds: ["bakery", "cafe"], near: { lat: 40.7, lon: -74 }, nearKm: "2.5", maxPledge: "$25" })),
    ).toEqual({
      max_pledge: "25.00",
      max_total: "60.00",
      max_count: 3,
      days: 1,
      near: { lat: 40.7, lon: -74, km: 2.5 },
      kinds: ["bakery", "cafe"],
    });
  });

  it("makes no request while something is wrong", () => {
    expect(limitsRequestOf(form({ maxCount: "0" }))).toBeNull();
    expect(limitsRequestOf(form({ maxTotal: "5" }))).toBeNull();
  });
});

describe("the limits in words", () => {
  it("says what they allow", () => {
    expect(limitsLines(limits())).toEqual([
      "Up to $30 for one pledge, $60 in all",
      expect.stringMatching(/^At most 3 pledges, until /),
    ]);
    expect(limitsLines(limits({ max_count: 1 }))[1]).toMatch(/^At most 1 pledge, until /);
    const lines = limitsLines(limits({ kinds: ["bakery", "cafe"], near: { lat: 1, lon: 2, km: 5 } }));
    expect(lines).toContain("Only bakery, cafe");
    expect(lines).toContain("Only within 5 km of where you were");
  });

  it("says what is left once the server has said what is used", () => {
    expect(leftText(limits())).toBeNull();
    expect(leftText(limits({ used: "25.00", remaining: "35.00" }))).toBe("$35 of $60 left");
  });

  it("measures what is used from nothing to everything", () => {
    expect(usedShare(limits())).toBe(0);
    expect(usedShare(limits({ used: "15.00" }))).toBe(0.25);
    expect(usedShare(limits({ used: "90.00" }))).toBe(1);
    expect(usedShare(limits({ used: "nonsense" }))).toBe(0);
  });

  it("reads a time in the reader's own, or nothing", () => {
    expect(whenText("2026-11-15T12:00:00Z")).toContain("Nov");
    expect(whenText("not a time")).toBe("");
  });
});

describe("a distance", () => {
  it("is in metres to the nearest ten under a kilometre, then in kilometres", () => {
    expect(distanceText(0.18)).toBe("180 m away");
    expect(distanceText(0.004)).toBe("10 m away");
    expect(distanceText(0.9996)).toBe("1.0 km away");
    expect(distanceText(2.44)).toBe("2.4 km away");
    expect(distanceText(12.6)).toBe("13 km away");
  });
});

describe("the conversation as the server reads it", () => {
  const answer = (patch: Partial<AskAnswer> = {}): AskAnswer => ({
    reply: "I found two.",
    mode: "plain",
    cards: [],
    shown: ["c4f1e2", "d5a2f3"],
    asked: null,
    pledge: null,
    refusal: null,
    trace: [],
    ...patch,
  });

  it("carries what each assistant turn showed and asked", () => {
    const messages: Message[] = [
      { id: 1, role: "user", content: "a bakery" },
      { id: 2, role: "assistant", content: "I found two.", answer: answer({ asked: "c4f1e2" }) },
      { id: 3, role: "user", content: "yes" },
    ];
    expect(turnsOf(messages)).toEqual([
      { role: "user", content: "a bakery" },
      { role: "assistant", content: "I found two.", shown: ["c4f1e2", "d5a2f3"], asked: "c4f1e2" },
      { role: "user", content: "yes" },
    ]);
  });

  it("sends only the last turns, each cut to the length the server takes", () => {
    const many: Message[] = Array.from({ length: MAX_TURNS + 5 }, (_, index) => ({
      id: index,
      role: "user" as const,
      content: `${index}`.padEnd(MAX_CHARS + 50, "x"),
    }));
    const turns = turnsOf(many);
    expect(turns).toHaveLength(MAX_TURNS);
    expect(turns[0]?.content.startsWith("5")).toBe(true);
    expect(turns.every((turn) => turn.content.length === MAX_CHARS)).toBe(true);
  });
});
