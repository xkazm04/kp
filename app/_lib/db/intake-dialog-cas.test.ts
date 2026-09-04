// BEHAVIORAL guard for the DIALOG writes (`/message`, `/voice-turn`) and the
// human brief edit, over a real temp SQLite file (the *-tenancy.test.ts /
// unit-db.ts pattern).
//
// The defect this pins: both dialog routes spend a model call — up to minutes —
// between the read that supplies the engine's basis and the write that replaces
// transcript AND brief wholesale. That write was unconditional, so a value the
// requestor STATED in between (a brief edit typed into the panel, or a turn on
// the other plane) was reverted by whatever the spawn eventually returned. The
// App-master routes were given `expectedUpdatedAt` for exactly this reason in the
// morning's change (intake-app-master-cas.test.ts); this is the same discipline
// reaching the nine dialog routes.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any
// store module resolves db-path.ts).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const { createIntake, getIntake, updateIntakeDialog, updateIntakeBrief } = await import("./intakes.ts");

after(() => cleanupUnitDb());

const WS = "ws-intake-dialog-cas";

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

const turn = (text: string) => ({ role: "candidate" as const, text, at: "2026-09-02T00:00:00.000Z" });

// `updated_at` is an ISO string with millisecond resolution, so two writes inside
// the same millisecond are indistinguishable (the granularity caveat documented on
// `casUpdate`). Real life puts a model call in that gap; this puts a busy-wait, so
// the assertion does not depend on how fast the machine ran two store calls.
function nextMillisecond(): void {
  const start = Date.now();
  while (Date.now() === start) {
    /* spin: the write below must land in a later millisecond than the read above */
  }
}

test("a human brief edit during the spawn is not reverted by the turn that returns after it", () => {
  const intake = createIntake({ title: "Role", lang: "en" }, WS);
  updateIntakeDialog(intake.id, { transcript: [turn("we need a backend lead")], brief: brief("Backend lead") }, WS);

  // t0 — /message reads the row and hands the brief to the engine.
  const readAt = getIntake(intake.id, WS)?.updatedAt ?? null;
  nextMillisecond();

  // …the requestor fixes the title in the brief panel while the spawn runs. A
  // typed edit is `stated` by definition — the one grading the merge may never
  // regress.
  assert.equal(updateIntakeBrief(intake.id, brief("Backend lead, payments"), WS, { expectedUpdatedAt: readAt }), "ok");

  // t1 — the exchange returns, carrying a brief merged from the STALE read.
  const write = updateIntakeDialog(
    intake.id,
    {
      transcript: [turn("we need a backend lead"), turn("…and the reply")],
      brief: brief("Backend lead"),
      expectedUpdatedAt: readAt,
    },
    WS
  );

  assert.equal(write, "moved", "a stale-version dialog write must be refused, not applied");
  const after = getIntake(intake.id, WS);
  assert.equal(after?.brief?.title, "Backend lead, payments", "the stated value was regressed");
  assert.equal(after?.transcript.length, 1, "a refused write must land nothing at all");
});

test("the dialog write applies when the row has not moved", () => {
  const intake = createIntake({ title: "Role", lang: "en" }, WS);
  const readAt = getIntake(intake.id, WS)?.updatedAt ?? null;
  const write = updateIntakeDialog(
    intake.id,
    { transcript: [turn("hello")], brief: brief("Role"), status: "complete", expectedUpdatedAt: readAt },
    WS
  );
  assert.equal(write, "ok");
  const after = getIntake(intake.id, WS);
  assert.equal(after?.status, "complete");
  assert.equal(after?.transcript.length, 1);
});

test("a vanished intake is `missing`, never `moved`", () => {
  assert.equal(
    updateIntakeDialog("intake-nope", { transcript: [], brief: null, expectedUpdatedAt: null }, WS),
    "missing"
  );
  assert.equal(updateIntakeBrief("intake-nope", brief("x"), WS, { expectedUpdatedAt: null }), "missing");
});

// The opener writes into a row it created microseconds earlier, so it passes no
// version — and must keep working unconditionally.
test("the opener write (no expectedUpdatedAt) stays unconditional", () => {
  const intake = createIntake({ title: "Role", lang: "en" }, WS);
  assert.equal(updateIntakeDialog(intake.id, { transcript: [turn("opener")], brief: null }, WS), "ok");
  assert.equal(getIntake(intake.id, WS)?.transcript.length, 1);
});

// A promoted session's brief is the grounding record behind a JD that exists.
// Both writers refuse it — and the refusal is `missing`, not a silent no-op.
test("a promoted session refuses both writes", () => {
  const intake = createIntake({ title: "Role", lang: "en" }, WS);
  const db = getIntake(intake.id, WS);
  assert.ok(db);
  // markIntakePromoted is the real path; reach it through the module.
  return import("./intakes.ts").then(({ markIntakePromoted }) => {
    markIntakePromoted(intake.id, { jdSlug: "jd-x", jobId: "job-x" }, WS);
    const at = getIntake(intake.id, WS)?.updatedAt ?? null;
    assert.equal(updateIntakeDialog(intake.id, { transcript: [], brief: null, expectedUpdatedAt: at }, WS), "missing");
    assert.equal(updateIntakeBrief(intake.id, brief("y"), WS, { expectedUpdatedAt: at }), "missing");
  });
});
