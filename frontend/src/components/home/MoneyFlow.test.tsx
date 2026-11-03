import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MoneyFlow } from "./MoneyFlow";

describe("the money-moving explainer", () => {
  const html = renderToStaticMarkup(<MoneyFlow />);

  it("draws a pledge for each of three neighbors and the four amounts the hold shows", () => {
    expect(html.match(/class="fl-chip"/g)).toHaveLength(3);
    for (const amount of ["$0", "$25", "$50", "$75"]) expect(html).toContain(`>${amount}</text>`);
    expect(html).toContain("Goal: 3 neighbors");
  });

  it("keeps the drawing out of a screen reader's way and says the same in words", () => {
    expect(html).toContain('<svg class="fl-stage"');
    expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
    expect(html).toContain("An example with a goal of 3 neighbors and a $25 pledge.");
    expect(html).toContain("If the goal is met by the deadline, every hold is collected and the owner is paid.");
    expect(html).toContain("every hold is released and nobody is charged");
  });

  it("tells both endings in its captions", () => {
    expect(html).toContain("Goal met by the deadline: every hold is collected and the owner is paid.");
    expect(html).toContain("Goal missed: every hold is released. Nobody is charged.");
  });

  it("can be paused, and starts playing", () => {
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain(">Pause</button>");
    expect(html).not.toContain("data-still");
  });
});
