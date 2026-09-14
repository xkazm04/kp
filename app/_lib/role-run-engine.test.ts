// Import the REAL native better-sqlite3 first (never a shim): this is an INTEGRATION
// test, so every stage below reads and writes a genuine on-disk SQLite file created by
// the actual schema — jobs and pipeline_entries from core.ts's own DDL, the ledger from
// role-runs.ts's. Nothing here is a hand-copied inline schema.
import "better-sqlite3";
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
// IMPORT ORDER IS LOAD-BEARING: unit-db sets KP_DB_PATH before anything touches db-path.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import {
  SCREEN_ADVANCE_FLOOR,
  SLATE_CAP,
  advanceRoleRun,
  commitRoleRunStageGate,
  type StageRunner,
} from "./role-run-engine.ts";
import { getOrCreateRoleRun, latestBranchArtifact, latestStageArtifact, listStageArtifacts } from "./db/role-runs.ts";
import { isRoleRunGateSpent, roleRunGateToken, ScreenWaveApprovalError } from "./role-run-gates.ts";
import { resetScreenWaveApprovalSpendForTests } from "./screen-wave-approval.ts";
import type { OfferDraftPayload, RoleSpecPayload, ScreenPayload, SlatePayload } from "./role-run-stages.ts";
import { ensureDb } from "./db/core.ts";
import { insertJob } from "./job-ingest.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import type { JobRecord } from "./db/core.ts";

// ONE ROLE, END TO END. The product's claim is "JD in; sourced and screened candidates;
// case; interview; scorecard; offer draft — the human only approves the decisions that
// affect a person." These tests are that sentence, executed: a real job row, real
// pipeline entries, seven real artifacts in the ledger, and exactly three places where
// the run stops and waits.

const JOB_ID = "jd-senior-java";

function seedJob(id: string, title: string, skills: string[]): void {
  insertJob(
    {
      id,
      title,
      requirements: skills.map((skill) => ({ skill, kind: "skill", hardness: "must" })),
    } as unknown as JobRecord,
    undefined,
    "published"
  );
}

function seedCandidate(jobId: string, candidateId: string, matchScore: number | null): string {
  const { entry } = createPipelineEntry({
    candidateId,
    // A real name on the BOARD — which is exactly right. The board is where a person's
    // name belongs; the ledger is where it must never appear. That contrast is the
    // point of the PII assertion below.
    candidateLabel: `Candidate ${candidateId}`,
    jobId,
    jobTitle: "Senior Java Engineer",
    matchScore,
  });
  return entry.id;
}

/** Drive the run to a standstill: keep advancing until a pass produces nothing. Models
 *  the scheduler calling the pass repeatedly, which is the only way a run makes progress. */
async function runToStandstill(runId: string, maxPasses = 12) {
  let last = await advanceRoleRun(runId);
  let passes = 1;
  while (last.produced.length > 0 && passes < maxPasses) {
    last = await advanceRoleRun(runId);
    passes += 1;
  }
  return last;
}

/** Resolve a parked branch the way a recruiter surface would: preview the set, sign it,
 *  commit inside the window. */
function approve(runId: string, branchRef: string, gate: Parameters<typeof roleRunGateToken>[1], policyVersion: string, decision: "approved" | "declined" = "approved") {
  const now = Date.now();
  const token = roleRunGateToken(runId, gate, policyVersion, [branchRef], now);
  return commitRoleRunStageGate({
    runId,
    branchRef,
    gate,
    decision,
    policyVersion,
    subjectRefs: [branchRef],
    token,
    approver: "recruiter-1",
    now,
  });
}

before(() => {
  ensureDb();
  seedJob(JOB_ID, "Senior Java Engineer", ["java", "sql", "kafka"]);
});
beforeEach(() => resetScreenWaveApprovalSpendForTests());
after(() => cleanupUnitDb());

// --- the full thread ---------------------------------------------------------

test("one role runs JD → offer draft, stopping at exactly three gates", async () => {
  const strong = seedCandidate(JOB_ID, "cand-strong", 88);
  const { run } = getOrCreateRoleRun({ jobId: JOB_ID });
  const policy = `screen-1@${SCREEN_ADVANCE_FLOOR}`;

  // PASS 1 — everything up to the first gate runs unattended.
  const first = await runToStandstill(run.id);
  assert.deepEqual(
    first.awaiting.map((a) => a.gate),
    ["rejection"],
    "the run reaches the screening decision and stops there — it does not screen and advance in one breath"
  );

  const spec = latestStageArtifact(run.id, "role_spec")?.payload as RoleSpecPayload;
  assert.deepEqual(spec.rubricKeys, ["java", "sql", "kafka"], "the rubric is the ROLE's graded requirements, not a per-candidate derivation");
  assert.deepEqual(spec.lintFindings, [], "a JD with requirements and a title lints clean");

  const slate = latestStageArtifact(run.id, "slate")?.payload as SlatePayload;
  assert.ok(slate.candidates.some((c) => c.candidateRef === strong), "the slate is the run's branch list");

  const screen = latestStageArtifact(run.id, "screen", strong)?.payload as ScreenPayload;
  assert.equal(screen.decisions[0].route, "advance", "88 clears the floor");
  assert.equal(screen.decisions[0].matchScore, 88);

  // GATE 1 — rejection. Nothing moves until a human commits.
  const beforeGate = listStageArtifacts(run.id).length;
  assert.deepEqual((await advanceRoleRun(run.id)).produced, [], "a parked branch produces nothing, however often the pass runs");
  assert.equal(listStageArtifacts(run.id).length, beforeGate);

  approve(run.id, strong, "rejection", policy);

  // PASS 2 — case assignment runs unattended, then the invite gate.
  const second = await runToStandstill(run.id);
  assert.deepEqual(second.awaiting.map((a) => a.gate), ["interview_invite"]);
  assert.ok(latestStageArtifact(run.id, "case_assignment", strong), "the case was assigned with nobody asked — it is not a verdict");

  // GATE 2 — interview invite.
  approve(run.id, strong, "interview_invite", "invite-1");

  // PASS 3 — scorecard runs unattended, then the offer gate.
  const third = await runToStandstill(run.id);
  assert.deepEqual(third.awaiting.map((a) => a.gate), ["offer"], "the scorecard is NOT a fourth gate");
  const card = latestStageArtifact(run.id, "scorecard", strong);
  assert.equal(card?.status, "complete");

  const draft = latestStageArtifact(run.id, "offer_draft", strong)?.payload as OfferDraftPayload;
  assert.equal(draft.drafts[0].entryId, strong);
  assert.ok(draft.drafts[0].ttlDays > 0, "the draft carries real offer-policy terms");

  // GATE 3 — offer. The run DRAFTED; it never minted. The draft carries no offer
  // reference, because there is no offer yet: createOffer is called by the gate commit,
  // never by the run (ADR-0009 Consequences). `offerRef` being absent is the assertion —
  // an artifact that named a minted offer would mean the run had already made it.
  assert.equal(Object.hasOwn(draft.drafts[0], "offerRef"), false);
  assert.equal(latestStageArtifact(run.id, "offer_draft", strong)?.status, "awaiting_approval");

  approve(run.id, strong, "offer", "offer-1");

  // And the whole thread is in the ledger, once, in order.
  const mine = listStageArtifacts(run.id).filter((a) => a.branchRef === null || a.branchRef === strong);
  const kinds = mine.map((a) => a.kind);
  assert.deepEqual(
    [...new Set(kinds)],
    ["role_spec", "slate", "screen", "case_assignment", "interview", "scorecard", "offer_draft"],
    "seven stages, every one persisted"
  );
});

test("each stage consumes the previous stage's artifact — never in-memory state", async () => {
  seedJob("jd-consume", "Consumer", ["go"]);
  const c = seedCandidate("jd-consume", "cand-consume", 90);
  const { run } = getOrCreateRoleRun({ jobId: "jd-consume" });

  const seen: { kind: string; previousKind: string | null }[] = [];
  const spy =
    (inner: StageRunner): StageRunner =>
    (ctx) => {
      seen.push({ kind: ctx.kind, previousKind: ctx.previous?.kind ?? null });
      return inner(ctx);
    };
  const { DEFAULT_STAGE_RUNNERS } = await import("./role-run-engine.ts");
  const runners = Object.fromEntries(
    Object.entries(DEFAULT_STAGE_RUNNERS).map(([k, v]) => [k, spy(v as StageRunner)])
  ) as Record<string, StageRunner>;

  await advanceRoleRun(run.id, { runners });
  approve(run.id, c, "rejection", `screen-1@${SCREEN_ADVANCE_FLOOR}`);
  await advanceRoleRun(run.id, { runners });

  assert.deepEqual(seen[0], { kind: "role_spec", previousKind: null }, "S0 has nothing before it");
  assert.deepEqual(seen[1], { kind: "slate", previousKind: "role_spec" });
  assert.deepEqual(seen[2], { kind: "screen", previousKind: "slate" }, "the first per-candidate stage consumes the run-wide slate");
  assert.deepEqual(seen[3], { kind: "case_assignment", previousKind: "screen" });
});

// --- resumability (ADR-0009 §1) ----------------------------------------------

test("a pass stopped at its ceiling resumes exactly where it stopped, producing nothing twice", async () => {
  seedJob("jd-resume", "Resumable", ["rust"]);
  const c = seedCandidate("jd-resume", "cand-resume", 95);
  const { run } = getOrCreateRoleRun({ jobId: "jd-resume" });

  // The 20-minute execution ceiling, modelled: one artifact per pass.
  const a = await advanceRoleRun(run.id, { maxStages: 1 });
  assert.deepEqual(a.produced.map((p) => p.kind), ["role_spec"]);
  assert.equal(a.ceilingHit, true);

  const b = await advanceRoleRun(run.id, { maxStages: 1 });
  assert.deepEqual(b.produced.map((p) => p.kind), ["slate"], "the resumed pass does NOT re-run S0");

  const rest = await runToStandstill(run.id);
  assert.deepEqual(rest.awaiting.map((x) => x.gate), ["rejection"]);

  // NON-VACUITY: one artifact per kind, i.e. nothing was produced twice across the four
  // separate passes. A resume that re-ran a stage would double these.
  const counts = new Map<string, number>();
  for (const art of listStageArtifacts(run.id)) counts.set(art.kind, (counts.get(art.kind) ?? 0) + 1);
  assert.deepEqual([...counts.entries()].sort(), [["role_spec", 1], ["screen", 1], ["slate", 1]]);
  assert.equal(c.length > 0, true);
});

// --- the gates actually gate (ADR-0009 §3) -----------------------------------

test("a branch cannot be advanced past a gate without a valid, attributed, unspent approval", async () => {
  seedJob("jd-gate", "Gated", ["java"]);
  const c = seedCandidate("jd-gate", "cand-gate", 91);
  const { run } = getOrCreateRoleRun({ jobId: "jd-gate" });
  await runToStandstill(run.id);
  const policy = `screen-1@${SCREEN_ADVANCE_FLOOR}`;
  const now = Date.now();
  const good = roleRunGateToken(run.id, "rejection", policy, [c], now);
  const base = { runId: run.id, branchRef: c, gate: "rejection" as const, decision: "approved" as const, policyVersion: policy, subjectRefs: [c], approver: "recruiter-1", now };

  assert.throws(() => commitRoleRunStageGate({ ...base, token: null }), (e: unknown) => e instanceof ScreenWaveApprovalError && e.reason === "required");
  assert.throws(() => commitRoleRunStageGate({ ...base, token: good, approver: "" }), (e: unknown) => e instanceof ScreenWaveApprovalError && e.reason === "unattributed");
  // A token signed over a DIFFERENT set — the cohort drifted since the preview.
  const stale = roleRunGateToken(run.id, "rejection", policy, [c, "m-someone-else"], now);
  assert.throws(() => commitRoleRunStageGate({ ...base, token: stale }), (e: unknown) => e instanceof ScreenWaveApprovalError && e.reason === "mismatch");

  // NON-VACUITY: after three refusals the branch has NOT moved...
  assert.equal(latestBranchArtifact(run.id, c)?.status, "awaiting_approval");
  assert.deepEqual((await advanceRoleRun(run.id)).produced, []);

  // ...and the valid approval does move it.
  commitRoleRunStageGate({ ...base, token: good });
  assert.equal(latestBranchArtifact(run.id, c)?.status, "complete");
  assert.ok((await advanceRoleRun(run.id)).produced.length > 0);
});

test("a replayed gate commit cannot resolve the branch twice, and the token is burned either way", async () => {
  seedJob("jd-replay", "Replay", ["java"]);
  const c = seedCandidate("jd-replay", "cand-replay", 93);
  const { run } = getOrCreateRoleRun({ jobId: "jd-replay" });
  await runToStandstill(run.id);

  const policy = `screen-1@${SCREEN_ADVANCE_FLOOR}`;
  const now = Date.now();
  const token = roleRunGateToken(run.id, "rejection", policy, [c], now);
  const input = { runId: run.id, branchRef: c, gate: "rejection" as const, decision: "approved" as const, policyVersion: policy, subjectRefs: [c], token, approver: "recruiter-1", now };

  commitRoleRunStageGate(input);
  // TWO independent defences, and this is the outer one: the branch is no longer parked,
  // so the replay is refused on STATE before the token is even examined. (The inner one
  // — the token itself being spent — is pinned in role-run-gates.test.ts, where the
  // state check cannot mask it.) A replay must not run the adverse act twice whichever
  // of the two fires first.
  assert.throws(() => commitRoleRunStageGate(input), /not parked at the rejection gate/);
  assert.equal(isRoleRunGateSpent(token, now), true, "and the token was spent by the commit that succeeded");

  const screens = listStageArtifacts(run.id).filter((a) => a.branchRef === c && a.kind === "screen");
  assert.equal(screens.length, 2, "the ask and exactly one answer — never two answers");
});

test("the run never mints: no stage runner reaches createOffer or createScheduleInvite", () => {
  // The non-vacuous form of "the offer stage drafts and stops". The asymmetry ADR-0009
  // names is structural — the minting calls live at the gate commit, so the engine must
  // not be able to reach them at all, whatever a future runner author intends.
  const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "role-run-engine.ts"), "utf8");
  // The IMPORTS, not the prose — the module names both minting calls in comments
  // explaining why it does not make them, and a substring scan over the whole file
  // would fail on its own documentation.
  const imports = [...src.matchAll(/^import\s[\s\S]*?from\s+"([^"]+)";$/gm)];
  const specifiers = imports.map((m) => m[1]);
  for (const forbidden of ["./offers-store.ts", "./schedule-store.ts"]) {
    assert.equal(specifiers.includes(forbidden), false, `role-run-engine.ts must not import ${forbidden}`);
  }
  const importedNames = imports.map((m) => m[0]).join("\n");
  for (const forbidden of ["createOffer", "createScheduleInvite"]) {
    assert.equal(importedNames.includes(forbidden), false, `role-run-engine.ts must not import ${forbidden}`);
  }
  // POSITIVE CONTROL: it DOES import the read-only policy helper, so this is not just
  // asserting against a regex that matched nothing.
  assert.ok(specifiers.includes("./offer-policy.ts"), "the offer draft still reads real offer-policy terms");
});

test("the ledger records who approved as a hash, never as a name", async () => {
  seedJob("jd-approver", "Approver", ["java"]);
  const c = seedCandidate("jd-approver", "cand-approver", 94);
  const { run } = getOrCreateRoleRun({ jobId: "jd-approver" });
  await runToStandstill(run.id);

  const resolved = approve(run.id, c, "rejection", `screen-1@${SCREEN_ADVANCE_FLOOR}`);
  const payload = resolved.payload as { approverRef?: string; decision?: string };
  assert.equal(payload.decision, "approved");
  assert.match(payload.approverRef ?? "", /^[0-9a-f]{32}$/);
  assert.equal(
    JSON.stringify(listStageArtifacts(run.id)).includes("recruiter-1"),
    false,
    "the recruiter's identity lives in the sealed decision record, not in the ledger"
  );
});

// --- §4: a gate blocks a candidate, not the run -------------------------------

test("one candidate parked at a gate does not stop the other branches", async () => {
  seedJob("jd-fanout", "Fanout", ["java"]);
  const a = seedCandidate("jd-fanout", "cand-a", 92);
  const b = seedCandidate("jd-fanout", "cand-b", 85);
  const { run } = getOrCreateRoleRun({ jobId: "jd-fanout" });
  const policy = `screen-1@${SCREEN_ADVANCE_FLOOR}`;

  await runToStandstill(run.id);
  approve(run.id, a, "rejection", policy); // only A is reviewed

  const after = await runToStandstill(run.id);
  const gatesByBranch = new Map(after.awaiting.map((x) => [x.branchRef, x.gate]));
  assert.equal(gatesByBranch.get(a), "interview_invite", "A moved on to the next gate");
  assert.equal(gatesByBranch.get(b), "rejection", "B is still where its own recruiter left it — and stopped nobody");
  assert.equal(latestStageArtifact(run.id, "case_assignment", b), null, "B produced nothing while parked");
});

test("a declined gate ends that branch, and the run completes when every branch is terminal", async () => {
  seedJob("jd-decline", "Decline", ["java"]);
  const only = seedCandidate("jd-decline", "cand-decline", 96);
  const { run } = getOrCreateRoleRun({ jobId: "jd-decline" });
  await runToStandstill(run.id);

  approve(run.id, only, "rejection", `screen-1@${SCREEN_ADVANCE_FLOOR}`, "declined");
  assert.equal(latestBranchArtifact(run.id, only)?.status, "terminal");

  const done = await advanceRoleRun(run.id);
  assert.equal(done.status, "complete", "every branch terminal = the run is over, §4");
  assert.deepEqual(done.produced, [], "and a complete run produces nothing on a later pass");
});

// --- the honest edges ---------------------------------------------------------

test("a JD with no graded requirements says so rather than producing a rubric it does not have", async () => {
  insertJob({ id: "jd-thin", title: "Thin Role" } as unknown as JobRecord, undefined, "published");
  seedCandidate("jd-thin", "cand-thin", 99);
  const { run } = getOrCreateRoleRun({ jobId: "jd-thin" });
  await advanceRoleRun(run.id);

  const spec = latestStageArtifact(run.id, "role_spec")?.payload as RoleSpecPayload;
  assert.deepEqual(spec.rubricKeys, []);
  assert.deepEqual(spec.lintFindings, ["no_graded_requirements"], "every downstream score would otherwise claim a rigour the JD never had");
});

test("a run for a job that does not exist is cancelled with the reason recorded, not thrown away", async () => {
  const { run } = getOrCreateRoleRun({ jobId: "jd-does-not-exist" });
  const result = await advanceRoleRun(run.id);
  assert.equal(result.status, "cancelled");
  const spec = latestStageArtifact(run.id, "role_spec");
  assert.equal(spec?.status, "terminal");
  assert.deepEqual((spec?.payload as RoleSpecPayload).lintFindings, ["job_not_found"]);

  // And a later pass does not retry S0 forever.
  assert.deepEqual((await advanceRoleRun(run.id)).produced, []);
});

test("a slate is capped, and says so when it cut somebody", async () => {
  seedJob("jd-big", "Big", ["java"]);
  for (let i = 0; i < SLATE_CAP + 3; i += 1) seedCandidate("jd-big", `cand-big-${i}`, 50);
  const { run } = getOrCreateRoleRun({ jobId: "jd-big" });
  await advanceRoleRun(run.id, { maxStages: 2 });

  const slate = latestStageArtifact(run.id, "slate")?.payload as SlatePayload;
  assert.equal(slate.candidates.length, SLATE_CAP);
  assert.equal(slate.truncated, true, "a slate silently cut at twenty reads as 'twenty candidates existed'");
});

test("no artifact in a full run carries a candidate's name, even though the board rows do", async () => {
  // The positive control that keeps this from being vacuous: the BOARD carries the
  // label, so a ledger that accidentally copied an entry across would be caught here.
  seedJob("jd-pii", "Pii", ["java"]);
  const c = seedCandidate("jd-pii", "cand-pii", 97);
  const { run } = getOrCreateRoleRun({ jobId: "jd-pii" });
  await runToStandstill(run.id);
  approve(run.id, c, "rejection", `screen-1@${SCREEN_ADVANCE_FLOOR}`);
  await runToStandstill(run.id);

  const board = ensureDb().prepare(`SELECT candidate_label AS l FROM pipeline_entries WHERE id = ?`).get(c) as { l: string };
  assert.equal(board.l, "Candidate cand-pii", "positive control: the name IS on the board");
  assert.equal(
    JSON.stringify(listStageArtifacts(run.id)).includes(board.l),
    false,
    "and it is nowhere in the ledger — which is what makes a read-boundary consent withhold sufficient"
  );
});
