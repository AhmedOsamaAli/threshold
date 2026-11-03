import { describe, expect, it } from "vitest";
import type { Proof, ProofPledge } from "../api/trust";
import { anyDiffers, marksOf, outcomeLines, shortHash, stateText, summaryText, timelineOf, verdictOf } from "./proof";

const pledge = (patch: Partial<ProofPledge> = {}): ProofPledge => ({
  ref: "a1b2c3d4e5f6",
  how: "assistant",
  state: "authorized",
  amount: "25.00",
  held_at: "2026-11-02T10:00:00Z",
  ids: { authorization: "AUTH-1", capture: null },
  signed: { terms_hash: "h", signature: "s" },
  checks: { signature: "valid", hash: "valid", unchanged: true, paypal: "matches", invoice: true, amount: true },
  problems: [],
  verified: true,
  ...patch,
});

const outcome = (patch: Partial<Proof["outcome"]> = {}): Proof["outcome"] => ({
  status: "open",
  funded: null,
  held: 0,
  released: 0,
  collected: null,
  payout: null,
  ...patch,
});

describe("what the checks on a pledge found", () => {
  it("marks everything that agrees", () => {
    const marks = marksOf(pledge());
    expect(marks.map((mark) => mark.label)).toEqual(["Signed terms", "Terms since", "PayPal", "PayPal's order", "Amount"]);
    expect(marks.every((mark) => mark.tone === "ok")).toBe(true);
  });

  it("marks a signature that does not match, and one that is missing", () => {
    const bad = marksOf(pledge({ checks: { ...pledge().checks, signature: "invalid" } }))[0];
    expect(bad).toMatchObject({ value: "Do not match", tone: "bad" });
    const unsigned = marksOf(pledge({ checks: { ...pledge().checks, signature: "missing", hash: "missing" } }))[0];
    expect(unsigned).toMatchObject({ value: "Not signed", tone: "idle" });
  });

  it("marks terms that changed, and what PayPal says", () => {
    const changed = marksOf(pledge({ checks: { ...pledge().checks, unchanged: false, paypal: "differs" } }));
    expect(changed[1]).toMatchObject({ value: "Changed since the pledge", tone: "bad" });
    expect(changed[2]).toMatchObject({ value: "PayPal's record differs", tone: "bad" });
    const silent = marksOf(pledge({ checks: { ...pledge().checks, unchanged: null, paypal: "unavailable" } }));
    expect(silent[1]).toMatchObject({ tone: "idle" });
    expect(silent[2]).toMatchObject({ value: "PayPal did not answer", tone: "idle" });
  });

  it("leaves out what PayPal was not asked", () => {
    const marks = marksOf(pledge({ checks: { ...pledge().checks, paypal: "not_checked", invoice: null, amount: null } }));
    expect(marks.map((mark) => mark.label)).toEqual(["Signed terms", "Terms since", "PayPal"]);
  });

  it("marks an order that lacks the signed terms' fingerprint, and an amount that differs", () => {
    const marks = marksOf(pledge({ checks: { ...pledge().checks, invoice: false, amount: false } }));
    expect(marks[3]).toMatchObject({ tone: "bad" });
    expect(marks[4]).toMatchObject({ value: "Differs in PayPal", tone: "bad" });
  });

  it("gives a verdict in a word", () => {
    expect(verdictOf({ verified: true })).toEqual({ text: "Verified", tone: "ok" });
    expect(verdictOf({ verified: false })).toEqual({ text: "Differs", tone: "bad" });
    expect(verdictOf({ verified: null })).toEqual({ text: "Unconfirmed", tone: "idle" });
  });

  it("names every state a pledge can be in", () => {
    expect(stateText("authorized")).toBe("Held by PayPal");
    expect(stateText("captured")).toBe("Collected");
    expect(stateText("voided")).toBe("Released");
  });
});

describe("the checks in a sentence", () => {
  const summary = (patch: Partial<Proof["summary"]> = {}): Proof["summary"] => ({
    listed: 0,
    verified: 0,
    differs: 0,
    unconfirmed: 0,
    prepared: 0,
    ...patch,
  });

  it("says when nothing is held yet", () => {
    expect(summaryText(summary())).toBe("No pledge is held yet.");
    expect(summaryText(summary({ prepared: 1 }))).toBe("No pledge is held yet. 1 pledge prepared, waiting for approval in PayPal.");
    expect(summaryText(summary({ prepared: 3 }))).toContain("3 pledges prepared");
  });

  it("counts what was verified, what differs and what is unconfirmed", () => {
    expect(summaryText(summary({ listed: 3, verified: 2, unconfirmed: 1 }))).toBe("3 pledges: 2 verified, 1 unconfirmed.");
    expect(summaryText(summary({ listed: 1, differs: 1 }))).toBe("1 pledge: 1 differs.");
    expect(summaryText(summary({ listed: 4, differs: 2 }))).toBe("4 pledges: 2 differ.");
    expect(summaryText(summary({ listed: 2, verified: 2, prepared: 1 }))).toBe(
      "2 pledges: 2 verified. 1 more pledge prepared, not approved yet.",
    );
  });

  it("knows when anything differs", () => {
    expect(anyDiffers({ summary: summary({ listed: 1, verified: 1 }) })).toBe(false);
    expect(anyDiffers({ summary: summary({ listed: 1, differs: 1 }) })).toBe(true);
  });
});

describe("where the money is", () => {
  it("says no money has moved when none has", () => {
    expect(outcomeLines(outcome(), "USD")).toEqual(["No money has moved."]);
  });

  it("says what PayPal holds, and what it released", () => {
    expect(outcomeLines(outcome({ held: 3 }), "USD")[0]).toBe(
      "3 holds on the neighbors' PayPal accounts. Nothing is collected unless the goal is met.",
    );
    expect(outcomeLines(outcome({ released: 1 }), "USD")[0]).toBe(
      "1 hold released or withdrawn: those neighbors were never charged.",
    );
  });

  it("says what was collected, with PayPal's fee and the owner's share once they are known", () => {
    const collected = { count: 3, gross: "75.00", fee: "2.77", net: "72.23" };
    expect(outcomeLines(outcome({ status: "collected", collected }), "USD")).toEqual([
      "$75 collected from 3 neighbors, PayPal's fee $2.77, $72.23 to the owner.",
    ]);
    expect(outcomeLines(outcome({ collected: { ...collected, fee: null, net: null } }), "USD")).toEqual([
      "$75 collected from 3 neighbors.",
    ]);
  });

  it("says what happened to the payout, and whether PayPal's batch agrees", () => {
    const payout = { status: "paid" as const, amount: "72.23", batch: "B1", item: "I1", check: "matches" as const };
    expect(outcomeLines(outcome({ payout }), "USD")).toEqual(["Payout of $72.23 to the owner: paid. PayPal's batch agrees."]);
    expect(outcomeLines(outcome({ payout: { ...payout, check: "differs" } }), "USD")[0]).toContain("PayPal's batch differs.");
    expect(outcomeLines(outcome({ payout: { ...payout, status: "pending", check: "not_checked" } }), "USD")).toEqual([
      "Payout of $72.23 to the owner: pending.",
    ]);
  });
});

describe("a fingerprint cut for reading", () => {
  it("keeps the front of a long one and all of a short one", () => {
    expect(shortHash("0123456789abcdef0123456789abcdef")).toBe("0123456789abcdef…");
    expect(shortHash("0123456789abcdef0123456789abcdef", 24)).toBe("0123456789abcdef01234567…");
    expect(shortHash("abc")).toBe("abc");
  });
});

describe("the money's way from the neighbors to the owner, in four steps", () => {
  const campaign = { currency: "USD", goal: 3, deadline: "2026-11-30T20:00:00Z" };
  const summary = (patch: Partial<Proof["summary"]> = {}): Proof["summary"] => ({
    listed: 0,
    verified: 0,
    differs: 0,
    unconfirmed: 0,
    prepared: 0,
    ...patch,
  });
  const steps = (summaryPatch: Partial<Proof["summary"]>, outcomePatch: Partial<Proof["outcome"]>) =>
    timelineOf({ campaign, summary: summary(summaryPatch), outcome: outcome(outcomePatch) }, { timeZone: "UTC" });
  const states = (list: ReturnType<typeof steps>) => list.map((step) => step.state);
  const collected = { count: 3, gross: "15.00", fee: "1.98", net: "13.02" };
  const paid = { status: "paid" as const, amount: "13.02", batch: "B1", item: "I1", check: "matches" as const };

  it("always has the same four steps, in order", () => {
    expect(steps({}, {}).map((step) => step.id)).toEqual(["pledged", "held", "decided", "paid"]);
  });

  it("starts at the first step while nobody has pledged", () => {
    const list = steps({}, {});
    expect(states(list)).toEqual(["now", "todo", "todo", "todo"]);
    expect(list[0]?.detail).toBe("No pledge yet. A neighbor pledges by approving it in PayPal.");
    expect(steps({ prepared: 2 }, {})[0]?.detail).toBe("2 pledges prepared, waiting for approval in PayPal.");
  });

  it("holds while the campaign is open, and says when the deadline decides and what it decides", () => {
    const list = steps({ listed: 2, prepared: 1 }, { held: 2 });
    expect(states(list)).toEqual(["done", "now", "todo", "todo"]);
    expect(list[0]?.detail).toBe("2 pledges approved in PayPal. 1 more pledge prepared, not approved yet.");
    expect(list[1]?.detail).toBe("2 holds on the neighbors' PayPal accounts. Nobody is charged while the campaign is open.");
    expect(list[2]).toMatchObject({ title: "The deadline decides" });
    expect(list[2]?.detail).toBe("On Nov 30: with 3 neighbors, every hold is collected; with fewer, every hold is released.");
    expect(list[3]?.detail).toBe("Once collected, what is left after PayPal's fee goes to the owner's PayPal.");
  });

  it("is on the collecting step once the goal is met and the holds are being collected", () => {
    const list = steps({ listed: 3 }, { status: "funded", funded: true, held: 3 });
    expect(states(list)).toEqual(["done", "done", "now", "todo"]);
    expect(list[2]).toMatchObject({ title: "Collecting", detail: "The goal was met. 3 holds still to collect." });
    const partial = steps({ listed: 3 }, { status: "partial", funded: true, held: 1, collected: { ...collected, count: 2 } });
    expect(partial[2]?.detail).toBe("The goal was met. 2 holds collected so far, 1 hold still to collect.");
  });

  it("shows a collected campaign whose payout is paid, with what PayPal's batch says", () => {
    const list = steps({ listed: 3 }, { status: "collected", funded: true, collected, payout: paid });
    expect(states(list)).toEqual(["done", "done", "done", "done"]);
    expect(list[1]?.detail).toBe("3 holds placed on the neighbors' PayPal accounts.");
    expect(list[2]).toMatchObject({ title: "Collected", detail: "$15 collected from 3 neighbors." });
    expect(list[3]?.detail).toBe("$13.02 paid to the owner. PayPal's batch agrees.");
  });

  it("is on the payout step while it is pending or has not started, and flags one that failed or differs", () => {
    const base = { status: "collected" as const, funded: true, collected };
    expect(steps({ listed: 3 }, { ...base, payout: null })[3]).toMatchObject({ state: "now", detail: "The owner's payout has not started yet." });
    expect(steps({ listed: 3 }, { ...base, payout: { ...paid, status: "pending", check: "not_checked" } })[3]).toMatchObject({
      state: "now",
      detail: "A payout of $13.02 to the owner is on its way.",
    });
    expect(steps({ listed: 3 }, { ...base, payout: { ...paid, status: "failed", check: "not_checked" } })[3]).toMatchObject({
      state: "bad",
      detail: "The payout of $13.02 to the owner failed.",
    });
    expect(steps({ listed: 3 }, { ...base, payout: { ...paid, check: "differs" } })[3]).toMatchObject({
      state: "bad",
      detail: "$13.02 paid to the owner. PayPal's batch differs.",
    });
  });

  it("releases every hold when the goal was missed, and never pays out", () => {
    const list = steps({ listed: 2 }, { status: "expired", funded: false, released: 2 });
    expect(states(list)).toEqual(["done", "done", "done", "off"]);
    expect(list[2]).toMatchObject({
      title: "Released",
      detail: "The goal was not met by the deadline. 2 holds released, so nobody was charged.",
    });
    expect(list[3]?.detail).toBe("Nothing was collected, so nothing is paid out.");
  });

  it("says the owner cancelled, and what a campaign nobody pledged to shows", () => {
    expect(steps({ listed: 1 }, { status: "cancelled", released: 1 })[2]?.detail).toBe(
      "The owner cancelled the campaign. 1 hold released, so nobody was charged.",
    );
    const empty = steps({}, { status: "expired", funded: false });
    expect(states(empty)).toEqual(["off", "off", "done", "off"]);
    expect(empty[0]?.detail).toBe("No neighbor pledged.");
    expect(empty[1]?.detail).toBe("No hold was placed.");
    expect(empty[2]?.detail).toBe("The goal was not met by the deadline. Nobody was charged.");
  });
});
