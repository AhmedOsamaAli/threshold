import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Campaign } from "../../api/founders";
import type { PosterCampaign, PosterInput } from "../../lib/poster";
import { brandForPoster, DEFAULT_POSTER_APPEARANCE } from "../../lib/posterBrand";
import { posterForCampaign } from "../../lib/posterProject";
import { PosterArt, posterLinkProblem } from "./PosterArt";

const poster: PosterInput = {
  name: "Pulse Community Gym", tagline: "Strength, cardio and recovery.", location: "East Austin",
  identity: { kind: "Gym", keywords: ["Do Not Print This Artist Name"] },
};
const campaign: PosterCampaign = {
  id: "c1", amount: "25.00", goal: 40, deadline: "2026-11-20T20:00:00Z", accepting: true,
  perks: ["10% off your membership for the first year", "Your name on the founders' wall", "An invitation to the opening"],
};
const LINK = "https://threshold-pledge.pages.dev/p/c1";
const visibleWords = (html: string) => [...html.matchAll(/<text\b[^>]*>(.*?)<\/text>/g)].map((match) => match[1]).join(" ");

describe("the campaign poster", () => {
  it("makes the actual founding-supporter benefit the headline and prints all the remaining perks", () => {
    const html = renderToStaticMarkup(<PosterArt poster={poster} campaign={campaign} sandbox link={LINK} />);
    const printed = visibleWords(html);
    expect(printed).toContain("10% off your membership");
    expect(printed).toContain("founders&#x27; wall");
    expect(printed).toContain("An invitation to the opening");
    expect(html.indexOf("AS A FOUNDER, YOU GET")).toBeLessThan(html.indexOf("THE PLEDGE"));
    expect(printed).toContain("Demo payments — no real money.");
    expect(printed).toContain("PayPal holds $25.");
    expect(printed).toContain("otherwise the hold is released.");
    expect(printed).toContain("SCAN TO JOIN");
    expect(html).not.toContain("Do Not Print This Artist Name");
  });

  it("prints the QR code with its quiet zone, at the campaign's public page", () => {
    const html = renderToStaticMarkup(<PosterArt poster={poster} campaign={campaign} link={LINK} />);
    expect(html).toContain('data-poster-qr-frame="true"');
    expect(html).toContain('data-qr-quiet-modules="5"');
    expect(html).toContain('shape-rendering="crispEdges"');
    expect(html).toContain('fill="#111111"');
    expect(visibleWords(html)).toContain("threshold-pledge.pages.dev/p/c1");
    expect(html).toContain('data-poster-problem=""');
  });

  describe("posters for newly described businesses, not hardcoded showcase projects", () => {
    it.each([
      { id: "fresh-cedar", name: "Cedar Loop Studio", kind: "studio", summary: "Small-group ceramics and wheel-throwing classes.",
        perk: "An invitation to the studio preview", amount: "20.00", goal: 5, direction: "workshop" },
      { id: "fresh-juniper", name: "Juniper Steps Gym", kind: "gym", summary: "Strength and recovery for small training groups.",
        perk: "10% off membership for the first year", amount: "30.00", goal: 4, direction: "kinetic" },
      { id: "fresh-paper", name: "Paper Lantern Books", kind: "bookstore", summary: "Independent books and neighborhood reading groups.",
        perk: "An invitation to the first book-club evening", amount: "15.00", goal: 6, direction: "editorial" },
    ])("builds $name from its own name, description, perk and terms", (project) => {
      const record: Campaign = {
        id: project.id, status: "open", accepting: true,
        name: project.name, place: { label: "East Austin, Texas", lat: 30.26, lon: -97.72, area: "" },
        concept: { genre: project.kind, summary: project.summary }, evidence: [],
        title: `Help open ${project.name}`, pitch: project.summary, perks: [project.perk],
        how_it_works: "The owner's terms.", amount: project.amount, currency: "USD", goal: project.goal,
        deadline: "2026-11-20T20:00:00Z", closed_at: null,
        progress: { supporters: 0, goal: project.goal, remaining: project.goal, percent: 0, total: "0.00", funded: false },
        is_owner: true,
      };
      const adapted = posterForCampaign(record);
      const brand = brandForPoster(adapted, DEFAULT_POSTER_APPEARANCE);
      const html = renderToStaticMarkup(<PosterArt poster={adapted} campaign={record} sandbox
        link={`https://threshold-pledge.pages.dev/p/${record.id}`} />);
      const printed = visibleWords(html);
      expect(brand.direction).toBe(project.direction);
      expect(printed).toContain(brand.face === "sans" ? project.name.toUpperCase() : project.name);
      expect(printed).toContain(project.perk);
      expect(printed).toContain(`$${Number(project.amount)}`);
      expect(printed).toContain(`${project.goal} neighbors join`);
      expect(printed).toContain(`threshold-pledge.pages.dev/p/${project.id}`);
      expect(html).toContain('data-poster-problem=""');
      expect(html).toContain('data-qr-quiet-modules="5"');
      expect(printed).not.toContain("Pulse Community Gym");
    });
  });

  it("never draws a book for a pastry business, even with an editorial palette", () => {
    const pastry: PosterInput = { ...poster, name: "The Daily Grind", tagline: null,
      identity: { kind: "Patisserie", keywords: ["coffee"] } };
    const html = renderToStaticMarkup(<PosterArt poster={pastry} campaign={campaign} link={LINK} />);
    expect(html).toContain('data-poster-subject="pastry"');
    expect(html).toContain('data-art="pastry"');
    const unknown = renderToStaticMarkup(<PosterArt poster={{ ...pastry, identity: { kind: "Other", keywords: [] },
      name: "Common Ground" }} campaign={campaign} link={LINK} />);
    expect(unknown).toContain('data-art="abstract"');
    expect(unknown).not.toContain('data-poster-subject="books"');
  });

  it("gives a different business a different art direction, not only a different name", () => {
    const html = renderToStaticMarkup(<PosterArt poster={poster} campaign={campaign} link={LINK} />);
    expect(html).toContain('data-direction="kinetic"');
  });

  it("can lead with a different actual perk without hiding the others", () => {
    const html = renderToStaticMarkup(<PosterArt poster={poster} campaign={campaign} sandbox
      appearance={{ choice: "auto", leadPerk: campaign.perks[2] }} link={LINK} />);
    const printed = visibleWords(html);
    expect(printed.indexOf("An invitation to the opening")).toBeLessThan(printed.indexOf("10% off"));
    expect(printed).toContain("founders&#x27; wall");
  });

  it("will not export a lead perk that the campaign does not have, or a campaign without perks", () => {
    const invented = renderToStaticMarkup(<PosterArt poster={poster} campaign={campaign}
      appearance={{ choice: "auto", leadPerk: "Free coffee for life" }} link={LINK} />);
    expect(invented).toContain('data-poster-problem="The chosen headline perk is not in this campaign.');
    const bare = renderToStaticMarkup(<PosterArt poster={poster} campaign={{ ...campaign, perks: [] }} link={LINK} />);
    expect(bare).toContain('data-poster-problem="Campaign perks are missing.');
  });

  it("never solicits new pledges for a closed campaign", () => {
    const html = renderToStaticMarkup(<PosterArt poster={poster} campaign={{ ...campaign, accepting: false }} sandbox link={LINK} />);
    expect(html).toContain("SCAN FOR STATUS");
    expect(html).toContain("no longer taking pledges");
    expect(visibleWords(html)).toContain("Original terms:");
    expect(visibleWords(html)).toContain("PayPal holds $25.");
    expect(html).not.toContain("SCAN TO JOIN");
    expect(html).not.toContain("BECOME A FOUNDING SUPPORTER");
  });

  it("rejects private receipts, credentials and individual approval links as public QR destinations", () => {
    for (const link of [`https://threshold-pledge.pages.dev/r/${"x".repeat(32)}`, "https://user:pass@example.com/",
      "https://www.sandbox.paypal.com/checkoutnow?token=buyer", "javascript:alert(1)", "not a link"]) {
      expect(posterLinkProblem(link)).not.toBeNull();
    }
    expect(posterLinkProblem("https://example.com/business")).toBeNull();
    expect(posterLinkProblem(LINK)).toBeNull();
  });
});
