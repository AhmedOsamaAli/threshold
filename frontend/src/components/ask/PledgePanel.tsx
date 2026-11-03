import type { PreparedPledge } from "../../api/assistant";
import { moneyText, pledgeTerms } from "../../lib/founders";
import { proofUrl } from "../../lib/routes";
import { keepPrepared } from "../../state/founders";
import { Link } from "../Link";
import { PrivateReceipt } from "../founders/PrivateReceipt";
import { SandboxNotice } from "../founders/SandboxNotice";

/** A pledge the assistant prepared, not yet approved: PayPal's own button, in the person's hands alone. */
export function PledgePanel({ pledge }: { pledge: PreparedPledge }) {
  return (
    <section className="ask-pledge" aria-label={`A pledge prepared for ${pledge.name}`}>
      <p className="ask-pledge-kicker mono">Prepared · not approved yet</p>
      <h3 className="ask-pledge-title">
        {pledge.name}: a {moneyText(pledge.amount, pledge.currency)} pledge
      </h3>
      <p className="ask-pledge-terms">{pledgeTerms(pledge.amount, pledge.goal, pledge.deadline)}</p>
      <div className="ask-pledge-go">
        <a
          className="go"
          href={pledge.approve_url}
          onClick={() => {
            // The receipt waits apart from the held pledges until PayPal confirms the hold.
            keepPrepared(pledge.campaign_id, pledge.receipt);
          }}
        >
          Approve in PayPal
        </a>
        <span className="ask-pledge-note">
          Only you can approve it, in PayPal. The assistant cannot, and nothing is held until you do.
        </span>
      </div>
      <SandboxNotice />
      <p className="ask-pledge-proof">
        <span className="mono">
          Signed terms <span className="raw">{pledge.ref}</span>
        </span>{" "}
        · PayPal's own record of the order carries their fingerprint.{" "}
        <Link className="text-link" href={proofUrl(pledge.campaign_id)}>
          See the proof
        </Link>
      </p>
      <PrivateReceipt token={pledge.receipt} />
    </section>
  );
}
