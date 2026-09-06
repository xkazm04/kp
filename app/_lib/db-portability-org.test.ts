// Round-trip coverage for the ORG-SCOPED backup pair (dumpOrg / restoreOrg).
//
// The whole-database pair it replaced had NO behavioural tests at all — only
// source-level guards asserting that both routes refused multi-workspace mode
// (app/api/workspace/import/multi-workspace-guard.test.ts, deleted with the refusal
// it pinned). That was survivable while the answer was "refuse", and is not
// survivable now that the answer is "delete these rows and insert those".
// Everything here is behavioural for that reason: a restore that silently clears a
// bystander org, or that leaves a post-backup team's rows orphaned behind a deleted
// `workspaces` row, is exactly the class of bug a source-level assertion cannot see.
//
// The seeded demo corpus belongs to the DEFAULT org, so this file treats that org as
// the org under test (which is what a real deployment looks like) and asserts on
// DELTAS — the teams it creates — rather than on absolute table contents.
//
// unit-db.ts must stay the FIRST project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { coerceOrgDumpPayload, dumpOrg, planOrgRestore, restoreOrg, type OrgDumpPayload } from "./db-portability.ts";
import { DEFAULT_ORG_ID, createOrganization } from "./db/organizations.ts";
import { createWorkspace, getWorkspace, listWorkspacesByOrg } from "./db/workspaces.ts";
import { createUser, listUsersByOrg } from "./db/users.ts";
import { upsertMembership, listMembershipsForWorkspace } from "./db/memberships.ts";
import { createPipelineEntry, listPipeline } from "./db/pipeline.ts";
import { createTemplate, deleteTemplate, listTemplates } from "./templates-store.ts";

after(() => cleanupUnitDb());

/** One candidate on a team's board — the smallest piece of real tenant data. */
function seedEntry(workspaceId: string, who: string) {
  return createPipelineEntry({
    candidateId: who,
    candidateLabel: who,
    jobId: `job-${workspaceId}`,
    jobTitle: "Backend Engineer",
    stage: "Accepted",
    workspaceId,
  });
}

const names = (workspaceId: string) => listPipeline(workspaceId).map((e) => e.candidateLabel).sort();
const emails = (orgId: string) => listUsersByOrg(orgId).map((u) => u.email);

// ---- Fixture: two organizations sharing one deployment ----------------------
// ORG A is the seeded default org, given two teams of its own; ORG B is a second
// tenant that must come through every restore untouched.
const teamA1 = createWorkspace("Team A1", DEFAULT_ORG_ID);
const teamA2 = createWorkspace("Team A2", DEFAULT_ORG_ID);
const orgB = createOrganization("Rival Corp");
const teamB = createWorkspace("Team B", orgB.id);

const userA = createUser({ orgId: DEFAULT_ORG_ID, email: "a@example.com", name: "Ann" });
const userB = createUser({ orgId: orgB.id, email: "b@example.com", name: "Bo" });
upsertMembership(userA.id, teamA1.id, "owner");
upsertMembership(userA.id, teamA2.id, "recruiter");
upsertMembership(userB.id, teamB.id, "owner");

seedEntry(teamA1.id, "alice");
seedEntry(teamA2.id, "amir");
seedEntry(teamB.id, "bruno");

// `jd_templates` is DUAL-TIER (see db-portability-shared-tier.test.ts): a team's own
// drafts carry its workspace id, the deployment-global library lives in
// `workspace_id IS NULL`. On THIS deployment a second org is present, so the NULL tier
// is out of restore scope — the org's TEAM-PRIVATE half is very much in it.
const draftA1 = createTemplate({ name: "Team A1 draft", body: "## Draft", scope: "team" }, teamA1.id);

const backup: OrgDumpPayload = dumpOrg(DEFAULT_ORG_ID);

test("the dump carries the org's own teams and nobody else's", () => {
  assert.equal(backup.orgId, DEFAULT_ORG_ID);
  for (const id of [teamA1.id, teamA2.id]) assert.ok(backup.workspaceIds.includes(id), `${id} is in scope`);
  assert.ok(!backup.workspaceIds.includes(teamB.id), "the rival org's team is not");
  assert.ok(backup.userIds.includes(userA.id) && !backup.userIds.includes(userB.id), "users follow the org boundary");

  const entries = backup.tables.find((t) => t.name === "pipeline_entries");
  assert.ok(entries, "the dump must carry the pipeline");
  const label = entries.columns.indexOf("candidate_label");
  const carried = new Set(entries.rows.map((r) => String(r[label])));
  assert.ok(carried.has("alice") && carried.has("amir"), "both of the org's teams are dumped");
  assert.ok(!carried.has("bruno"), "the rival org's candidate must NOT be in the file");
});

test("deployment secrets and provider-global ledgers are excluded by the manifest", () => {
  const carried = new Set(backup.tables.map((t) => t.name));
  for (const table of ["provider_keys", "ats_config", "comms_relay_config", "billing_events", "gemini_cache", "tasks"]) {
    assert.ok(!carried.has(table), `${table} is not the org's to carry`);
  }
  // …and the reason travels WITH the file, so an operator restoring it on another
  // build still learns what will not come back.
  assert.ok(backup.notPortable.includes("comms_relay_config"));
});

test("a backup is refused by the org it does not belong to", () => {
  assert.throws(() => restoreOrg(backup, orgB.id), /different organization/i);
  assert.throws(() => planOrgRestore(backup, orgB.id), /different organization/i);
  // The rival's data is still there — a refused restore writes nothing.
  assert.deepEqual(names(teamB.id), ["bruno"]);
});

test("the dry run reports what would be replaced, and writes nothing", () => {
  const plan = planOrgRestore(backup, DEFAULT_ORG_ID);
  const entries = plan.tables.find((t) => t.name === "pipeline_entries");
  assert.ok(entries);
  assert.equal(entries.rows, entries.existing, "nothing has drifted yet, so the file matches the live scope");
  assert.ok(plan.totalExisting > 0, "the headline count is what makes the confirm honest");
  assert.equal(plan.sharedTierRestored, false, "a second org shares this deployment");
  assert.deepEqual(names(teamA1.id), ["alice"], "planning is read-only");
});

test("a multi-org restore brings the org's TEAM-PRIVATE dual-tier rows back", () => {
  // The out-of-scope shared tier used to be skipped as a WHOLE TABLE, one row into the
  // insert loop — but the DELETE's `workspace_id IN (…)` arm had already removed the
  // org's own team-private rows in the same table. The restore then reported
  // `inserted: 0` and the operator saw a success summary while the team's template
  // library was permanently gone. Prove the two tiers are told apart per row.
  assert.ok(listTemplates(teamA1.id).templates.some((t) => t.id === draftA1.id), "the draft is there before");
  deleteTemplate(draftA1.id, teamA1.id);
  assert.ok(!listTemplates(teamA1.id).templates.some((t) => t.id === draftA1.id), "and gone before the restore");
  const sharedBefore = listTemplates(teamA1.id).templates.filter((t) => t.scope === "org").map((t) => t.id).sort();

  const summary = restoreOrg(backup, DEFAULT_ORG_ID);
  assert.equal(summary.sharedTierRestored, false, "the deployment-global NULL tier stays out of scope");

  const visible = listTemplates(teamA1.id).templates;
  assert.ok(visible.some((t) => t.id === draftA1.id), "the team's private draft comes back");
  const templates = summary.tables.find((t) => t.name === "jd_templates");
  assert.ok(templates, "jd_templates was in scope");
  assert.ok(templates.inserted > 0, "a table whose rows were deleted must not report inserted: 0");
  // The NULL tier the delete never touched is neither cleared nor duplicated.
  assert.deepEqual(
    visible.filter((t) => t.scope === "org").map((t) => t.id).sort(),
    sharedBefore,
    "the shared library is untouched — no gap, no duplicate"
  );
});

test("restoring rolls the org back, and leaves the other org alone", () => {
  // Drift AFTER the backup, on both orgs: a new candidate on each, plus a whole new
  // team in org A that the file has never heard of.
  seedEntry(teamA1.id, "andrea");
  seedEntry(teamB.id, "bianca");
  const teamA3 = createWorkspace("Team A3", DEFAULT_ORG_ID);
  seedEntry(teamA3.id, "axel");

  const summary = restoreOrg(backup, DEFAULT_ORG_ID);

  assert.deepEqual(names(teamA1.id), ["alice"], "the post-backup candidate is rolled back");
  assert.deepEqual(names(teamA2.id), ["amir"], "the org's second team is restored too");
  assert.deepEqual(names(teamB.id), ["bianca", "bruno"], "the rival org keeps everything, including its drift");

  // A team created after the backup is removed WITH its rows. Clearing only the
  // file's scope would delete the `workspaces` row (org_id = A) and strand the
  // entries behind it — a rollback that leaves orphans is not a rollback.
  assert.equal(getWorkspace(teamA3.id), null, "the post-backup team is gone");
  assert.deepEqual(names(teamA3.id), [], "and so are its rows");

  const teams = listWorkspacesByOrg(DEFAULT_ORG_ID).map((w) => w.id);
  assert.ok(teams.includes(teamA1.id) && teams.includes(teamA2.id) && !teams.includes(teamA3.id));

  const touched = summary.tables.find((t) => t.name === "pipeline_entries");
  assert.ok(touched, "the pipeline was in scope");
  assert.equal(touched.inserted, touched.deleted - 2, "cleared the two drifted rows, re-inserted the file exactly");
});

test("identity survives the round trip — users, memberships, and the rival's account", () => {
  assert.ok(emails(DEFAULT_ORG_ID).includes("a@example.com"), "the org's own user comes back");
  assert.deepEqual(emails(orgB.id), ["b@example.com"], "the rival's account is untouched");
  const roles = listMembershipsForWorkspace(teamA2.id).map((m) => `${m.userId}:${m.role}`);
  assert.deepEqual(roles, [`${userA.id}:recruiter`], "the role, not just the seat, comes back");
  assert.deepEqual(listMembershipsForWorkspace(teamB.id).map((m) => m.userId), [userB.id]);
});

test("the restore is idempotent — running it twice lands in the same place", () => {
  restoreOrg(backup, DEFAULT_ORG_ID);
  assert.deepEqual(names(teamA1.id), ["alice"]);
  assert.deepEqual(names(teamA2.id), ["amir"]);
  assert.deepEqual(names(teamB.id), ["bianca", "bruno"]);
});

test("the org backup format is distinct from the whole-database dump", () => {
  assert.equal(coerceOrgDumpPayload({ ...backup, format: "kp-db-dump" }).ok, false);
  assert.equal(coerceOrgDumpPayload({ ...backup, orgId: "" }).ok, false);
  assert.equal(coerceOrgDumpPayload({ ...backup, tables: [{ name: "drop table x", columns: [], rows: [] }] }).ok, false);
  assert.equal(coerceOrgDumpPayload(backup).ok, true);
});
