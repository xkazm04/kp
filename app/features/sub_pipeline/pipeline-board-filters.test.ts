// Compound board filtering + sorting (perfect-board Direction 2) — the composed
// predicate, the within-lane sort, the URL (de)serialization, and the legacy
// saved-view migration are PURE, so they're pinned here under `node --test`.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  QUICK_FILTERS,
  SCORE_BANDS,
  UNATTRIBUTED_SOURCE,
  entryScoreBand,
  entrySource,
  quickPredicate,
  entryMatchesFilters,
  sortFilteredEntries,
  parseQuicksParam,
  parseScoreBandsParam,
  parseSourcesParam,
  parseSortParam,
  serializeQuicks,
  serializeScoreBands,
  serializeSources,
  serializeSort,
  normalizeView,
  setsEqual,
  type QuickFilter,
  type ScoreBandKey,
} from "./pipeline-board-filters.ts";
import { boardSignature } from "./pipeline-render-diet.ts";
import type { Entry } from "./PipelineTypes.ts";

const DAY = 86_400_000;
const NOW = Date.parse("2026-06-01T00:00:00.000Z");

function makeEntry(over: Partial<Entry> = {}): Entry {
  return {
    id: "e1",
    candidateId: "c1",
    candidateLabel: "Ann Novak",
    archetype: "bau",
    roleFamily: "eng",
    jobId: "jd-test",
    jobTitle: "Backend Engineer",
    stage: "Screened",
    matchScore: 72,
    status: "active",
    approvalKind: null,
    approvalDetail: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    stageChangedAt: "2026-05-30T00:00:00.000Z",
    ...over,
  };
}
const set = <T extends string>(...xs: T[]): ReadonlySet<T> => new Set(xs);
const NONE = { quicks: set<QuickFilter>(), scoreBands: set<ScoreBandKey>(), sources: set<string>() };

// --- score band + source facets ---------------------------------------------------

test("entryScoreBand: tracks the canonical scoreTone tiers; null is its own 'unscored' bucket", () => {
  assert.equal(entryScoreBand(makeEntry({ matchScore: 88 })), "strong", "≥75 is strong");
  assert.equal(entryScoreBand(makeEntry({ matchScore: 75 })), "strong", "the 75 cutoff is strong");
  assert.equal(entryScoreBand(makeEntry({ matchScore: 60 })), "mid", "50–74 is mid");
  assert.equal(entryScoreBand(makeEntry({ matchScore: 49 })), "weak", "<50 is weak");
  assert.equal(entryScoreBand(makeEntry({ matchScore: null, canonicalScore: null })), "unscored", "a missing score is unscored, never weak");
});

test("entrySource: the stored channel, or the unattributed sentinel for a null source", () => {
  assert.equal(entrySource(makeEntry({ sourceChannel: "quick-apply" })), "quick-apply");
  assert.equal(entrySource(makeEntry({ sourceChannel: null })), UNATTRIBUTED_SOURCE);
  assert.equal(entrySource(makeEntry({})), UNATTRIBUTED_SOURCE, "absent source ⇒ unattributed");
});

// --- quick predicates -------------------------------------------------------------

test("quickPredicate: aging reuses the render-diet bucket; the rest read plain fields", () => {
  // Screened SLA is 7 days. 8 days in = aging; 6 days = fresh.
  const aged = makeEntry({ stage: "Screened", stageChangedAt: new Date(NOW - 8 * DAY).toISOString() });
  const fresh = makeEntry({ stage: "Screened", stageChangedAt: new Date(NOW - 6 * DAY).toISOString() });
  assert.equal(quickPredicate(aged, "aging", null, NOW), true);
  assert.equal(quickPredicate(fresh, "aging", null, NOW), false);
  assert.equal(quickPredicate(makeEntry({ stage: "Interview" }), "interview", null, NOW), true);
  assert.equal(quickPredicate(makeEntry({ approvalKind: "offer_review", status: "active" }), "awaiting", null, NOW), true);
  assert.equal(quickPredicate(makeEntry({ approvalKind: "offer_review", status: "rejected" }), "awaiting", null, NOW), false);
  assert.equal(quickPredicate(makeEntry({ intakeDegraded: true }), "intake", null, NOW), true);
});

// --- the composed predicate -------------------------------------------------------

test("entryMatchesFilters: quick filters compose with AND (aging AND interview)", () => {
  const c = { query: "", stage: null, ...NONE, quicks: set<QuickFilter>("aging", "interview") };
  const agingInterview = makeEntry({ stage: "Interview", stageChangedAt: new Date(NOW - 9 * DAY).toISOString() }); // Interview SLA 5 → aging
  const agingScreened = makeEntry({ stage: "Screened", stageChangedAt: new Date(NOW - 9 * DAY).toISOString() });
  const freshInterview = makeEntry({ stage: "Interview", stageChangedAt: new Date(NOW - 1 * DAY).toISOString() });
  assert.equal(entryMatchesFilters(agingInterview, c, { now: NOW }), true, "aging AND in Interview passes both");
  assert.equal(entryMatchesFilters(agingScreened, c, { now: NOW }), false, "aging but not Interview fails the AND");
  assert.equal(entryMatchesFilters(freshInterview, c, { now: NOW }), false, "Interview but not aging fails the AND");
});

test("entryMatchesFilters: score bands are OR within the dimension, AND across dimensions", () => {
  const strong = makeEntry({ id: "s", matchScore: 90, sourceChannel: "apply" });
  const mid = makeEntry({ id: "m", matchScore: 60, sourceChannel: "apply" });
  const weak = makeEntry({ id: "w", matchScore: 30, sourceChannel: "boards" });
  const bands = { query: "", stage: null, ...NONE, scoreBands: set<ScoreBandKey>("strong", "mid") };
  assert.equal(entryMatchesFilters(strong, bands, { now: NOW }), true, "strong ∈ {strong,mid}");
  assert.equal(entryMatchesFilters(mid, bands, { now: NOW }), true, "mid ∈ {strong,mid}");
  assert.equal(entryMatchesFilters(weak, bands, { now: NOW }), false, "weak ∉ {strong,mid}");
  // Cross-dimension AND: strong-band AND apply-source.
  const both = { ...bands, sources: set<string>("apply") };
  assert.equal(entryMatchesFilters(strong, both, { now: NOW }), true, "strong AND apply");
  assert.equal(entryMatchesFilters(makeEntry({ matchScore: 90, sourceChannel: "boards" }), both, { now: NOW }), false, "strong but wrong source fails");
});

test("entryMatchesFilters: empty facet sets impose no constraint; query + stage still narrow", () => {
  const e = makeEntry({ candidateLabel: "Zoe Ray", jobTitle: "Backend Engineer", stage: "Offer" });
  assert.equal(entryMatchesFilters(e, { query: "", stage: null, ...NONE }, { now: NOW }), true, "no filters ⇒ everything passes");
  assert.equal(entryMatchesFilters(e, { query: "zoe", stage: null, ...NONE }, { now: NOW }), true, "name query hits");
  assert.equal(entryMatchesFilters(e, { query: "backend", stage: null, ...NONE }, { now: NOW }), true, "role query hits");
  assert.equal(entryMatchesFilters(e, { query: "nobody", stage: null, ...NONE }, { now: NOW }), false, "miss excludes");
  assert.equal(entryMatchesFilters(e, { query: "", stage: "Offer", ...NONE }, { now: NOW }), true, "matching stage passes");
  assert.equal(entryMatchesFilters(e, { query: "", stage: "Screened", ...NONE }, { now: NOW }), false, "other stage excludes");
});

// --- sort + render-diet interplay -------------------------------------------------

test("sortFilteredEntries: insertion is identity; score/age reorder desc with unscored/undated sinking", () => {
  const a = makeEntry({ id: "a", matchScore: 40, stageChangedAt: new Date(NOW - 2 * DAY).toISOString() });
  const b = makeEntry({ id: "b", matchScore: 90, stageChangedAt: new Date(NOW - 10 * DAY).toISOString() });
  const c = makeEntry({ id: "c", matchScore: null, canonicalScore: null, stageChangedAt: null });
  const input = [a, b, c];
  assert.equal(sortFilteredEntries(input, "insertion"), input, "insertion returns the SAME array untouched");
  assert.deepEqual(sortFilteredEntries(input, "score", { now: NOW }).map((e) => e.id), ["b", "a", "c"], "score desc, unscored last");
  assert.deepEqual(sortFilteredEntries(input, "age", { now: NOW }).map((e) => e.id), ["b", "a", "c"], "oldest-in-stage first, undated last");
  // Does not mutate the caller's array.
  assert.deepEqual(input.map((e) => e.id), ["a", "b", "c"], "source array is untouched by a non-trivial sort");
});

test("a sort reorders the array, and boardSignature (content+order) re-renders correctly on the new order", () => {
  const a = makeEntry({ id: "a", matchScore: 40 });
  const b = makeEntry({ id: "b", matchScore: 90 });
  const insertion = sortFilteredEntries([a, b], "insertion");
  const byScore = sortFilteredEntries([a, b], "score", { now: NOW });
  assert.deepEqual(byScore.map((e) => e.id), ["b", "a"], "score sort flips the order");
  // The signature is order-sensitive and content-based, so a reordering yields a
  // DIFFERENT signature — the board re-renders into the sorted order instead of
  // being masked as a no-op by the poll-tick diet.
  assert.notEqual(
    boardSignature(insertion, { now: NOW }),
    boardSignature(byScore, { now: NOW }),
    "the sorted order has a different board signature, so it re-renders"
  );
  // A stable re-sort of an already-sorted list is signature-identical (no churn).
  assert.equal(
    boardSignature(byScore, { now: NOW }),
    boardSignature(sortFilteredEntries([a, b], "score", { now: NOW }), { now: NOW }),
    "re-sorting the same content yields the same signature"
  );
});

// --- URL round-trip ---------------------------------------------------------------

test("quick param: multi CSV round-trips, and a legacy single value hydrates as one element", () => {
  const s = set<QuickFilter>("aging", "interview");
  assert.equal(serializeQuicks(s), "interview,aging", "serialized in canonical order");
  assert.deepEqual([...parseQuicksParam("interview,aging")], ["interview", "aging"]);
  // Legacy single-value deep link (?quick=aging) still lands.
  assert.deepEqual([...parseQuicksParam("aging")], ["aging"]);
  // Junk tokens are dropped, not poison.
  assert.deepEqual([...parseQuicksParam("aging,bogus,interview")], ["aging", "interview"]);
  assert.equal(serializeQuicks(set<QuickFilter>()), null, "empty ⇒ null so the param is dropped");
});

test("score/source/sort params round-trip; empty/default ⇒ null", () => {
  assert.equal(serializeScoreBands(set<ScoreBandKey>("unscored", "strong")), "strong,unscored", "canonical band order");
  assert.deepEqual([...parseScoreBandsParam("strong,unscored")], ["strong", "unscored"]);
  assert.equal(serializeSources(set<string>("apply", "__none__")), "__none__,apply", "sources sorted");
  assert.deepEqual([...parseSourcesParam("apply,__none__")].sort(), ["__none__", "apply"]);
  assert.equal(serializeSort("score"), "score");
  assert.equal(serializeSort("insertion"), null, "the default sort is dropped from the URL");
  assert.equal(parseSortParam("age"), "age");
  assert.equal(parseSortParam("bogus"), "insertion", "an unknown sort falls back to insertion");
  assert.equal(parseSortParam(null), "insertion");
});

// --- legacy saved-view migration --------------------------------------------------

test("normalizeView: a legacy single-quick view (no score/source/sort) hydrates gracefully", () => {
  const legacy = { id: "v1", name: "Aging", query: "novak", quick: "aging" as QuickFilter, stage: "Screened" };
  const n = normalizeView(legacy);
  assert.deepEqual(n.quicks, ["aging"], "legacy single quick becomes a one-element set");
  assert.deepEqual(n.scoreBands, [], "no score facet ⇒ empty");
  assert.deepEqual(n.sources, [], "no source facet ⇒ empty");
  assert.equal(n.sort, "insertion", "absent sort ⇒ default insertion order");
  assert.equal(n.stage, "Screened");
  assert.equal(n.query, "novak");
});

test("normalizeView: a richer view round-trips; a null-quick legacy view is empty", () => {
  const rich = { id: "v2", name: "Hot", query: "", quicks: ["aging", "interview"] as QuickFilter[], score: ["strong"] as ScoreBandKey[], source: ["apply"], sort: "score" as const, stage: null };
  const n = normalizeView(rich);
  assert.deepEqual(n.quicks, ["aging", "interview"]);
  assert.deepEqual(n.scoreBands, ["strong"]);
  assert.deepEqual(n.sources, ["apply"]);
  assert.equal(n.sort, "score");
  // A legacy view saved with quick:null hydrates to no quick filters.
  assert.deepEqual(normalizeView({ id: "v3", name: "x", query: "", quick: null }).quicks, []);
  // Corrupt enum values are dropped on migration.
  assert.deepEqual(normalizeView({ id: "v4", name: "x", query: "", score: ["strong", "bogus"] as ScoreBandKey[] }).scoreBands, ["strong"]);
});

test("setsEqual: order-independent membership check for the active-view match", () => {
  assert.equal(setsEqual(set("aging", "interview"), ["interview", "aging"]), true);
  assert.equal(setsEqual(set("aging"), ["aging", "interview"]), false);
  assert.equal(setsEqual(set<string>(), []), true);
});

test("the canonical value lists are what the params validate against", () => {
  assert.deepEqual([...QUICK_FILTERS], ["interview", "aging", "awaiting", "intake"]);
  assert.deepEqual([...SCORE_BANDS], ["strong", "mid", "weak", "unscored"]);
});
