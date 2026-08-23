// The RoleBrief → JD-build projection (promote step). Pure module, no DB.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  briefToAppMasterSpec,
  briefDealbreakerEvidence,
  briefIntentSummary,
  briefMustSkills,
  briefNiceSkills,
  briefOutcomeEvidence,
  briefPromoteBlockers,
  briefReadyToPromote,
  briefStatedRequirements,
  needTextFromBrief,
} from "./intake-brief.ts";
import type { RoleBrief } from "./rolespec.ts";

const brief: RoleBrief = {
  title: "Data Analyst",
  seniority: "senior",
  roleFamily: "data_analytics",
  summary: "Reporting keeps slipping; nobody owns the dashboards.",
  successCriteria: ["Weekly reporting runs without manual work"],
  responsibilities: ["Own the dashboard stack"],
  requirements: [
    { skill: "SQL", kind: "must_have", hardness: "prerequisite", weight: 0.8, rationale: "", provenance: "stated", confidence: 0.9 },
    { skill: "dbt", kind: "nice_to_have", hardness: "learnable", weight: 0.4, rationale: "", provenance: "stated", confidence: 0.9 },
  ],
  facets: [
    { key: "urgency", label: "Urgency", value: "Ops team is losing trust", importance: "core", provenance: "stated", confidence: 0.9 },
  ],
};

test("needTextFromBrief flattens narrative → outcomes → graded requirements → facets", () => {
  const text = needTextFromBrief(brief);
  const lines = text.split("\n");
  assert.equal(lines[0], "Reporting keeps slipping; nobody owns the dashboards.");
  assert.ok(text.includes("Done in 90 days: Weekly reporting runs without manual work"));
  assert.ok(text.includes("Must have: SQL"));
  assert.ok(text.includes("Nice to have: dbt"));
  assert.ok(text.includes("Urgency: Ops team is losing trust"));
  // Outcomes come before requirements (the de-spec framing survives the flatten).
  assert.ok(text.indexOf("Done in 90 days") < text.indexOf("Must have: SQL"));
});

test("skill projections split by kind", () => {
  assert.deepEqual(briefMustSkills(brief), ["SQL"]);
  assert.deepEqual(briefNiceSkills(brief), ["dbt"]);
});

test("readiness needs a title plus substance; empty briefs refuse", () => {
  assert.equal(briefReadyToPromote(brief), true);
  assert.equal(briefReadyToPromote(null), false);
  assert.equal(briefReadyToPromote({ title: "X" }), false);
  assert.equal(briefReadyToPromote({ title: "X", successCriteria: ["ships"] }), true);
  assert.equal(briefReadyToPromote({ successCriteria: ["ships"] }), false);
});

// UAT L2-NEW-2 — the live shape that blocked promote: a rich session whose hard
// conditions and 90-day outcome live in FACETS because the extraction filed them
// there (requirements[] and successCriteria[] both empty).
const facetOnlyBrief: RoleBrief = {
  title: "Band 5 Registered Nurse",
  facets: [
    { key: "why_now", label: "Why now", value: "Two of three nurses are leaving.", importance: "core", provenance: "stated", confidence: 1 },
    {
      key: "dealbreaker_context",
      label: "Dealbreakers",
      value: "A valid NMC registration and an enhanced DBS.",
      importance: "core",
      provenance: "stated",
      confidence: 1,
    },
  ],
};

test("readiness reads dealbreakers and outcomes in either home (UAT L2-NEW-2)", () => {
  assert.equal(briefReadyToPromote(facetOnlyBrief), true);
  assert.deepEqual(briefPromoteBlockers(facetOnlyBrief), []);
  assert.deepEqual(briefDealbreakerEvidence(facetOnlyBrief), ["A valid NMC registration and an enhanced DBS."]);
  // A facet-carried 90-day outcome counts too.
  assert.equal(
    briefReadyToPromote({
      title: "X",
      facets: [{ key: "success_90d", label: "90 days", value: "Runs her own clinic list", importance: "core", provenance: "stated", confidence: 1 }],
    }),
    true
  );
  // Unrelated context facets are NOT substance — the gate stays a gate.
  assert.deepEqual(briefPromoteBlockers({ title: "X", facets: [{ key: "why_now", label: "", value: "backfill", importance: "context", provenance: "stated", confidence: 1 }] }), [
    "substance",
  ]);
  // An empty facet value never counts.
  assert.deepEqual(
    briefPromoteBlockers({ title: "X", facets: [{ key: "dealbreaker_context", label: "", value: "  ", importance: "core", provenance: "stated", confidence: 1 }] }),
    ["substance"]
  );
});

test("briefPromoteBlockers names every missing piece (UAT L2-RC-1)", () => {
  assert.deepEqual(briefPromoteBlockers(null), ["title", "substance"]);
  assert.deepEqual(briefPromoteBlockers({}), ["title", "substance"]);
  assert.deepEqual(briefPromoteBlockers({ successCriteria: ["ships"] }), ["title"]);
  assert.deepEqual(briefPromoteBlockers({ title: "X" }), ["substance"]);
  assert.deepEqual(briefPromoteBlockers(brief), []);
  assert.deepEqual(briefOutcomeEvidence(brief), ["Weekly reporting runs without manual work"]);
});

test("briefStatedRequirements projects the graded shape the devcase chain consumes", () => {
  assert.deepEqual(briefStatedRequirements(brief), [
    { skill: "SQL", kind: "must_have", hardness: "prerequisite", weight: 0.8 },
    { skill: "dbt", kind: "nice_to_have", hardness: "learnable", weight: 0.4 },
  ]);
  assert.deepEqual(briefStatedRequirements({}), []);
});

test("briefIntentSummary digests outcomes + dealbreakers, never fires on empty briefs", () => {
  const intent = briefIntentSummary(brief);
  assert.ok(intent);
  assert.ok(intent.includes("success in the first 90 days means: Weekly reporting runs without manual work"));
  assert.ok(intent.includes("dealbreakers are: SQL"));
  assert.ok(intent.includes("urgency: Ops team is losing trust"));
  assert.ok(intent.includes("never read this note aloud"));
  assert.equal(briefIntentSummary(null), null);
  assert.equal(briefIntentSummary({ title: "X" }), null);
});

// UAT L2-NEW-2, second half: the promote gate learned to read both homes, the
// interviewer digest had not. All five live recertify sessions stored their hard
// conditions as facet prose with requirements[] empty — so the brief richest in
// stated intent grounded the interviewer with NOTHING.
test("briefIntentSummary grounds a facet-only brief (both homes, like the promote gate)", () => {
  const intent = briefIntentSummary(facetOnlyBrief);
  assert.ok(intent, "a facet-carried dealbreaker must still ground the interviewer");
  assert.ok(intent.includes("the stated dealbreakers are: A valid NMC registration and an enhanced DBS."), intent);
  // A facet-carried 90-day outcome grounds the same way.
  const outcomeOnly = briefIntentSummary({
    title: "X",
    facets: [{ key: "success_90d", label: "90 days", value: "Runs her own clinic list", importance: "core", provenance: "stated", confidence: 1 }],
  });
  assert.ok(outcomeOnly?.includes("success in the first 90 days means: Runs her own clinic list"), String(outcomeOnly));
  // Still silent when the brief genuinely holds nothing to ground on.
  assert.equal(
    briefIntentSummary({ title: "X", facets: [{ key: "why_now", label: "", value: "backfill", importance: "context", provenance: "stated", confidence: 1 }] }),
    null
  );
  // Facet prose is capped so the digest can't swamp the agent brief.
  const long = briefIntentSummary({
    title: "X",
    facets: [{ key: "dealbreaker_context", label: "", value: "z".repeat(600), importance: "core", provenance: "stated", confidence: 1 }],
  });
  assert.ok(long && !long.includes("z".repeat(201)), "long facet prose must be trimmed");
});

// --------------------------------------------------------------------------
// App master: RoleBrief (+ RepoDossier) -> AppMasterSpec
// --------------------------------------------------------------------------

const dossier = {
  dossierId: "dossier_kp1",
  repo: { url: "https://github.com/xkazm04/kp", rootPath: null, mainBranch: "main" },
  source: "heuristic" as const,
  generatedAt: "2026-08-23T09:00:00Z",
  stack: ["TypeScript", "Python"],
  size: { files: 2377, sourceFiles: 2100, contexts: 143 },
  declaredGates: ["npm run typecheck", "npm run test:unit"],
  contexts: [{ name: "Role intake", category: "ui", fileCount: 14 }],
  hotSpots: [{ ref: "app/_lib/db/core.ts", note: "churn" }],
  riskAreas: [{ ref: "app/_lib/auth", note: "custom HMAC" }],
  existingKpis: [],
  maintainerLoadEstimate: "~1.5 devs, bursty",
  candidateObjectives: [
    { kpiKey: "gate_pass_rate", label: "Gate pass rate", baseline: 0.8, target: null, unit: "%", direction: "gte" as const, windowDays: 60 },
  ],
  fieldProvenance: {},
  promptVersion: "app-master-v1",
};

const facet = (key: string, value: string) => ({
  key,
  label: key,
  value,
  importance: "core" as const,
  provenance: "stated" as const,
  confidence: 0.9,
  sourceTurn: null,
});

const appMasterBrief = (extra: { key: string; value: string }[] = []): RoleBrief => ({
  title: "App master for kp",
  seniority: "medior",
  spineProvenance: { title: "stated" },
  facets: [
    facet("objective:gate_pass_rate", "gate pass rate: 95% within 60 days"),
    facet("mandate.scopeRung", "2"),
    facet("mandate.forbiddenClasses", "all six stand"),
    facet("budget.monthlyUsd", "120 USD"),
    facet("mandate.owner", "Martin, head of engineering"),
    facet("tenure.probationDays", "45"),
    facet("role.population", "either"),
    ...extra.map((e) => facet(e.key, e.value)),
  ],
});

test("briefToAppMasterSpec reads the six answer facet keys back into the spec", () => {
  const spec = briefToAppMasterSpec(appMasterBrief(), dossier);
  assert.equal(spec.mandate.scopeRung, 2);
  assert.equal(spec.mandate.owner, "Martin, head of engineering");
  assert.equal(spec.budget.monthlyUsd, 120);
  assert.equal(spec.budget.onCap, "drain");
  assert.equal(spec.tenure.probationDays, 45);
  assert.equal(spec.role.population, "either");
  // "a step past senior" — a seniority the requestor never stated must not
  // read as a decision they made.
  assert.equal(spec.role.seniority, "senior");
  assert.equal(spec.app.repo.url, "https://github.com/xkazm04/kp");
  assert.equal(spec.app.dossierId, "dossier_kp1");
  // The repo's OWN gates are what a proposal must pass.
  assert.deepEqual(spec.mandate.approvalGates, ["npm run typecheck", "npm run test:unit"]);
});

test("briefToAppMasterSpec parses target + window out of the requestor's own line", () => {
  const spec = briefToAppMasterSpec(appMasterBrief(), dossier);
  assert.equal(spec.objectives.length, 1);
  const [objective] = spec.objectives;
  assert.equal(objective.kpiKey, "gate_pass_rate");
  assert.equal(objective.target, 95);
  assert.equal(objective.windowDays, 60);
  // Baseline/unit/direction come from the scan's proposal — the requestor was
  // not asked to restate what the machine already read.
  assert.equal(objective.baseline, 0.8);
  assert.equal(objective.unit, "%");
  assert.equal(objective.direction, "gte");
});

test("an objective with no readable number is recorded unquantified, never zeroed", () => {
  const brief = appMasterBrief();
  brief.facets = brief.facets!.map((f) =>
    f.key === "objective:gate_pass_rate" ? { ...f, value: "gates should just stop failing" } : f
  );
  const spec = briefToAppMasterSpec(brief, dossier);
  assert.equal(spec.objectives[0].target, null, "0 would invent a target nobody set");
  assert.ok(spec.coercionNotes.some((n) => n.includes("no numeric target")));
});

test("the defaults are the safe end: unreadable answers keep rung 2 and all six classes", () => {
  const brief = appMasterBrief();
  brief.facets = brief.facets!.map((f) =>
    f.key === "mandate.scopeRung" ? { ...f, value: "whatever you think" } : f
  );
  const spec = briefToAppMasterSpec(brief, dossier);
  assert.equal(spec.mandate.scopeRung, 2);
  assert.equal(spec.mandate.forbiddenClasses.length, 6);
  assert.ok(spec.coercionNotes.some((n) => n.includes("could not read a scope rung")));
});

test("a rung above the ladder is clamped and the clamp is recorded", () => {
  const brief = appMasterBrief();
  brief.facets = brief.facets!.map((f) => (f.key === "mandate.scopeRung" ? { ...f, value: "4" } : f));
  const spec = briefToAppMasterSpec(brief, dossier);
  assert.equal(spec.mandate.scopeRung, 2);
  assert.ok(spec.coercionNotes.some((n) => n.includes("not grantable in v1")));
});

test("only an explicit allow verb relaxes a forbidden class", () => {
  const emphatic = appMasterBrief();
  emphatic.facets = emphatic.facets!.map((f) =>
    f.key === "mandate.forbiddenClasses" ? { ...f, value: "we take test deletion extremely seriously" } : f
  );
  assert.equal(briefToAppMasterSpec(emphatic, dossier).mandate.forbiddenClasses.length, 6);

  const relaxed = appMasterBrief();
  relaxed.facets = relaxed.facets!.map((f) =>
    f.key === "mandate.forbiddenClasses" ? { ...f, value: "you may bump a dependency, the rest stand" } : f
  );
  const spec = briefToAppMasterSpec(relaxed, dossier);
  assert.equal(spec.mandate.forbiddenClasses.length, 5);
  assert.ok(!spec.mandate.forbiddenClasses.includes("dependency_bump_to_satisfy_check"));
  assert.ok(spec.coercionNotes.some((n) => n.includes("relaxed")));
});

test("population drives which tail block exists, and 'either' stays disclosed", () => {
  const either = briefToAppMasterSpec(appMasterBrief(), dossier);
  assert.equal(either.agent, null);
  assert.equal(either.human, null);

  const agentBrief = appMasterBrief();
  agentBrief.facets = agentBrief.facets!.map((f) =>
    f.key === "role.population" ? { ...f, value: "an AI agent" } : f
  );
  const agent = briefToAppMasterSpec(agentBrief, dossier);
  assert.equal(agent.role.population, "agent");
  assert.ok(agent.agent);
  // The connector catalog is not available to a pure function — guessing one
  // would put an unverified connector on a dispatch payload.
  assert.deepEqual(agent.agent!.connectors, []);
  assert.ok(agent.agent!.systemPromptDraft.includes("rung 2"));

  const humanBrief = appMasterBrief();
  humanBrief.facets = humanBrief.facets!.map((f) =>
    f.key === "role.population" ? { ...f, value: "a human, definitely" } : f
  );
  const human = briefToAppMasterSpec(humanBrief, dossier);
  assert.equal(human.role.population, "human");
  assert.ok(human.human!.compBandRef.includes("assumption"));
});

test("a missing dossier composes a spec that says the app binding is incomplete", () => {
  const spec = briefToAppMasterSpec(appMasterBrief(), null);
  assert.equal(spec.app.repo.url, null);
  assert.equal(spec.app.repo.mainBranch, "main");
  assert.ok(spec.coercionNotes.some((n) => n.includes("no repo dossier")));
  // Still a valid spec — the requestor's answers survived.
  assert.equal(spec.mandate.scopeRung, 2);
});

test("briefToAppMasterSpec is pure: the same inputs always yield the same spec", () => {
  const a = briefToAppMasterSpec(appMasterBrief(), dossier);
  const b = briefToAppMasterSpec(appMasterBrief(), dossier);
  assert.deepEqual(a, b);
});

test("selectApprovalGates keeps the deciding gates first, drops pointers and heavy runs, caps the list", async () => {
  const { selectApprovalGates, MAX_APPROVAL_GATES } = await import("./intake-brief.ts");
  // The real kp dossier (docs/features/app-master/examples/kp-dossier.json):
  // alphabetical, 15 entries. A blind slice(0,10) kept build/e2e/eval×3 and
  // dropped typecheck, test:unit and test:python:gate.
  const declared = [
    "npm run build", "npm run design:check", "npm run i18n:check", "npm run lint",
    "npm run schemas:check", "npm run taxonomy:check", "npm run test:e2e", "npm run test:eval",
    "npm run test:eval:match", "npm run test:eval:strict", "npm run test:python",
    "npm run test:python:gate", "npm run test:unit", "npm run typecheck",
    "ci: .github/workflows/ci.yml",
  ];
  const picked = selectApprovalGates(declared);
  assert.deepEqual(picked.slice(0, 4), ["npm run typecheck", "npm run lint", "npm run test:unit", "npm run test:python:gate"]);
  assert.ok(picked.length <= MAX_APPROVAL_GATES);
  for (const bad of ["npm run build", "npm run test:e2e", "npm run test:eval", "ci: .github/workflows/ci.yml"]) {
    assert.ok(!picked.includes(bad), `${bad} must not be an executed gate`);
  }
  // Unknown-but-runnable commands survive after the ranked ones; duplicates collapse.
  assert.deepEqual(selectApprovalGates(["make verify", "make verify", "npm test"]), ["npm test", "make verify"]);
  assert.deepEqual(selectApprovalGates([]), []);
});
