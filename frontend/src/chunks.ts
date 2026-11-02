/* The parts of the app that load on demand, a chunk each, so the first screen loads only what it shows. Each can be
   started early (`preload`), as the app does where the next step is likely: the page a link points to. */
import { lazyModule } from "./lib/lazy";

export const privacyChunk = lazyModule(() => import("./pages/PrivacyPage"));
/** Walk-in Founders: the open campaigns, a campaign's page, starting one and the account's own, with PayPal's buttons and the Founders styles. */
export const foundersChunk = lazyModule(() => import("./pages/foundersPages"));
