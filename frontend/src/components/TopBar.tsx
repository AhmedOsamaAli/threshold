import { useEffect, useRef, useState } from "react";
import { replays } from "../lib/brand";
import { prefersReducedMotion } from "../lib/motion";
import { isPlainClick } from "../lib/navigation";
import { PRODUCT_NAME } from "../lib/product";
import { ASK_URL, BROWSE_URL, HOME_URL, SPOT_URL, START_CAMPAIGN_URL, type Route } from "../lib/routes";
import type { Theme } from "../state/theme";
import { AccountMenu } from "./AccountMenu";
import { BrandMark } from "./BrandMark";
import { EngineNote } from "./EngineNote";
import { Link } from "./Link";
import { ThemeToggle } from "./ThemeToggle";

interface TopBarProps {
  /** The page on show: its link in the bar is marked as the current one. */
  route: Route;
  theme: Theme;
  onToggleTheme: () => void;
}

/** The mark, the campaigns to browse, the assistant, checking a spot, starting a campaign, the account and the theme. */
export function TopBar({ route, theme, onToggleTheme }: TopBarProps) {
  const [replay, setReplay] = useState(0);
  /** When the last walk-in started, on performance.now()'s clock; the first plays as the page loads. */
  const playedAt = useRef(0);
  const browsing = route.page === "browse";

  useEffect(() => {
    playedAt.current = performance.now();
  }, []);

  function play(cause: "click" | "preview") {
    const now = performance.now();
    if (!replays(cause, prefersReducedMotion(), now - playedAt.current)) return;
    playedAt.current = now;
    setReplay((count) => count + 1);
  }

  return (
    <header className="bar">
      <Link
        className="mark"
        href={HOME_URL}
        aria-label={`${PRODUCT_NAME}, home`}
        onPointerEnter={(event) => {
          // A mouse hover previews the walk; a tap on a phone plays it with its click instead.
          if (event.pointerType === "mouse") play("preview");
        }}
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) play("preview");
        }}
        onClick={(event) => {
          if (isPlainClick(event)) play("click");
        }}
      >
        <BrandMark replay={replay} />
        <span className="mark-word">{PRODUCT_NAME}</span>
      </Link>
      <span className="bar-gap" />
      <div className="bar-end">
        <Link
          className="bar-link mono"
          href={BROWSE_URL}
          aria-current={browsing ? "page" : undefined}
          title="Businesses their neighbors can back with PayPal before they open"
        >
          Browse
        </Link>
        <Link
          className="bar-link mono"
          href={ASK_URL}
          aria-current={route.page === "ask" ? "page" : undefined}
          title="Ask an assistant to find a place and prepare a pledge, inside limits you set"
        >
          Ask
        </Link>
        <Link
          className="bar-link bar-wide mono"
          href={SPOT_URL}
          aria-current={route.page === "spot" ? "page" : undefined}
          title="See what is already within a ten-minute walk of an address"
        >
          Check a spot
        </Link>
        <Link
          className="bar-link bar-start mono"
          href={START_CAMPAIGN_URL}
          aria-label="Start a campaign"
          aria-current={route.page === "start-campaign" ? "page" : undefined}
          title="Open something? Let the neighbors back it"
        >
          <span>Start</span>
          <span className="bar-start-more"> a campaign</span>
        </Link>
        <AccountMenu />
        <ThemeToggle theme={theme} onToggle={onToggleTheme} />
      </div>
      <EngineNote />
    </header>
  );
}
