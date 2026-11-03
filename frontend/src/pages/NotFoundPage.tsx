import { Link } from "../components/Link";
import { Page, PageHead, useDocumentTitle, useFocusOnMount } from "../components/Page";
import { BROWSE_URL } from "../lib/routes";

/** An address the app has no page for: a mistyped link, or a page from an older version. */
export function NotFoundPage() {
  const titleRef = useFocusOnMount();
  useDocumentTitle("Page not found");
  return (
    <Page>
      <PageHead
        eyebrow="Threshold · Not found"
        title="This page isn't here"
        titleRef={titleRef}
        standfirst="The link may be mistyped, or the page was removed."
      />
      <section className="pg-sec" aria-label="Where to go next">
        <Link className="text-link" href={BROWSE_URL}>
          See the open campaigns <span aria-hidden="true">→</span>
        </Link>
      </section>
    </Page>
  );
}
