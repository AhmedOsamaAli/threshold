import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Route } from "../lib/routes";
import { TopBar } from "./TopBar";

const bar = (route: Route) => renderToStaticMarkup(<TopBar route={route} theme="light" onToggleTheme={() => undefined} />);

describe("the top bar", () => {
  const html = bar({ page: "home" });

  it("has the mark, the three tabs, the Start button, the account and the theme, in that order", () => {
    const places = [
      'aria-label="Threshold, home"',
      '<nav class="bar-tabs"',
      'class="bar-start mono"',
      'class="account"',
      'class="theme-toggle"',
    ].map((part) => html.indexOf(part));
    expect(places.every((at) => at >= 0)).toBe(true);
    expect([...places].sort((a, b) => a - b)).toEqual(places);
    expect(html.match(/<nav /g)).toHaveLength(1);
  });

  it("says the whole phrase on the Start button, whatever the screen: the words are not hidden by a class", () => {
    expect(html).toContain(">Start a campaign</a>");
    expect(html).not.toContain("bar-start-more");
    // The visible words are the link's name, so it needs no label of its own that could drift from them.
    expect(html).toMatch(/<a [^>]*class="bar-start mono"[^>]*>Start a campaign<\/a>/);
    expect(html).not.toMatch(/<a [^>]*class="bar-start mono"[^>]*aria-label=/);
  });

  it("opens the page for starting a campaign, and says what it is for", () => {
    expect(html).toMatch(/<a [^>]*class="bar-start mono"[^>]*href="\/start"/);
    expect(html).toContain('title="Open something? Let the neighbors back it"');
  });

  it("marks Start as current only on its own page, and never together with a tab", () => {
    const onStart = bar({ page: "start-campaign" });
    expect(onStart.match(/aria-current="page"/g)).toHaveLength(1);
    expect(onStart).toMatch(/<a [^>]*class="bar-start mono"[^>]*aria-current="page"/);
    expect(html).not.toContain("aria-current");
    const onBrowse = bar({ page: "browse" });
    expect(onBrowse.match(/aria-current="page"/g)).toHaveLength(1);
    expect(onBrowse).not.toMatch(/class="bar-start mono"[^>]*aria-current/);
  });

  it("offers signing in with its words and a person for the screens too narrow for them, the words kept for screen readers", () => {
    expect(html).toContain('class="account-signin mono"');
    expect(html).toMatch(/<svg class="account-signin-icon"[^>]*aria-hidden="true"/);
    expect(html).toContain('<span class="account-signin-text">Sign in</span>');
    // The person is only a picture: the button is named by the words.
    expect(html).not.toMatch(/class="account-signin mono"[^>]*aria-label=/);
  });
});
