// Tenancy guard for the rediscovery feed's Refresh (rediscovery-alerts #1). The
// POST sweep is fired from one team's session, but it called
// sweepRediscoveryAlerts({ signal }) with no workspace — so defaultSweepDeps'
// listJobStatuses() fell to DEFAULT_WORKSPACE_ID and the sweep ranked the DEFAULT
// tenant's roles, then the route returned relevantAlerts(currentWorkspace()) (the
// SESSION tenant's feed). The UI showed "swept N roles" while zero rows appeared.
// The route runs behind cookie auth, so this pins that the sweep and the returned
// feed use the SAME resolved workspace.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");

test("the Refresh sweep and the returned feed both use the caller's workspace", () => {
  assert.match(src, /sweepRediscoveryAlerts\([^)]*workspaceId[^)]*\)/, "the sweep must receive a workspaceId");
  assert.doesNotMatch(
    src,
    /sweepRediscoveryAlerts\(\s*\{\s*signal:\s*request\.signal\s*\}\s*\)/,
    "the sweep must not be called with signal only (bare default-tenant sweep)",
  );
  // The sweep's workspace and the feed read must be the SAME resolved value.
  assert.match(src, /const ws = await currentWorkspace\(\)/, "resolve the workspace once");
  assert.match(src, /relevantAlerts\(ws\)/, "the returned feed must use the same ws the sweep ran on");
});
