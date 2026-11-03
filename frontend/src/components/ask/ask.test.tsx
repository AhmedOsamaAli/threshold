import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AskCard, PreparedPledge } from "../../api/assistant";
import { AskCards } from "./AskCards";
import { LimitsPanel } from "./LimitsPanel";
import { PledgePanel } from "./PledgePanel";

const NOW = Date.parse("2026-11-03T12:00:00Z");
const RECEIPT = "Av7v5rcNyjXToUQ9JyFkEyHFEHJ_jijs";

const card: AskCard = {
  id: "c4f1e2",
  url: "/p/c4f1e2",
  name: "Golden Hour",
  title: "A neighborhood cafe",
  kind: "cafe",
  place: "East Austin",
  distance_km: 0.4,
  amount: "25.00",
  currency: "USD",
  goal: 40,
  supporters: 13,
  deadline: "2026-11-30T12:00:00Z",
  accepting: true,
};

const pledge: PreparedPledge = {
  campaign_id: "c4f1e2",
  name: "Golden Hour",
  amount: "25.00",
  currency: "USD",
  goal: 40,
  deadline: "2026-11-30T12:00:00Z",
  approve_url: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T",
  receipt: RECEIPT,
  ref: "a1b2c3d4e5f6",
  terms_hash: "f".repeat(64),
  limits: null,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the campaigns an answer shows", () => {
  const render = (cards: AskCard[], disabled = false) =>
    renderToStaticMarkup(<AskCards cards={cards} now={NOW} onBack={() => undefined} disabled={disabled} />);

  it("shows each one with where it is, how far along it is, and a way to back it", () => {
    const html = render([card]);
    expect(html).toContain("Golden Hour");
    expect(html).toContain('href="/p/c4f1e2"');
    expect(html).toContain("cafe · East Austin · 400 m away");
    expect(html).toContain("<b>13</b> of 40 neighbors");
    expect(html).toContain('aria-valuenow="13"');
    expect(html).toContain("Back it");
    expect(html).toContain('href="/proof/c4f1e2"');
  });

  it("names the pledge, and how long is left", () => {
    const html = render([card]);
    expect(html).toContain("pledge $25");
    expect(html).toMatch(/\d+ days left/);
  });

  it("offers no way to back a campaign that is not taking pledges, or whose time has run out", () => {
    for (const closed of [{ ...card, accepting: false }, { ...card, deadline: "2026-11-01T12:00:00Z" }]) {
      const html = render([closed]);
      expect(html).toContain("Not taking pledges");
      expect(html).not.toContain("Back it");
    }
  });

  it("holds the buttons while the assistant is answering", () => {
    expect(render([card], true)).toMatch(/<button[^>]*disabled=""[^>]*>Back it/);
  });

  it("leaves out a distance that is unknown, and a title that only repeats the name", () => {
    const html = render([{ ...card, distance_km: null, title: "Golden Hour" }]);
    expect(html).toContain("cafe · East Austin<");
    expect(html).not.toContain("ask-card-sub");
  });
});

describe("a pledge prepared for approval", () => {
  function render() {
    vi.stubGlobal("window", { location: { origin: "https://dayone.test" } });
    return renderToStaticMarkup(<PledgePanel pledge={pledge} />);
  }

  it("says it is not approved yet, and that only the person can approve it", () => {
    const html = render();
    expect(html).toContain("Prepared · not approved yet");
    expect(html).toContain("Only you can approve it, in PayPal. The assistant cannot, and nothing is held until you do.");
    expect(html).not.toMatch(/pledge (is )?held|you have pledged|pledge made/i);
  });

  it("links to PayPal's own approval page", () => {
    expect(render()).toContain('href="https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T"');
  });

  it("states the terms in the words the campaign page uses", () => {
    expect(render()).toContain("PayPal holds $25. You are charged only if 40 neighbors join by");
  });

  it("points to the signed terms, the proof and the person's private receipt", () => {
    const html = render();
    expect(html).toContain("Signed terms a1b2c3d4e5f6");
    expect(html).toContain('href="/proof/c4f1e2"');
    expect(html).toContain(`https://dayone.test/r/${RECEIPT}`);
  });
});

describe("the limits panel", () => {
  it("asks for limits first when there are none", () => {
    const html = renderToStaticMarkup(<LimitsPanel />);
    expect(html).toContain("What the assistant may prepare for you");
    expect(html).toContain("Set my limits");
    expect(html).toContain("Most for one pledge");
    expect(html).toContain("Most in all");
    expect(html).toContain("Most pledges");
    expect(html).toContain('value="30"');
    expect(html).not.toContain("Keep the ones I have");
  });

  it("offers every kind of place, and the person's own place, as choices", () => {
    const html = renderToStaticMarkup(<LimitsPanel />);
    expect(html.match(/type="checkbox"/g)).toHaveLength(15);
    for (const kind of ["bakery", "cafe", "gym", "bookstore"]) expect(html).toContain(`${kind}</label>`);
    expect(html).toContain("Only places near where I am now");
  });

  it("says who checks the limits", () => {
    const html = renderToStaticMarkup(<LimitsPanel />);
    expect(html).toContain("The server checks every one, not the AI");
  });
});
