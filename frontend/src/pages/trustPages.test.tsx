import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AskPage } from "./AskPage";
import { HomePage } from "./HomePage";
import { ProofPage } from "./ProofPage";
import { SpotPage } from "./SpotPage";

describe("the home page", () => {
  const html = renderToStaticMarkup(<HomePage />);

  it("says what the product is and how a pledge works", () => {
    expect(html).toContain("Neighbors back the place before it opens");
    expect(html).toContain("PayPal only holds the money");
    expect(html).toContain("If not, every hold is released and nobody pays.");
    expect(html).toContain("Neighbors pledge");
    expect(html).toContain("PayPal holds it");
    expect(html).toContain("The deadline decides");
  });

  it("shows the money moving and one open campaign, in a section that waits for it", () => {
    expect(html).toContain("How the money moves");
    expect(html).toContain("Open for pledges right now");
    expect(html).toContain("Looking for an open campaign");
  });

  it("shows the proof of a real test run, and links to it", () => {
    expect(html).toContain("A real test run · its proof page");
    expect(html).toContain("$15 collected from 3 neighbors.");
    expect(html).toContain("$13.02 paid to the owner. PayPal&#x27;s batch agrees.");
    expect(html).toContain('href="/proof/a539c2daddc34db8"');
  });

  it("opens the ways in", () => {
    for (const href of ["/browse", "/ask", "/spot", "/start"]) expect(html).toContain(`href="${href}"`);
  });

  it("says the assistant only prepares, and that the money is test money", () => {
    expect(html).toContain("An assistant that cannot spend your money");
    expect(html).toContain("you approve each pledge yourself, in");
    expect(html).toContain("Test money only (PayPal sandbox)");
  });
});

describe("the Ask page", () => {
  const html = renderToStaticMarkup(<AskPage />);

  it("puts the limits above the conversation, where the assistant's own replies point", () => {
    expect(html.indexOf("What the assistant may prepare for you")).toBeGreaterThan(-1);
    expect(html.indexOf("What the assistant may prepare for you")).toBeLessThan(html.indexOf("Conversation with the assistant"));
  });

  it("says who sets, checks and approves", () => {
    expect(html).toContain("Sets the limits");
    expect(html).toContain("not the AI");
    expect(html).toContain("You, in PayPal");
  });

  it("offers things to try, and a box that takes what the server takes", () => {
    expect(html).toContain("What is open for pledges right now?");
    expect(html).toContain('maxLength="600"');
    expect(html).toContain("Your message to the assistant");
  });
});

describe("the proof page", () => {
  it("says it is checking, then gives a way to check again", () => {
    const html = renderToStaticMarkup(<ProofPage id="c4f1e2" />);
    expect(html).toContain("Checking the record with PayPal…");
    expect(html).toContain("Check again");
    expect(html).toContain("It is not taken on our word.");
  });
});

describe("the Check a spot page", () => {
  const html = renderToStaticMarkup(<SpotPage />);

  it("asks for an address and a kind, and offers places to try", () => {
    expect(html).toContain("Address, neighborhood or city");
    expect(html).toContain("Kind of business");
    expect(html.match(/<option/g)).toHaveLength(14);
    expect(html).toContain("cafe · Zamalek, Cairo");
  });

  it("says what it does not show", () => {
    expect(html).toContain("never what people want");
  });
});
