/* What each address of the app needs before it can show, started ahead of need: the chunk of code that draws its page.
   Links start it as they are hovered, focused or touched; the app starts it for the address it opens on. */
import { foundersChunk, homeChunk, privacyChunk, trustChunk } from "./chunks";
import { parseRoute, type Route } from "./lib/routes";

/** The chunk that draws a route's page; the page for an address the app does not have is part of the app itself. */
function chunkOf(route: Route) {
  switch (route.page) {
    case "privacy":
      return privacyChunk;
    case "home":
      return homeChunk;
    case "founders":
    case "start-campaign":
    case "my-campaigns":
    case "campaign":
    case "receipt":
      return foundersChunk;
    case "ask":
    case "spot":
    case "proof":
      return trustChunk;
    case "not-found":
      return null;
  }
}

/** The app's route for a link, or null for a link that leaves the app. */
export function routeOf(href: string, base: string): Route | null {
  let url: URL;
  try {
    url = new URL(href, base);
  } catch {
    return null;
  }
  return url.origin === new URL(base).origin ? parseRoute(url.pathname, url.search) : null;
}

/** Starts loading the code of the page an address shows. */
export function preloadRoute(route: Route): void {
  chunkOf(route)?.preload();
}

/** The same, for a link's address; nothing for a link that leaves the app. */
export function preloadLink(href: string): void {
  const route = routeOf(href, window.location.href);
  if (route) preloadRoute(route);
}
