import "../styles/proofline.css";
import type { StepState, TimelineStep } from "../lib/proof";

const STATE_WORD: Record<StepState, string> = {
  done: "done",
  now: "where it is now",
  todo: "not yet",
  off: "did not happen",
  bad: "needs attention",
};

/** One mark in a step's circle: a tick once done, a dot where it is now, a dash for what never happens, a bar for a problem. */
function Mark({ state, number }: { state: StepState; number: number }) {
  switch (state) {
    case "done":
      return (
        <svg viewBox="0 0 24 24">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      );
    case "now":
      return <i className="pl-dot" />;
    case "off":
      return (
        <svg viewBox="0 0 24 24">
          <path d="M7 12h10" />
        </svg>
      );
    case "bad":
      return (
        <svg viewBox="0 0 24 24">
          <path d="M12 6.5v7M12 17.5v.01" />
        </svg>
      );
    case "todo":
      return <span className="pl-no mono">{number}</span>;
  }
}

interface ProofTimelineProps {
  steps: readonly TimelineStep[];
  /** One step above the next, whatever the width, for a narrow column. */
  stacked?: boolean;
}

/** A campaign's money on its way from pledges to the owner: the steps, where it is now, and what each says. */
export function ProofTimeline({ steps, stacked = false }: ProofTimelineProps) {
  return (
    <ol className={stacked ? "proof-line stacked" : "proof-line"}>
      {steps.map((step, index) => (
        <li key={step.id} data-state={step.state}>
          <span className="pl-node" aria-hidden="true">
            <Mark state={step.state} number={index + 1} />
          </span>
          <div className="pl-body">
            <h3 className="pl-title">
              {step.title}
              <span className="sr-only"> ({STATE_WORD[step.state]})</span>
            </h3>
            <p className="pl-detail">{step.detail}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
