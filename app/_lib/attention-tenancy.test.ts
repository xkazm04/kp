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
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { attentionCounts } from "./attention.ts";
import { createPipelineEntry } from "./db/pipeline.ts";
import { DEFAULT_WORKSPACE_ID } from "./db/workspaces.ts";

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
