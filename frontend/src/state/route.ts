/* The address as the app's one route, and the moves between addresses: Back and Forward, the app's own links and the
   pages' own navigation all change it, and the app follows. */
import { useSyncExternalStore } from "react";
import type { Navigate } from "../lib/navigation";
import { currentAddress, currentRoute, type Route } from "../lib/routes";

let shown: { address: string; route: Route } | null = null;

/** The route of the address now: the same object for as long as the address stays, as a store's snapshot must be. */
function snapshot(): Route {
  const address = currentAddress();
  if (shown?.address !== address) shown = { address, route: currentRoute() };
  return shown.route;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("popstate", listener);
  return () => {
    window.removeEventListener("popstate", listener);
  };
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, snapshot);
}

/** The address changes and the app follows it as it follows Back; the same address again returns to the page's top. */
export const navigate: Navigate = (url, options) => {
  const next = new URL(url, window.location.href);
  const target = `${next.pathname}${next.search}${next.hash}`;
  if (!options?.replace && target === `${currentAddress()}${window.location.hash}`) {
    window.scrollTo({ top: 0 });
    return;
  }
  if (options?.replace) window.history.replaceState(null, "", target);
  else window.history.pushState(null, "", target);
  window.dispatchEvent(new PopStateEvent("popstate"));
};
