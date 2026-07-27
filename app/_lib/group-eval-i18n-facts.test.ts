// eval-speaks-your-language (end-to-end) — the PERSISTED eval must carry structured
// FACTS, not baked English prose, for everything the modal renders: the pool risks,
// the deterministic summary branch, the governance banner and the lead's "why".
//
// A group eval is generated once and re-opened by whoever is on the team, so an
// English literal frozen into the payload renders untranslated forever in a
// cs/de/fr workspace — while the AI compare narrative beside it IS produced in the
// org locale. This test pins the server half of the fix (the client half, i.e. that
// each fact resolves to a catalog key, is group-eval/localize.test.ts).
//
// Two things it deliberately does NOT change: `summary` stays English prose (it is
// the SEALED decision rationale — canonical-English audit convention, documented at
// the seal site) and `governanceNote` stays persisted for pre-enum readers.
//
// Drives the REAL runGroupEval against a throwaway DB — testing/unit-db.ts MUST be
// the FIRST project import. Run: npm run test:unit
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { FIT_PROMISING_FLOOR } from "./fit-thresholds.ts";
import type { RiskFact, SummaryFacts } from "@/app/features/sub_decisions/group-eval/types";

// Force the best-effort AI "compare all" spawn to fail fast (ENOENT → deterministic
// fallback), so the test is hermetic. Set BEFORE python-runner is loaded.
process.env.PYTHON_CMD = "kp-no-python-for-this-test";
const { runGroupEval } = await import("./group-eval-run.ts");
const { getGroupEval } = await import("./group-eval.ts");

after(() => cleanupUnitDb());

const cand = (entryId: string, label: string, matchScore: number | null) => ({ entryId, candidateId: null, label, matchScore });

test("risks persist as STRUCTURED FACTS — no baked English sentence in the payload", async () => {
  const res = await runGroupEval({
    roleKey: "role-facts",
    roleTitle: "Backend Engineer",
    candidates: [cand("e1", "Jan Novák", 90), cand("e2", "Eva Dvořáková", FIT_PROMISING_FLOOR - 10)],
    governanceMode: "recommendation",
  });
  const risks = res.risks as RiskFact[];
  assert.ok(Array.isArray(risks) && risks.length > 0, "the low-fit rival raises a watch-out");
  for (const r of risks) assert.equal(typeof r, "object", "a risk is a fact object, never a prose string");
  const lowFit = risks.find((r) => r.kind === "low_fit");
  assert.deepEqual(lowFit, { kind: "low_fit", label: "Eva Dvořáková", score: FIT_PROMISING_FLOOR - 10 });
  // The sentence the client used to receive must not be anywhere in the facts.
  assert.doesNotMatch(JSON.stringify(risks), /confirm must-haves/i, "the English sentence is composed client-side now");
});

test("the deterministic summary persists a branch discriminator + params alongside the English prose", async () => {
  const res = await runGroupEval({
    roleKey: "role-facts-2",
    roleTitle: "Backend Engineer",
    candidates: [cand("e1", "Jan Novák", 90), cand("e2", "Eva Dvořáková", 40)],
    governanceMode: "recommendation",
  });
  const facts = res.summaryFacts as SummaryFacts;
  assert.equal(facts.kind, "recommendation");
  assert.equal(facts.roleTitle, "Backend Engineer");
  assert.equal(facts.count, 2);
  assert.equal(facts.leadLabel, "Jan Novák");
  assert.equal(facts.leadScore, 90);
  assert.equal(facts.riskCount, (res.risks as RiskFact[]).length);
  // The sealed rationale is this string: canonical English by convention.
  assert.match(res.summary as string, /Recommended lead/, "the English prose stays — it is the sealed rationale");
});

test("a governed mode persists the MODE (the banner's source of truth) and stays advisory", async () => {
  const res = await runGroupEval({
    roleKey: "role-facts-committee",
    roleTitle: "Backend Engineer",
    candidates: [cand("e1", "Jan Novák", 90), cand("e2", "Eva Dvořáková", 40)],
    governanceMode: "committee",
  });
  assert.equal(res.governanceMode, "committee", "the client composes the banner from this enum");
  assert.equal((res.summaryFacts as SummaryFacts).kind, "committee");
  // The English note is still carried for readers that predate the enum.
  assert.match(res.governanceNote as string, /Committee mode/);
});

test("a single-candidate field persists the insufficient-sample branch", async () => {
  const res = await runGroupEval({
    roleKey: "role-facts-single",
    roleTitle: "Backend Engineer",
    candidates: [cand("e1", "Jan Novák", 90)],
    governanceMode: "recommendation",
  });
  assert.equal((res.summaryFacts as SummaryFacts).kind, "insufficient");
  assert.equal(res.topPick, null, "no lead is crowned below the min-cohort floor");
});

test("topPick carries whyKind when the server fell back to a canned line, and the facts survive the DB round-trip", async () => {
  await runGroupEval({
    roleKey: "role-facts-why",
    roleTitle: "Backend Engineer",
    candidates: [cand("e1", "Jan Novák", 90), cand("e2", "Eva Dvořáková", 40)],
    governanceMode: "recommendation",
  });
  // Re-read through the store: the facts must survive JSON persistence, since the
  // modal renders the STORED payload, not the in-memory return value.
  const stored = getGroupEval("role-facts-why");
  assert.ok(stored, "the eval persisted");
  const payload = stored!.payload as { topPick?: { whyKind?: string; score: number | null }; summaryFacts?: SummaryFacts; risks?: RiskFact[] };
  // No AI reasoning ran (no jobId/candidateId), so the lead's verdict is empty and
  // the scored fallback applies.
  assert.equal(payload.topPick?.whyKind, "highest_fit");
  assert.equal(payload.summaryFacts?.kind, "recommendation");
  assert.equal(typeof payload.risks?.[0], "object");
});
