// The first-run data choice and the on-demand demo seed (operator triage T1, 2026-10-22).
//
// A fresh database no longer seeds the demo at boot (seed-gate.ts, core-empty-boot.test.ts);
// '/' asks instead, and "Explore with demo data" seeds through seedDemoOnDemand. Pinned here:
//   - a blank boot offers the choice, and an answer of either kind closes it for good;
//   - the on-demand seed lands the corpus with every tenant column stamped (no NULL
//     workspace_id survives — the backfill runs after the seeders, as at boot);
//   - it is idempotent: a second call adds no row;
//   - it refuses a workspace that already holds real data, and any non-default workspace.
//
// unit-db.ts must stay the first project import (isolated throwaway DB). Its env carries
// neither KP_EMPTY nor KP_SEED_DEMO, so this process's boot is the default, blank one.
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ensureDb } from "./core.ts";
import { demoChoicePending, getDemoChoice, recordEmptyChoice, seedDemoOnDemand, workspaceHasData } from "./demo-seed.ts";

after(() => cleanupUnitDb());

delete process.env.KP_EMPTY;
delete process.env.KP_SEED_DEMO;

const n = (sql: string): number => (ensureDb().prepare(sql).get() as { n: number }).n;

function resetChoice(): void {
  ensureDb().prepare(`UPDATE workspaces SET demo_choice = NULL, onboarding_state = NULL WHERE id = 'workspace'`).run();
}

test("a blank boot offers the choice; the env answering it, or another workspace, does not", () => {
  assert.equal(workspaceHasData(), false, "the default boot is blank");
  assert.equal(demoChoicePending("workspace", {}), true);
  assert.equal(demoChoicePending("workspace", { KP_EMPTY: "1" }), false, "dev:empty has already chosen blank");
  assert.equal(demoChoicePending("workspace", { KP_SEED_DEMO: "1" }), false, "the opt-in has already chosen demo");
  assert.equal(demoChoicePending("ws-other", {}), false, "the demo only ever seeds the default workspace");
  assert.equal(seedDemoOnDemand("ws-other"), "refused-workspace");
});

test("'Start empty' is recorded in the database and closes the choice", () => {
  resetChoice();
  recordEmptyChoice();
  assert.equal(getDemoChoice(), "empty");
  assert.equal(demoChoicePending("workspace", {}), false, "the screen never comes back");
  assert.equal(workspaceHasData(), false, "and nothing was seeded");
});

test("a workspace with real data is refused the demo, and nothing is written", () => {
  resetChoice();
  const db = ensureDb();
  db.prepare(`INSERT INTO profiles (id, label, payload_json, created_at, workspace_id) VALUES ('p-real', 'Real person', '{}', ?, 'workspace')`).run(
    new Date().toISOString()
  );
  try {
    assert.equal(demoChoicePending("workspace", {}), false, "a workspace with data is not a first run");
    assert.equal(seedDemoOnDemand("workspace"), "refused-has-data");
    assert.equal(n(`SELECT COUNT(*) AS n FROM pipeline_entries`), 0, "the demo did not land on top of real data");
    assert.equal(getDemoChoice(), null);
  } finally {
    db.prepare(`DELETE FROM profiles WHERE id = 'p-real'`).run();
  }
});

test("'Explore with demo data' seeds the corpus once, fully tenant-stamped, and is idempotent", () => {
  resetChoice();
  assert.equal(seedDemoOnDemand("workspace"), "seeded");
  assert.equal(getDemoChoice(), "demo");
  assert.equal(demoChoicePending("workspace", {}), false);

  const entries = n(`SELECT COUNT(*) AS n FROM pipeline_entries`);
  const jobs = n(`SELECT COUNT(*) AS n FROM jobs`);
  const profiles = n(`SELECT COUNT(*) AS n FROM profiles`);
  const analyses = n(`SELECT COUNT(*) AS n FROM analyses`);
  assert.ok(entries > 0 && jobs > 0 && profiles > 0 && analyses > 0, "the demo board, roles, candidates and analyses landed");
  assert.ok(n(`SELECT COUNT(*) AS n FROM users WHERE org_id = 'org-default'`) > 0, "the org roster landed");

  // The backfill ran after the seeders: no seeded row is left outside a tenant.
  for (const table of ["analyses", "profiles", "jds", "pipeline_entries", "pipeline_events"]) {
    assert.equal(n(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id IS NULL`), 0, `${table} has no NULL workspace_id`);
  }
  assert.equal(n(`SELECT COUNT(*) AS n FROM users WHERE org_id IS NULL`), 0, "users have an org");
  const state = ensureDb().prepare(`SELECT onboarding_state AS v FROM workspaces WHERE id = 'workspace'`).get() as { v: string | null };
  assert.equal(state.v, "completed", "a seeded tenant is an established demo, so the wizard does not ambush it");

  // Idempotent: a second click (or a racing one) adds nothing.
  assert.equal(seedDemoOnDemand("workspace"), "already-seeded");
  assert.equal(n(`SELECT COUNT(*) AS n FROM pipeline_entries`), entries);
  assert.equal(n(`SELECT COUNT(*) AS n FROM jobs`), jobs);
  assert.equal(n(`SELECT COUNT(*) AS n FROM profiles`), profiles);
  assert.equal(n(`SELECT COUNT(*) AS n FROM analyses`), analyses);

  // And 'Start empty' afterwards cannot downgrade the recorded answer.
  recordEmptyChoice();
  assert.equal(getDemoChoice(), "demo");
});
