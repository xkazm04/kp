// TENANT SCOPE for the interview feedback letter (spark interview-feedback-letter, WP-alpha).
//
// `interview_letters` holds a letter ABOUT one named person — the machine's draft and the
// recruiter's approved text — and its id travels further than one screen: through the
// recruiter's review queue, and through the task runner, whose params POST /api/tasks accepts
// from a client. So, like interview_kits and repo_scans, the table gets NO by-id carve-out:
// every statement binds workspace_id, point reads included, and a leaked letter id resolves
// for nobody but its own team. The exemption list below is empty and meant to stay so.
//
// Two halves, because either alone is hollow: the STORE must filter, and the store must be
// the only thing that reaches the table outside the erasure scrub.
//
// unit-db.ts MUST be the first project import (it sets KP_DB_PATH before any store
// resolves db-path.ts).
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const {
  interviewLetterApprove,
  interviewLetterByEntry,
  interviewLetterById,
  interviewLetterDecidingEvent,
  interviewLetterDecline,
  interviewLetterQueue,
  interviewLetterRecordDelivery,
  interviewLetterRequest,
  interviewLetterSaveDraft,
} = await import("./interview-letters.ts");
const { createPipelineEntry, actOnPipelineEntry } = await import("./pipeline.ts");
const { DEFAULT_WORKSPACE_ID } = await import("./workspaces.ts");

after(() => cleanupUnitDb());

const OTHER_WS = "team-beta";

// ---- the SQL half ---------------------------------------------------------

const dir = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(dir, "interview-letters.ts"), "utf8").replace(/\r\n/g, "\n");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);

test("every interview_letters statement binds workspace_id — no by-id exemption", () => {
  const touching = sqlBlocks.filter((s) => /\b(from|into|update)\s+interview_letters\b/i.test(s));
  assert.ok(touching.length >= 8, `expected every letter query, found ${touching.length}`);
  // The exemption list this guard grants. EMPTY on purpose (see the header).
  const EXEMPT: readonly string[] = [];
  let inserts = 0;
  let predicates = 0;
  for (const sql of touching) {
    if (EXEMPT.some((e) => sql.includes(e))) continue;
    if (/\binsert\s+into\s+interview_letters\b/i.test(sql)) {
      // An INSERT STAMPS the tenant — the column must be written, or the row lands on the
      // DDL default and belongs to the wrong team.
      assert.match(sql, /\(\s*id,\s*workspace_id\b/i, `an interview_letters INSERT does not stamp workspace_id:\n${sql.trim()}`);
      inserts += 1;
      continue;
    }
    assert.match(sql, /workspace_id\s*=\s*\?/, `an interview_letters statement is NOT workspace-bound:\n${sql.trim().slice(0, 200)}`);
    predicates += 1;
  }
  assert.ok(inserts >= 1, "expected the request INSERT");
  assert.ok(predicates >= 7, `expected every read/update to carry the predicate, saw ${predicates}`);
});

test("the deciding-event read is scoped to the entry's own team too", () => {
  const events = sqlBlocks.filter((s) => /\bfrom\s+pipeline_events\b/i.test(s));
  assert.equal(events.length, 1, "one audit-trail read in this store");
  assert.match(events[0], /workspace_id\s*=\s*\?/, "the reject-event read is workspace-bound");
});

test("one letter per application is keyed per team, so two teams can never collide", () => {
  const core = readFileSync(path.join(dir, "core.ts"), "utf8").replace(/\r\n/g, "\n");
  assert.match(core, /CREATE UNIQUE INDEX IF NOT EXISTS uq_interview_letters_entry ON interview_letters \(workspace_id, entry_id\)/);
});

test("outside this store, only the erasure scrub touches the table", () => {
  const libDir = path.resolve(dir, "..");
  const appDir = path.resolve(libDir, "..");
  const offenders: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(p);
        continue;
      }
      if (!e.name.endsWith(".ts") || e.name.endsWith(".test.ts")) continue;
      if (p === path.join(dir, "interview-letters.ts") || p === path.join(dir, "core.ts")) continue;
      const text = readFileSync(p, "utf8");
      for (const m of text.matchAll(/`([^`]*)`/g)) {
        if (/\b(from|into|update)\s+interview_letters\b/i.test(m[1])) offenders.push(`${path.relative(appDir, p)}: ${m[1].trim().slice(0, 80)}`);
      }
    }
  };
  walk(appDir);
  assert.deepEqual(
    offenders.map((o) => o.split(":")[0]),
    [path.join("_lib", "db", "pipeline.ts")],
    `only the erasure scrub may write interview_letters outside its store:\n${offenders.join("\n")}`
  );
  assert.match(offenders[0] ?? "", /UPDATE interview_letters SET draft_text = NULL, final_text = NULL/, "…and that write is the scrub");
});

// ---- the behavioural half -------------------------------------------------

function entry(ws: string) {
  const suffix = Math.random().toString(36).slice(2, 8);
  return createPipelineEntry({
    candidateId: `c-ilt-${suffix}`,
    candidateLabel: "Tenancy Candidate",
    jobId: `job-ilt-${suffix}`,
    jobTitle: "Data Engineer",
    stage: "Interview",
    workspaceId: ws,
  }).entry;
}

test("no read or write crosses a tenant boundary — by entry, by id, the queue, every transition", () => {
  const foreignEntry = entry(OTHER_WS);
  const { letter: foreign } = interviewLetterRequest({ entryId: foreignEntry.id, lang: "cs", outcome: "not_selected" }, OTHER_WS);

  assert.equal(interviewLetterByEntry(foreignEntry.id, DEFAULT_WORKSPACE_ID), null);
  assert.equal(interviewLetterById(foreign.id, DEFAULT_WORKSPACE_ID), null, "a leaked letter id resolves for nobody else");
  assert.deepEqual(
    interviewLetterQueue(DEFAULT_WORKSPACE_ID).filter((l) => l.id === foreign.id),
    [],
    "another team's open letter is not in this team's queue"
  );
  // Every write is a no-op across the boundary — and says so with null.
  assert.equal(interviewLetterSaveDraft(foreign.id, { text: "Hello.", source: "template" }, DEFAULT_WORKSPACE_ID), null);
  assert.equal(interviewLetterApprove(foreign.id, { finalText: "Hello.", decidedBy: "human:Eve" }, DEFAULT_WORKSPACE_ID), null);
  assert.equal(interviewLetterDecline(foreign.id, { decidedBy: "human:Eve" }, DEFAULT_WORKSPACE_ID), null);
  assert.equal(interviewLetterRecordDelivery(foreign.id, "sent", DEFAULT_WORKSPACE_ID), null);
  const untouched = interviewLetterById(foreign.id, OTHER_WS)!;
  assert.equal(untouched.state, "requested", "the owning team's letter is exactly as it was");
  assert.equal(untouched.draft, null);

  // The same entry id asked from another team is ANOTHER letter, never this one.
  const { letter: ours, created } = interviewLetterRequest({ entryId: foreignEntry.id, lang: "en", outcome: "hired" }, DEFAULT_WORKSPACE_ID);
  assert.equal(created, true);
  assert.notEqual(ours.id, foreign.id);
  assert.equal(interviewLetterById(foreign.id, OTHER_WS)!.lang, "cs", "and it did not overwrite the first team's row");

  // …and scoping is a filter, not a wall: the owning team reads its own.
  assert.equal(interviewLetterByEntry(foreignEntry.id, OTHER_WS)?.id, foreign.id);
  assert.ok(interviewLetterQueue(OTHER_WS).some((l) => l.id === foreign.id));
});

test("the deciding event is read on the entry's own team", () => {
  const e = entry(OTHER_WS);
  actOnPipelineEntry(e.id, "reject", undefined, { actor: "human", actorRef: "human:Beta Recruiter" }, OTHER_WS);
  assert.deepEqual(interviewLetterDecidingEvent(e.id, OTHER_WS), { kind: "rejected", actor: "human:Beta Recruiter" });
  assert.equal(interviewLetterDecidingEvent(e.id, DEFAULT_WORKSPACE_ID), null, "another team cannot read who decided");
});
