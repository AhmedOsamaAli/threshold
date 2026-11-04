import type { ReactNode } from "react";
import { Link } from "../components/Link";
import { Page, PageHead, useDocumentTitle, useFocusOnMount } from "../components/Page";
import { SectionHead } from "../components/SectionHead";
import { REPO_URL } from "../lib/product";
import { BROWSE_URL, MY_CAMPAIGNS_URL } from "../lib/routes";

/** The day this note last changed: say so here whenever it does. */
const UPDATED = "3 November 2026";
const ISSUES = `${REPO_URL}/issues`;

function Item({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div>
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/**
 * Who runs Threshold, what it stores and why, its cookie, who else sees what, how long it keeps things, how to delete
 * them and whom to ask, in plain words. It is the privacy policy Google's consent screen links to, so it stands on its
 * own: no sign-in and no request to the server, and it prints as a document.
 */
export function PrivacyPage() {
  const titleRef = useFocusOnMount();
  useDocumentTitle("Privacy");
  return (
    <Page className="privacy-page">
      <PageHead
        eyebrow="Threshold · Privacy"
        title="Your data, in plain words"
        titleRef={titleRef}
        standfirst="Threshold keeps what it needs to sign you in, run campaigns and check pledges. Nothing else."
        fields={[
          { label: "Run by", lines: ["An independent project"] },
          { label: "Ads and tracking", lines: ["None"] },
          { label: "Sent to AI", lines: ["Only what you type to", "the assistant"] },
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
        <SectionHead id="privacy-who" no="01" title="Who runs Threshold" />
        <p className="privacy-plain">
          Threshold is an independent project, run by the people who made it. Questions about your data go to the project
          on GitHub, below.
        </p>
      </section>
      <section className="pg-sec" aria-labelledby="privacy-stores">
        <SectionHead id="privacy-stores" no="02" title="What Threshold stores, and why" />
        <dl className="privacy-list">
          <Item term="With sign-in">
            Your Google account id, your email, your name and the link to your Google profile picture, only to show that
            you&apos;re signed in and to list your campaigns in My campaigns.
          </Item>
          <Item term="Campaigns">
            If you start one: the business&apos;s name, kind, description, why-here note and address, your terms, the words of
            its page and the PayPal email you give for the money, which its page shows only to you, masked. Anyone with
            the campaign&apos;s link can read the rest.
          </Item>
          <Item term="Pledges">
            PayPal takes a pledge on its own pages, so Threshold never sees your card or your PayPal login. Threshold keeps
            PayPal&apos;s ids for your order and its hold, PayPal&apos;s id for you as the payer (not your email), the amount
            and where the pledge stands, to count it and to collect or release it, and PayPal&apos;s own notices about it. It
            also keeps the terms the pledge was made under, signed, so they can be checked later.
          </Item>
          <Item term="Proof pages">
            A campaign&apos;s proof page is public. For each pledge it shows a short reference, the amount, where the
            pledge stands, when it was held and PayPal&apos;s ids for the hold. Never a name or an email.
          </Item>
          <Item term="In your browser">
            Your light or dark theme; the PayPal order id and private receipt of each pledge you made from it, so you can
            withdraw the pledge from there; the limits you set for an assistant, which only this browser holds and sends
            with a request; and the posters you design here, which stay on your device.
          </Item>
        </dl>
      </section>
      <section className="pg-sec" aria-labelledby="privacy-cookies">
        <SectionHead id="privacy-cookies" no="03" title="Cookies" note="One, and it does not follow you to other sites." />
        <dl className="privacy-list">
          <Item term="A sign-in cookie">
            Set when you sign in, so Threshold knows it is you; Threshold keeps only a one-way fingerprint of it. It lasts 30
            days, renewed while you use Threshold, and signing out deletes it.
          </Item>
        </dl>
      </section>
      <section className="pg-sec" aria-labelledby="privacy-others">
        <SectionHead id="privacy-others" no="04" title="Who else sees what" />
        <dl className="privacy-list">
          <Item term="The AI providers">
            When you ask for a draft of a campaign&apos;s page, they read what you wrote about the business and the terms you
            set. When you talk to the assistant, they may read your messages and the public facts of the campaigns it
            found, so leave personal details out of what you type. They never get your name, your email, your account, a
            pledge&apos;s receipt, PayPal&apos;s approval link or the numbers in your limits.
          </Item>
          <Item term="OpenStreetMap's services">
            Find the addresses you search for, draw the walking area, and read what its volunteers wrote about a place
            (opening hours, website, phone) for Check a spot. Threshold&apos;s server asks them, never your browser, so they
            learn nothing about you.
          </Item>
          <Item term="OpenFreeMap">
            Draws the street map where a page shows one, such as Check a spot. Your browser asks it for the map&apos;s tiles,
            fonts and icons, so, like any map host, it sees your IP address and the part of the map you look at. It sets no
            cookies and needs no key. Threshold&apos;s server also reads the places in a walking area from its tiles, which
            tells it nothing about you.
          </Item>
          <Item term="Google Maps">
            Only if you press &ldquo;Ratings and photos on Google Maps&rdquo; on a place&apos;s card: that opens Google Maps in
            a new tab, where Google&apos;s own terms and privacy statement apply. Threshold sends it nothing but the place&apos;s
            name and position, in the link.
          </Item>
          <Item term="Google">
            Runs the sign-in itself when you sign in with Google, and tells Threshold your account id, email, name and
            picture link.
          </Item>
          <Item term="PayPal">
            Takes each pledge on its own pages, holds it, and collects or releases it; once a campaign is collected, it pays
            the owner. What you give PayPal there is under PayPal&apos;s own privacy statement.
          </Item>
          <Item term="Threshold's hosts">
            Cloudflare serves the web app from its worldwide network; the server runs on Render and the database on Neon,
            both in Ohio, in the United States. Like any website&apos;s hosts, they see your IP address with each request
            and may keep it in their logs. Threshold itself uses it only to limit how much one address can ask of it in an
            hour, and never saves it with your campaigns or your account.
          </Item>
          <Item term="Nobody else">
            Threshold shows no ads and runs no analytics or tracking pixels. Nothing about you is sold or shared.
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
            github.com/<wbr />AhmedOsamaAli/<wbr />threshold/<wbr />issues
          </a>
          . Issues are public, so please leave personal details out of them.
        </p>
        <p className="privacy-back">
          <Link className="text-link" href={BROWSE_URL}>
            See the open campaigns <span aria-hidden="true">→</span>
          </Link>
        </p>
      </section>
    </Page>
  );
}
