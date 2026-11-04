import type { Route } from "../lib/routes";
import { currentTab, TABS, type TabId } from "../lib/tabs";
import { Link } from "./Link";

/** A tab's picture, drawn with the bar's own pen: a storefront for the campaigns, a speech bubble for the assistant, a target for a spot. */
function TabIcon({ id }: { id: TabId }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {id === "browse" ? <path d="M4 9.5 5.6 4h12.8L20 9.5M4 9.5V20h16V9.5M4 9.5h16M9.5 20v-5.5h5V20" /> : null}
      {id === "ask" ? (
        <>
          <path d="M4 5h16v11h-9l-4.5 4v-4H4z" />
          <path d="M9 10.5h6" />
        </>
      ) : null}
      {id === "spot" ? (
        <>
          <circle cx="12" cy="12" r="6.5" />
          <circle cx="12" cy="12" r="1.6" />
          <path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
        </>
      ) : null}
    </svg>
  );
}

/**
 * The places to go: Browse, Ask and Check a spot, as the bar's main tabs. They are links in a navigation landmark (each opens
 * a page of its own, so they are not ARIA tabs), and the one for the page on show says so with `aria-current`, which the
 * stylesheet fills in with the highlighter.
 */
export function MainTabs({ route }: { route: Route }) {
  const current = currentTab(route);
  return (
    <nav className="bar-tabs" aria-label="Main">
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          className="bar-tab mono"
          href={tab.href}
          title={tab.title}
          aria-current={tab.id === current ? "page" : undefined}
        >
          <TabIcon id={tab.id} />
          <span>{tab.label}</span>
        </Link>
      ))}
    </nav>
  );
}
