/* The product's main places, as the top bar's tabs show them. Pure, so it is tested without a browser. */
import { ASK_URL, BROWSE_URL, SPOT_URL, type Route } from "./routes";

export type TabId = "browse" | "ask" | "spot";

export interface Tab {
  /** The same word as the page's name in the router, so that the tab of the page on show is found by it. */
  id: TabId;
  label: string;
  href: string;
  /** What the place is for, as the tab's tooltip says. */
  title: string;
}

/**
 * The three places the product is made of, in the order the bar shows them: the campaigns to back, the assistant, and the
 * check of what is around a spot. Starting a campaign is not among them: it is something to do, not a place to be, so it is a
 * button beside the tabs.
 */
export const TABS: readonly Tab[] = [
  { id: "browse", label: "Browse", href: BROWSE_URL, title: "Businesses their neighbors can back with PayPal before they open" },
  { id: "ask", label: "Ask", href: ASK_URL, title: "Ask an assistant to find a place and prepare a pledge, inside limits you set" },
  { id: "spot", label: "Check a spot", href: SPOT_URL, title: "See what is already within a ten-minute walk of an address" },
];

/** The tab of the page on show, or null when the page is not one of them (the home page, a campaign, a proof...). */
export function currentTab(route: Route): TabId | null {
  switch (route.page) {
    case "browse":
    case "ask":
    case "spot":
      return route.page;
    default:
      return null;
  }
}
