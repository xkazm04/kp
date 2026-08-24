// The sidebar attention badges (Decisions / Pipeline / Schedule / Jobs / Channels)
// are the first thing a recruiter reads on every page. `attentionCounts()` used to
// take NO workspace, so all three of its store reads fell through to
// DEFAULT_WORKSPACE_ID and every badge reported the DEFAULT team's backlog to a
// recruiter signed into any other team — a hint that actively misleads, and the
// last workspace-blind read path in the recruiter shell.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { cleanupUnitDb, UNIT_DB_PATH } from "./testing/unit-db.ts";
import { attentionCounts } from "./attention.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { setDecisionConfig } from "./decision-config-store.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";
import { appendTurnWithProposals, createThread, resolveProposal } from "./db/companion.ts";

after(() => cleanupUnitDb());

const WS_B = "team-attention-b";

let seq = 0;
function entryIn(workspaceId: string, stage: string) {
  seq += 1;
  return createPipelineEntry({
    candidateId: `att-c${seq}`,
    candidateLabel: `Attention Candidate ${seq}`,
    jobId: `att-job-${seq}`,
    jobTitle: "Attention Test Role",
    contact: `att-c${seq}@example.com`,
    stage,
    workspaceId,
  }).entry;
}

test("counts are computed for the workspace asked for, not the default one", () => {
  const defaultBefore = attentionCounts(DEFAULT_WORKSPACE_ID);
  const bBefore = attentionCounts(WS_B);

  // Two fresh arrivals in team B only. "Accepted" is the entry stage the Channels
  // badge counts, so this moves exactly one bucket.
  entryIn(WS_B, "Accepted");
  entryIn(WS_B, "Accepted");

  const bAfter = attentionCounts(WS_B);
  assert.equal(bAfter.channels, bBefore.channels + 2, "team B sees its own arrivals");

  const defaultAfter = attentionCounts(DEFAULT_WORKSPACE_ID);
  assert.equal(defaultAfter.channels, defaultBefore.channels, "the default team's badge must not move");
});

test("an entry in the default workspace does not leak into another team's counts", () => {
  const bBefore = attentionCounts(WS_B);
  entryIn(DEFAULT_WORKSPACE_ID, "Accepted");
  assert.equal(attentionCounts(WS_B).channels, bBefore.channels, "team B is unaffected by the default team's inbox");
});

test("omitting the argument still resolves to the default workspace", () => {
  // Background callers and older tests rely on this; the parameter is additive.
  assert.deepEqual(attentionCounts(), attentionCounts(DEFAULT_WORKSPACE_ID));
});

// --- source contract on the two call sites ---------------------------------------
// Both must PASS the session's workspace. Scoping the module while leaving a caller
// argument-less would restore the exact bug with no test failing.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const routeSrc = readFileSync(path.join(HERE, "..", "api", "attention", "route.ts"), "utf8");
const navSrc = readFileSync(path.join(HERE, "..", "features", "shell", "WorkspaceNav.tsx"), "utf8");

test("both call sites pass the session workspace", () => {
  assert.match(routeSrc, /attentionCounts\(await currentWorkspace\(\)\)/, "/api/attention scopes to the session");
  assert.match(navSrc, /attentionCounts\(await currentWorkspace\(\)\)/, "the server-rendered nav scopes to the session");
});

// --- the aging badge honors the SLA contract, not the shipped-axis coincidence ---
// slaForStage documents a non-positive threshold as "this stage never ages", and
// STAGE_SLA_DEFAULTS.Hired is 0. The count is `days >= sla`, which reads 0 as
// "always stale" — the exact inverse. On the shipped board the terminal-role
// exclusion hides that, because the only 0-day stage IS the terminal one. A
// workspace that MIGRATES its board unhides it: rename the terminal column and
// retire the old id, and every entry still standing on the retired id resolves to
// no live role, escapes the exclusion, and is counted as aging from day 0 with no
// board move able to clear it (the board doesn't draw a retired column).
const WS_MIGRATED = "team-attention-migrated";
setDecisionConfig(
  "pipelineStages",
  {
    stages: [
      { id: "Accepted", label: "Applied", role: "entry" },
      { id: "Screened", label: "Screened", role: "screening" },
      { id: "Interview", label: "Interview", role: "interview" },
      { id: "Offer", label: "Offer", role: "offer" },
      { id: "Placed", label: "Placed", role: "terminal" },
    ],
    retired: [{ id: "Hired", label: "Hired (retired)", role: "terminal" }],
  },
  WS_MIGRATED
);

test("an entry stranded on a RETIRED 0-day stage is not counted as aging forever", () => {
  const before = attentionCounts(WS_MIGRATED).pipeline;
  // A candidate hired before the migration: stage 'Hired' (now retired), status
  // stays 'active' by design (pipeline-status.ts header).
  entryIn(WS_MIGRATED, "Hired");
  assert.equal(
    attentionCounts(WS_MIGRATED).pipeline,
    before,
    "a stage whose SLA is 0 never ages — the badge must not latch on a placed candidate"
  );
});

test("a genuinely aging entry is still counted (the badge is not simply switched off)", () => {
  const before = attentionCounts(WS_MIGRATED).pipeline;
  const aging = entryIn(WS_MIGRATED, "Offer"); // Offer's default SLA is 3 days
  assert.equal(attentionCounts(WS_MIGRATED).pipeline, before, "a fresh Offer entry is not yet aging");
  // Backdate the stage clock past the SLA on a separate write connection to the
  // same throwaway file (the way db.ts and the sibling stores share kp.sqlite).
  const d = new Database(UNIT_DB_PATH);
  d.prepare(`UPDATE pipeline_entries SET stage_changed_at = ? WHERE id = ?`).run(
    new Date(Date.now() - 9 * 86_400_000).toISOString(),
    aging.id
  );
  d.close();
  assert.equal(attentionCounts(WS_MIGRATED).pipeline, before + 1, "9 days at Offer is past its 3-day SLA");
});

// ---- the companion bucket (WP3) --------------------------------------------
//
// The sixth key, and the only one no tab declares: Candi lives in a dock, not a
// tab, so the count is read by the dock's own state line. It is deliberately NOT
// folded into `decisions` — that count beacons the ControlDock orb and its one
// click routes to the Decisions tab, which has no affordance that can resolve a
// companion proposal. Both halves are asserted here: the bucket counts, and it
// does not leak into the bucket whose affordance cannot clear it.
const WS_PROPOSALS = "team-attention-proposals";

function openProposalIn(workspaceId: string) {
  const thread = createThread("", workspaceId);
  const written = appendTurnWithProposals(
    {
      threadId: thread.id,
      role: "assistant",
      content: "I could re-screen her.",
      proposals: [
        { kind: "run_analysis", payload: { actionId: "run_analysis", params: {}, summary: { key: "runAnalysis" } } },
      ],
    },
    workspaceId
  );
  assert.ok(written);
  return written.proposals[0].id;
}

test("an unresolved companion proposal is counted, scoped to its own tenant", () => {
  const before = attentionCounts(WS_PROPOSALS);
  const otherBefore = attentionCounts(WS_B).companion;
  openProposalIn(WS_PROPOSALS);
  const after = attentionCounts(WS_PROPOSALS);
  assert.equal(after.companion, before.companion + 1);
  assert.equal(attentionCounts(WS_B).companion, otherBefore, "another team's dock must not see it");
  // It stays out of the bucket that beacons the orb and routes to Decisions.
  assert.equal(after.decisions, before.decisions, "a proposal is not a pipeline approval gate");
});

test("answering a proposal clears it from the count", () => {
  const id = openProposalIn(WS_PROPOSALS);
  const before = attentionCounts(WS_PROPOSALS).companion;
  assert.equal(resolveProposal(id, "declined", WS_PROPOSALS), true);
  assert.equal(attentionCounts(WS_PROPOSALS).companion, before - 1);
});
