// Import the isolated-DB bootstrap FIRST (load-bearing — see unit-db.ts) so the
// behavioral case below opens a throwaway SQLite file, never a developer's data.
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const { saveGroupEval, getGroupEval, listEvaluatedRoles } = await import("./group-eval.ts");
const { DEFAULT_WORKSPACE_ID } = await import("./db/workspaces.ts");

after(() => cleanupUnitDb());

const dir = path.dirname(fileURLToPath(import.meta.url));

// Tenant scope (E0 Phase 1) — source guard for group_evals (same shape as
// campaign-tenancy.test.ts). Every DML statement touching the table must filter/stamp
// workspace_id so a team's comparative group evaluations can't leak across tenants.
const src = readFileSync(path.join(dir, "group-eval.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

test("every group_evals DML query is workspace-scoped", () => {
  // Only INSERT/SELECT/UPDATE (not the CREATE/ALTER DDL that defines the column).
  const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+group_evals\b/i.test(s));
  assert.ok(touching.length >= 3, `expected >=3 group_evals DML queries, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(/workspace_id/.test(sql), `a group_evals query is NOT workspace-scoped:\n${sql.trim().slice(0, 200)}`);
  }
});

// group-eval-read-tenancy — the READ route (api/decisions/group-eval) was calling
// getGroupEval(role) / listEvaluatedRoles(roles) with NO workspace arg, so both
// defaulted to DEFAULT_WORKSPACE_ID even for a non-default team. Exercise the store
// through the EXACT call shape the route now uses (role + ws), with two workspaces
// sharing one roleKey, and prove a non-default team sees ITS eval and never the
// default tenant's. This is the behavioral counterpart to the SQL grep above.
test("group-eval reads are isolated per workspace (the route's call shape)", () => {
  const WS_A = "ws-alpha";
  const roleKey = "role:shared-key";

  // Same roleKey, two tenants — the exact cross-tenant collision the unscoped read
  // could serve from the wrong team.
  saveGroupEval(roleKey, "Default team eval", { summary: "default-tenant" }, DEFAULT_WORKSPACE_ID);
  saveGroupEval(roleKey, "Alpha team eval", { summary: "alpha-tenant" }, WS_A);

  // getGroupEval(role, ws) — the route's `role` branch. Each team sees only its own.
  const alpha = getGroupEval(roleKey, WS_A);
  assert.equal(alpha?.roleTitle, "Alpha team eval", "WS_A must read ITS own eval");
  assert.equal((alpha?.payload as { summary?: string }).summary, "alpha-tenant");
  const def = getGroupEval(roleKey, DEFAULT_WORKSPACE_ID);
  assert.equal(def?.roleTitle, "Default team eval", "default must read ITS own eval");

  // A third workspace that never saved an eval for this role must see nothing —
  // never the default tenant's eval bleeding through.
  assert.equal(getGroupEval(roleKey, "ws-empty"), null, "an unrelated team sees no eval");

  // listEvaluatedRoles(roles, ws) — the route's `roles` branch (the evaluated chip).
  // WS_A's role is evaluated for WS_A; the same key reads as UN-evaluated for a team
  // that never ran it (so the chip stays dark and no PAID re-run is wrongly skipped —
  // and, conversely, WS_A's chip lights instead of re-firing an LLM run every open).
  assert.ok(roleKey in listEvaluatedRoles([roleKey], WS_A), "WS_A's role reads as evaluated");
  assert.equal(
    roleKey in listEvaluatedRoles([roleKey], "ws-empty"),
    false,
    "an unrelated team's chip must NOT light from another tenant's eval"
  );
});

// Source guard: the route must thread the caller's workspace into BOTH reads (mirrors
// the sibling reconsider/route.ts). A regression that drops the ws arg would silently
// fall back to DEFAULT_WORKSPACE_ID — the exact bug this direction fixed.
test("the group-eval READ route threads currentWorkspace into both store reads", () => {
  const routeSrc = readFileSync(
    path.join(dir, "..", "api", "decisions", "group-eval", "route.ts"),
    "utf8"
  );
  assert.match(routeSrc, /currentWorkspace/, "route must import/resolve currentWorkspace");
  assert.match(routeSrc, /const\s+ws\s*=\s*await\s+currentWorkspace\(\)/, "route must await currentWorkspace()");
  assert.match(routeSrc, /getGroupEval\(\s*role\s*,\s*ws\s*\)/, "getGroupEval must be passed ws");
  assert.match(routeSrc, /listEvaluatedRoles\(\s*roles\s*,\s*ws\s*\)/, "listEvaluatedRoles must be passed ws");
});
