import "../styles/founders.css";
import "../styles/ask.css";
import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { trust, type Proof, type ProofPledge } from "../api/trust";
import { Link } from "../components/Link";
import { Page, PageHead, useDocumentTitle, useFocusOnMount } from "../components/Page";
import { plainError } from "../lib/account";
import { whenText } from "../lib/ask";
import { deadlineText, moneyText } from "../lib/founders";
import { anyDiffers, marksOf, outcomeLines, shortHash, stateText, summaryText, verdictOf } from "../lib/proof";
import { campaignUrl } from "../lib/routes";

type Load = { phase: "loading" } | { phase: "ready"; proof: Proof } | { phase: "failed"; message: string };

function Facts({ proof }: { proof: Proof }) {
  const { terms } = proof;
  return (
    <section className="pg-sec" aria-labelledby="proof-terms">
      <h2 className="ask-side-title" id="proof-terms">
        The terms each pledge was signed with
      </h2>
      <dl className="cp-facts proof-terms">
        <div>
          <dt className="mono">Place</dt>
          <dd>{terms.business}</dd>
        </div>
        <div>
          <dt className="mono">Campaign</dt>
          <dd>{terms.title}</dd>
        </div>
        <div>
          <dt className="mono">One pledge</dt>
          <dd>{moneyText(terms.amount, terms.currency)}</dd>
        </div>
        <div>
          <dt className="mono">Goal</dt>
          <dd>{terms.goal} neighbors</dd>
        </div>
        <div>
          <dt className="mono">Deadline</dt>
          <dd>{deadlineText(terms.deadline)}</dd>
        </div>
        {terms.perk ? (
          <div>
            <dt className="mono">Perk</dt>
            <dd>{terms.perk}</dd>
          </div>
        ) : null}
        <div>
          <dt className="mono">Owner's PayPal</dt>
          <dd className="mono raw">{terms.payee}</dd>
        </div>
        <div>
          <dt className="mono">Fingerprint</dt>
          <dd className="mono raw" title={proof.terms_hash}>
            {shortHash(proof.terms_hash, 24)}
          </dd>
        </div>
      </dl>
      <p className="proof-how">{terms.how_it_works}</p>
      <p className="proof-key">
        Signed with key <span className="mono raw">{proof.key.kid}</span>. The public key is at{" "}
        <a className="text-link" href={proof.key.jwks}>
          {proof.key.jwks}
        </a>
        .
        {proof.key.persistent ? null : " This server is using a temporary key, so these signatures can be checked only until it restarts."}
      </p>
    </section>
  );
}

function PledgeRow({ pledge }: { pledge: ProofPledge }) {
  const verdict = verdictOf(pledge);
  return (
    <li className="proof-pledge">
      <div className="proof-pledge-head">
        <span className="mono">
          Pledge <span className="raw">{pledge.ref}</span>
        </span>
        <span className={`proof-verdict ${verdict.tone}`}>{verdict.text}</span>
      </div>
      <p className="proof-pledge-line">
        {moneyText(pledge.amount)} · {stateText(pledge.state)}
        {pledge.held_at ? ` · held ${whenText(pledge.held_at)}` : ""} ·{" "}
        {pledge.how === "assistant" ? "prepared by an assistant, approved by the neighbor" : "made on the campaign page"}
      </p>
      <ul className="proof-marks">
        {marksOf(pledge).map((mark) => (
          <li key={mark.label} className={mark.tone}>
            <span className="mono">{mark.label}</span> {mark.value}
          </li>
        ))}
      </ul>
      {pledge.problems.length ? (
        <ul className="page-alert proof-problems" role="alert">
          {pledge.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
      {pledge.ids.authorization || pledge.ids.capture ? (
        <p className="proof-ids mono raw">
          {pledge.ids.authorization ? `PayPal authorization ${pledge.ids.authorization}` : ""}
          {pledge.ids.authorization && pledge.ids.capture ? " · " : ""}
          {pledge.ids.capture ? `capture ${pledge.ids.capture}` : ""}
        </p>
      ) : null}
    </li>
  );
}

function Record({ proof }: { proof: Proof }) {
  const differs = anyDiffers(proof);
  return (
    <>
      <section className="pg-sec" aria-labelledby="proof-checks">
        <h2 className="ask-side-title" id="proof-checks">
          What was checked
        </h2>
        <p className={differs ? "page-alert" : "proof-summary"} role={differs ? "alert" : undefined}>
          {summaryText(proof.summary)}
          {differs ? " Something does not agree with PayPal's record. The pledge below says what." : ""}
        </p>
        {proof.pledges.length ? (
          <ul className="proof-pledges">
            {proof.pledges.map((pledge) => (
              <PledgeRow key={pledge.ref} pledge={pledge} />
            ))}
          </ul>
        ) : null}
      </section>
      <Facts proof={proof} />
      <section className="pg-sec" aria-labelledby="proof-money">
        <h2 className="ask-side-title" id="proof-money">
          Where the money is
        </h2>
        <ul className="proof-money">
          {outcomeLines(proof.outcome, proof.campaign.currency).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </section>
      <section className="pg-sec" aria-labelledby="proof-yourself">
        <h2 className="ask-side-title" id="proof-yourself">
          Check it yourself
        </h2>
        <ol className="proof-steps">
          <li>
            Fetch the public key from <a href={proof.key.jwks}>{proof.key.jwks}</a>.
          </li>
          <li>
            A pledge's terms are signed with it (Ed25519). The fingerprint above is the SHA-256 of the terms in their canonical
            JSON form, and a PayPal order's invoice id begins with the pledge's reference and the first sixteen characters of
            that fingerprint.
          </li>
          <li>
            Open the pledge's authorization in PayPal's {proof.paypal_environment === "sandbox" ? "sandbox" : "own"} records and
            read the same invoice id there.
          </li>
        </ol>
      </section>
    </>
  );
}

export function ProofPage({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ phase: "loading" });
  const [attempt, setAttempt] = useState(0);
  const titleRef = useFocusOnMount();
  useDocumentTitle("Proof");

  useEffect(() => {
    const abort = new AbortController();
    trust.proof(id, abort.signal).then(
      (proof) => {
        setLoad({ phase: "ready", proof });
      },
      (failure: unknown) => {
        if (abort.signal.aborted) return;
        const message =
          failure instanceof ApiError && failure.status === 404
            ? "That campaign was not found."
            : plainError(failure, "The proof could not be loaded. Try again.");
        setLoad({ phase: "failed", message });
      },
    );
    return () => {
      abort.abort();
    };
  }, [id, attempt]);

  const proof = load.phase === "ready" ? load.proof : null;
  return (
    <Page className="proof">
      <PageHead
        eyebrow={`Proof · ${proof?.terms.business ?? "A campaign"}`}
        title="What the record shows"
        titleRef={titleRef}
        standfirst="Each pledge was signed with the terms it was made under, and PayPal's own record of it is checked against them each time this page opens. It is not taken on our word."
        fields={
          proof
            ? [
                { label: "Campaign", lines: [proof.terms.title] },
                { label: "Checked", lines: [whenText(proof.checked_at)] },
                { label: "PayPal", lines: [proof.paypal_environment === "sandbox" ? "Sandbox (test money)" : "Live"] },
              ]
            : undefined
        }
      />
      <div className="page-state" aria-busy={load.phase === "loading"}>
        {load.phase === "loading" ? <p role="status">Checking the record with PayPal…</p> : null}
        {load.phase === "failed" ? (
          <p className="page-alert" role="alert">
            {load.message}
          </p>
        ) : null}
        {proof ? <Record proof={proof} /> : null}
      </div>
      <div className="cf-actions proof-actions">
        <button
          type="button"
          className="ghost mono"
          disabled={load.phase === "loading"}
          onClick={() => {
            setLoad({ phase: "loading" });
            setAttempt((value) => value + 1);
          }}
        >
          Check again
        </button>
        {proof ? (
          <Link className="text-link" href={campaignUrl(proof.campaign.id)}>
            Back to the campaign
          </Link>
        ) : null}
      </div>
    </Page>
  );
}
