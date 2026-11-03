import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { TimelineStep } from "../lib/proof";
import { ProofTimeline } from "./ProofTimeline";

const steps: TimelineStep[] = [
  { id: "pledged", title: "Pledged", detail: "3 pledges approved in PayPal.", state: "done" },
  { id: "held", title: "Held by PayPal", detail: "3 holds placed.", state: "now" },
  { id: "decided", title: "The deadline decides", detail: "On Nov 30.", state: "todo" },
  { id: "paid", title: "Paid out", detail: "Nothing is paid out.", state: "off" },
];

describe("the money's timeline", () => {
  const html = renderToStaticMarkup(<ProofTimeline steps={steps} />);

  it("lists every step in order with what it says", () => {
    expect(html.match(/<li /g)).toHaveLength(4);
    expect(html.indexOf("Pledged")).toBeLessThan(html.indexOf("Held by PayPal"));
    expect(html.indexOf("Held by PayPal")).toBeLessThan(html.indexOf("The deadline decides"));
    expect(html).toContain("3 pledges approved in PayPal.");
    expect(html).toContain("Nothing is paid out.");
  });

  it("marks each step's state for the eye and says it in words for a screen reader", () => {
    for (const state of ["done", "now", "todo", "off"]) expect(html).toContain(`data-state="${state}"`);
    expect(html).toContain("(done)");
    expect(html).toContain("(where it is now)");
    expect(html).toContain("(not yet)");
    expect(html).toContain("(did not happen)");
    expect(html).toContain('<span class="pl-node" aria-hidden="true">');
  });

  it("numbers a step that is still to come, and says needs attention for one that went wrong", () => {
    expect(html).toContain(">3</span>");
    const bad = renderToStaticMarkup(<ProofTimeline steps={[{ id: "paid", title: "Paid out", detail: "It failed.", state: "bad" }]} />);
    expect(bad).toContain("(needs attention)");
  });

  it("stacks the steps when asked to", () => {
    expect(html).toContain('class="proof-line"');
    expect(renderToStaticMarkup(<ProofTimeline steps={steps} stacked />)).toContain('class="proof-line stacked"');
  });
});
