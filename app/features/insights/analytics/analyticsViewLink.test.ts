// UAT 2026-08-17-analytics-sections, finding TOM-ANA-8 (convergent with KAT-ANA-9)
// — the link a reader hands their VP must land them on the view the reader is on.
//
// The half that already worked is the READING half: an incoming
// /?tab=analytics&sec=quality&win=30 is adopted by the URL inbox's lazy initializer
// and then, deliberately, erased from the address bar. So the address bar was never
// going to be the share artifact, and the fix is a minted link rather than a change
// to the inbox (which is what keeps a deep link from bouncing back to Overview one
// render after it lands).
//
// This file pins the contract where the two halves meet: what `analyticsViewUrl`
// emits is fed to the REAL readers — `resolveTabParam`, `resolveAnalyticsSection`,
// and the tab's own `?win=` parse, asserted against its source — so a rename on
// either side breaks here rather than on a colleague's screen.
//
// Runner: `npm run test:unit` (node --test, process-isolated, type stripping).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_TAB, resolveTabParam } from "@/app/features/shell/tabs";
import { analyticsViewUrl } from "./analyticsViewLink.ts";
import { WINDOW_CHOICES } from "./AnalyticsTypes.ts";
import { ANALYTICS_SECTION_IDS, resolveAnalyticsSection } from "./sections/analyticsSections.ts";

const ORIGIN = "https://kp.example.com";

const parse = (url: string) => new URL(url);

test("the minted link names its destination, its section and its window", () => {
  assert.equal(
    analyticsViewUrl({ origin: ORIGIN, section: "quality", days: 30 }),
    `${ORIGIN}/?tab=analytics&sec=quality&win=30`,
    "the exact string a reader pastes into a chat"
  );
  // Absolute, not the "/?…" the app navigates with: a relative href pasted into a
  // message is not a link at all, which is the shape of the original complaint.
  assert.ok(analyticsViewUrl({ origin: ORIGIN, section: "performance", days: null }).startsWith("https://"));
  // A trailing slash on the origin must not double up.
  assert.equal(
    analyticsViewUrl({ origin: `${ORIGIN}/`, section: "economics", days: 90 }),
    `${ORIGIN}/?tab=analytics&sec=economics&win=90`
  );
});

test("all time is written as the ABSENCE of a window, never as a value", () => {
  const url = parse(analyticsViewUrl({ origin: ORIGIN, section: "performance", days: null }));
  assert.equal(url.searchParams.has("win"), false, "an all-time link must not invent a window the switcher does not have");
  // …and the tab reads a missing ?win= as all time, which is what closes the loop.
  assert.equal(WINDOW_CHOICES[0], null, "all time is the first (default) window choice");
});

test("every section mints a link the real resolvers land", () => {
  for (const section of ANALYTICS_SECTION_IDS) {
    for (const days of WINDOW_CHOICES) {
      const url = parse(analyticsViewUrl({ origin: ORIGIN, section, days }));
      // The tab: `?tab=analytics` survives composition. buildUrl used to delete a
      // tab equal to DEFAULT_TAB — analytics is not the default, but assert the
      // param is present rather than assuming, since that deletion is exactly the
      // bug TOM-ANA-1 filed one layer down.
      assert.equal(url.searchParams.get("tab"), "analytics");
      assert.equal(resolveTabParam(url.searchParams.get("tab")), "analytics");
      assert.notEqual(resolveTabParam(url.searchParams.get("tab")), DEFAULT_TAB, "a link that resolves to Overview is the defect, not the fix");
      // The section: round-trips through the same resolver the tab uses at mount.
      assert.equal(resolveAnalyticsSection(url.searchParams.get("sec")), section);
      // The window: whatever was in force, and nothing else.
      assert.equal(url.searchParams.get("win"), days == null ? null : String(days));
    }
  }
});

test("the link carries the view and nothing else", () => {
  // Composed off an EMPTY query string, so a recipient never inherits the sender's
  // candidate selection or board filter. If this ever composes off the live search
  // string, a shared link starts leaking whatever the sender had open.
  const url = parse(analyticsViewUrl({ origin: ORIGIN, section: "quality", days: 30 }));
  assert.deepEqual([...url.searchParams.keys()], ["tab", "sec", "win"]);
  const src = readFileSync(fileURLToPath(new URL("./analyticsViewLink.ts", import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
  assert.match(src, /\}\s*,\s*""\s*\)/, "analyticsViewUrl must compose against an empty query string, not the current one");
});

test("the window value the link mints is one the tab actually parses", () => {
  // Pinned against the writer rather than a paraphrase: AnalyticsTab turns `?win=`
  // back into a number with an inline literal comparison, so a new window choice
  // that is not added there would mint links that silently fall back to all time.
  const tab = readFileSync(fileURLToPath(new URL("./AnalyticsTab.tsx", import.meta.url)), "utf8");
  assert.match(tab, /search\.get\("win"\)/, "AnalyticsTab must still read ?win= from the URL");
  for (const days of WINDOW_CHOICES) {
    if (days == null) continue;
    assert.ok(
      tab.includes(`winParam === "${days}"`),
      `AnalyticsTab does not parse ?win=${days}, so a link minted for that window would land on all time`
    );
  }
});
