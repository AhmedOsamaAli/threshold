import type { Proof } from "../../api/trust";
import { timelineOf } from "../../lib/proof";
import { ProofTimeline } from "../ProofTimeline";

/** What that run's proof says, as it stood when it was written down: three $5 pledges to a goal of three, collected and paid out. */
const RUN: Pick<Proof, "summary" | "outcome"> & { campaign: Pick<Proof["campaign"], "currency" | "goal" | "deadline"> } = {
  campaign: { currency: "USD", goal: 3, deadline: "2026-11-03T12:00:00Z" },
  summary: { listed: 3, verified: 3, differs: 0, unconfirmed: 0, prepared: 0 },
  outcome: {
    status: "collected",
    funded: true,
    held: 0,
    released: 0,
    collected: { count: 3, gross: "15.00", fee: "1.98", net: "13.02" },
    payout: { status: "paid", amount: "13.02", batch: null, item: null, check: "matches" },
  },
};

/** What a proof page shows first, for a real run: the four steps, each done, with the numbers PayPal agreed to. */
export function ProofExample() {
  return (
    <figure className="home-proof">
      <figcaption className="mono">A real test run · its proof page</figcaption>
      <ProofTimeline steps={timelineOf(RUN)} stacked />
      <p className="home-proof-note">Three neighbors pledged $5 each in PayPal's sandbox. Every pledge was checked against PayPal's own record.</p>
    </figure>
  );
}
