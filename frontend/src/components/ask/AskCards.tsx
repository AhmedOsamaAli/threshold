import type { AskCard } from "../../api/assistant";
import { distanceText } from "../../lib/ask";
import { moneyText, timeLeft } from "../../lib/founders";
import { proofUrl } from "../../lib/routes";
import { Link } from "../Link";
import { ProgressBar } from "../founders/ProgressBar";

interface AskCardsProps {
  cards: readonly AskCard[];
  now: number;
  /** The person pressed Back it on a card. */
  onBack: (card: AskCard) => void;
  disabled: boolean;
}

/** The campaigns an answer put on the page, each with the button that asks the assistant to prepare its pledge. */
export function AskCards({ cards, now, onBack, disabled }: AskCardsProps) {
  return (
    <ul className="ask-cards">
      {cards.map((card) => {
        const left = timeLeft(card.deadline, now);
        const where = [card.kind, card.place, card.distance_km === null ? null : distanceText(card.distance_km)].filter(Boolean);
        return (
          <li key={card.id}>
            <article className="ask-card">
              <p className="ask-card-kicker mono">{where.join(" · ")}</p>
              <h3 className="ask-card-title">
                <Link href={card.url}>{card.name}</Link>
              </h3>
              {card.title && card.title !== card.name ? <p className="ask-card-sub">{card.title}</p> : null}
              <ProgressBar
                supporters={card.supporters}
                goal={card.goal}
                funded={card.supporters >= card.goal}
                label={`Neighbors backing ${card.name}`}
              />
              <p className="ask-card-count">
                <b>{card.supporters}</b> of {card.goal} neighbors · pledge {moneyText(card.amount, card.currency)} ·{" "}
                {left.closed ? "closing" : left.text}
              </p>
              <div className="ask-card-actions">
                {card.accepting && !left.closed ? (
                  <button
                    className="go"
                    type="button"
                    disabled={disabled}
                    onClick={() => {
                      onBack(card);
                    }}
                  >
                    Back it
                  </button>
                ) : (
                  <span className="mono ask-card-closed">Not taking pledges</span>
                )}
                <Link className="text-link" href={proofUrl(card.id)}>
                  Proof
                </Link>
              </div>
            </article>
          </li>
        );
      })}
    </ul>
  );
}
