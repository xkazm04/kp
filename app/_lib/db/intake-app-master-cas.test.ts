// BEHAVIORAL guard for the two App-master write paths, over a real temp SQLite
// file (the *-tenancy.test.ts / unit-db.ts pattern).
//
// The defect this pins: both writes spend MINUTES in a Python spawn between the
// read that produced the brief and the write that stores it. `updateIntakeDossier`
// was an unconditional `UPDATE ... SET brief_json = ?` — a dialog turn that
// landed during the spawn was silently overwritten, which is exactly the
// "merge that never regresses a stated value" rule inverted. `updateIntakeAppMaster`
// had the mirror hole: it wrote the spec and DROPPED the merged brief the route
// had just returned to the client, so the client's brief reverted on reload.
//
// Both now carry the row version they were computed from (`expectedUpdatedAt`)
// into the UPDATE's WHERE and report `moved` rather than clobbering.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any
// store module resolves db-path.ts).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const { createIntake, getIntake, updateIntakeDialog, updateIntakeDossier, updateIntakeAppMaster } = await import(
  "./intakes.ts"
);

after(() => cleanupUnitDb());

const WS = "ws-app-master-cas";

type Brief = Parameters<typeof updateIntakeDialog>[1]["brief"];

function brief(title: string): NonNullable<Brief> {
  return {
    schemaVersion: 1,
    title,
    seniority: "senior",
    roleFamily: "engineering",
    languages: ["en"],
    summary: title,
    responsibilities: [],
    successCriteria: [],
    requirements: [],
    facets: [],
    spineProvenance: {},
    promptVersion: "intake-v1",
  } as NonNullable<Brief>;
}

const DOSSIER = {
  dossierId: "dos-1",
  repo: { url: "https://example.test/app", rootPath: null, mainBranch: "main" },
  source: "heuristic",
  generatedAt: "2026-09-02T00:00:00.000Z",
  stack: ["typescript"],
  size: { files: 10, sourceFiles: 8, contexts: 1 },
  declaredGates: [],
  contexts: [],
  hotSpots: [],
  riskAreas: [],
  existingKpis: [],
  maintainerLoadEstimate: "unknown",
  candidateObjectives: [],
  fieldProvenance: {},
  promptVersion: "repo-scan-v1",
} as never;

// A dialog turn landing DURING the spawn is the whole point: the dossier write
// must not carry a brief computed from a version of the row that no longer
// exists.
test("a dialog turn during the spawn is not overwritten by the dossier write", () => {
  const intake = createIntake({ title: "App master", scanId: "scan-1" }, WS);
  // t0: the route reads the row (this is the version the spawn works from).
  const readAt = getIntake(intake.id, WS)?.updatedAt ?? null;

  // …minutes pass inside runIntakeAppMasterSync, and the requestor answers a
  // question. `stated` value, now on the row.
  updateIntakeDialog(intake.id, { transcript: [], brief: brief("Stated by the requestor") }, WS);

  // t1: the spawn returns with a brief merged from the STALE read.
  const result = updateIntakeDossier(
    intake.id,
    { scanId: "scan-1", dossier: DOSSIER, brief: brief("Merged from the stale read"), expectedUpdatedAt: readAt },
    WS
  );

  assert.equal(result, "moved", "a stale-version write must be refused, not applied");
  const after = getIntake(intake.id, WS);
  assert.equal(after?.brief?.title, "Stated by the requestor", "the stated value was regressed");
  assert.equal(after?.dossier, null, "a refused write must land nothing at all");
});

test("the dossier write applies when the row has not moved", () => {
  const intake = createIntake({ title: "App master", scanId: "scan-2" }, WS);
  const readAt = getIntake(intake.id, WS)?.updatedAt ?? null;
  const result = updateIntakeDossier(
    intake.id,
    { scanId: "scan-2", dossier: DOSSIER, brief: brief("Merged"), expectedUpdatedAt: readAt },
    WS
  );
  assert.equal(result, "ok");
  const after = getIntake(intake.id, WS);
  assert.equal(after?.brief?.title, "Merged");
  assert.equal(after?.dossier?.dossierId, "dos-1");
  assert.equal(after?.shape, "app_master");
});

test("a missing intake is `missing`, never `moved`", () => {
  assert.equal(
    updateIntakeDossier(
      "intake-nope",
      { scanId: "scan-3", dossier: DOSSIER, brief: brief("x"), expectedUpdatedAt: null },
      WS
    ),
    "missing"
  );
});

const COMPOSE = {
  spec: { schemaVersion: 1 } as never,
  fit: { verdict: "agent" as const, perObjective: [], coverageRatio: 1, source: "llm" as const },
  composedAt: "2026-09-02T00:00:00.000Z",
};

test("compose persists the merged brief beside the spec, in one write", () => {
  const intake = createIntake({ title: "App master", scanId: "scan-4" }, WS);
  const readAt = getIntake(intake.id, WS)?.updatedAt ?? null;
  const result = updateIntakeAppMaster(intake.id, COMPOSE, WS, {
    brief: brief("Composed from"),
    expectedUpdatedAt: readAt,
  });
  assert.equal(result, "ok");
  const after = getIntake(intake.id, WS);
  assert.equal(after?.appMaster?.composedAt, COMPOSE.composedAt);
  assert.equal(after?.brief?.title, "Composed from", "the brief the client was handed must survive a reload");
});

test("compose refuses a stale row rather than reverting a stated value", () => {
  const intake = createIntake({ title: "App master", scanId: "scan-5" }, WS);
  const readAt = getIntake(intake.id, WS)?.updatedAt ?? null;
  updateIntakeDialog(intake.id, { transcript: [], brief: brief("Stated during compose") }, WS);
  const result = updateIntakeAppMaster(intake.id, COMPOSE, WS, {
    brief: brief("Merged from the stale read"),
    expectedUpdatedAt: readAt,
  });
  assert.equal(result, "moved");
  const after = getIntake(intake.id, WS);
  assert.equal(after?.brief?.title, "Stated during compose");
  assert.equal(after?.appMaster, null, "a refused compose must not land a spec either");
});
