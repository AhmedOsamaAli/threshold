import { describe, expect, it } from "vitest";
import type { Proof, ProofPledge } from "../api/trust";
import { anyDiffers, marksOf, outcomeLines, shortHash, stateText, summaryText, verdictOf } from "./proof";

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
