/* A campaign's proof in plain words: what each check says and how the page sums it up. Pure, so it is tested without a
   browser. The checks themselves are the server's (app/trust/proof.py); the page only says what they mean. */
import type { Check, PaypalCheck, PledgeState, Proof, ProofPledge } from "../api/trust";
import { moneyText } from "./founders";

export type Tone = "ok" | "bad" | "idle";

export interface Mark {
  label: string;
  /** What the check found, in a few words. */
  value: string;
  tone: Tone;
}

const STATE_TEXT: Record<PledgeState, string> = {
  created: "Prepared, not approved",
  authorized: "Held by PayPal",
  declined: "Declined in PayPal",
  captured: "Collected",
  voided: "Released",
  withdrawn: "Withdrawn",
  expired: "Hold ran out",
  failed: "Failed",
  refunded: "Refunded",
};

export function stateText(state: PledgeState): string {
  return STATE_TEXT[state];
}

function signedMark(signature: Check, hash: Check): Mark {
  if (signature === "invalid" || hash === "invalid") return { label: "Signed terms", value: "Do not match", tone: "bad" };
  if (signature === "valid" && hash === "valid") return { label: "Signed terms", value: "Signature and fingerprint match", tone: "ok" };
  return { label: "Signed terms", value: "Not signed", tone: "idle" };
}

function unchangedMark(unchanged: boolean | null): Mark {
  if (unchanged === null) return { label: "Terms since", value: "Nothing to compare", tone: "idle" };
  return unchanged
    ? { label: "Terms since", value: "Unchanged since the pledge", tone: "ok" }
    : { label: "Terms since", value: "Changed since the pledge", tone: "bad" };
}

const PAYPAL_VALUE: Record<PaypalCheck, { value: string; tone: Tone }> = {
  matches: { value: "PayPal's record agrees", tone: "ok" },
  differs: { value: "PayPal's record differs", tone: "bad" },
  unavailable: { value: "PayPal did not answer", tone: "idle" },
  not_checked: { value: "Not asked", tone: "idle" },
};

/** What the checks on one pledge found, one mark each, in the order they are made. */
export function marksOf(pledge: ProofPledge): Mark[] {
  const { checks } = pledge;
  const paypal = PAYPAL_VALUE[checks.paypal];
  const marks: Mark[] = [
    signedMark(checks.signature, checks.hash),
    unchangedMark(checks.unchanged),
    { label: "PayPal", ...paypal },
  ];
  if (checks.invoice !== null) {
    marks.push({
      label: "PayPal's order",
      value: checks.invoice ? "Carries the signed terms' fingerprint" : "Does not carry the fingerprint",
      tone: checks.invoice ? "ok" : "bad",
    });
  }
  if (checks.amount !== null) {
    marks.push({ label: "Amount", value: checks.amount ? "The same in PayPal" : "Differs in PayPal", tone: checks.amount ? "ok" : "bad" });
  }
  return marks;
}

/** The pledge's verdict in a word. */
export function verdictOf(pledge: Pick<ProofPledge, "verified">): { text: string; tone: Tone } {
  if (pledge.verified === true) return { text: "Verified", tone: "ok" };
  if (pledge.verified === false) return { text: "Differs", tone: "bad" };
  return { text: "Unconfirmed", tone: "idle" };
}

const counted = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

/** The checks in one sentence: "3 pledges: 2 verified, 1 unconfirmed." */
export function summaryText(summary: Proof["summary"]): string {
  if (summary.listed === 0) {
    return summary.prepared
      ? `No pledge is held yet. ${counted(summary.prepared, "pledge")} prepared, waiting for approval in PayPal.`
      : "No pledge is held yet.";
  }
  const parts = [
    summary.verified ? `${summary.verified} verified` : null,
    summary.differs ? `${summary.differs} differ${summary.differs === 1 ? "s" : ""}` : null,
    summary.unconfirmed ? `${summary.unconfirmed} unconfirmed` : null,
  ].filter(Boolean);
  const prepared = summary.prepared ? ` ${counted(summary.prepared, "more pledge")} prepared, not approved yet.` : "";
  return `${counted(summary.listed, "pledge")}: ${parts.join(", ")}.${prepared}`;
}

/** Whether anything differs, so the page can say so before anything else. */
export function anyDiffers(proof: Pick<Proof, "summary">): boolean {
  return proof.summary.differs > 0;
}

/** What happened to the money, in a few lines, as the proof has it. */
export function outcomeLines(outcome: Proof["outcome"], currency: string): string[] {
  const lines: string[] = [];
  if (outcome.held) lines.push(`${counted(outcome.held, "hold")} on the neighbors' PayPal accounts. Nothing is collected unless the goal is met.`);
  if (outcome.released) lines.push(`${counted(outcome.released, "hold")} released or withdrawn: those neighbors were never charged.`);
  const collected = outcome.collected;
  if (collected) {
    const parts = [`${moneyText(collected.gross, currency)} collected from ${counted(collected.count, "neighbor")}`];
    if (collected.fee !== null && collected.net !== null) {
      parts.push(`PayPal's fee ${moneyText(collected.fee, currency)}`, `${moneyText(collected.net, currency)} to the owner`);
    }
    lines.push(`${parts.join(", ")}.`);
  }
  const payout = outcome.payout;
  if (payout) {
    const agree = payout.check === "matches" ? " PayPal's batch agrees." : payout.check === "differs" ? " PayPal's batch differs." : "";
    lines.push(`Payout of ${moneyText(payout.amount, currency)} to the owner: ${payout.status}.${agree}`);
  }
  if (!lines.length) lines.push("No money has moved.");
  return lines;
}

/** "a1b2c3d4e5f6a7b8…": a long fingerprint cut for reading. */
export function shortHash(hash: string, length = 16): string {
  return hash.length > length ? `${hash.slice(0, length)}…` : hash;
}
