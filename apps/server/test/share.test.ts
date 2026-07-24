import { describe, expect, it } from "vitest";
import { meetLink, renderProfileCard, renderSharePage, renderStoryCard, shareSummary, shareUrl, type ShareCardView } from "../src/share.js";
import type { AvatarGenome } from "../src/types.js";

const genome: AvatarGenome = { body: "round", primary: "#8ee3cf", secondary: "#ff8fa3", eyes: "wide", mark: "moon", accessory: "leaf", evolution: 2 };

function view(overrides: Partial<ShareCardView> = {}): ShareCardView {
  return {
    shareToken: "a1b2c3d4e5f6a7b8c9",
    meetRef: "a1b2c3d4e5f6a7b8c9",
    name: "Piko",
    level: 7,
    evolution: 2,
    genome,
    headline: "Piko is level 7 in the Bloopy Network",
    latestStoryTitle: "The door that was not there yesterday",
    ...overrides
  };
}

describe("share cards", () => {
  it("renders the same bytes for the same input", () => {
    expect(renderProfileCard(view())).toBe(renderProfileCard(view()));
    expect(renderStoryCard(view())).toBe(renderStoryCard(view()));
    expect(renderSharePage(view(), "BloopyNetworkBot")).toBe(renderSharePage(view(), "BloopyNetworkBot"));
  });

  it("escapes markup in creature names and story titles", () => {
    const hostile = view({ name: `<script>alert(1)</script>`, latestStoryTitle: `A "quoted" & <b>bold</b> chapter`, headline: `<img src=x onerror=alert(1)>` });
    for (const rendered of [renderProfileCard(hostile), renderStoryCard(hostile), renderSharePage(hostile, "BloopyNetworkBot")]) {
      // The payloads may appear as inert escaped text; what must never appear is a real tag or a
      // quote that could break out of an attribute.
      expect(rendered).not.toContain("<script");
      expect(rendered).not.toContain("<img src=x");
      expect(rendered).not.toContain("<b>bold");
      expect(rendered).toContain("&lt;script&gt;");
      expect(rendered).toContain("&quot;quoted&quot;");
      expect(rendered).toContain("&amp;");
    }
  });

  it("never loads a remote asset or runs a script", () => {
    const page = renderSharePage(view(), "BloopyNetworkBot");
    const cards = renderProfileCard(view()) + renderStoryCard(view());
    expect(page).not.toContain("<script");
    expect(page).not.toContain('rel="stylesheet"');
    // Every fetched subresource must be same-origin; the only absolute URLs are the canonical share
    // URL, the og:image on our own host and the outbound Telegram link the reader chooses to follow.
    for (const [, url] of page.matchAll(/(?:src|href)="([^"]+)"/g)) {
      expect(url.startsWith("/") || url.startsWith("https://t.me/") || url.startsWith("http://localhost:3000")).toBe(true);
    }
    expect(cards).not.toMatch(/(?:href|xlink:href|src)="https?:/);
    // The avatar is inlined rather than referenced, so a card renders with no second request.
    expect(cards).toContain('<svg x="760" y="130" width="370" height="370"');
    expect(cards).not.toMatch(/<svg[^>]*width="[^"]*"[^>]*width=/);
  });

  it("keeps private identifiers out of the card and its metadata", () => {
    const page = renderSharePage(view(), "BloopyNetworkBot");
    const cards = renderProfileCard(view()) + renderStoryCard(view());
    for (const rendered of [page, cards]) {
      expect(rendered).not.toContain("bloopy-424242");
      expect(rendered).not.toContain("telegram_user_id");
      expect(rendered).not.toContain("initData");
    }
    // Story bodies are never published; only the authored title is.
    expect(page).not.toContain("The nest rises and falls");
  });

  it("carries an accessible label and alt text on every visual", () => {
    for (const card of [renderProfileCard(view()), renderStoryCard(view())]) {
      expect(card).toContain('role="img"');
      expect(card).toContain("aria-label=\"Piko, level 7, second evolution");
      expect(card).toContain("<title>");
    }
    expect(renderSharePage(view(), "BloopyNetworkBot")).toContain('alt="Piko, level 7, second evolution"');
  });

  it("produces a text-only fallback that carries the same facts", () => {
    const summary = shareSummary(view());
    expect(summary).toContain("Piko · Level 7 · Second evolution");
    expect(summary).toContain("Latest chapter: The door that was not there yesterday");
    expect(shareSummary(view({ latestStoryTitle: null }))).not.toContain("Latest chapter");
  });

  it("points at the manager bot meet link, falling back to the Mini App", () => {
    expect(meetLink(view(), "BloopyNetworkBot")).toBe("https://t.me/BloopyNetworkBot?start=meet_a1b2c3d4e5f6a7b8c9");
    expect(meetLink(view())).toContain("/?startapp=meet_a1b2c3d4e5f6a7b8c9");
    expect(shareUrl(view())).toMatch(/\/share\/c\/a1b2c3d4e5f6a7b8c9$/);
  });

  it("wraps and truncates a long story title without overflowing the card", () => {
    const long = view({ latestStoryTitle: "A chapter with an extremely long authored title that keeps going well past anything a card could reasonably hold in three lines of type" });
    const card = renderStoryCard(long);
    const titleRows = [...card.matchAll(/font-size="52"/g)];
    expect(titleRows.length).toBeLessThanOrEqual(3);
    expect(card).toContain("</svg>");
  });

  it("still renders a card for a creature with no story yet", () => {
    const blank = renderStoryCard(view({ latestStoryTitle: null }));
    // The placeholder wraps across title rows, so assert on the words rather than the whole phrase.
    expect(blank).toContain("A quiet chapter, not yet");
    expect(blank).toContain("written down");
    expect(renderSharePage(view({ latestStoryTitle: null }), "BloopyNetworkBot")).toContain("profile.svg");
  });
});
