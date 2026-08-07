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
  CANDIDATE_VISIBLE_DECISION_KINDS,
  autoRejectFacts,
  candidateDecisionHistory,
  redactDecisionForCandidate,
  sealedActorAttribution,
} from "../../_lib/status-decisions.ts";
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
// Another candidate's record — must never appear in entry-own's view.
sealDecisionRecord({
  kind: "auto_rejected",
  actor: "auto:screen-wave",
  policyVersion: "screen-wave/bottom10/maxMatch55",
  candidateRef: "entry-other",
  rationale: "Auto-rejected other",
  reasonCode: "reject",
  inputs: { score: 12, threshold: 55, approvedBy: "alice@example.com" },
});

function ownHistory() {
  return candidateDecisionHistory(LIVE_CONSENT, listDecisionRecords({ candidateRef: "entry-own", workspaceId: WS }), NOW);
}

test("the history carries the right entry's records only — and hides internal calibration kinds", () => {
  const views = ownHistory();
  // auto_rejected + reinstated survive; the holdout marker and entry-other's reject don't.
  assert.deepEqual(
    views.map((v) => v.kind).sort(),
    ["auto_rejected", "reinstated"]
  );
  // The other candidate's decisive numbers appear nowhere in the payload.
  assert.ok(
    views.every((v) => v.facts?.score !== 12),
    "another candidate's sealed inputs must never cross"
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
});

test("auto_rejected exposes ONLY the sealed score-vs-threshold pair; other kinds no facts", () => {
  const views = ownHistory();
  assert.deepEqual(views.find((v) => v.kind === "auto_rejected")?.facts, { score: 41, threshold: 55 });
  assert.equal(views.find((v) => v.kind === "reinstated")?.facts, null);
  // Never fabricate: absent/non-numeric inputs → null, and a corrupt payload → null.
  assert.equal(autoRejectFacts(JSON.stringify({ inputs: { score: "n/a", threshold: 55 } })), null);
  assert.equal(autoRejectFacts("not json"), null);
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
  // CODE only (comments legitimately explain what is withheld and why).
  const code = routeSrc.replace(/\/\/[^\n]*/g, "");
  for (const forbidden of ["rationale", "payloadJson", "contentHash", "verifyDecisionChain", "requireOperator"]) {
    assert.ok(!code.includes(forbidden), `route must not touch ${forbidden}`);
  }
});
