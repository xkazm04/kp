// Direction 3, part 2 — a failover and a reconnect become FACTS ON THE ROW.
//
// Both were already known to the system and both were thrown away: /connect wrote the
// provider that actually served over `provider` (the completion ledger reads it) and
// spent the requested one on a `console.warn`, and /complete's billing expression
// reasoned about "the current attempt" without ever recording that there had been
// more than one. So a recruiter looking at a call priced on ElevenLabs could not learn
// that the OpenAI screen they picked had failed, and a session billed for the third of
// three attempts read exactly like a clean first-time call.
//
// Two additive columns (`failover_from TEXT`, `attempts INTEGER NOT NULL DEFAULT 1`)
// and the honest-null rules that go with them: NULL failover_from is "nothing fell
// back", never "fell back from itself"; attempts is 1 for a link that never connected
// AND for the ordinary single-attempt call, never 0.
//
// unit-db.ts must stay the first project import (isolated throwaway DB).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import {
  completeInterviewSession,
  createInterviewSession,
  getInterviewSessionById,
  interviewedForJob,
  listRecentInterviewSessions,
  markInterviewStarted,
  setInterviewSessionProvider,
} from "./interviews.ts";
import { insertLlmUsage } from "./llm.ts";
import { ensureDb } from "./core.ts";

after(() => cleanupUnitDb());

const WS = "team-interview-failover";

function summaryFor(id: string) {
  const row = listRecentInterviewSessions(WS, 500).find((s) => s.id === id);
  assert.ok(row, `expected session ${id} in the workspace ledger`);
  return row;
}

function newSession(extra: { jobId?: string } = {}) {
  return createInterviewSession({
    provider: "openai",
    mode: "candidate",
    durationMin: 20,
    workspaceId: WS,
    ...extra,
  });
}

test("a fresh DB carries both new interview_sessions columns", () => {
  const cols = new Set(
    (ensureDb().prepare(`PRAGMA table_info(interview_sessions)`).all() as { name: string }[]).map((c) => c.name)
  );
  assert.ok(cols.has("failover_from"), "interview_sessions is missing failover_from");
  assert.ok(cols.has("attempts"), "interview_sessions is missing attempts");
});

test("a new session is one attempt that fell back from nothing", () => {
  const s = newSession();
  assert.equal(s.attempts, 1, "a link that has not connected is still ONE attempt, never zero");
  assert.equal(s.failoverFrom, null);
  const sum = summaryFor(s.id);
  assert.equal(sum.attempts, 1);
  assert.equal(sum.failoverFrom, null);
});

test("the first connect does not inflate the count; a reconnect does", () => {
  const s = newSession();
  assert.equal(markInterviewStarted(s.id, true), true);
  assert.equal(getInterviewSessionById(s.id)!.attempts, 1, "the first connect IS the first attempt");
  assert.equal(markInterviewStarted(s.id, true), true);
  assert.equal(getInterviewSessionById(s.id)!.attempts, 2, "a dropped call retried is a second attempt");
  assert.equal(markInterviewStarted(s.id, true), true);
  assert.equal(summaryFor(s.id).attempts, 3);
});

test("a completed session cannot be reopened, so it cannot gain an attempt", () => {
  const s = newSession();
  markInterviewStarted(s.id, true);
  completeInterviewSession(s.id, { transcript: [] });
  assert.equal(markInterviewStarted(s.id, true), false);
  assert.equal(getInterviewSessionById(s.id)!.attempts, 1, "a refused connect must not count");
});

test("a failover records what it fell back FROM, and keeps the first answer", () => {
  const s = newSession();
  markInterviewStarted(s.id, true);
  setInterviewSessionProvider(s.id, "elevenlabs", "openai");
  const after1 = getInterviewSessionById(s.id)!;
  assert.equal(after1.provider, "elevenlabs", "provider is who SERVED");
  assert.equal(after1.failoverFrom, "openai", "…and failover_from is who was asked");
  // A second failover on the same link must not rewrite history: the first thing the
  // recruiter chose is the interesting one.
  setInterviewSessionProvider(s.id, "openai", "elevenlabs");
  assert.equal(getInterviewSessionById(s.id)!.failoverFrom, "openai");
  assert.equal(summaryFor(s.id).failoverFrom, "openai");
});

test("a plain provider write (no failover) never invents a fallback", () => {
  const s = newSession();
  setInterviewSessionProvider(s.id, "elevenlabs");
  assert.equal(getInterviewSessionById(s.id)!.failoverFrom, null);
});

test("the compare cohort carries what each interview cost", () => {
  const jobId = `job-failover-${Date.now()}`;
  const s = newSession({ jobId });
  completeInterviewSession(s.id, { transcript: [] });
  assert.equal(interviewedForJob(jobId, WS)[0]?.costUsd, null, "no ledger row is unknown, not free");
  insertLlmUsage({
    useCase: "interview_realtime",
    provider: "openai",
    model: "gpt-realtime",
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    costUsd: 1.5,
    source: "llm",
    outcome: "ok",
    requestId: s.id,
  });
  assert.equal(interviewedForJob(jobId, WS)[0]?.costUsd, 1.5);
});

// ---- The case a fresh DB cannot prove: an EXISTING interview_sessions table --------
//
// Every assertion above runs against a file whose CREATE TABLE already names both
// columns, so the two ALTERs could be deleted and the suite would stay green. The
// database that matters is the one an operator has been running for months, with real
// sessions in it: `attempts` is NOT NULL, so a migration that goes wrong there fails
// the whole boot rather than one read. Driven in a child process (the core-migrations
// pattern) because KP_DB_PATH must be frozen before core.ts loads.
const LEGACY_CHILD = `
import path from "node:path";
import os from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";

const dir = mkdtempSync(path.join(os.tmpdir(), "kp-iv-legacy-"));
const dbPath = path.join(dir, "legacy.sqlite");
process.env.NODE_TEST_CONTEXT = "child-v8";
process.env.KP_DB_PATH = dbPath;
process.env.KP_EMPTY = "1";
delete process.env.KP_MULTI_WORKSPACE;

// The interview_sessions shape as it stood before this change, carrying a completed
// call: no failover_from, no attempts, no workspace_id.
const legacy = new Database(dbPath);
legacy.exec([
  "CREATE TABLE interview_sessions (id TEXT PRIMARY KEY, token TEXT UNIQUE, entry_id TEXT, candidate_label TEXT, job_id TEXT, job_title TEXT, provider TEXT NOT NULL, language TEXT, mode TEXT NOT NULL DEFAULT 'test', status TEXT NOT NULL DEFAULT 'created', instructions TEXT, consent_at TEXT, started_at TEXT, ended_at TEXT, transcript_json TEXT, scorecard_json TEXT, created_at TEXT NOT NULL, updated_at TEXT);",
  "INSERT INTO interview_sessions (id, token, provider, mode, status, transcript_json, created_at) VALUES ('iv-legacy','tk-legacy','openai','candidate','completed','[{\\"role\\":\\"agent\\",\\"text\\":\\"hi\\"}]','2024-01-02T00:00:00.000Z');",
].join("\\n"));
legacy.close();

const core = await import(pathToFileURL(path.join(process.cwd(), "app/_lib/db/core.ts")).href);
const holder = globalThis;
let db = core.ensureDb();

const fails = [];
const one = (sql, ...args) => db.prepare(sql).get(...args);
const check = (label, actual, expected) => {
  if (actual !== expected) fails.push(label + ": got " + JSON.stringify(actual) + ", expected " + JSON.stringify(expected));
};

const cols = new Set(db.prepare("PRAGMA table_info(interview_sessions)").all().map((c) => c.name));
check("legacy table gained failover_from", cols.has("failover_from"), true);
check("legacy table gained attempts", cols.has("attempts"), true);
// The NOT NULL DEFAULT 1 must land on the EXISTING row, not leave it NULL.
check("legacy row reads as one attempt", one("SELECT attempts AS v FROM interview_sessions WHERE id='iv-legacy'").v, 1);
check("legacy row fell back from nothing", one("SELECT failover_from AS v FROM interview_sessions WHERE id='iv-legacy'").v, null);
check("legacy transcript untouched", one("SELECT transcript_json AS v FROM interview_sessions WHERE id='iv-legacy'").v, '[{"role":"agent","text":"hi"}]');

// A second boot over the now-migrated DB must change nothing.
holder.__kpDb.close();
holder.__kpDb = undefined;
db = core.ensureDb();
check("2nd boot keeps the attempt count", one("SELECT attempts AS v FROM interview_sessions WHERE id='iv-legacy'").v, 1);
check("2nd boot adds no sessions", one("SELECT COUNT(*) AS v FROM interview_sessions").v, 1);

db.close();
rmSync(dir, { recursive: true, force: true });
console.log(fails.length === 0 ? "LEGACY_OK" : "LEGACY_FAIL " + fails.join(" ;; "));
`;

test("a PRE-MIGRATION interview_sessions table is carried forward", () => {
  const res = spawnSync(
    process.execPath,
    [
      "--import",
      "./scripts/test-alias-loader.mjs",
      "--experimental-transform-types",
      "--disable-warning=ExperimentalWarning",
      "--input-type=module",
      "-e",
      LEGACY_CHILD,
    ],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" } }
  );
  assert.match(res.stdout, /LEGACY_OK/, `stdout=${res.stdout}\nstderr=${res.stderr}`);
});
