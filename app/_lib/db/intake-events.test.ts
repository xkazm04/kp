// The role-intake history ledger (db/intake-events.ts) + the boot backfill that recovers
// the rounds that happened before it existed (db/core.ts backfillIntakeEvents).
//
// What is pinned here, and why each one is a property rather than a detail:
//   • APPEND-ONLY is structural — no UPDATE statement exists in the store, and the only
//     DELETE is the erasure door. A ledger whose past can be edited proves nothing.
//   • TWO CLOCKS — a backfilled row's `occurredAt` is the TURN's own `at` and its
//     `recordedAt` is the moment of the backfill, and the test proves they DIFFER. One
//     column would make a recovered history indistinguishable from a live one.
//   • REFUSAL IS A ROW — a round with no topic is stored and listed, with `topicCode`
//     OMITTED per the journey contract's absent-value convention.
//   • IDEMPOTENT, RECORDED IN seed_marks — the second run writes nothing, and it knows
//     that from the mark rather than from a row count (which cannot tell "never ran"
//     from "ran, then the operator emptied the table").
//
// unit-db.ts MUST be the first project import (isolated throwaway DB).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const { ensureDb, backfillIntakeEvents, INTAKE_EVENTS_BACKFILL_MARK } = await import("./core.ts");
const { countIntakeEvents, eraseIntakeEvents, listIntakeEvents, recordIntakeEvent } = await import("./intake-events.ts");
const { createIntake, updateIntakeDialog } = await import("./intakes.ts");
const { seedAlreadyRan } = await import("./seed-marks.ts");

after(() => cleanupUnitDb());

const TEAM_A = "team-intake-events-a";
const TEAM_B = "team-intake-events-b";

test("a recorded round round-trips, and seq is monotonic per intake", () => {
  const intakeId = "intake-seq-1";
  for (const [n, at] of [
    [1, "2026-08-07T16:25:55.992Z"],
    [2, "2026-08-07T16:26:34.798Z"],
    [3, "2026-08-07T16:27:05.905Z"],
  ] as const) {
    recordIntakeEvent({
      intakeId,
      workspaceId: TEAM_A,
      kind: "intake_round",
      occurredAt: at,
      topicCode: "salary-band",
      facts: { question: `q${n}`, answer: `a${n}` },
      actor: "human:u-1",
    });
  }
  const rows = listIntakeEvents(intakeId, TEAM_A);
  assert.deepEqual(rows.map((r) => r.seq), [1, 2, 3], "seq is 1-based and monotonic per intake_id");
  assert.deepEqual(rows.map((r) => r.occurredAt), [
    "2026-08-07T16:25:55.992Z",
    "2026-08-07T16:26:34.798Z",
    "2026-08-07T16:27:05.905Z",
  ]);
  assert.equal(rows[0].kind, "intake_round");
  assert.equal(rows[0].topicCode, "salary-band");
  assert.deepEqual(rows[0].facts, { question: "q1", answer: "a1" });
  assert.equal(rows[0].actor, "human:u-1");
  assert.equal(countIntakeEvents(intakeId, TEAM_A), 3);
  // Two clocks: a LIVE row records what it learned essentially as it happens, but it is
  // still a separate column — never the same string by construction.
  assert.ok(rows[0].recordedAt >= rows[0].occurredAt, "recordedAt is its own clock");
});

test("a second intake starts its own sequence — seq is per intake_id, not per table", () => {
  recordIntakeEvent({ intakeId: "intake-seq-2", workspaceId: TEAM_A, kind: "intake_round", occurredAt: "2026-08-08T09:00:00.000Z" });
  const rows = listIntakeEvents("intake-seq-2", TEAM_A);
  assert.deepEqual(rows.map((r) => r.seq), [1]);
});

test("a round the classifier could not place is a ROW, with topicCode OMITTED", () => {
  recordIntakeEvent({
    intakeId: "intake-unplaced",
    workspaceId: TEAM_A,
    kind: "intake_round",
    occurredAt: "2026-08-09T09:00:00.000Z",
    topicCode: null,
  });
  const [row] = listIntakeEvents("intake-unplaced", TEAM_A);
  assert.ok(row, "an unclassified round is still recorded — refusal is a result, not a failure");
  // The journey contract's absent-value convention: the key is ABSENT, never null.
  assert.equal(Object.hasOwn(row, "topicCode"), false, "topicCode is omitted, not null");
  // `actor`, by contrast, is the one deliberate null — "kp does not know who did this"
  // is a fact and must survive as one.
  assert.equal(row.actor, null);
  assert.deepEqual(row.facts, {});
});

test("a topic code the vocabulary no longer contains is dropped rather than rendered blank", () => {
  // Written past the typed door on purpose: this is the shape a FUTURE rename leaves in
  // an existing database, and the read path is the only place that can answer for it.
  ensureDb()
    .prepare(
      `INSERT INTO intake_events (intake_id, workspace_id, seq, kind, topic_code, facts_json, occurred_at, recorded_at, actor)
       VALUES (?, ?, 1, 'intake_round', 'a-code-we-retired', NULL, ?, ?, NULL)`
    )
    .run("intake-legacy-topic", TEAM_A, "2026-08-10T09:00:00.000Z", new Date().toISOString());
  const [row] = listIntakeEvents("intake-legacy-topic", TEAM_A);
  assert.equal(Object.hasOwn(row, "topicCode"), false, "an unknown code is dropped so the row falls back to its kind");
  assert.equal(row.kind, "intake_round");
});

test("one team cannot read, count or erase another team's rounds", () => {
  recordIntakeEvent({ intakeId: "intake-shared-id", workspaceId: TEAM_A, kind: "intake_round", occurredAt: "2026-08-11T09:00:00.000Z" });
  recordIntakeEvent({ intakeId: "intake-shared-id", workspaceId: TEAM_B, kind: "intake_round", occurredAt: "2026-08-11T10:00:00.000Z" });
  assert.equal(listIntakeEvents("intake-shared-id", TEAM_A).length, 1);
  assert.equal(listIntakeEvents("intake-shared-id", TEAM_B).length, 1);
  // Even the SEQUENCE is per tenant: B's first row is B's seq 1, not A's seq 2.
  assert.equal(listIntakeEvents("intake-shared-id", TEAM_B)[0].seq, 1);
  assert.equal(eraseIntakeEvents("intake-shared-id", TEAM_B), 1);
  assert.equal(listIntakeEvents("intake-shared-id", TEAM_A).length, 1, "erasing B's history left A's alone");
  assert.equal(countIntakeEvents("intake-shared-id", TEAM_B), 0);
});

test("erasure deletes by intake_id and reports what it removed", () => {
  const intakeId = "intake-erase";
  for (const at of ["2026-08-12T09:00:00.000Z", "2026-08-12T09:05:00.000Z"]) {
    recordIntakeEvent({ intakeId, workspaceId: TEAM_A, kind: "intake_round", occurredAt: at });
  }
  assert.equal(eraseIntakeEvents(intakeId, TEAM_A), 2, "returns the row count so a caller reports honestly");
  assert.deepEqual(listIntakeEvents(intakeId, TEAM_A), []);
  assert.equal(eraseIntakeEvents(intakeId, TEAM_A), 0, "erasing twice is a no-op, not an error");
});

test("APPEND-ONLY is structural: the store holds no UPDATE, and exactly one DELETE", () => {
  const src = readFileSync(fileURLToPath(new URL("./intake-events.ts", import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  // Comments stripped — the header EXPLAINS that there is no UPDATE path, and prose that
  // describes a rule must never be mistaken for the rule holding.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
  assert.equal(/\bUPDATE\s+intake_events\b/i.test(code), false, "intake_events must have no UPDATE path at all");
  const deletes = [...code.matchAll(/\bDELETE\s+FROM\s+intake_events\b/gi)];
  assert.equal(deletes.length, 1, "exactly one DELETE — the erasure door");
  const inserts = [...code.matchAll(/\bINSERT\s+INTO\s+intake_events\b/gi)];
  assert.equal(inserts.length, 1, "ONE WRITER: recordIntakeEvent is the store's only INSERT");
});

// ---------------------------------------------------------------------------
// THE BACKFILL (db/core.ts backfillIntakeEvents)
// ---------------------------------------------------------------------------

/** The backfill already ran, over an empty table, when this process booted its throwaway
 *  DB — that is the behaviour under test on a fresh install. Clearing the mark is how a
 *  test gets a second, meaningful run; it also proves the mark (not a row count) is what
 *  the gate reads.
 *
 *  CAVEAT for anyone adding a test below: re-arming makes the next run re-scan EVERY
 *  role_intakes row, so intakes an earlier test already recovered pick up a second copy.
 *  Assert only on the intake the test itself created. That is not a defect in the
 *  backfill — on the real boot path the mark is never cleared, which is the whole point
 *  of recording it. */
function armBackfill(): void {
  ensureDb().prepare(`DELETE FROM seed_marks WHERE name = ?`).run(INTAKE_EVENTS_BACKFILL_MARK);
}

test("the boot backfill recovers rounds from a transcript, with the TURN's own clock", () => {
  const intake = createIntake({ title: "Java do platebního týmu", lang: "cs" }, TEAM_A);
  // A real-shaped Czech transcript: the agent asks, the requestor answers. Every turn
  // carries its own `at` — verified true of all 143 turns in the operator's own database
  // on 2026-09-21, which is what makes this recovery possible at all.
  const wrote = updateIntakeDialog(
    intake.id,
    {
      transcript: [
        { role: "interviewer", text: "Pojďme tu roli nadefinovat společně.", at: "2026-08-07T16:25:55.992Z" },
        { role: "candidate", text: "Je to náhrada — odešel nám Jarda.", at: "2026-08-07T16:26:34.798Z" },
        { role: "interviewer", text: "Dobře — takže náhrada. Jaké mzdové rozpětí máte?", at: "2026-08-07T16:26:34.798Z" },
        { role: "candidate", text: "Rozpočet je do 120 000 Kč hrubého.", at: "2026-08-07T16:27:05.905Z" },
        // A trailing question with no answer yet: NOT a round — nothing happened in it.
        { role: "interviewer", text: "A kdy by měl nastoupit?", at: "2026-08-07T16:27:10.000Z" },
      ],
      brief: null,
    },
    TEAM_A
  );
  assert.equal(wrote, "ok");

  armBackfill();
  const written = backfillIntakeEvents(ensureDb());
  assert.ok(written >= 2, `expected the two answered rounds to be recovered, wrote ${written}`);

  const rows = listIntakeEvents(intake.id, TEAM_A);
  assert.equal(rows.length, 2, "two answered turns ⇒ two rounds; the dangling question is not one");
  assert.deepEqual(rows.map((r) => r.seq), [1, 2]);
  assert.deepEqual(rows.map((r) => r.occurredAt), ["2026-08-07T16:26:34.798Z", "2026-08-07T16:27:05.905Z"]);

  // THE POINT OF TWO COLUMNS: `occurred_at` is August, `recorded_at` is now. A single
  // clock would have made this recovered history indistinguishable from a live one, and
  // every report over a past window irreproducible.
  for (const row of rows) {
    assert.notEqual(row.recordedAt, row.occurredAt, "the two clocks must not collapse");
    assert.ok(row.recordedAt > row.occurredAt, "kp learned it after it happened");
  }
  // ONE moment across the whole run, so "what did kp know, and when" has one answer.
  assert.equal(rows[0].recordedAt, rows[1].recordedAt);

  // The round carries the pair as FACTS, never as a stored sentence (journey/types.ts).
  assert.equal(rows[0].facts.answer, "Je to náhrada — odešel nám Jarda.");
  assert.equal(rows[0].facts.question, "Pojďme tu roli nadefinovat společně.");
  // Recovered rounds are deliberately UNCLASSIFIED: core.ts is on every route's import
  // graph, so the classifier is not imported there (see backfillIntakeEvents). A NULL
  // topic is a first-class state the board renders through the row's kind.
  assert.equal(Object.hasOwn(rows[0], "topicCode"), false);
  assert.equal(rows[0].actor, null, "kp genuinely does not know who typed this");
});

test("the backfill is idempotent and records that it ran in seed_marks, never a row count", () => {
  const db = ensureDb();
  assert.equal(seedAlreadyRan(db, INTAKE_EVENTS_BACKFILL_MARK), true, "the run above stamped the mark");
  assert.equal(backfillIntakeEvents(db), 0, "a second call is a no-op while the mark stands");

  // AND the mark is what governs — not `COUNT(*) > 0`. Empty the table the way an
  // operator legitimately might; the backfill must STILL decline, because "never
  // backfilled" and "backfilled, then legitimately emptied" are different facts and a
  // row count cannot tell them apart. This is the defect seed_marks exists for: a
  // recruiter who cleared a table got the demo corpus injected back on the next boot.
  const intakeIds = (db.prepare(`SELECT DISTINCT intake_id FROM intake_events`).all() as {
    intake_id: string;
  }[]).map((r) => r.intake_id);
  assert.ok(intakeIds.length > 0, "non-vacuity: there are rows to empty");
  for (const id of intakeIds) {
    eraseIntakeEvents(id, TEAM_A);
    eraseIntakeEvents(id, TEAM_B);
  }
  assert.equal(backfillIntakeEvents(db), 0, "an emptied table does not resurrect the history on the next boot");
});

test("a transcript turn with no `at` is skipped rather than stamped with now()", () => {
  const intake = createIntake({ title: "No clock", lang: "en" }, TEAM_B);
  assert.equal(
    updateIntakeDialog(
      intake.id,
      {
        transcript: [
          { role: "interviewer", text: "What is the budget?" },
          { role: "candidate", text: "Around 120k." },
          { role: "interviewer", text: "And the start date?", at: "2026-08-20T10:00:00.000Z" },
          { role: "candidate", text: "September.", at: "2026-08-20T10:01:00.000Z" },
        ],
        brief: null,
      },
      TEAM_B
    ),
    "ok"
  );
  armBackfill();
  backfillIntakeEvents(ensureDb());
  const rows = listIntakeEvents(intake.id, TEAM_B);
  assert.equal(rows.length, 1, "only the round whose clock we actually have is recovered");
  assert.equal(rows[0].occurredAt, "2026-08-20T10:01:00.000Z");
});

test("an unreadable transcript costs that one intake its history, never the boot", () => {
  const intake = createIntake({ title: "Corrupt", lang: "en" }, TEAM_B);
  ensureDb().prepare(`UPDATE role_intakes SET transcript_json = ? WHERE id = ? AND workspace_id = ?`).run(
    "{not json",
    intake.id,
    TEAM_B
  );
  armBackfill();
  // Does not throw: the whole point of safeRowParse on that column.
  assert.doesNotThrow(() => backfillIntakeEvents(ensureDb()));
  assert.deepEqual(listIntakeEvents(intake.id, TEAM_B), []);
});
