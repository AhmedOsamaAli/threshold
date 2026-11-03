import { useRef, useState } from "react";
import { cssVars } from "../../lib/css";
import { useInView } from "../../lib/useInView";

/** Where each neighbor sits, the height its pledge enters the hold at, when it leaves, and whether it is in the second act. */
const NEIGHBORS = [
  { y: 46, hold: 98, delay: "0s", missed: 1 },
  { y: 115, hold: 115, delay: ".45s", missed: 1 },
  { y: 184, hold: 132, delay: ".9s", missed: 0 },
] as const;

function Person({ y }: { y: number }) {
  return (
    <g className="fl-person">
      <circle cx="40" cy={y} r="18" />
      <circle className="fl-head" cx="40" cy={y - 4} r="5" />
      <path d={`M31 ${y + 11}q9 -13 18 0`} />
    </g>
  );
}

function Badge({ width, text, className }: { width: number; text: string; className: string }) {
  return (
    <g className={`fl-badge ${className}`}>
      <rect x={-width / 2} y="-12" width={width} height="24" rx="12" />
      <text y="4" textAnchor="middle">
        {text}
      </text>
    </g>
  );
}

/**
 * The idea of the product in about five seconds, then once more for the other ending: neighbors' pledges go into PayPal's
 * hold; when the goal is met every hold is collected and the owner is paid, and when it is missed every hold is released.
 * Drawn in CSS (styles/flow.css), so it costs nothing to load. It moves only where motion is welcome, waits while it is out
 * of view, and has a button to pause it; the same words are there, still, for a screen reader.
 */
export function MoneyFlow() {
  const frame = useRef<HTMLElement>(null);
  const inView = useInView(frame);
  const [paused, setPaused] = useState(false);
  return (
    <figure className="flow" ref={frame} data-still={paused || !inView ? "" : undefined} aria-labelledby="flow-title">
      <div className="fl-head-row">
        <figcaption className="fl-title mono" id="flow-title">
          How the money moves · an example
        </figcaption>
        <button
          type="button"
          className="fl-pause mono"
          aria-pressed={paused}
          onClick={() => {
            setPaused((value) => !value);
          }}
        >
          {paused ? "Play" : "Pause"}
        </button>
      </div>
      <svg className="fl-stage" viewBox="0 0 460 236" aria-hidden="true" focusable="false">
        <g className="fl-lanes">
          {NEIGHBORS.map(({ y, hold }) => (
            <path key={y} d={`M62 ${y}L148 ${hold}`} />
          ))}
          <path d="M302 115H372" />
        </g>

        <g>
          {NEIGHBORS.map(({ y }) => (
            <Person key={y} y={y} />
          ))}
          <text className="fl-label" x="40" y="226" textAnchor="middle">
            Neighbors
          </text>
        </g>

        <g>
          <rect className="fl-box" x="150" y="22" width="150" height="190" rx="16" />
          <text className="fl-label fl-paypal" x="225" y="56" textAnchor="middle">
            PayPal holds
          </text>
          <g textAnchor="middle">
            <text className="fl-n fl-n0" x="225" y="124">$0</text>
            <text className="fl-n fl-n25" x="225" y="124">$25</text>
            <text className="fl-n fl-n50" x="225" y="124">$50</text>
            <text className="fl-n fl-n75" x="225" y="124">$75</text>
          </g>
          {[195, 225, 255].map((x, index) => (
            <g key={x}>
              <circle className="fl-slot" cx={x} cy="168" r="8" />
              <circle className={`fl-fill fl-s${index + 1}`} cx={x} cy="168" r="8" />
            </g>
          ))}
          <text className="fl-label fl-goal" x="225" y="198" textAnchor="middle">
            Goal: 3 neighbors
          </text>
        </g>

        <g>
          <path className="fl-awning" d="M384 92h52l-4 16h-44z" />
          <rect className="fl-shop" x="388" y="108" width="44" height="36" />
          <rect className="fl-door" x="403" y="120" width="14" height="24" />
          <text className="fl-label" x="410" y="168" textAnchor="middle">
            Owner
          </text>
        </g>

        <g transform="translate(410 70)">
          <Badge width={54} text="Paid" className="fl-paid" />
        </g>
        <g transform="translate(225 22)">
          <Badge width={100} text="Goal met" className="fl-met" />
          <Badge width={116} text="Goal missed" className="fl-missed" />
          <Badge width={100} text="Released" className="fl-released" />
        </g>

        {NEIGHBORS.map(({ y, hold, delay, missed }) => (
          <g key={y} className="fl-chip" style={cssVars({ "--y0": `${y}px`, "--y1": `${hold}px`, "--d": delay, "--b": missed })}>
            <rect x="-20" y="-11" width="40" height="22" rx="11" />
            <text y="4.5" textAnchor="middle">
              $25
            </text>
          </g>
        ))}
      </svg>
      <div className="fl-says" aria-hidden="true">
        <p className="fl-say fl-say1">Neighbors pledge $25 each. PayPal holds the money. Nobody is charged yet.</p>
        <p className="fl-say fl-say2">Goal met by the deadline: every hold is collected and the owner is paid.</p>
        <p className="fl-say fl-say3">Another campaign: only 2 of 3 neighbors join by the deadline.</p>
        <p className="fl-say fl-say4">Goal missed: every hold is released. Nobody is charged.</p>
      </div>
      <p className="sr-only">
        An example with a goal of 3 neighbors and a $25 pledge. Each neighbor's pledge is held by PayPal, and nobody is charged
        while the campaign is open. If the goal is met by the deadline, every hold is collected and the owner is paid. If it is
        missed, every hold is released and nobody is charged.
      </p>
    </figure>
  );
}
