// Tenancy guard for the job close route. closeEntriesByJobId has a defaulted
// workspaceId, so the close route (unlike its /publish mirror, which threads
// currentWorkspace() into reopenEntriesByJobId) fell to DEFAULT_WORKSPACE_ID and
// withdrew none of a non-default team's in-flight candidates — the close
// "succeeded" with withdrawn:0 while the funnel kept chasing a retired role. The
// route runs behind cookie auth, so this is a SOURCE GUARD that close resolves
// the workspace and passes it to closeEntriesByJobId, matching publish.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));

test("POST /api/jobs/[id]/close scopes the entry withdrawal to the caller's workspace", () => {
  const src = readFileSync(path.join(dir, "[id]/close/route.ts"), "utf8");
  assert.match(src, /currentWorkspace\(\)/, "close must resolve the caller's workspace");
  assert.match(src, /closeEntriesByJobId\([^)]*\bws\b[^)]*\)/, "close must pass the workspace to closeEntriesByJobId");
  assert.doesNotMatch(src, /closeEntriesByJobId\(id\)/, "close must not call closeEntriesByJobId with a bare id");
});
