/* The parts of the app that load on demand, a chunk each, so the first screen loads only what it shows. Each can be
   started early (`preload`), as the app does where the next step is likely: the page a link points to. */
import { lazyModule } from "./lib/lazy";

export const privacyChunk = lazyModule(() => import("./pages/PrivacyPage"));
/** The home page: what the product is, in one screen, and the ways in. */
export const homeChunk = lazyModule(() => import("./pages/HomePage"));
/** Walk-in Founders: the open campaigns, a campaign's page, starting one and the account's own, with PayPal's buttons and the Founders styles. */
export const foundersChunk = lazyModule(() => import("./pages/foundersPages"));
/** What a person can check and ask: the assistant with the person's limits, a campaign's proof and Check a spot. */
export const trustChunk = lazyModule(() => import("./pages/trustPages"));
