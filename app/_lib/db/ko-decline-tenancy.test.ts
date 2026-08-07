// Tenant (P1) regression — an entry-less KO decline must be stamped with the
// OPENING's workspace, not the default one.
//
// The bug this locks: recordKnockoutDecline took no workspaceId and handed
// recordEvent an entry-less event, so core.ts's tenant derivation (entry lookup →
// literal "workspace") always landed the row in the DEFAULT workspace. Because the
// analytics read IS workspace-scoped, every other team's "turned away at the gate"
// figure was permanently 0 — while the default team's activity feed accumulated
// OTHER tenants' applicant names and role titles (cross-tenant PII bleed).
//
// Isolated throwaway DB (testing/unit-db.ts must stay the first project import);
// every assertion is a DELTA against a pre-insert snapshot because ensureDb seeds
// a demo dataset into the default workspace.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { DEFAULT_WORKSPACE_ID } from "./workspaces.ts";
import { listPipelineEvents, recordKnockoutDecline } from "./pipeline.ts";
import { pipelineAnalytics } from "./analytics.ts";

after(() => cleanupUnitDb());

const TENANT = "ws-ko-tenant";
const KO_KINDS = ["ko_declined"] as const;

test("a tenanted KO decline is visible + counted ONLY in the opening's workspace", () => {
  const tenantBefore = pipelineAnalytics(null, undefined, TENANT).koDeclined;
  const defaultBefore = pipelineAnalytics().koDeclined;
  const defaultFeedBefore = listPipelineEvents(200, 0, KO_KINDS, DEFAULT_WORKSPACE_ID).length;

  recordKnockoutDecline({
    candidateLabel: "Tenanted Applicant",
    jobTitle: "Platform Engineer",
    channel: "conversational apply",
    failedKoIds: ["ko_workauth"],
    workspaceId: TENANT,
  });

  // Visible in its own team's feed, with the identifying fields intact…
  const tenantFeed = listPipelineEvents(200, 0, KO_KINDS, TENANT);
  const mine = tenantFeed.find((e) => e.candidateLabel === "Tenanted Applicant");
  assert.ok(mine, "the decline must appear in the owning team's activity feed");
  assert.equal(mine.entryId, null, "a KO decline stays entry-less — no terminal row a mis-tap can't retry past");
  assert.match(mine.detail ?? "", /ko_workauth/, "the failed gate must survive into the audit detail");

  // …and NOWHERE in the default workspace (the PII-bleed half of the bug).
  const defaultFeed = listPipelineEvents(200, 0, KO_KINDS, DEFAULT_WORKSPACE_ID);
  assert.equal(defaultFeed.length, defaultFeedBefore, "no KO event may leak into the default workspace's feed");
  assert.ok(
    !defaultFeed.some((e) => e.candidateLabel === "Tenanted Applicant"),
    "another team's applicant name must never surface in the default team's feed"
  );

  // The analytics half: counted for the tenant, unchanged for everyone else.
  const tenantAfter = pipelineAnalytics(null, undefined, TENANT);
  assert.equal(tenantAfter.koDeclined, tenantBefore + 1, "the tenant's gate-decline metric must count its own discard");
  assert.equal(
    tenantAfter.byJob.find((j) => j.jobTitle === "Platform Engineer")?.koDeclined,
    1,
    "the role table must attribute the discard to the role that turned the applicant away"
  );
  assert.equal(pipelineAnalytics().koDeclined, defaultBefore, "the default workspace's count must not move");
});
