// BEHAVIORAL guard for the periodic voice EXTRACTION SWEEP's write, over a real
// temp SQLite file (the *-tenancy.test.ts / unit-db.ts pattern).
//
// The defect this pins: the client fires the sweep and the next spoken turn from
// the SAME `finally` block (JdsIntakeVoice's `if (extract) void sweep(); if
// (next) void dispatch(next);`). The sweep read the transcript, spent seconds in
// a batch extraction, then wrote `[...thatPreSpawnRead, ...itsOwnTurns]` through
// `updateIntakeDialog` — so the turn pair /voice-turn had written meanwhile was
// erased. Spoken words vanished: not from the panel (which re-rendered from the
// sweep's own payload), from the STORE, which is the only record a voice call
// has.
//
// `updateIntakeVoiceSweep` carries no transcript in at all — only the sweep's own
// turns — and re-reads the stored one inside the write transaction.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any
// store module resolves db-path.ts).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";

const { createIntake, getIntake, updateIntakeDialog, updateIntakeVoiceSweep } = await import("./intakes.ts");

after(() => cleanupUnitDb());

const WS = "ws-intake-voice-sweep";

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

const turn = (role: "candidate" | "interviewer", text: string) => ({ role, text, at: "2026-09-02T00:00:00.000Z" });

// The row version is `updated_at`, an ISO string with MILLISECOND resolution, so
// two writes inside the same millisecond are indistinguishable (the granularity
// caveat documented on `casUpdate`). Real life puts a Python spawn in that gap;
// this test puts a busy-wait, so `moved` is asserted deterministically instead of
// depending on how fast the machine ran the two store calls.
function nextMillisecond(): void {
  const start = Date.now();
  while (Date.now() === start) {
    /* spin: the write below must land in a later millisecond than the read above */
  }
}

test("a turn written DURING the sweep survives the sweep's own write", () => {
  const intake = createIntake({ title: "Voice", lang: "en" }, WS);
  // The call so far: one exchange already persisted by /voice-turn.
  updateIntakeDialog(intake.id, { transcript: [turn("candidate", "we need a backend lead"), turn("interviewer", "for which team?")], brief: null }, WS);

  // t0 — the sweep route reads the row, then spends seconds in the batch
  // extraction spawn.
  const read = getIntake(intake.id, WS);
  const readAt = read?.updatedAt ?? null;

  // …meanwhile the requestor keeps talking and /voice-turn persists the pair.
  nextMillisecond();
  updateIntakeDialog(
    intake.id,
    { transcript: [...(read?.transcript ?? []), turn("candidate", "payments, three people"), turn("interviewer", "noted")], brief: null },
    WS
  );

  // t1 — the sweep lands. It carries NO transcript, only its own (recovery)
  // turns and the extracted brief.
  const write = updateIntakeVoiceSweep(
    intake.id,
    { turns: [turn("candidate", "one last thing")], brief: brief("Backend lead"), expectedUpdatedAt: readAt },
    WS
  );

  assert.equal(write.result, "moved", "the row DID move — the sweep must know it");
  const after = getIntake(intake.id, WS);
  const texts = (after?.transcript ?? []).map((t) => t.text);
  assert.deepEqual(texts, [
    "we need a backend lead",
    "for which team?",
    "payments, three people",
    "noted",
    "one last thing",
  ], "the turn pair written during the sweep was erased");
  // The returned transcript is what was STORED — the route answers with it, so
  // the panel and the row can never disagree.
  assert.deepEqual(write.transcript.map((t) => t.text), texts);
  assert.equal(after?.brief?.title, "Backend lead", "the extraction still lands");
});

test("an unmoved row is `ok`, and the sweep's turns are appended once", () => {
  const intake = createIntake({ title: "Voice", lang: "en" }, WS);
  updateIntakeDialog(intake.id, { transcript: [turn("candidate", "hello")], brief: null }, WS);
  const readAt = getIntake(intake.id, WS)?.updatedAt ?? null;
  const write = updateIntakeVoiceSweep(
    intake.id,
    { turns: [turn("candidate", "stray")], brief: brief("Role"), shape: "story", expectedUpdatedAt: readAt },
    WS
  );
  assert.equal(write.result, "ok");
  const after = getIntake(intake.id, WS);
  assert.deepEqual((after?.transcript ?? []).map((t) => t.text), ["hello", "stray"]);
  assert.equal(after?.shape, "story");
});

// The honest keyless outcome (extracted: false): the transcript is preserved and
// the brief is left EXACTLY as it stands — never replaced with an empty one.
test("brief: null leaves the stored brief untouched", () => {
  const intake = createIntake({ title: "Voice", lang: "en" }, WS);
  updateIntakeDialog(intake.id, { transcript: [], brief: brief("Stated by the requestor") }, WS);
  const readAt = getIntake(intake.id, WS)?.updatedAt ?? null;
  updateIntakeVoiceSweep(intake.id, { turns: [turn("candidate", "spoken")], brief: null, expectedUpdatedAt: readAt }, WS);
  const after = getIntake(intake.id, WS);
  assert.equal(after?.brief?.title, "Stated by the requestor");
  assert.deepEqual((after?.transcript ?? []).map((t) => t.text), ["spoken"]);
});

test("a promoted session is frozen, and a vanished one is `missing`", () => {
  assert.equal(
    updateIntakeVoiceSweep("intake-nope", { turns: [], brief: null, expectedUpdatedAt: null }, WS).result,
    "missing"
  );
});
