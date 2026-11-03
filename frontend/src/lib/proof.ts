/* A campaign's proof in plain words: what each check says and how the page sums it up. Pure, so it is tested without a
   browser. The checks themselves are the server's (app/trust/proof.py); the page only says what they mean. */
import type { Check, PaypalCheck, PledgeState, Proof, ProofPledge } from "../api/trust";
import { dayText, moneyText } from "./founders";

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

/** Where a step is: done, where the campaign is now, still to come, never to happen, or something is wrong. */
export type StepState = "done" | "now" | "todo" | "off" | "bad";

export interface TimelineStep {
  id: "pledged" | "held" | "decided" | "paid";
  title: string;
  detail: string;
  state: StepState;
}

/**
 * A campaign's money on its way from the neighbors to the owner, in four steps, from what the proof carries: pledged, held
 * by PayPal, collected (or released) once the deadline decides, and paid out. A campaign that missed its goal or was cancelled
 * never reaches the last step, and says so.
 */
export function timelineOf(
  proof: Pick<Proof, "summary" | "outcome"> & { campaign: Pick<Proof["campaign"], "currency" | "goal" | "deadline"> },
  { timeZone }: { timeZone?: string } = {},
): TimelineStep[] {
  const { campaign, summary, outcome } = proof;
  const { status, collected, payout } = outcome;
  const open = status === "open";
  const collecting = status === "funded" || status === "partial";
  const released = status === "expired" || status === "cancelled";
  const everHeld = outcome.held + outcome.released + (collected?.count ?? 0);

  let pledgedDetail: string;
  if (summary.listed) {
    pledgedDetail = `${counted(summary.listed, "pledge")} approved in PayPal.`;
    if (summary.prepared) pledgedDetail += ` ${counted(summary.prepared, "more pledge")} prepared, not approved yet.`;
  } else if (!open) pledgedDetail = "No neighbor pledged.";
  else if (summary.prepared) pledgedDetail = `${counted(summary.prepared, "pledge")} prepared, waiting for approval in PayPal.`;
  else pledgedDetail = "No pledge yet. A neighbor pledges by approving it in PayPal.";
  const pledged: TimelineStep = {
    id: "pledged",
    title: "Pledged",
    detail: pledgedDetail,
    state: summary.listed ? "done" : open ? "now" : "off",
  };

  let heldDetail: string;
  if (open) {
    heldDetail = outcome.held
      ? `${counted(outcome.held, "hold")} on the neighbors' PayPal accounts. Nobody is charged while the campaign is open.`
      : "A pledge is a hold: PayPal sets the money aside and charges nothing.";
  } else heldDetail = everHeld ? `${counted(everHeld, "hold")} placed on the neighbors' PayPal accounts.` : "No hold was placed.";
  let heldState: StepState = "off";
  if (open) heldState = outcome.held ? "now" : "todo";
  else if (everHeld) heldState = "done";
  const held: TimelineStep = { id: "held", title: "Held by PayPal", detail: heldDetail, state: heldState };

  let decided: TimelineStep;
  if (open) {
    decided = {
      id: "decided",
      title: "The deadline decides",
      state: "todo",
      detail: `On ${dayText(campaign.deadline, { timeZone })}: with ${campaign.goal} neighbors, every hold is collected; with fewer, every hold is released.`,
    };
  } else if (collecting) {
    const so = collected ? `${counted(collected.count, "hold")} collected so far, ` : "";
    decided = {
      id: "decided",
      title: "Collecting",
      state: "now",
      detail: `The goal was met. ${so}${counted(outcome.held, "hold")} still to collect.`,
    };
  } else if (status === "collected") {
    decided = {
      id: "decided",
      title: "Collected",
      state: "done",
      detail: collected
        ? `${moneyText(collected.gross, campaign.currency)} collected from ${counted(collected.count, "neighbor")}.`
        : "The goal was met and the holds were collected.",
    };
  } else {
    const why = status === "cancelled" ? "The owner cancelled the campaign." : "The goal was not met by the deadline.";
    decided = {
      id: "decided",
      title: "Released",
      state: "done",
      detail: outcome.released ? `${why} ${counted(outcome.released, "hold")} released, so nobody was charged.` : `${why} Nobody was charged.`,
    };
  }

  let paid: TimelineStep;
  if (released) {
    paid = { id: "paid", title: "Paid out", state: "off", detail: "Nothing was collected, so nothing is paid out." };
  } else if (status !== "collected") {
    paid = {
      id: "paid",
      title: "Paid out",
      state: "todo",
      detail: "Once collected, what is left after PayPal's fee goes to the owner's PayPal.",
    };
  } else if (!payout) {
    paid = { id: "paid", title: "Paid out", state: "now", detail: "The owner's payout has not started yet." };
  } else {
    const amount = moneyText(payout.amount, campaign.currency);
    const agree = payout.check === "matches" ? " PayPal's batch agrees." : payout.check === "differs" ? " PayPal's batch differs." : "";
    if (payout.status === "paid") {
      paid = { id: "paid", title: "Paid out", state: payout.check === "differs" ? "bad" : "done", detail: `${amount} paid to the owner.${agree}` };
    } else if (payout.status === "failed") {
      paid = { id: "paid", title: "Paid out", state: "bad", detail: `The payout of ${amount} to the owner failed.` };
    } else {
      paid = { id: "paid", title: "Paid out", state: "now", detail: `A payout of ${amount} to the owner is on its way.` };
    }
  }

  return [pledged, held, decided, paid];
}
