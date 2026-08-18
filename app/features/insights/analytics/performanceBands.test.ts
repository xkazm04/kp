// UAT 2026-08-17-analytics-sections, finding TOM-ANA-12 — no band may claim more
// than its own evidence supports.
//
// The defect was a CLASS, not two instances. The Briefing opens by stating its own
// rule ("if the data can't support a claim, the band says so plainly instead of
// rendering an inconclusive chart"); bands 1 and 2 implemented it by hand inside
// their `claim` expression and bands 3 and 4 simply did not, so an empty tenant read
// „Které role táhnou pipeline." in display type directly above the tab's first-run
// empty-state hero. Fixing the two would have left the next band free to reintroduce
// it, which is what this file exists to prevent.
//
// The mechanism it pins:
//   • BAND_NO_DATA_CLAIMS is a TOTAL table and BandKey is derived from it, so a band
//     cannot be typed into existence without a no-data claim;
//   • every <Band> in the Briefing declares `bandKey` and `hasData`, and `hasData`
//     may not be a literal — a band that hardcodes `true` is the same lie with extra
//     steps;
//   • the two conditions the finding named are the SAME predicates their panels use
//     for their own zero states, so the heading and the figure under it cannot
//     disagree.
//
// Source-level, like analyticsRenderMap / analyticsWindowScope: there is no DOM test
// layer in this repo, and .tsx components import through the "@/…" alias, so the
// invariant is asserted over the writer's own comment-stripped source.
//
// Runner: `npm run test:unit` (node --test, process-isolated, type stripping).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BAND_NO_DATA_CLAIMS, MOMENTUM_SERIES_KEYS, hasRoleRows, momentumIsQuiet } from "./performanceBands.ts";

/** Source with comments removed — otherwise the prose EXPLAINING an invariant would
 *  satisfy the assertion that checks it. */
function source(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

const BRIEFING = source("./sections/PerformanceBriefing.tsx");

/** Every `<Band …>` opening tag's prop block. `=>` is allowed through so an arrow
 *  function in a prop cannot be mistaken for the end of the tag. */
const bandTags = [...BRIEFING.matchAll(/<Band\b((?:=>|[^>])*?)>/g)].map((m) => m[1]);

// ---------------------------------------------------------------------------
// The table.
// ---------------------------------------------------------------------------

test("every band in the vocabulary declares a distinct no-data claim", () => {
  const entries = Object.entries(BAND_NO_DATA_CLAIMS);
  assert.ok(entries.length >= 4, `the band table holds ${entries.length} bands; the Briefing renders four`);
  for (const [band, key] of entries) {
    assert.ok(key.length > 0, `band "${band}" declares an empty no-data claim key`);
  }
  const keys = entries.map(([, key]) => key);
  assert.equal(new Set(keys).size, keys.length, `two bands share a no-data claim: ${keys.join(", ")} — each states its own absence`);
});

// ---------------------------------------------------------------------------
// The render path.
// ---------------------------------------------------------------------------

test("every <Band> the Briefing renders names a band and a condition", () => {
  assert.equal(
    bandTags.length,
    Object.keys(BAND_NO_DATA_CLAIMS).length,
    `the Briefing renders ${bandTags.length} bands and BAND_NO_DATA_CLAIMS declares ${Object.keys(BAND_NO_DATA_CLAIMS).length}. ` +
      "A band without a table entry has no sentence for its empty state; a table entry no band renders is dead copy."
  );
  for (const tag of bandTags) {
    const named = tag.match(/bandKey="([^"]+)"/);
    assert.ok(named, `a <Band> is rendered without a bandKey: ${tag.trim().slice(0, 80)}…`);
    assert.ok(
      named![1] in BAND_NO_DATA_CLAIMS,
      `<Band bandKey="${named![1]}"> is not in BAND_NO_DATA_CLAIMS — add its no-data claim there, that is the whole contract`
    );
    assert.match(
      tag,
      /hasData=\{/,
      `<Band bandKey="${named![1]}"> renders an unconditional claim. Give it the condition its own panel uses for its zero state.`
    );
    // The cheat this closes: a band can satisfy the prop and still assert whatever
    // it likes. `hasData={true}` is the unconditional claim wearing a costume.
    assert.doesNotMatch(
      tag,
      /hasData=\{\s*(?:true|false)\s*\}/,
      `<Band bandKey="${named![1]}"> hardcodes hasData. It must be resolved from the payload, not asserted.`
    );
  }
  const rendered = bandTags.map((tag) => tag.match(/bandKey="([^"]+)"/)![1]).sort();
  assert.deepEqual(rendered, Object.keys(BAND_NO_DATA_CLAIMS).sort(), "the rendered bands and the declared bands must be the same set");
});

test("Band resolves the fallback from the key rather than trusting the call site", () => {
  assert.match(
    BRIEFING,
    /hasData\s*\?\s*claim\s*:\s*t\(BAND_NO_DATA_CLAIMS\[bandKey\]\)/,
    "Band no longer selects its headline from the band table — a call site could then pass any sentence it liked for the empty state"
  );
  // The panels stay on screen when the claim falls back: they carry the honest
  // zero states (momentumEmpty, AnalyticsEmptyPreview with its two CTAs), and an
  // empty workspace needs those more than a full one does.
  assert.match(BRIEFING, /\{children \? <div className="mt-5">\{children\}<\/div> : null\}/, "Band must keep rendering its evidence in the no-data state");
});

test("the two bands the finding named read their panels' own conditions", () => {
  // The real fix, and the reason it cannot rot: there is one predicate per question,
  // imported by both the heading and the thing the heading is about.
  assert.match(BRIEFING, /hasData=\{!momentumIsQuiet\(data\.momentum\)\}/, "the momentum band must ask momentumIsQuiet");
  assert.match(BRIEFING, /hasData=\{hasRoleRows\(data\.byJob\)\}/, "the roles band must ask hasRoleRows");
  assert.match(
    source("./AnalyticsMomentumPanel.tsx"),
    /momentumIsQuiet\(weeks\)/,
    "MomentumPanel must decide its quiet branch with the shared predicate, or the heading and the chart can drift apart again"
  );
  assert.match(
    source("./AnalyticsByRoleTable.tsx"),
    /hasRoleRows\(data\.byJob\)/,
    "AnalyticsByRoleTable must decide its empty hero with the shared predicate"
  );
});

// ---------------------------------------------------------------------------
// The predicates, pure.
// ---------------------------------------------------------------------------

const week = (over: Partial<Record<(typeof MOMENTUM_SERIES_KEYS)[number], number>> = {}) => ({
  weekStart: "2026-08-10",
  added: 0,
  advanced: 0,
  rejected: 0,
  hired: 0,
  ...over,
});

test("momentumIsQuiet: quiet means every counted series is zero in every week", () => {
  assert.equal(momentumIsQuiet([week(), week(), week()]), true);
  assert.equal(momentumIsQuiet([]), true, "no weeks is nothing to claim about either");
  for (const key of MOMENTUM_SERIES_KEYS) {
    assert.equal(momentumIsQuiet([week(), week({ [key]: 1 })]), false, `one ${key} in one week is movement`);
  }
});

test("hasRoleRows: the table has something to be a heading for", () => {
  assert.equal(hasRoleRows([]), false);
  assert.equal(hasRoleRows([{ jobTitle: "Backend Engineer" }]), true);
});
