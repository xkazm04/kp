// Tenant-isolation + auth for the NL command bar (perfect-board). POST
// /api/pipeline/command previewed AND executed against listPipeline() with no
// workspace, so it fell to DEFAULT_WORKSPACE_ID: a recruiter in ANY tenant could
// preview and then MUTATE (bulk-reject + email / advance) the DEFAULT team's
// pipeline. It is also the board's most powerful mutation surface (run_policy
// triggers the global pass; reject_below emails candidates), so it is now
// operator-gated like /api/decisions/*.
//
// Two layers of proof, both under the default `npm run test:unit` runner. The
// route CANNOT be imported here — it pulls next/server, which the worktree test
// runner can't resolve (the NextRequest dual-module artifact) — so the behavioral
// proof runs at the LIB level (the pure affected() over a workspace-scoped
// listPipeline()) and the wiring is pinned by a source guard over route.ts text:
//   1. BEHAVIORAL — listPipeline(ws) isolates by tenant, and affected() over that
//      scoped list surfaces ONLY that team's candidates; a foreign entry is
//      invisible (and therefore unmutatable, since execute acts only on what
//      affected() returns).
//   2. SOURCE GUARD — the route threads the caller's workspace into affected()
//      (via listPipeline(ws)) AND every mutating call, and re-verifies the
//      operator session.
//
// unit-db.ts MUST be the first project import (sets KP_DB_PATH before any store
// module resolves db-path.ts).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { cleanupUnitDb } from "../../../_lib/testing/unit-db.ts";
import { createPipelineEntry, listPipeline } from "../../../_lib/db/pipeline.ts";
import { affected } from "../../../_lib/pipeline-command.ts";

after(() => cleanupUnitDb());

test("affected() over a workspace-scoped list surfaces ONLY the caller's team — a foreign entry is invisible", () => {
  // Two teams each file a low-scoring active candidate on the same role.
  createPipelineEntry({ candidateId: "cmd-a", candidateLabel: "Alice A", jobId: "jobA", jobTitle: "Role A", matchScore: 20, workspaceId: "ws-a" });
  createPipelineEntry({ candidateId: "cmd-b", candidateLabel: "Bob B", jobId: "jobB", jobTitle: "Role B", matchScore: 20, workspaceId: "ws-b" });

  // listPipeline(ws) is the tenant boundary the route feeds into affected().
  const listA = listPipeline("ws-a");
  const listB = listPipeline("ws-b");
  assert.equal(listA.some((e) => e.candidateId === "cmd-b"), false, "ws-a's board never contains ws-b's candidate");

  const rejectBelow = { kind: "reject_below", threshold: 50, jobQuery: null } as const;
  const idsA = new Set(affected(rejectBelow, listA).map((e) => e.id));
  const idsB = new Set(affected(rejectBelow, listB).map((e) => e.id));

  // ws-a's preview sees Alice and NOT Bob (and vice versa) — so the confirm, which
  // acts only on affected()'s result, can never reach across tenants.
  assert.ok(idsA.size >= 1, "ws-a preview is non-empty");
  assert.equal([...idsA].some((id) => idsB.has(id)), false, "no id is shared across the two tenants' previews");

  // advance_top is likewise per-tenant.
  const advanceTop = { kind: "advance_top", count: 10 } as const;
  const advA = new Set(affected(advanceTop, listA).map((e) => e.id));
  const advB = new Set(affected(advanceTop, listB).map((e) => e.id));
  assert.equal([...advA].some((id) => advB.has(id)), false, "advance_top never crosses tenants");
});

test("the command route threads the caller's workspace into preview AND every mutation, and is operator-gated (source guard)", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.join(dir, "route.ts"), "utf8");
  // Resolves the caller's tenant once...
  assert.match(src, /const ws = await currentWorkspace\(\)/, "the route must resolve currentWorkspace()");
  // ...and scopes the preview/execute set to it (listPipeline(ws) feeds affected()).
  // UPDATED DELIBERATELY (not relaxed): this used to pin the exact two-argument call
  // `affected(cmd, listPipeline(ws))`, which was ALSO the shape of a second bug — with
  // no axis, affected() falls back to the SHIPPED axis and mis-answers "is this entry
  // terminal?" on a workspace that composed its own columns. The tenancy half is pinned
  // as before (listPipeline must carry `ws`); the axis argument is now REQUIRED too, so
  // the old, axis-less call can never come back.
  const affectedCalls = src.match(/affected\(cmd,[^\n]*\)/g) ?? [];
  assert.ok(affectedCalls.length >= 2, "both the preview and the execute resolve the affected set");
  for (const call of affectedCalls) {
    assert.match(call, /affected\(cmd,\s*listPipeline\(ws\),\s*axis\)/, `affected() must be fed the workspace-scoped board AND its axis: ${call}`);
  }
  assert.match(src, /const axis = getPipelineAxis\(ws\)\.stages/, "the axis must be THIS workspace's board, not the shipped literal");
  // ...and hands it to the execute loop. UPDATED DELIBERATELY (not relaxed): the
  // per-target loop moved to ./execute.ts so its count/failed/commsFailed arithmetic
  // is testable with a store double, so the tenancy contract now spans two files —
  // the route must give the loop THIS workspace, and every store call inside the
  // loop must carry it. A bare call still falls back to DEFAULT.
  assert.match(src, /executeCommandTargets\([\s\S]{0,300}?workspaceId: ws/, "the execute loop must be given the caller's workspace");
  const exec = readFileSync(path.join(dir, "execute.ts"), "utf8");
  const actCalls = exec.match(/deps\.actOn\([^\n]*\)/g) ?? [];
  assert.ok(actCalls.length >= 2, "both reject + advance mutations are present");
  for (const call of actCalls) {
    assert.match(call, /,\s*ws\s*\)/, `the store action must be workspace-scoped: ${call.slice(0, 60)}…`);
  }
  assert.match(exec, /deps\.recordEvent\([\s\S]{0,200}?\bws\b/, "the comms-failure marker is workspace-scoped too");
  // ...and re-verifies the operator session (defense in depth).
  assert.match(src, /requireOperator\(\)/, "the route must re-verify the operator session");
});
