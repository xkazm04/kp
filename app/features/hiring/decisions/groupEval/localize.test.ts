// eval-speaks-your-language — the persisted eval must render in the READER's
// language, not the language of the machine that produced it.
//
// Two properties are pinned here:
//   1. STRUCTURED FACTS round-trip: every fact the server persists (RiskFact,
//      SummaryFacts branch, governanceMode, topPick.whyKind) resolves to a CATALOG
//      KEY with the right params — never to a baked English literal.
//   2. LEGACY payloads still render: an eval saved before the facts existed carries
//      only frozen English prose, and that prose is shown verbatim rather than
//      disappearing behind a missing fact.
//
// Pure module, no React: run with `node --test app/features/sub_decisions/group-eval/localize.test.ts`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { governanceText, riskText, summaryText, topPickWhyText, type Translate } from "./localize.ts";
import type { GroupEvalPayload, SummaryFacts } from "@/app/features/shared/groupEvalTypes.ts";

// A fake translator that renders `key(param=value, …)` — so an assertion proves
// which CATALOG KEY was chosen and which params it received, independent of copy.
const t: Translate = (key, params) =>
  params && Object.keys(params).length ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join(",")})` : key;

test("risks resolve to catalog keys + params — one key per fact kind", () => {
  assert.equal(riskText(t, { kind: "low_fit", label: "Jan", score: 41 }), "risk.lowFit(label=Jan,score=41)");
  assert.equal(riskText(t, { kind: "early_career", label: "Eva" }), "risk.earlyCareer(label=Eva)");
  assert.equal(riskText(t, { kind: "gaps", label: "Jan", gaps: ["Kafka", "Go"] }), "risk.gaps(label=Jan,gaps=Kafka, Go)");
});

test("a LEGACY prose risk renders verbatim — an old eval never loses its content", () => {
  const legacy = "Jan: lower fit (41) — confirm must-haves at interview.";
  assert.equal(riskText(t, legacy), legacy);
});

const facts = (f: Partial<SummaryFacts>): GroupEvalPayload => ({
  summary: "ENGLISH PROSE",
  summaryFacts: { kind: "recommendation", roleTitle: "Backend Engineer", count: 3, ...f } as SummaryFacts,
});

test("every deterministic-summary branch composes from its own catalog key", () => {
  assert.match(summaryText(t, facts({ kind: "empty" }))!, /^summary\.empty\(role=Backend Engineer\)$/);
  assert.match(summaryText(t, facts({ kind: "insufficient", count: 1 }))!, /^summary\.insufficient\(count=1,role=/);
  assert.match(summaryText(t, facts({ kind: "no_lead" }))!, /^summary\.noLead\(count=3,role=/);
  const elig = summaryText(t, facts({ kind: "eligibility", leadLabel: "Jan", leadScore: 82 }))!;
  assert.match(elig, /^summary\.eligibility\(/);
  // The lead descriptor is itself a catalog message — never "Jan (fit 82)" in English.
  assert.match(elig, /lead=summary\.leadScored\(label=Jan,score=82\)/);
  const committee = summaryText(t, facts({ kind: "committee", leadLabel: "Jan", leadScore: 82, riskCount: 2 }))!;
  assert.match(committee, /^summary\.committee\(/);
  assert.match(committee, /summary\.watchOuts\(count=2\)$/);
});

test("an UNSCORED lead uses the unscored descriptor — never a fabricated number (REC-03)", () => {
  const out = summaryText(t, facts({ kind: "recommendation", leadLabel: "Jan", leadScore: null }))!;
  assert.match(out, /lead=summary\.leadUnscored\(label=Jan\)/);
  assert.doesNotMatch(out, /score=/);
});

test("the recommendation branch carries differentiators and the risk count / no-risk line", () => {
  const withAll = summaryText(t, facts({ leadLabel: "Jan", leadScore: 82, differentiators: ["Kafka", "Go"], riskCount: 3 }))!;
  assert.match(withAll, /summary\.uniqueStrengths\(list=Kafka, Go\)/);
  assert.match(withAll, /summary\.watchOuts\(count=3\)$/);
  const clean = summaryText(t, facts({ leadLabel: "Jan", leadScore: 82, differentiators: [], riskCount: 0 }))!;
  assert.match(clean, /summary\.noRisks$/);
});

test("the separation caveat is appended ONLY for an overlapping lead", () => {
  const sep = (verdict: "separated" | "overlapping" | "unknown") =>
    summaryText(t, facts({ leadLabel: "Jan", leadScore: 82, separation: { verdict, leadLabel: "Jan", runnerUpLabel: "Eva" } }))!;
  assert.match(sep("overlapping"), /summary\.separationCaveat\(lead=Jan,runnerUp=Eva\)$/);
  assert.doesNotMatch(sep("separated"), /separationCaveat/);
  assert.doesNotMatch(sep("unknown"), /separationCaveat/);
});

test("a LEGACY payload with prose but no facts renders the stored prose", () => {
  assert.equal(summaryText(t, { summary: "3 candidate(s) for X. Recommended lead: Jan." }), "3 candidate(s) for X. Recommended lead: Jan.");
  assert.equal(summaryText(t, {}), undefined);
});

test("the governance banner composes from the MODE enum — the compliance copy is localized", () => {
  assert.equal(governanceText(t, { governanceMode: "committee", governanceNote: "ENGLISH" }), "governance.committee");
  assert.equal(governanceText(t, { governanceMode: "eligibility_list", governanceNote: "ENGLISH" }), "governance.eligibilityList");
  assert.equal(governanceText(t, { governanceMode: "recommendation", governanceNote: null }), null);
  // Legacy: no mode persisted → the stored note is all there is.
  assert.equal(governanceText(t, { governanceNote: "ENGLISH" }), "ENGLISH");
  assert.equal(governanceText(t, {}), null);
});

test("topPick.why localizes the server's canned fallbacks and keeps the AI verdict verbatim", () => {
  assert.equal(topPickWhyText(t, { label: "Jan", score: 82, why: "Highest fit (82) in this role.", whyKind: "highest_fit" }), "topPickWhy.highestFit(score=82)");
  assert.equal(topPickWhyText(t, { label: "Jan", score: null, why: "Top of the field…", whyKind: "unscored" }), "topPickWhy.unscored");
  // An AI verdict is generated in the org locale already — render it as-is.
  assert.equal(topPickWhyText(t, { label: "Jan", score: 82, why: "Strongest Kafka evidence in the field." }), "Strongest Kafka evidence in the field.");
  assert.equal(topPickWhyText(t, null), "");
});
