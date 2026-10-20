// GET /api/analytics?job= — the route half of the role axis (challenge r04
// analytics-dashboard/B). The store has scoped a cohort by job since 90a95824d, but
// the route never passed one, so no reader could reach the axis. Driven as the REAL
// handler against a throwaway SQLite file.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { cleanupUnitDb } from "../../_lib/testing/unit-db.ts";

register(new URL("../../_lib/testing/next-server-hooks.mjs", import.meta.url));

// No KP_OPERATOR_PASSWORD: open dev mode resolves the caller to the default workspace.
const { GET } = await import("./route.ts");
const { createPipelineEntry } = await import("../../_lib/db/pipeline.ts");
const { DEFAULT_WORKSPACE_ID } = await import("../../_lib/db/workspaces.ts");

after(() => cleanupUnitDb());

type Payload = { jobId: string | null; total: number; jobScope: { jobId: string; withheld: { figure: string }[] } | null };
const read = async (qs: string): Promise<Payload> =>
  (await (await GET(new Request(`http://localhost/api/analytics${qs}`))).json()) as Payload;

createPipelineEntry({ candidateId: "r-a1", candidateLabel: "A one", jobId: "route-job-a", jobTitle: "Route A", workspaceId: DEFAULT_WORKSPACE_ID });
createPipelineEntry({ candidateId: "r-a2", candidateLabel: "A two", jobId: "route-job-a", jobTitle: "Route A", workspaceId: DEFAULT_WORKSPACE_ID });
createPipelineEntry({ candidateId: "r-b1", candidateLabel: "B one", jobId: "route-job-b", jobTitle: "Route B", workspaceId: DEFAULT_WORKSPACE_ID });
// Another team's requisition, in another workspace.
createPipelineEntry({ candidateId: "r-x1", candidateLabel: "X one", jobId: "route-job-x", jobTitle: "Other team", workspaceId: "route-other-ws" });

test("?job=A scopes the payload to that role and echoes it", async () => {
  const a = await read("?job=route-job-a&days=30");
  assert.equal(a.jobId, "route-job-a");
  assert.equal(a.total, 2);
  assert.equal(a.jobScope?.jobId, "route-job-a");
  assert.ok((a.jobScope?.withheld.length ?? 0) > 0, "a role view names what it withholds");
});

test("a job of ANOTHER workspace yields an empty cohort, never that team's figures", async () => {
  const x = await read("?job=route-job-x&days=30");
  assert.equal(x.total, 0);
  assert.equal(x.jobId, "route-job-x");
});

test("a blank ?job= is the workspace view, and the memo never serves one scope to the other", async () => {
  const wide = await read("?job=&days=30");
  assert.equal(wide.jobId, null);
  assert.equal(wide.jobScope, null);
  // The default workspace may self-seed a demo corpus, so the workspace total is
  // "at least our three", never a role's count.
  assert.ok(wide.total >= 3, `workspace view counts every role (got ${wide.total})`);
  // Same window, served back-to-back inside the memo TTL: each scope is its own entry.
  assert.equal((await read("?job=route-job-b&days=30")).total, 1);
  assert.equal((await read("?days=30")).total, wide.total);
  assert.equal((await read("?job=route-job-a&days=30")).total, 2);
});
