// Locks the multi-workspace refusal on the whole-DB import (backlog #15):
// POST /api/workspace/import restores the ENTIRE database — db-portability's
// loadWorkspace DROPs, recreates and reloads every table — which is only safe
// under the single-tenant lock (workspace-lock.ts). If an operator enables
// KP_MULTI_WORKSPACE, one tenant's import would clobber every other tenant
// wholesale, so the route must refuse outright (503, clear body) BEFORE reading
// the body — the dry-run and the apply alike — until the endpoint is reworked
// into a per-workspace restore (delete-by-workspace + insert, never DROP TABLE).
//
// Source-level guard (the route imports via the "@/..." alias, which Node's
// test runner does not resolve), mirroring upload-size-contract.test.ts, plus a
// behavioral pin of the canonical flag predicate the guard delegates to.
//
// Runner: Node's built-in test runner with type stripping (no extra deps).
//   npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { multiWorkspaceEnabled } from "../../../_lib/workspace-lock.ts";

function read(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
}

test("the import route refuses with 503 when multi-workspace mode is enabled", () => {
  const src = read("./route.ts");

  // The guard must delegate to the one canonical flag reader (workspace-lock.ts
  // owns the env semantics: '1'/'true'/'yes'/'on' ⇒ enabled), not re-read env.
  assert.match(src, /from "@\/app\/_lib\/workspace-lock"/, "must use the canonical flag reader");
  const guardAt = src.indexOf("if (multiWorkspaceEnabled())");
  assert.ok(guardAt >= 0, "must gate on multiWorkspaceEnabled()");

  // The refusal is loud and self-explaining: 503 (the endpoint is unavailable
  // in this server mode) with a body that says why and what to do instead.
  const refusal = src.slice(guardAt, guardAt + 700);
  assert.match(refusal, /status:\s*503/, "the refusal must be a 503");
  assert.match(refusal, /multi-workspace mode/, "the body must name the mode that disabled it");
  assert.match(refusal, /KP_MULTI_WORKSPACE/, "the body must name the flag");

  // The guard fires before the body is even read, so BOTH the dry-run and the
  // apply are refused — not just the destructive branch.
  const bodyAt = src.indexOf("request.json");
  assert.ok(bodyAt > guardAt, "the guard must run before the body parse");
  const loadAt = src.indexOf("loadWorkspace(");
  assert.ok(loadAt > guardAt, "the guard must run before loadWorkspace");
});

test("the guard's predicate: truthy KP_MULTI_WORKSPACE refuses, default keeps importing", () => {
  // The full env-semantics matrix lives in workspace-lock.test.ts; pin the two
  // ends this guard cares about so the contract is self-contained here.
  assert.equal(multiWorkspaceEnabled({ KP_MULTI_WORKSPACE: "1" }), true, "flag on ⇒ the route refuses");
  assert.equal(multiWorkspaceEnabled({}), false, "default single-workspace mode ⇒ import still works");
});
