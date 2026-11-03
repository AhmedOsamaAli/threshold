/**
 * What a URL asks for: the home page, the open campaigns, starting a campaign, one campaign's page and its proof, a pledge's
 * private receipt, the assistant, checking a spot, the privacy note, the signed-in user's campaigns, or nothing the app has.
 */
export type Route =
  | { page: "home" }
  | { page: "browse" }
  | { page: "start-campaign" }
  | { page: "my-campaigns" }
  | { page: "ask" }
  | { page: "spot" }
  | { page: "privacy" }
  | { page: "proof"; id: string }
  | { page: "receipt"; token: string }
  | CampaignRoute
  | { page: "not-found"; path: string };

/** A campaign (/p/{id}), with what PayPal sent a supporter back with from its own page. */
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
/** The open campaigns. */
export const BROWSE_URL = "/browse";
export const START_CAMPAIGN_URL = "/start";
export const MY_CAMPAIGNS_URL = "/me";
export const ASK_URL = "/ask";
export const SPOT_URL = "/spot";
export const PRIVACY_URL = "/privacy";

const BROWSE_PATH = /^\/browse\/?$/;
const START_CAMPAIGN_PATH = /^\/start\/?$/;
const MY_CAMPAIGNS_PATH = /^\/me\/?$/;
const ASK_PATH = /^\/ask\/?$/;
const SPOT_PATH = /^\/spot\/?$/;
const PRIVACY_PATH = /^\/privacy\/?$/;
const CAMPAIGN_PATH = /^\/p\/([A-Za-z0-9_-]{1,64})\/?$/;
const PROOF_PATH = /^\/proof\/([A-Za-z0-9_-]{1,64})\/?$/;
const RECEIPT_PATH = /^\/r\/([A-Za-z0-9_-]{32})\/?$/;
// What PayPal sends a supporter back with: our pledge's id, or PayPal's order id ("5O190127TN364715T"); the server
// takes either.
const ORDER_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parseRoute(pathname: string, search: string): Route {
  if (pathname === HOME_URL) return { page: "home" };
  if (BROWSE_PATH.test(pathname)) return { page: "browse" };
  if (START_CAMPAIGN_PATH.test(pathname)) return { page: "start-campaign" };
  if (MY_CAMPAIGNS_PATH.test(pathname)) return { page: "my-campaigns" };
  if (ASK_PATH.test(pathname)) return { page: "ask" };
  if (SPOT_PATH.test(pathname)) return { page: "spot" };
  if (PRIVACY_PATH.test(pathname)) return { page: "privacy" };
  const receipt = RECEIPT_PATH.exec(pathname)?.[1];
  if (receipt) return { page: "receipt", token: receipt };
  const proof = PROOF_PATH.exec(pathname)?.[1];
  if (proof) return { page: "proof", id: proof };
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

/** "/p/{id}": a campaign's page. */
export function campaignUrl(id: string): string {
  return `/p/${encodeURIComponent(id)}`;
}

/** "/proof/{id}": what the campaign's pledges and money did, checked against PayPal. */
export function proofUrl(id: string): string {
  return `/proof/${encodeURIComponent(id)}`;
}

export function receiptUrl(token: string): string {
  return `/r/${encodeURIComponent(token)}`;
}

/** The address a route shows; a campaign's without what PayPal sent the supporter back with. */
export function pageUrl(route: Route): string {
  switch (route.page) {
    case "home":
      return HOME_URL;
    case "browse":
      return BROWSE_URL;
    case "start-campaign":
      return START_CAMPAIGN_URL;
    case "my-campaigns":
      return MY_CAMPAIGNS_URL;
    case "ask":
      return ASK_URL;
    case "spot":
      return SPOT_URL;
    case "privacy":
      return PRIVACY_URL;
    case "campaign":
      return campaignUrl(route.id);
    case "proof":
      return proofUrl(route.id);
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
