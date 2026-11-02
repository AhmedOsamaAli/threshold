/**
 * What a URL asks for: the open campaigns ("/" for now, and "/founders"), starting a campaign, one campaign's page, a
 * pledge's private receipt, the privacy note, the signed-in user's campaigns, or nothing the app has.
 */
export type Route =
  | { page: "home" }
  | { page: "founders" }
  | { page: "start-campaign" }
  | { page: "my-campaigns" }
  | { page: "privacy" }
  | { page: "receipt"; token: string }
  | CampaignRoute
  | { page: "not-found"; path: string };

/** A Founders campaign (/p/{id}), with what PayPal sent a supporter back with from its own page. */
export interface CampaignRoute {
  page: "campaign";
  id: string;
  /** `?pledge={id}`: the pledge the supporter approved in PayPal (ours, or PayPal's order id), which this page then
   * authorizes. */
  pledge: string | null;
  /** `?cancelled=1`: the supporter left PayPal without approving, so nothing was held. */
  cancelled: boolean;
}

export const HOME_URL = "/";
/** The open Founders campaigns. */
export const FOUNDERS_URL = "/founders";
export const START_CAMPAIGN_URL = "/founders/start";
export const MY_CAMPAIGNS_URL = "/me";
export const PRIVACY_URL = "/privacy";

const FOUNDERS_PATH = /^\/founders\/?$/;
const START_CAMPAIGN_PATH = /^\/founders\/start\/?$/;
const MY_CAMPAIGNS_PATH = /^\/me\/?$/;
const PRIVACY_PATH = /^\/privacy\/?$/;
const CAMPAIGN_PATH = /^\/p\/([A-Za-z0-9_-]{1,64})\/?$/;
const RECEIPT_PATH = /^\/r\/([A-Za-z0-9_-]{32})\/?$/;
// What PayPal sends a supporter back with: our pledge's id, or PayPal's order id ("5O190127TN364715T"); the server
// takes either.
const ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseRoute(pathname: string, search: string): Route {
  if (pathname === HOME_URL) return { page: "home" };
  if (FOUNDERS_PATH.test(pathname)) return { page: "founders" };
  if (START_CAMPAIGN_PATH.test(pathname)) return { page: "start-campaign" };
  if (MY_CAMPAIGNS_PATH.test(pathname)) return { page: "my-campaigns" };
  if (PRIVACY_PATH.test(pathname)) return { page: "privacy" };
  const receipt = RECEIPT_PATH.exec(pathname)?.[1];
  if (receipt) return { page: "receipt", token: receipt };
  const campaign = CAMPAIGN_PATH.exec(pathname)?.[1];
  if (campaign) {
    const params = new URLSearchParams(search);
    const pledge = params.get("pledge");
    return {
      page: "campaign",
      id: campaign,
      pledge: pledge !== null && ORDER_ID.test(pledge) ? pledge : null,
      cancelled: params.get("cancelled") === "1",
    };
  }
  return { page: "not-found", path: pathname };
}

/** "/p/{id}": a Founders campaign's page. */
export function campaignUrl(id: string): string {
  return `/p/${encodeURIComponent(id)}`;
}

export function receiptUrl(token: string): string {
  return `/r/${encodeURIComponent(token)}`;
}

/** The address a route shows; a campaign's without what PayPal sent the supporter back with. */
export function pageUrl(route: Route): string {
  switch (route.page) {
    case "home":
      return HOME_URL;
    case "founders":
      return FOUNDERS_URL;
    case "start-campaign":
      return START_CAMPAIGN_URL;
    case "my-campaigns":
      return MY_CAMPAIGNS_URL;
    case "privacy":
      return PRIVACY_URL;
    case "campaign":
      return campaignUrl(route.id);
    case "receipt":
      return receiptUrl(route.token);
    case "not-found":
      return route.path;
  }
}

export function currentRoute(): Route {
  return parseRoute(window.location.pathname, window.location.search);
}

/** The address without its hash: a link to a place on the page changes only the hash, which is not a navigation. */
export function currentAddress(): string {
  return `${window.location.pathname}${window.location.search}`;
}
