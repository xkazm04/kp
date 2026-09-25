import { test } from "node:test";
import assert from "node:assert/strict";
import type { JobseekerPostingSummary } from "@/app/_lib/jobseeker/types";
import { PROVENANCE } from "@/app/_lib/taxonomy.generated";
import { applyDirection, deriveSieve, directionFilterOn, directionOf, EMPTY_FILTER, filterScored, firstGate, inDirection, initialsOf, isFilterActive, liftSkills, provenanceOf, replacedScore, sourceIsOn } from "./sieveModel";

// The sieve's numbers are DERIVED from the rows; these pin the placements the page draws
// and the honesty rules the marks encode.

function row(id: string, over: Partial<JobseekerPostingSummary> = {}): JobseekerPostingSummary {
  return {
    id,
    sourceId: "src-on",
    externalKey: id,
    url: `https://example.invalid/${id}`,
    title: `Posting ${id}`,
    company: "Acme",
    location: "Brno",
    country: "cz",
    workMode: "hybrid",
    postedAt: "2026-09-20T09:00:00Z",
    salaryMin: null,
    salaryMax: null,
    salaryCurrency: null,
    salaryPeriod: null,
    jobSource: "deterministic",
    matchTotal: null,
    fitTier: null,
    matchVersion: "v",
    matchedAt: "2026-09-21T09:00:00Z",
    status: "new",
    dismissReason: null,
    dismissNote: null,
    appliedAt: null,
    firstSeenAt: "2026-09-21T09:00:00Z",
    lastSeenAt: "2026-09-24T09:00:00Z",
    goneAt: null,
    bodyChars: 100,
    eligibility: [],
    confidence: null,
    blockedBy: [],
    blockedDetails: [],
    asIfTotal: null,
    matchedSkills: [],
    missingSkills: [],
    deepDived: false,
    previousTotal: null,
    reasoningStale: false,
    targetAlignment: null,
    ...over,
  };
}

const ON = { id: "src-on", enabled: true, pausedReason: null };
const OFF = { id: "src-off", enabled: false, pausedReason: null };
const PAUSED = { id: "src-paused", enabled: true, pausedReason: "blocked" as const };

test("a source feeds the sieve only while enabled and not paused", () => {
  assert.equal(sourceIsOn(ON), true);
  assert.equal(sourceIsOn(OFF), false);
  assert.equal(sourceIsOn(PAUSED), false);
  assert.equal(sourceIsOn(undefined), false);
});

test("every posting lands in exactly one place: held, gated, waiting or scored", () => {
  const rows = [
    row("held", { sourceId: "src-off", matchTotal: 90, fitTier: "strong" }),
    row("paused", { sourceId: "src-paused", matchTotal: 80, fitTier: "strong" }),
    row("gated", { blockedBy: ["work_mode"], asIfTotal: 71 }),
    row("waiting"),
    row("a", { matchTotal: 70, fitTier: "promising", confidence: { low: 60, high: 80, level: "moderate" } }),
    row("b", { matchTotal: 70, fitTier: "promising", confidence: { low: 66, high: 74, level: "tight" } }),
  ];
  const f = deriveSieve(rows, [ON, OFF, PAUSED]);
  assert.deepEqual(f.held.map((r) => r.id).sort(), ["held", "paused"]);
  assert.deepEqual(f.gated.map((r) => r.id), ["gated"]);
  assert.deepEqual(f.waiting.map((r) => r.id), ["waiting"]);
  // Equal totals: the tighter band (the surer score) ranks first.
  assert.deepEqual(f.scored.map((r) => r.id), ["b", "a"]);
  assert.equal(f.rank.b, 1);
  assert.equal(f.held.length + f.gated.length + f.waiting.length + f.scored.length, rows.length);
});

test("a gated posting is never ranked, whatever its as-if score", () => {
  const f = deriveSieve([row("g", { blockedBy: ["seniority"], asIfTotal: 99 }), row("s", { matchTotal: 10, fitTier: "partial" })], [ON]);
  assert.deepEqual(f.scored.map((r) => r.id), ["s"]);
  assert.equal(f.rank.g, undefined);
});

test("a decision moves the numbers: open, top five and decided are re-derived", () => {
  const rows = [1, 2, 3, 4, 5, 6].map((i) => row(`p${i}`, { matchTotal: 90 - i, fitTier: i < 3 ? "strong" : "promising" }));
  const before = deriveSieve(rows, [ON]);
  assert.deepEqual(before.top5.map((r) => r.id), ["p1", "p2", "p3", "p4", "p5"]);
  assert.equal(before.decided, 0);
  const after = deriveSieve(rows.map((r) => (r.id === "p1" ? { ...r, status: "applied" as const } : r)), [ON]);
  assert.deepEqual(after.top5.map((r) => r.id), ["p2", "p3", "p4", "p5", "p6"]);
  assert.equal(after.decided, 1);
  assert.equal(after.byDecision.applied, 1);
  assert.equal(after.strong, 1);
});

test("gates stack most-catching first, and a two-gate posting is drawn on the first", () => {
  const rows = [
    row("x", { blockedBy: ["language"] }),
    row("y", { blockedBy: ["work_mode"] }),
    row("z", { blockedBy: ["work_mode", "language"] }),
    row("w", { blockedBy: ["work_mode"] }),
  ];
  const f = deriveSieve(rows, [ON]);
  assert.deepEqual(f.gateKeys, ["work_mode", "language"]);
  assert.equal(firstGate(rows[2]!, f.gateKeys), "work_mode");
  assert.equal(f.gateCounts.language, 2);
});

test("lift skills count what is missing across the best open postings", () => {
  const open = [row("a", { missingSkills: ["Git", "Docker"] }), row("b", { missingSkills: ["Git"] }), row("c", { missingSkills: ["Kafka"] })];
  const lift = liftSkills(open, 20, 2);
  assert.equal(lift.pool, 3);
  assert.deepEqual(lift.list, [
    { skill: "Git", count: 2 },
    { skill: "Docker", count: 1 },
  ]);
});

test("the list filters by range, tier, mode, status and a search over skills", () => {
  const scored = [
    row("a", { matchTotal: 90, fitTier: "strong", workMode: "remote", matchedSkills: [{ skill: "React", provenance: "professional" }] }),
    row("b", { matchTotal: 80, fitTier: "promising", workMode: "hybrid", status: "shortlisted" }),
    row("c", { matchTotal: 70, fitTier: "partial", workMode: "onsite", missingSkills: ["Kafka"] }),
  ];
  assert.equal(isFilterActive(EMPTY_FILTER), false);
  assert.deepEqual(filterScored(scored, { ...EMPTY_FILTER, brush: [1, 2] }).map((r) => r.id), ["b", "c"]);
  assert.deepEqual(filterScored(scored, { ...EMPTY_FILTER, tiers: ["strong"] }).map((r) => r.id), ["a"]);
  assert.deepEqual(filterScored(scored, { ...EMPTY_FILTER, modes: ["onsite"] }).map((r) => r.id), ["c"]);
  assert.deepEqual(filterScored(scored, { ...EMPTY_FILTER, status: "shortlisted" }).map((r) => r.id), ["b"]);
  assert.deepEqual(filterScored(scored, { ...EMPTY_FILTER, q: "react" }).map((r) => r.id), ["a"]);
  assert.deepEqual(filterScored(scored, { ...EMPTY_FILTER, q: "kafka" }).map((r) => r.id), ["c"]);
});

test("a claim nobody backed is drawn as stated, never as checked", () => {
  assert.equal(provenanceOf("professional").mark, "solid");
  assert.equal(provenanceOf("personal_project").mark, "half");
  assert.equal(provenanceOf("coursework").mark, "ring");
  assert.equal(provenanceOf("self_declared").stated, true);
  assert.equal(provenanceOf(null).stated, true);
  assert.equal(provenanceOf("something_new").stated, true);
});

test("every provenance the taxonomy defines has a mark, and only self_declared reads as stated", () => {
  for (const value of PROVENANCE) {
    assert.equal(provenanceOf(value).stated, value === "self_declared", value);
  }
});

test("initials read two words, and say ? for no name", () => {
  assert.equal(initialsOf("Aneta Veselá"), "AV");
  assert.equal(initialsOf("  "), "?");
  assert.equal(initialsOf(null), "?");
});

test("a posting's direction reads the matcher's alignment, and an absent field is null", () => {
  const ta = (over: Record<string, unknown>) => ({ targetAlignment: { targetFamilies: [], ...over } as unknown as JobseekerPostingSummary["targetAlignment"] });
  assert.deepEqual(directionOf(ta({ state: "target", matchedTitle: "AI Engineer" })), { state: "target", title: "AI Engineer" });
  // The wire drops empty fields: a missing matchedTitle / pastFamily is "not named".
  assert.deepEqual(directionOf(ta({ state: "target" })), { state: "target", title: null });
  assert.deepEqual(directionOf(ta({ state: "family" })), { state: "family" });
  assert.deepEqual(directionOf(ta({ state: "past", pastFamily: "data_ai" })), { state: "past", family: "data_ai" });
  assert.deepEqual(directionOf(ta({ state: "past", pastFamily: "  " })), { state: "past", family: null });
  assert.equal(directionOf(ta({ state: "none" })), null);
  assert.equal(directionOf(ta({ state: "sideways" })), null);
  assert.equal(directionOf({ targetAlignment: null }), null);
});

test("only a target title or a target family is in the direction; the past is not", () => {
  const at = (state: string) => row(state, { targetAlignment: { state, matchedTitle: null, targetFamilies: [], pastFamily: null } as JobseekerPostingSummary["targetAlignment"] });
  assert.equal(inDirection(at("target")), true);
  assert.equal(inDirection(at("family")), true);
  assert.equal(inDirection(at("past")), false);
  assert.equal(inDirection(at("none")), false);
  assert.equal(inDirection(row("unmatched")), false);
});

test("the direction filter defaults on only with a stated title and something to keep", () => {
  const onWay = row("t", { targetAlignment: { state: "target", matchedTitle: "AI Engineer", targetFamilies: ["data_ai"], pastFamily: null } });
  const past = row("p", { targetAlignment: { state: "past", matchedTitle: null, targetFamilies: ["data_ai"], pastFamily: "business_analysis" } });
  assert.equal(directionFilterOn(null, 1, [onWay, past]), true);
  assert.equal(directionFilterOn(null, 0, [onWay, past]), false);
  // Nothing in the direction: the filter would hide everything, so it does not exist.
  assert.equal(directionFilterOn(null, 2, [past]), false);
  assert.equal(directionFilterOn(true, 2, [past]), false);
  // The seeker's own choice wins over the default.
  assert.equal(directionFilterOn(false, 1, [onWay]), false);
  assert.equal(directionFilterOn(true, 0, [onWay]), true);
  assert.deepEqual(applyDirection([onWay, past, row("x")], true), { rows: [onWay], hidden: 2 });
  assert.deepEqual(applyDirection([onWay, past], false), { rows: [onWay, past], hidden: 0 });
});

test("a replaced score is said only when the deep-dive moved it", () => {
  assert.equal(replacedScore({ previousTotal: 71, matchTotal: 39 }), 71);
  assert.equal(replacedScore({ previousTotal: 39, matchTotal: 39 }), null);
  assert.equal(replacedScore({ previousTotal: null, matchTotal: 39 }), null);
  assert.equal(replacedScore(null), null);
});
