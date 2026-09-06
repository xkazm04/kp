// The other half of the org-backup story: the SINGLE-ORG deployment, which is what
// self-hosted KP actually is.
//
// `jd_templates` and `decision_config` are dual-tier — a team's private rows carry
// its id, and the org's shared layer (the curated template library, the decision
// baseline every team inherits) lives in `workspace_id IS NULL`. That null tier is
// deployment-global rather than org-keyed: the schema literally cannot hold two orgs'
// versions of it (`uq_decision_config_org` is UNIQUE on `phase` alone). So the
// restore takes a position that depends on who else is on the box —
//
//   one org   → the null tier IS this org's, restore it; a backup that quietly reset
//               the company's template library to code defaults would be a lie.
//   more orgs → leave it alone and SAY SO (`sharedTierRestored: false`), because
//               clearing it would hit a bystander who never asked for a restore.
//
// db-portability-org.test.ts covers the multi-org side. This file is deliberately its
// own process so the deployment holds exactly ONE organization.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { dumpOrg, restoreOrg, type OrgDumpPayload } from "./db-portability.ts";
import { DEFAULT_ORG_ID, listOrganizations } from "./db/organizations.ts";
import { DEFAULT_WORKSPACE_ID, createWorkspace } from "./db/workspaces.ts";
import { createTemplate, deleteTemplate, listTemplates } from "./templates-store.ts";

after(() => cleanupUnitDb());

const teamA = createWorkspace("Team A", DEFAULT_ORG_ID);

// The company library (shared, workspace_id NULL) and one team's private draft.
const shared = createTemplate({ name: "Company standard 2026", body: "## Role", scope: "org" }, teamA.id);
const priv = createTemplate({ name: "Team A draft", body: "## Draft", scope: "team" }, teamA.id);

const backup: OrgDumpPayload = dumpOrg(DEFAULT_ORG_ID);

test("the fixture really is a single-org deployment", () => {
  assert.deepEqual(listOrganizations().map((o) => o.id), [DEFAULT_ORG_ID]);
});

test("the dump carries both tiers of the dual-tier tables", () => {
  const t = backup.tables.find((x) => x.name === "jd_templates");
  assert.ok(t, "jd_templates must be in scope");
  const id = t.columns.indexOf("id");
  const carried = new Set(t.rows.map((r) => String(r[id])));
  assert.ok(carried.has(shared.id), "the shared company library");
  assert.ok(carried.has(priv.id), "and the team's private draft");
});

test("restoring a single-org deployment brings the shared library back", () => {
  // Lose both tiers the way a bad afternoon would: someone deletes the company
  // standard and the team's draft.
  deleteTemplate(shared.id, teamA.id);
  deleteTemplate(priv.id, teamA.id);
  assert.ok(!listTemplates(teamA.id).templates.some((t) => t.id === shared.id), "gone before the restore");

  const summary = restoreOrg(backup, DEFAULT_ORG_ID);
  assert.equal(summary.sharedTierRestored, true, "nobody else is on this deployment");

  const back = listTemplates(teamA.id).templates.map((t) => t.id);
  assert.ok(back.includes(shared.id), "the company library is restored");
  assert.ok(back.includes(priv.id), "so is the team's private draft");
});

test("the restore names the config it could not carry, rather than failing quietly", () => {
  const summary = restoreOrg(backup, DEFAULT_ORG_ID);
  // The six singleton config tables carry no org_id, so a backup cannot say which org
  // owns them and a restore leaves them alone. Reporting the list is the whole
  // mitigation: the operator re-enters those settings knowingly.
  assert.ok(summary.notRestored.includes("comms_relay_config"));
  assert.ok(summary.notRestored.includes("brand_settings"));
  assert.ok(summary.notRestored.includes("ats_connections"));
});
