import { Suspense } from "react";
import { foundersChunk, privacyChunk } from "../chunks";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { lazyComponent } from "../lib/lazy";
import { pageUrl, type Route } from "../lib/routes";
import { NotFoundPage } from "./NotFoundPage";

// Each page loads with its own chunk the first time it opens.
const PrivacyPage = lazyComponent(privacyChunk, (chunk) => chunk.PrivacyPage);
const FoundersPage = lazyComponent(foundersChunk, (chunk) => chunk.FoundersPage);
const CampaignPage = lazyComponent(foundersChunk, (chunk) => chunk.CampaignPage);
const MyCampaignsPage = lazyComponent(foundersChunk, (chunk) => chunk.MyCampaignsPage);
const ReceiptPage = lazyComponent(foundersChunk, (chunk) => chunk.ReceiptPage);
const StartCampaignPage = lazyComponent(foundersChunk, (chunk) => chunk.StartCampaignPage);

function Broken() {
  return (
    <main className="page" id="main">
      <div className="page-sheet">
        <p className="page-alert" role="alert">
          This page could not be shown. Reload it to try again.
        </p>
      </div>
    </main>
  );
}

/** The sheet a page sits on, empty while the page's own code loads, so nothing moves when the page arrives. */
function Loading() {
  return (
    <main className="page" id="main" aria-busy="true">
      <div className="page-sheet">
        <p className="sr-only">Loading the page…</p>
      </div>
    </main>
  );
}

function Shown({ route }: { route: Route }) {
  switch (route.page) {
    // The landing page comes later; until then "/" lists the open campaigns, as "/founders" does.
    case "home":
    case "founders":
      return <FoundersPage />;
    case "start-campaign":
      return <StartCampaignPage />;
    case "my-campaigns":
      return <MyCampaignsPage />;
    case "privacy":
      return <PrivacyPage />;
    case "campaign":
      return <CampaignPage route={route} />;
    case "receipt":
      return <ReceiptPage token={route.token} />;
    case "not-found":
      return <NotFoundPage />;
  }
}

/** The page an address asks for, in a boundary of its own so nothing carries over from one page to the next. */
export function PageView({ route }: { route: Route }) {
  return (
    <ErrorBoundary key={pageUrl(route)} fallback={<Broken />}>
      <Suspense fallback={<Loading />}>
        <Shown route={route} />
      </Suspense>
    </ErrorBoundary>
  );
}
