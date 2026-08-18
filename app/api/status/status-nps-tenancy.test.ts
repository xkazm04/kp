// The public status surfaces are TOKEN-driven — there is no session to read a tenant
// from — so every store read must derive the workspace from the entry the token
// resolves to. `/api/status/[token]/decisions` always did; its two siblings did not:
//
//   /api/status/[token]        called getPipelineEntry(entryId) with no workspace
//   /api/status/[token]/nps    same, plus candidateNpsFor / recordCandidateNps
//
// Both fell through to DEFAULT_WORKSPACE_ID, so on a multi-workspace deployment a
// non-default team's candidate got a 404 on their own status link, and any score
// that did land was filed under the DEFAULT team's candidate-experience metric.
//
// Source-level, matching status-decisions.test.ts: these handlers can't be imported
// under the unit runner without a request scope, and the contract being pinned is
// "which argument is passed", which the source states exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const statusSrc = readFileSync(path.join(HERE, "[token]", "route.ts"), "utf8");
const npsSrc = readFileSync(path.join(HERE, "[token]", "nps", "route.ts"), "utf8");

test("the status route resolves the entry on ITS OWN workspace, not the default", () => {
  // Hoisted to a const (matching the NPS route below) because the workspace is
  // now needed TWICE: once to read the entry, once to resolve the board axis that
  // projects its stage into a candidate-facing status. The guarantee is unchanged
  // — the tenant is derived from the entry, never defaulted.
  assert.match(statusSrc, /const workspaceId = getEntryWorkspace\(entryId\)/, "tenant derived from the entry");
  assert.match(statusSrc, /getPipelineEntry\(entryId, workspaceId\)/, "the entry read is scoped");
  assert.doesNotMatch(statusSrc, /getPipelineEntry\(entryId\)\s*[;,)]/, "no bare, default-workspace read may remain");
});

test("the NPS route derives one workspace and threads it through every store call", () => {
  assert.match(npsSrc, /const workspaceId = getEntryWorkspace\(entryId\)/, "resolved once, in resolve()");
  assert.match(npsSrc, /getPipelineEntry\(entryId, workspaceId\)/, "the entry read is scoped");
  assert.match(npsSrc, /return \{ entryId, workspaceId, asked \}/, "resolve() carries the tenant out to both verbs");
  assert.match(npsSrc, /candidateNpsFor\(resolved\.entryId, resolved\.workspaceId\)/, "the GET read is scoped");
  assert.match(
    npsSrc,
    /recordCandidateNps\(resolved\.entryId, parsed\.score, parsed\.comment, resolved\.workspaceId\)/,
    "the PUBLIC WRITE lands on the candidate's own team, not the default one"
  );
});

test("neither route invents a tenant from a session — there isn't one on a token route", () => {
  for (const [name, src] of [["status", statusSrc], ["nps", npsSrc]] as const) {
    const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.ok(!code.includes("currentWorkspace("), `${name}: a public token route has no session workspace to read`);
    assert.ok(!code.includes("DEFAULT_WORKSPACE"), `${name}: the default workspace must never be hardcoded here`);
  }
});
