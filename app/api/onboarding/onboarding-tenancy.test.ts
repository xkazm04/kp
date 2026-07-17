// Tenancy source-guard for the onboarding list/create route
// (candidate-onboarding-hand-off #3). startRun stamps a run with the entry's
// workspace, but the GET reads (listRuns/listTemplates/listPipeline) and the POST
// createTemplate write fell to DEFAULT_WORKSPACE_ID — so a non-default team's runs
// were invisible to their own recruiters and their template names leaked into the
// default tenant. The route runs behind cookie auth, so this pins that the route
// derives currentWorkspace() and threads it into every tenant-scoped store call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const src = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "route.ts"), "utf8");

test("the onboarding route resolves the caller's workspace and threads it into every tenant-scoped read/write", () => {
  assert.match(src, /currentWorkspace\(\)/, "the route must resolve currentWorkspace()");
  assert.match(src, /listRuns\(\s*ws\s*\)/, "listRuns must be workspace-scoped");
  assert.match(src, /listTemplates\(\s*ws\s*\)/, "listTemplates must be workspace-scoped");
  assert.match(src, /createTemplate\([^)]*\bws\b[^)]*\)/, "createTemplate must be workspace-scoped");
  assert.match(src, /listPipeline\(\s*ws\s*\)/, "listPipeline reads must be workspace-scoped");
  assert.doesNotMatch(src, /listRuns\(\)/, "no bare listRuns() call may remain");
  assert.doesNotMatch(src, /listTemplates\(\)/, "no bare listTemplates() call may remain");
});
