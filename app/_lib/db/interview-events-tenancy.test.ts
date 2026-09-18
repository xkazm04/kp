import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Tenant scope — the proof tenancy.ts cites for `interview_events` (the interview
// director's append-only record: every live turn verbatim, evidence and guardrail
// quotes, forwarded questions).
//
// SOURCE half: every statement in db/interview-events.ts that touches the table binds
// workspace_id in a PREDICATE (or, for the INSERT, selects the tenant from the session
// row filtered by the same workspace). NO by-id / by-session exemption: a session id is
// an internal identifier the recruiter surfaces pass around, not a capability. And the
// table has exactly two doors — the store, and the erasure DELETE in db/pipeline.ts —
// so a third file that starts writing SQL against it is caught here, not in review.
//
// BEHAVIOURAL half: another team's workspace reads nothing, and an append naming the
// wrong workspace writes nothing (the INSERT…SELECT finds no session to file it under).
const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(here, "interview-events.ts"), "utf8");
const sqlBlocks = [...src.matchAll(/`([^`]*)`/g)].map((m) => m[1]);
const TOUCHES = /\b(from|into|update|delete\s+from)\s+interview_events\b/i;

/** Does workspace_id constrain the statement? A predicate, not a mention in a SELECT
 *  list (the pipeline-events guard's lesson). */
function isScoped(sql: string): boolean {
  return /\bworkspace_id\s*(=|in)\s*[?(@:]/i.test(sql);
}

test("the scoping predicate rejects a statement that merely mentions the column", () => {
  assert.equal(isScoped("SELECT workspace_id FROM interview_events WHERE session_id = ?"), false);
  assert.equal(isScoped("SELECT id FROM interview_events WHERE session_id = ? AND workspace_id = ?"), true);
});

test("every interview_events statement in the store is workspace-scoped (no exemptions)", () => {
  const touching = sqlBlocks.filter((s) => TOUCHES.test(s));
  assert.ok(touching.length >= 3, `expected the append, list and max-seq statements, found ${touching.length}`);
  for (const sql of touching) {
    assert.ok(isScoped(sql), `an interview_events statement is NOT workspace-scoped:\n${sql.trim().slice(0, 240)}`);
  }
  const insert = touching.find((s) => /insert\s+into\s+interview_events/i.test(s));
  assert.ok(insert, "the append statement is found");
  assert.match(insert!, /FROM interview_sessions s\s+WHERE s\.id = \? AND s\.workspace_id = \?/, "the INSERT takes its tenant from the session row, filtered by the caller's workspace");
  assert.doesNotMatch(src, /\bUPDATE\s+interview_events\b/i, "the record is append-only: the store has no UPDATE");
});

test("only the store and the erasure scrub write SQL against interview_events", () => {
  const appDir = path.resolve(here, "..", "..");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") walk(p);
      } else if (/\.(ts|tsx|mjs)$/.test(e.name) && !/\.test\.(ts|tsx|mjs)$/.test(e.name)) {
        const text = readFileSync(p, "utf8");
        const sql = [...text.matchAll(/`([^`]*)`/g)].map((m) => m[1]).filter((s) => TOUCHES.test(s));
        if (sql.length > 0) offenders.push(path.relative(appDir, p).split(path.sep).join("/"));
      }
    }
  };
  walk(appDir);
  assert.deepEqual(offenders.sort(), ["_lib/db/interview-events.ts", "_lib/db/pipeline.ts"]);
  const pipeline = readFileSync(path.join(here, "pipeline.ts"), "utf8");
  const pipelineSql = [...pipeline.matchAll(/`([^`]*)`/g)].map((m) => m[1]).filter((s) => TOUCHES.test(s));
  assert.deepEqual(
    pipelineSql.map((s) => s.trim()),
    ["DELETE FROM interview_events WHERE session_id IN (SELECT id FROM interview_sessions WHERE entry_id = ?)"],
    "pipeline.ts may only DELETE the erased entry's sessions' events",
  );
});

// ---- behavioural -------------------------------------------------------------------
import { cleanupUnitDb } from "../testing/unit-db.ts";
import { appendInterviewEvents, listInterviewEvents, maxInterviewTurnSeq } from "./interview-events.ts";
import { createInterviewSession } from "./interviews.ts";
import { DEFAULT_WORKSPACE_ID } from "./workspaces.ts";

after(() => cleanupUnitDb());

const WS_B = "team-interview-events-b";

test("another team reads nothing and cannot append to a session it does not own", () => {
  const session = createInterviewSession({ provider: "openai", mode: "test", durationMin: 10, workspaceId: WS_B });
  const written = appendInterviewEvents(
    [{ sessionId: session.id, attempt: 1, seq: 0, kind: "turn", payload: { role: "candidate", text: "I ran the migration." } }],
    WS_B,
  );
  assert.equal(written.length, 1, "the owning team appends");
  assert.equal(listInterviewEvents(session.id, WS_B).length, 1);

  assert.deepEqual(listInterviewEvents(session.id, DEFAULT_WORKSPACE_ID), [], "a stranger's read is empty");
  assert.equal(maxInterviewTurnSeq(session.id, 1, DEFAULT_WORKSPACE_ID), -1, "a stranger sees no turns");

  const foreign = appendInterviewEvents(
    [{ sessionId: session.id, attempt: 1, seq: 1, kind: "turn", payload: { role: "candidate", text: "injected" } }],
    DEFAULT_WORKSPACE_ID,
  );
  assert.deepEqual(foreign, [], "an append naming the wrong workspace writes nothing");
  assert.equal(listInterviewEvents(session.id, WS_B).length, 1, "the owner's record is untouched");
});
