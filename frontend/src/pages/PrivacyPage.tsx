import type { ReactNode } from "react";
import { Link } from "../components/Link";
import { Page, PageHead, useDocumentTitle, useFocusOnMount } from "../components/Page";
import { SectionHead } from "../components/SectionHead";
import { FOUNDERS_URL, MY_CAMPAIGNS_URL } from "../lib/routes";

/** The day this note last changed: say so here whenever it does. */
const UPDATED = "2 November 2026";
const ISSUES = "https://github.com/AhmedOsamaAli/walk-in/issues";

function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Who runs Walk-in, what it stores and why, its cookie, who else sees what, how long it keeps things, how to delete
 * them and whom to ask, in plain words. It is the privacy policy Google's consent screen links to, so it stands on its
 * own: no sign-in and no request to the server, and it prints as a document.
 */
export function PrivacyPage() {
  const titleRef = useFocusOnMount();
  useDocumentTitle("Privacy");
  return (
    <Page className="privacy-page">
      <PageHead
        eyebrow="Walk-in · Privacy"
        title="Your data, in plain words"
        titleRef={titleRef}
        standfirst="Walk-in keeps what it needs to sign you in and to run Founders campaigns. Nothing else."
        fields={[
          { label: "Run by", lines: ["An independent project"] },
          { label: "Ads and tracking", lines: ["None"] },
          { label: "Sent to AI", lines: ["Nothing about you"] },
          { label: "Last updated", lines: [UPDATED] },
        ]}
        actions={
          <button
            type="button"
            className="ghost mono"
            onClick={() => {
              window.print();
            }}
          >
            Print
          </button>
        }
      />
      <section className="pg-sec" aria-labelledby="privacy-who">
        <SectionHead id="privacy-who" no="01" title="Who runs Walk-in" />
        <p className="privacy-plain">
          Walk-in is an independent project, run by the people who made it. Questions about your data go to the project
          on GitHub, below.
        </p>
      </section>
      <section className="pg-sec" aria-labelledby="privacy-stores">
        <SectionHead id="privacy-stores" no="02" title="What Walk-in stores, and why" />
        <dl className="privacy-list">
          <Item term="With sign-in">
            Your Google account id, your email, your name and the link to your Google profile picture, only to show that
            you&apos;re signed in and to list your campaigns in My campaigns.
          </Item>
          <Item term="Founders campaigns">
            If you start one: the business&apos;s name, kind, description, why-here note and address, your terms, the words of
            its page and the PayPal email you give for the money, which its page shows only to you, masked. Anyone with
            the campaign&apos;s link can read the rest.
          </Item>
          <Item term="Pledges">
            PayPal takes a pledge on its own pages, so Walk-in never sees your card or your PayPal login. Walk-in keeps
            PayPal&apos;s ids for your order and its hold, the amount and where the pledge stands, to count it and to collect
            or release it, and PayPal&apos;s own notices about it.
          </Item>
          <Item term="In your browser">
            Your light or dark theme, the PayPal order id of each pledge you made from it, so you can withdraw the pledge
            from there, and the posters you design here: their colors and logo, which stay on your device.
          </Item>
        </dl>
      </section>
      <section className="pg-sec" aria-labelledby="privacy-cookies">
        <SectionHead id="privacy-cookies" no="03" title="Cookies" note="One, and it does not follow you to other sites." />
        <dl className="privacy-list">
          <Item term="A sign-in cookie">
            Set when you sign in, so Walk-in knows it is you; Walk-in keeps only a one-way fingerprint of it. It lasts 30
            days, renewed while you use Walk-in, and signing out deletes it.
          </Item>
        </dl>
      </section>
      <section className="pg-sec" aria-labelledby="privacy-others">
        <SectionHead id="privacy-others" no="04" title="Who else sees what" />
        <dl className="privacy-list">
          <Item term="The AI providers">
            When you ask for a draft of a campaign&apos;s page, they read what you wrote about the business and the terms you
            set. Nothing personal is ever sent to them: not your name, your email or your account.
          </Item>
          <Item term="OpenStreetMap's services">
            Find the addresses you search for. Walk-in&apos;s server asks them, never your browser, so they learn nothing
            about you.
          </Item>
          <Item term="Google">
            Runs the sign-in itself when you sign in with Google, and tells Walk-in your account id, email, name and picture
            link.
          </Item>
          <Item term="PayPal">
            Takes each pledge on its own pages, holds it, and collects or releases it; once a campaign is collected, it pays
            the owner. What you give PayPal there is under PayPal&apos;s own privacy statement.
          </Item>
          <Item term="Walk-in's hosts">
            Cloudflare serves the web app from its worldwide network; the server runs on Render and the database on Neon,
            both in Ohio, in the United States. Like any website&apos;s hosts, they see your IP address with each request
            and may keep it in their logs. Walk-in itself uses it only to limit how much one address can ask of it in an
            hour, and never saves it with your campaigns or your account.
          </Item>
          <Item term="Nobody else">
            Walk-in shows no ads and runs no analytics or tracking pixels. Nothing about you is sold or shared.
          </Item>
        </dl>
      </section>
      <section className="pg-sec" aria-labelledby="privacy-kept">
        <SectionHead id="privacy-kept" no="05" title="How long it is kept" />
        <dl className="privacy-list">
          <Item term="Your account">Kept until you delete it. Signing out keeps it.</Item>
          <Item term="Campaigns and pledges">
            Kept after a campaign closes, as the record of what was held, collected or released.
          </Item>
        </dl>
      </section>
      <section className="pg-sec" aria-labelledby="privacy-delete">
        <SectionHead id="privacy-delete" no="06" title="Deleting it" />
        <dl className="privacy-list">
          <Item term="Your account">
            In{" "}
            <Link className="text-link" href={MY_CAMPAIGNS_URL}>
              My campaigns
            </Link>
            , “Delete my account” deletes your account and signs you out on every device. The campaigns you started are not
            deleted with it: they stay online, with no owner left to manage them.
          </Item>
          <Item term="This browser">
            Signing out deletes the sign-in cookie. Clearing this site&apos;s cookies and storage in your browser deletes it
            too, with your theme, the pledges remembered here and your poster designs.
          </Item>
        </dl>
      </section>
      <section className="pg-sec" aria-labelledby="privacy-contact">
        <SectionHead id="privacy-contact" no="07" title="Contact" />
        <p className="privacy-plain">
          For a question about your data, or a request about it, open an issue at{" "}
          <a className="text-link" href={ISSUES} target="_blank" rel="noopener">
            github.com/AhmedOsamaAli/walk-in/issues
          </a>
          . Issues are public, so please leave personal details out of them.
        </p>
        <p className="privacy-back">
          <Link className="text-link" href={FOUNDERS_URL}>
            See the open campaigns <span aria-hidden="true">→</span>
          </Link>
        </p>
      </section>
    </Page>
  );
}
