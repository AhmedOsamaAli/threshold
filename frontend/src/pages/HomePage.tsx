import "../styles/home.css";
import "../styles/flow.css";
import "../styles/founders.css";
import { LiveExample } from "../components/home/LiveExample";
import { MoneyFlow } from "../components/home/MoneyFlow";
import { ProofExample } from "../components/home/ProofExample";
import { Link } from "../components/Link";
import { Page, PageHead, useFocusOnMount } from "../components/Page";
import { SectionHead } from "../components/SectionHead";
import { EXAMPLE_PROOF_ID, PRODUCT_NAME } from "../lib/product";
import { ASK_URL, BROWSE_URL, proofUrl, SPOT_URL, START_CAMPAIGN_URL } from "../lib/routes";

const STEPS = [
  {
    title: "Neighbors pledge",
    body: "Each neighbor pledges a fixed amount to a new place before its owner signs the lease. Approving it in PayPal is all it takes.",
  },
  {
    title: "PayPal holds it",
    body: "The money stays with PayPal. Nobody is charged while the campaign is open, and a neighbor can withdraw their pledge until then.",
  },
  {
    title: "The deadline decides",
    body: "If enough neighbors joined, every hold is collected and paid to the owner. If not, every hold is released and nobody pays.",
  },
] as const;

/** An example of limits, drawn the way the Ask page shows them, so the idea is clear before anything is set. */
function LimitsExample() {
  return (
    <figure className="home-limits" aria-label="An example of the limits a person sets">
      <figcaption className="mono">Your limits · an example</figcaption>
      <ul>
        <li>Up to $30 for one pledge, $60 in all</li>
        <li>At most 3 pledges, for the next day</li>
        <li>Only bakeries and cafes within 5 km</li>
      </ul>
      <p className="home-limits-held mono">Held back · over your $30 limit</p>
      <p className="home-limits-note">The server refuses anything outside the limits. The assistant cannot change them or approve a pledge.</p>
    </figure>
  );
}

/** What the product is, in one screen, and the ways in. */
export function HomePage() {
  const titleRef = useFocusOnMount();
  return (
    <Page className="home">
      <div className="home-hero">
        <div className="home-hero-main">
          <PageHead
            eyebrow={`${PRODUCT_NAME} · Back a new place before it opens`}
            title="Neighbors back the place before it opens"
            titleRef={titleRef}
            standfirst="Pledge to a new cafe, gym or bakery before the owner signs the lease. PayPal only holds the money. If enough neighbors join by the deadline, everyone is charged and the owner is paid. If not, every hold is released and nobody pays."
          />
          <div className="home-cta">
            <Link className="go" href={BROWSE_URL}>
              See what neighbors are backing
            </Link>
            <Link className="ghost mono" href={ASK_URL}>
              Ask the assistant
            </Link>
            <Link className="text-link" href={START_CAMPAIGN_URL}>
              Opening something? Start a campaign <span aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
        <div className="home-hero-art">
          <MoneyFlow />
        </div>
      </div>

      <section className="pg-sec" aria-labelledby="home-live">
        <SectionHead
          no="01"
          title="Open for pledges right now"
          id="home-live"
          note="A campaign taking pledges on this site, set out the way Browse sets them out."
        />
        <div className="home-split">
          <div className="home-copy">
            <p>
              Open it to read its terms, see its street on a map and pledge with PayPal's sandbox: it is test money, so nothing real
              is charged.
            </p>
            <Link className="text-link" href={BROWSE_URL}>
              See every open campaign <span aria-hidden="true">→</span>
            </Link>
          </div>
          <LiveExample />
        </div>
      </section>

      <section className="pg-sec" aria-labelledby="home-how">
        <SectionHead no="02" title="How a pledge works" id="home-how" note="Nobody is charged unless the neighborhood shows up." />
        <ol className="home-steps">
          {STEPS.map((step, index) => (
            <li key={step.title}>
              <span className="home-step-no mono">{index + 1}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="pg-sec" aria-labelledby="home-assistant">
        <SectionHead no="03" title="An assistant that cannot spend your money" id="home-assistant" />
        <div className="home-split">
          <div className="home-copy">
            <p>
              Ask for a bakery near you, and an assistant finds the open campaigns and prepares a pledge. It works inside limits you
              set: the most for one pledge and in all, how many, for how long, and where.
            </p>
            <p>
              The server enforces those limits, not the AI. And the assistant only prepares: you approve each pledge yourself, in
              PayPal.
            </p>
            <Link className="text-link" href={ASK_URL}>
              Set your limits and ask <span aria-hidden="true">→</span>
            </Link>
          </div>
          <LimitsExample />
        </div>
      </section>

      <section className="pg-sec" aria-labelledby="home-proof">
        <SectionHead no="04" title="Check it, don't trust it" id="home-proof" />
        <div className="home-split">
          <div className="home-copy">
            <p>
              Every pledge is signed with the exact terms it was made under: the amount, the goal, the deadline and who gets paid. A
              campaign's proof page checks those signatures against PayPal's own record of each pledge, and says plainly when
              anything differs.
            </p>
            <Link className="text-link" href={proofUrl(EXAMPLE_PROOF_ID)}>
              Open the proof of a real test run <span aria-hidden="true">→</span>
            </Link>
          </div>
          <ProofExample />
        </div>
      </section>

      <section className="pg-sec" aria-labelledby="home-spot">
        <SectionHead no="05" title="Look around before you back it" id="home-spot" />
        <div className="home-copy">
          <p>
            Enter an address and a kind of business. Check a spot draws the ten-minute walk on a street map and numbers every place of
            that kind it lists, with its hours and links where there are any. It shows what is open nearby, never what people want.
          </p>
          <Link className="text-link" href={SPOT_URL}>
            Check a spot <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <p className="home-foot mono">Test money only (PayPal sandbox) · Built on PayPal Orders, Payouts and webhooks · Open source, MIT</p>
    </Page>
  );
}
