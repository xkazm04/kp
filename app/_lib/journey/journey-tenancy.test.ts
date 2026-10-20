// Tenant scope for the journey projection — BOTH halves, because the 40-odd sibling
// `*-tenancy.test.ts` files each pin only one of them and the app has leaked through
// the other:
//
//   (a) SOURCE. Every statement in project.ts binds `workspace_id` in a PREDICATE.
//       A bare `/workspace_id/` match is not enough — it is satisfied by the SELECT
//       LIST, so a read that returns every tenant's rows and merely reports which
//       tenant each belongs to would pass (pipeline-events-tenancy.test.ts:23-31
//       states the same trap).
//
//   (b) BEHAVIOUR. Two workspaces, the same fixtures in each, and the board for one
//       must contain nothing of the other's — not a column, not a row, not a count.
//       A source scan cannot see a caller that forgets to thread the tenant, and a
//       behavioural test cannot see a query that was never scoped; the defect has
//       taken both shapes here.
//
// THE NAME-MATCHING RATCHET. `app/api/route-tenancy-coverage.test.ts` derives the
// tenant-defaulting store surface from `_lib` BY FUNCTION NAME and flags any route
// call that omits the argument. This module's reads therefore take `workspaceId` as
// a REQUIRED parameter and are prefixed `journey*`, so they neither enter that map
// nor collide with a sibling store's function of the same name.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { createPipelineEntry, setApproval } from "../db/pipeline.ts";
import { saveAnalysis } from "../db/analyses.ts";
import { sealDecisionRecord } from "../decision-record-store.ts";
import { journeyBoard, journeyColumn, journeyEntryView } from "./project.ts";

after(() => cleanupUnitDb());

const HERE = dirname(fileURLToPath(import.meta.url));
const ALPHA = "ws-alpha";
const BETA = "ws-beta";

// ── (a) the source guard ─────────────────────────────────────────────────────

const src = readFileSync(resolve(HERE, "project.ts"), "utf8").replace(/\r\n/g, "\n");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

/** Does workspace_id actually CONSTRAIN this statement? Same predicate as
 *  pipeline-events-tenancy.test.ts, and for the same reason. */
function isScoped(sql: string): boolean {
  if (/^\s*insert\s+into/i.test(sql.trim())) return /\bworkspace_id\b/.test(sql);
  return /\bworkspace_id\s*(=|in)\s*[?(@:]/i.test(sql);
}

test("the scoping predicate rejects a tenant-blind query that merely mentions the column", () => {
  assert.equal(isScoped("SELECT id, workspace_id FROM pipeline_entries WHERE stage = ?"), false);
  assert.equal(isScoped("SELECT id FROM pipeline_entries WHERE stage = ? AND workspace_id = ?"), true);
});

test("every statement the projection issues is workspace-scoped", () => {
  const TABLES =
    "pipeline_entries|pipeline_events|consent_events|interview_sessions|analyses|dev_cases|dev_submissions|dev_sessions|role_intakes|intake_events|jobs";
  const touching = sqlBlocks.filter((s) => new RegExp(`\\b(from|into|update|delete\\s+from)\\s+(${TABLES})\\b`, "i").test(s));
  // Non-vacuity: if the scan stops matching (a query is reformatted, a table renamed)
  // it must FAIL rather than pass over an empty set.
  assert.ok(touching.length >= 10, `expected >=10 projection queries, found ${touching.length} — the scan is broken`);
  for (const sql of touching) {
    assert.ok(isScoped(sql), `a journey query is NOT workspace-scoped:\n${sql.trim().slice(0, 240)}`);
  }
});

test("the projection never reads the schema-probe table as if it were tenant data", () => {
  // `sqlite_master` is the ONE unscoped read here, and it is deliberate: "does this
  // database have intake_events yet" is a question about the FILE, not about a team.
  // Pinned so a later edit cannot quietly widen the exemption to a data table.
  const unscoped = sqlBlocks.filter((s) => /\bfrom\s+sqlite_master\b/i.test(s));
  assert.equal(unscoped.length, 1, "exactly one schema probe, and it is the table-existence guard");
  assert.match(unscoped[0], /type\s*=\s*'table'/, "…and it reads the schema, never a row");
});

test("no journey read defaults its tenant, so the route-layer ratchet has nothing to catch", () => {
  // route-tenancy-coverage.test.ts derives its map from `workspaceId … = DEFAULT_WORKSPACE_ID`
  // parameters. A defaulted tenant on an exported read here would put a journey
  // function into that map under a name a sibling route might also call.
  const exported = [...src.matchAll(/export function (journey[A-Za-z0-9_]*|railCellState)\s*\(([^)]*)\)/g)];
  assert.ok(exported.length >= 4, `expected the exported read surface, found ${exported.length}`);
  for (const [, name, params] of exported) {
    assert.doesNotMatch(
      params,
      /workspaceId[^,]*=\s*DEFAULT_WORKSPACE_ID/,
      `${name} defaults its tenant — a caller that forgets would silently read the default team`
    );
  }
});

test("every exported read is module-prefixed, so a name-matching ratchet cannot confuse it", () => {
  const names = [...src.matchAll(/export function ([A-Za-z0-9_]+)\s*\(/g)].map((m) => m[1]);
  assert.ok(names.length >= 4, "non-vacuity: the export scan found the read surface");
  for (const name of names) {
    assert.ok(
      name.startsWith("journey") || name === "railCellState",
      `${name} is not module-prefixed — a sibling store's function of this name would collide in the ratchet's map`
    );
  }
});

// ── (b) the behavioural guard ────────────────────────────────────────────────

function seedWorkspace(ws: string, marker: string) {
  const { entry } = createPipelineEntry({
    candidateId: `tenant-${marker}`,
    candidateLabel: `Tenant Probe ${marker}`,
    jobId: `tenant-job-${marker}`,
    jobTitle: `Tenant Role ${marker}`,
    workspaceId: ws,
  });
  setApproval(entry.id, "screening_review", "{}", ws);
  saveAnalysis(
    { candidateLabel: `Tenant Probe ${marker}`, jdSlug: null, score: 60, roleFamily: null, seniority: null, payload: {} },
    ws
  );
  sealDecisionRecord(
    {
      kind: "auto_rejected",
      actor: "auto:screen-wave",
      policyVersion: `policy-${marker}`,
      candidateRef: entry.id,
      rationale: `sealed for ${marker}`,
      reasonCode: "reject",
      inputs: {},
    },
    ws
  );
  return entry;
}

test("one team's board contains nothing of another's — not a column, not a row, not a count", () => {
  const alpha = seedWorkspace(ALPHA, "alpha");
  const beta = seedWorkspace(BETA, "beta");

  const alphaBoard = journeyBoard({ workspaceId: ALPHA, limit: 50 });
  const alphaIds = alphaBoard.clusters.flatMap((c) => c.columns.map((col) => col.entryId));
  assert.deepEqual(alphaIds, [alpha.id], "alpha sees exactly its own column");
  assert.equal(alphaBoard.totals.columns, 1, "the TOTALS are scoped too — this is where a leak hides");
  assert.equal(alphaBoard.totals.roles, 1);

  const serialized = JSON.stringify(alphaBoard);
  for (const foreign of [beta.id, "Tenant Probe beta", "tenant-job-beta", "policy-beta", "sealed for beta"]) {
    assert.ok(!serialized.includes(foreign), `alpha's board carries beta's "${foreign}"`);
  }

  // …and symmetrically, so a test that passed because beta was simply empty cannot.
  const betaBoard = journeyBoard({ workspaceId: BETA, limit: 50 });
  assert.deepEqual(
    betaBoard.clusters.flatMap((c) => c.columns.map((col) => col.entryId)),
    [beta.id]
  );
});

test("an entry read under the WRONG tenant answers null, exactly as an unknown id does", () => {
  const alpha = seedWorkspace(ALPHA, "alpha2");
  assert.ok(journeyColumn(alpha.id, ALPHA), "the owning team reads it");
  assert.equal(journeyColumn(alpha.id, BETA), null, "another team does not");
  assert.equal(journeyColumn("no-such-entry", ALPHA), null, "…and learns nothing from the difference");
  assert.equal(journeyEntryView(alpha.id, BETA), null, "the detail layer is scoped the same way");
});

test("an analysis of a same-named candidate in ANOTHER team never crosses over", () => {
  const label = "Cross Tenant Namesake";
  const { entry } = createPipelineEntry({
    candidateId: "tenant-cross",
    candidateLabel: label,
    jobId: "tenant-cross-job",
    jobTitle: "Cross Role",
    workspaceId: ALPHA,
  });
  // The label join is the weakest link in the identity contract, so it is the one
  // most worth proving cannot reach across a tenant boundary.
  saveAnalysis({ candidateLabel: label, jdSlug: null, score: 99, roleFamily: null, seniority: null, payload: {} }, BETA);
  const column = journeyColumn(entry.id, ALPHA);
  assert.ok(column);
  assert.deepEqual(
    column.events.filter((e) => e.kind === "analysis"),
    [],
    "a name match is not a tenancy exemption"
  );

  saveAnalysis({ candidateLabel: label, jdSlug: null, score: 40, roleFamily: null, seniority: null, payload: {} }, ALPHA);
  const again = journeyColumn(entry.id, ALPHA);
  assert.equal(again?.events.filter((e) => e.kind === "analysis").length, 1, "…and the team's own analysis still attaches");
  assert.equal(again?.events.find((e) => e.kind === "analysis")?.facts.score, 40);
});
