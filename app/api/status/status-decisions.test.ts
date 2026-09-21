// Art. 86 candidate decision history on the status token (EU AI-Act pack G11).
// Two halves, mirroring the sibling status-rate-limit test's approach:
//
//  1. The REAL store + the real redaction pipe (unit-db): seal records for two
//     entries and assert the candidate view carries only the right entry's
//     records, redacted to the closed CandidateDecisionView shape — never the
//     rationale (which names the approving operator), payload snapshot, chain
//     hashes, or another candidate's data — with auto/human attribution taken
//     from the sealed actor, and consent expiry/anonymization withholding all
//     of it.
//  2. A source contract on the route itself (importing it would pull in
//     `next/server`, which the unit runner can't resolve): the throttle fires
//     before any store read, the record read is candidateRef- AND
//     workspace-scoped, and the response is built ONLY from the redaction
//     helper's output.
import "../../_lib/testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { UNIT_DB_PATH, cleanupUnitDb } from "../../_lib/testing/unit-db.ts";
import { listDecisionRecords, sealDecisionRecord } from "../../_lib/decision-record-store.ts";
import {
  AI_VERDICT_DECISION_KINDS,
  CANDIDATE_RUBRIC_RATING_MAX,
  CANDIDATE_VISIBLE_DECISION_KINDS,
  MAX_CANDIDATE_RUBRIC_DIMENSIONS,
  aiScorecardFacts,
  autoRejectFacts,
  candidateDecisionHistory,
  factsCoverage,
  redactDecisionForCandidate,
  sealedActorAttribution,
} from "../../_lib/status-decisions.ts";
import { MAX_SEALED_RUBRIC_DIMENSIONS, sealableRubricDimensions } from "../../_lib/interview-scorecard.ts";
import { RATING_MAX } from "../../_lib/format.ts";
import type { ConsentSnapshot } from "../../_lib/consent.ts";

after(() => cleanupUnitDb());

const WS = "workspace"; // DEFAULT_WORKSPACE_ID — the unit store's only tenant here

function seedEntry(id: string): void {
  const d = new Database(UNIT_DB_PATH);
  d.exec(`CREATE TABLE IF NOT EXISTS pipeline_entries (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL DEFAULT 'workspace');`);
  d.prepare(`INSERT OR REPLACE INTO pipeline_entries (id, workspace_id) VALUES (?, ?)`).run(id, WS);
  d.close();
}

// Live consent — the gate must not withhold anything for these tests.
const LIVE_CONSENT: ConsentSnapshot = { givenAt: "2026-07-01T00:00:00.000Z", expiresAt: null, anonymizedAt: null };
const NOW = Date.parse("2026-07-27T00:00:00.000Z");

// --- seed a realistic sealed history for two candidates -------------------------
seedEntry("entry-own");
seedEntry("entry-other");
sealDecisionRecord({
  kind: "auto_rejected",
  actor: "auto:screen-wave",
  policyVersion: "screen-wave/bottom10/maxMatch55",
  candidateRef: "entry-own",
  rationale: "Auto-rejected · … · approved by alice@example.com",
  reasonCode: "reject",
  inputs: { pct: 10, n: 20, count: 2, rank: 19, score: 41, threshold: 55, tieAdjusted: 0, approvedBy: "alice@example.com" },
});
sealDecisionRecord({
  kind: "reinstated",
  actor: "human:recruiter",
  policyVersion: "manual",
  candidateRef: "entry-own",
  rationale: "Reinstated by bob@example.com after review",
  reasonCode: "reinstate",
  inputs: {},
});
// Internal calibration marker — sealed about the candidate, but NOT a decision
// that affected them; must never surface.
sealDecisionRecord({
  kind: "screen_wave_holdout",
  actor: "auto:screen-wave",
  policyVersion: "screen-wave/bottom10/maxMatch55",
  candidateRef: "entry-own",
  rationale: "Kept — calibration holdout",
  reasonCode: "holdout",
  inputs: { score: 41, threshold: 55 },
});
// An AI VERDICT ABOUT THE PERSON — sealed exactly the way /api/interview/complete
// seals it, THROUGH the real seal-side builder rather than a hand-written literal,
// so a change to what that builder emits is felt here instead of being mirrored.
// The ratings deliberately mix the three cases that matter: a real high score, a
// real low score, a NOT-ASSESSED axis (mid-scale 3 + placeholder evidence — the
// competency the interview never touched), and a genuine 3 that must NOT be
// mistaken for the not-assessed one.
const OWN_SCORECARD_RATINGS = [
  { competency: "Technical depth", rating: 4, evidence: "Walked through a real migration they led." },
  { competency: "Communication", rating: 2, evidence: "Answers stayed abstract when pressed for specifics." },
  { competency: "System design", rating: 3, evidence: "Not assessed (auto-synthesis unavailable)." },
  { competency: "Culture add", rating: 3, evidence: "Named a concrete conflict and how they handled it." },
];
sealDecisionRecord({
  kind: "ai_scorecard",
  actor: "auto:scorecard-v5",
  policyVersion: "scorecard-v5",
  candidateRef: "entry-own",
  rationale: "AI interview scorecard — recommendation: hold.",
  reasonCode: "scorecard",
  inputs: { recommendation: "hold", dimensions: sealableRubricDimensions(OWN_SCORECARD_RATINGS) },
});
// Another candidate's records — must never appear in entry-own's view. Both kinds,
// so the scoping is proven on the NEW fact shape too and not only on the old one.
sealDecisionRecord({
  kind: "auto_rejected",
  actor: "auto:screen-wave",
  policyVersion: "screen-wave/bottom10/maxMatch55",
  candidateRef: "entry-other",
  rationale: "Auto-rejected other",
  reasonCode: "reject",
  inputs: { score: 12, threshold: 55, approvedBy: "alice@example.com" },
});
sealDecisionRecord({
  kind: "ai_scorecard",
  actor: "auto:scorecard-v5",
  policyVersion: "scorecard-v5",
  candidateRef: "entry-other",
  rationale: "AI interview scorecard — recommendation: advance.",
  reasonCode: "scorecard",
  inputs: {
    recommendation: "advance",
    dimensions: sealableRubricDimensions([{ competency: "Someone else's axis", rating: 5, evidence: "x" }]),
  },
});

function ownHistory() {
  return candidateDecisionHistory(LIVE_CONSENT, listDecisionRecords({ candidateRef: "entry-own", workspaceId: WS }), NOW);
}

test("the history carries the right entry's records only — and hides internal calibration kinds", () => {
  const views = ownHistory();
  // auto_rejected + reinstated + ai_scorecard survive; the holdout marker and
  // entry-other's records don't.
  assert.deepEqual(
    views.map((v) => v.kind).sort(),
    ["ai_scorecard", "auto_rejected", "reinstated"]
  );
  // The other candidate's decisive numbers appear nowhere in the payload — on
  // EITHER fact shape.
  assert.ok(
    views.every((v) => !(v.facts?.type === "threshold" && v.facts.score === 12)),
    "another candidate's sealed threshold must never cross"
  );
  assert.ok(
    !JSON.stringify(views).includes("Someone else's axis"),
    "another candidate's sealed rubric must never cross"
  );
});

test("attribution comes from the sealed actor — auto vs human, never misattributed", () => {
  const views = ownHistory();
  assert.equal(views.find((v) => v.kind === "auto_rejected")?.attribution, "automated");
  assert.equal(views.find((v) => v.kind === "reinstated")?.attribution, "human");
  // A prefix-less legacy actor falls back to the shared kind map; an unmapped
  // kind stays unknown rather than defaulting to either side.
  assert.equal(sealedActorAttribution("screen-wave", "auto_rejected"), "automated");
  assert.equal(sealedActorAttribution("legacy", "offer_terms"), "unknown");
});

test("no leakage fields: the wire shape is closed and scrubbed", () => {
  const views = ownHistory();
  assert.ok(views.length > 0);
  for (const v of views) {
    // Exactly the CandidateDecisionView keys — nothing sealed rides along.
    assert.deepEqual(Object.keys(v).sort(), ["attribution", "createdAt", "facts", "kind", "reasonCode"]);
  }
  const wire = JSON.stringify(views);
  for (const leak of ["alice@example.com", "bob@example.com", "approvedBy", "policyVersion", "prevHash", "contentHash", "payloadJson", "rationale", "actor", "seq"]) {
    assert.ok(!wire.includes(leak), `redacted payload must not contain "${leak}"`);
  }
  // The scorecard's own withheld material. `recommendation` IS sealed (the chain
  // needs the conclusion) but is NOT a fact: a verdict LABEL crossing without the
  // axes behind it is exactly the bare-label state this surface exists to leave.
  // The evidence quotes never reach the payload at all — they are dropped one layer
  // earlier, at the seal (sealableRubricDimensions), which its own test pins.
  for (const leak of ["recommendation", "Walked through a real migration", "evidence", "Not assessed", "System design"]) {
    assert.ok(!wire.includes(leak), `the scorecard's redacted view must not contain "${leak}"`);
  }
  // …AND THE POSITIVE CONTROLS, so none of the above can pass vacuously. A seal that
  // silently stopped writing dimensions, or a fixture that never carried the
  // withheld material, would turn every negative assertion in this test green while
  // the surface got WORSE — the failure mode the gate on this idea named.
  const sealed = listDecisionRecords({ candidateRef: "entry-own", workspaceId: WS }).find((r) => r.kind === "ai_scorecard");
  assert.ok(sealed, "precondition: the scorecard record exists");
  assert.match(sealed.payloadJson, /"recommendation":"hold"/, "the verdict label WAS sealed — its absence above is redaction");
  assert.match(sealed.payloadJson, /Technical depth/, "the rubric axes WERE sealed");
  assert.ok(
    OWN_SCORECARD_RATINGS.some((r) => r.competency === "System design" && r.evidence.startsWith("Not assessed")),
    "precondition: the fixture really does carry a not-assessed axis for the negative above to be about"
  );
  // And the decisive facts DO cross: without this, an extractor that returned null
  // for everything would satisfy every leak assertion in this file.
  const scorecardView = views.find((v) => v.kind === "ai_scorecard");
  assert.equal(scorecardView?.facts?.type, "rubric", "the scorecard's decisive facts must actually reach the candidate");
  assert.ok(wire.includes("Technical depth"), "the assessed axis crosses — the redaction is not blanket");
});

test("auto_rejected exposes ONLY the sealed score-vs-threshold pair; a kind with no extractor gets no facts", () => {
  const views = ownHistory();
  assert.deepEqual(views.find((v) => v.kind === "auto_rejected")?.facts, { type: "threshold", score: 41, threshold: 55 });
  // `reinstated` is candidate-visible but has no extractor — it crosses with a
  // reason code and no decisive element, which is the honest state for a human call.
  assert.equal(views.find((v) => v.kind === "reinstated")?.facts, null);
  // Never fabricate: absent/non-numeric inputs → null, and a corrupt payload → null.
  assert.equal(autoRejectFacts(JSON.stringify({ inputs: { score: "n/a", threshold: 55 } })), null);
  assert.equal(autoRejectFacts("not json"), null);
});

test("ai_scorecard exposes the assessed rubric axes and their ratings — and nothing else", () => {
  const facts = ownHistory().find((v) => v.kind === "ai_scorecard")?.facts;
  assert.equal(facts?.type, "rubric");
  assert.deepEqual(
    facts.type === "rubric" ? facts.dimensions : null,
    [
      { competency: "Technical depth", rating: 4, ratingMax: CANDIDATE_RUBRIC_RATING_MAX },
      { competency: "Communication", rating: 2, ratingMax: CANDIDATE_RUBRIC_RATING_MAX },
      // "System design" is absent: mid-scale 3 + "Not assessed…" evidence is an axis
      // the interview never touched, and telling a candidate they scored 3 of 5 on it
      // would be the machine inventing a verdict.
      { competency: "Culture add", rating: 3, ratingMax: CANDIDATE_RUBRIC_RATING_MAX },
    ],
    "a genuine 3 survives; the not-assessed 3 does not"
  );
});

test("the rubric extractor never fabricates, and never trusts the payload it is handed", () => {
  const facts = (inputs: unknown) => aiScorecardFacts(JSON.stringify({ inputs }));
  // Nothing to read → no facts, never an empty verdict.
  assert.equal(facts({ recommendation: "hold" }), null, "a legacy record sealed before dimensions existed");
  assert.equal(facts({ dimensions: [] }), null, "a scorecard that assessed nothing has no facts");
  assert.equal(aiScorecardFacts("not json"), null);
  assert.equal(aiScorecardFacts(JSON.stringify({ inputs: null })), null);
  // Records outlive the code that sealed them, so every constraint the seal applies
  // is applied AGAIN here — a payload written by an older (or a wrong) seal cannot
  // put an off-scale rating, a blank axis or free text on a public wire.
  assert.equal(facts({ dimensions: [{ competency: "X", rating: 0 }] }), null, "below the scale");
  assert.equal(facts({ dimensions: [{ competency: "X", rating: 6 }] }), null, "above the scale");
  assert.equal(facts({ dimensions: [{ competency: "X", rating: 3.5 }] }), null, "off the integer ladder");
  assert.equal(facts({ dimensions: [{ competency: "   ", rating: 3 }] }), null, "a blank axis is not an axis");
  assert.equal(facts({ dimensions: [{ competency: "a".repeat(61), rating: 3 }] }), null, "free text is not an axis");
  assert.equal(facts({ dimensions: [{ rating: 3 }, null, "nope"] }), null, "malformed rows are dropped, not thrown on");
  // The one check that is NOT repeated here, stated so the asymmetry is deliberate
  // rather than an oversight: evidence is never sealed, so a stored `rating: 3` is
  // indistinguishable from a real middling score and MUST stand. The not-assessed
  // filter is the seal's alone (asserted in the seal-side test below).
  assert.equal(
    facts({ dimensions: [{ competency: "Legacy axis", rating: 3, evidence: "Not assessed." }] })?.type,
    "rubric",
    "a stored 3 stands on read — dropping every 3 would delete real verdicts"
  );
  // And the list is bounded: an LLM-shaped payload cannot make the public response
  // arbitrarily long.
  const many = Array.from({ length: 40 }, (_, i) => ({ competency: `Axis ${i}`, rating: 3 }));
  const bounded = facts({ dimensions: many });
  assert.equal(bounded?.type === "rubric" ? bounded.dimensions.length : -1, MAX_CANDIDATE_RUBRIC_DIMENSIONS);
});

test("the seal side drops what must never be sealed, and the two sides share one ceiling", () => {
  // Evidence quotes, the summary and an off-rubric axis never enter the payload —
  // the read side cannot redact what was never written, so this is where that holds.
  assert.deepEqual(
    sealableRubricDimensions([
      { competency: " Technical depth ", rating: 4, evidence: "a quote" },
      { competency: "Untouched", rating: 3, evidence: "Not assessed (auto-synthesis unavailable)." },
      { competency: "Foreign axis", rating: 5, evidence: "a quote", offRubric: true },
      { competency: "", rating: 4 },
      { competency: "Bad scale", rating: 9 },
    ]),
    [{ competency: "Technical depth", rating: 4 }],
    "only a real, on-rubric, on-scale axis is sealed — as {competency, rating} and nothing more"
  );
  assert.deepEqual(sealableRubricDimensions(undefined), [], "a scorecard with no ratings seals an empty list");
  assert.deepEqual(sealableRubricDimensions("ratings"), []);
  // The two ceilings and the two scales are declared separately ON PURPOSE (the read
  // side must not trust the seal side's constant) — pinned equal here so "separately
  // declared" never becomes "quietly different".
  assert.equal(MAX_SEALED_RUBRIC_DIMENSIONS, MAX_CANDIDATE_RUBRIC_DIMENSIONS);
  assert.equal(CANDIDATE_RUBRIC_RATING_MAX, RATING_MAX);
});

test("the Art. 86 coverage ratio is a number, and it is the number this change claims", () => {
  // The goal this serves ("every automated step is explainable to the candidate") is
  // a ratio, so it is asserted as one. Raising it means adding an extractor AND its
  // candidate copy; this line is what makes that a movement rather than a claim.
  const c = factsCoverage();
  assert.equal(c.visible, CANDIDATE_VISIBLE_DECISION_KINDS.size);
  assert.equal(c.withFacts, 2, "auto_rejected + ai_scorecard carry decisive facts");
  assert.equal(c.aiVerdict, 5, "the kinds where a machine judged the person");
  assert.equal(c.aiVerdictWithFacts, 2, "…of which two can say what they were judged on");
  // Every kind with an extractor must be a kind the candidate can actually SEE —
  // an extractor for a hidden kind is dead code pretending to be coverage.
  for (const kind of AI_VERDICT_DECISION_KINDS) {
    assert.ok(CANDIDATE_VISIBLE_DECISION_KINDS.has(kind), `${kind} is counted as AI-verdict coverage but is not visible`);
  }
});

test("anonymized or consent-expired entries get nothing", () => {
  const records = listDecisionRecords({ candidateRef: "entry-own", workspaceId: WS });
  assert.ok(records.length > 0, "precondition: sealed records exist");
  const anonymized: ConsentSnapshot = { givenAt: "2026-01-01T00:00:00.000Z", expiresAt: null, anonymizedAt: "2026-06-01T00:00:00.000Z" };
  const expired: ConsentSnapshot = { givenAt: "2025-01-01T00:00:00.000Z", expiresAt: "2026-01-01T00:00:00.000Z", anonymizedAt: null };
  assert.deepEqual(candidateDecisionHistory(anonymized, records, NOW), []);
  assert.deepEqual(candidateDecisionHistory(expired, records, NOW), []);
  // Still-active consent (expiring later than now) is served.
  const active: ConsentSnapshot = { givenAt: "2026-07-01T00:00:00.000Z", expiresAt: "2026-08-01T00:00:00.000Z", anonymizedAt: null };
  assert.ok(candidateDecisionHistory(active, records, NOW).length > 0);
});

test("every candidate-visible kind is an allowlist entry — a new kind ships hidden by default", () => {
  // Redaction refuses anything outside the allowlist (deny-by-default).
  const stranger = { kind: "brand_new_kind", actor: "auto:x", reasonCode: "x", createdAt: "2026-07-01T00:00:00.000Z", payloadJson: "{}" };
  assert.equal(redactDecisionForCandidate(stranger), null);
  assert.ok(!CANDIDATE_VISIBLE_DECISION_KINDS.has("screen_wave_holdout"), "the calibration marker stays internal");
});

// --- source contract on the route (can't be imported under the unit runner) ------
const HERE = path.dirname(fileURLToPath(import.meta.url));
const routeSrc = readFileSync(path.join(HERE, "[token]", "decisions", "route.ts"), "utf8");

test("the decisions route throttles before the store reads, scopes by candidateRef + workspace, and serves only the redacted view", () => {
  const limitAt = routeSrc.indexOf("rateLimit(");
  const tokenReadAt = routeSrc.indexOf("getEntryIdByStatusToken(");
  assert.ok(limitAt > 0 && limitAt < tokenReadAt, "a flood must be rejected before the store reads");
  assert.match(routeSrc, /rateLimit\(`status-decisions:\$\{clientIpFrom\(request\.headers\)\}:\$\{token\}`/, "per token AND client, like the sibling status route");
  assert.match(routeSrc, /listDecisionRecords\(\{ candidateRef: entryId, workspaceId \}\)/, "only THIS entry's records, on its own tenant chain");
  assert.match(routeSrc, /getEntryWorkspace\(entryId\)/, "tenant derived from the entry — no session on a public token route");
  assert.match(
    routeSrc,
    /candidateDecisionHistory\(\s*\{ givenAt: entry\.consentGivenAt, expiresAt: entry\.consentExpiresAt, anonymizedAt: entry\.anonymizedAt \}/,
    "the consent gate sees the entry's real snapshot"
  );
  assert.match(routeSrc, /jsonOk\(\{ records \}\)/, "the response is exactly the redacted view");
  assert.match(routeSrc, /jsonRefusal\("STATUS_LINK_INVALID", 404\)/, "unknown token and missing entry share the parent status door's coded 404");
  assert.equal(
    (routeSrc.match(/jsonRefusal\("STATUS_LINK_INVALID", 404\)/g) ?? []).length,
    2,
    "both not-found branches are STATUS_LINK_INVALID"
  );
  assert.doesNotMatch(routeSrc, /error:\s*"not found"/, "no English not-found body on this public token door");
  // CODE only (comments legitimately explain what is withheld and why).
  const code = routeSrc.replace(/\/\/[^\n]*/g, "");
  for (const forbidden of ["rationale", "payloadJson", "contentHash", "verifyDecisionChain", "requireOperator"]) {
    assert.ok(!code.includes(forbidden), `route must not touch ${forbidden}`);
  }
});
