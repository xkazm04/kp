// Score-after-filing (entry-scoring.ts + application-filing.ts step 6).
//
// A candidate who applied sat on the owner's board with a BLANK score — and the policy
// pass held them "awaiting match score" — until an automation pass ran, and the clock
// that runs it is off by default. The filing core now schedules the role-fit score of a
// FRESH, BUILT filing through the door's `deferScore` (afterResponse in the routes).
//
// What these pin:
//   1. the pure predicate: only a created, non-stub, scorable entry is scored;
//   2. the deferred task writes the score + the `scored` event and NOTHING ELSE — no
//      stage move, no approval, no proposal (scoring only, never a decision);
//   3. the write is a compare-and-swap: a score a concurrent pass already wrote is not
//      clobbered and not double-logged;
//   4. a ranker failure never throws out of the task; the entry stays unscored for the
//      pass to pick up;
//   5. a duplicate or a stub filing schedules nothing.
//
// Real, throwaway DB: testing/unit-db.ts must stay the FIRST project import. The
// profile builder and the ranker are injected, so nothing spawns Python.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "./testing/unit-db.ts";
import { fileApplication, type ProfileBuilder } from "./application-filing.ts";
import { isScorableEntry, scoreFiledEntry, shouldScoreAfterFiling, type EntryRanker, type ScorableEntry } from "./entry-scoring.ts";
import { insertJob } from "./job-ingest.ts";
import { getJob } from "./db/jobs.ts";
import { getPipelineEntry, listPipelineEventsForEntry, setEntryMatchScore } from "./db/pipeline.ts";
import { saveProfile } from "./db/profiles.ts";

after(() => cleanupUnitDb());

const W = "team-score-after-filing";

const builder: ProfileBuilder = async (_job, answers, _into, workspaceId) => {
  const saved = saveProfile(
    { label: answers.name, archetype: "backend", roleFamily: null, completeness: 60, payload: { displayName: answers.name } },
    workspaceId
  );
  return { ok: true, id: saved.id, archetype: "backend", missingGaps: [] };
};

/** A ranker that scores every candidate it is handed at `total`, counting its calls. */
function fixedRanker(total: number, calls: string[][]): EntryRanker {
  return async (_jobId, pool) => {
    calls.push(pool.map((c) => c.id));
    return { candidates: pool.map((c) => ({ candidateId: c.id, result: { total } })) };
  };
}

function openJob(id: string) {
  insertJob({ id, title: `Role ${id}` } as never, undefined, "published", W);
  const job = getJob(id);
  assert.ok(job, `precondition: job ${id} exists`);
  return job;
}

const base: ScorableEntry = {
  id: "e1",
  candidateId: "prof-1",
  candidateLabel: "Ada",
  jobId: "job-1",
  jobTitle: "Role",
  matchScore: null,
  intakeDegraded: false,
  workspaceId: W,
};

// ---------------------------------------------------------------------------
// 1. The predicate
// ---------------------------------------------------------------------------

test("predicate: a fresh, built, scorable filing is scored", () => {
  assert.equal(shouldScoreAfterFiling({ kind: "created", entry: base }, false), true);
});

test("predicate: a duplicate, a stub, a degraded intake, a scored entry, a ds- id and a jobless entry are not", () => {
  assert.equal(shouldScoreAfterFiling({ kind: "duplicate", entry: base }, false), false, "a repeat keeps the original's score");
  assert.equal(shouldScoreAfterFiling({ kind: "created", entry: base }, true), false, "a quick-apply/ATS stub is skipped by design");
  assert.equal(shouldScoreAfterFiling({ kind: "created", entry: { ...base, intakeDegraded: true } }, false), false);
  assert.equal(shouldScoreAfterFiling({ kind: "created", entry: { ...base, matchScore: 70 } }, false), false);
  assert.equal(shouldScoreAfterFiling({ kind: "created", entry: { ...base, candidateId: "ds-sub1" } }, false), false);
  assert.equal(shouldScoreAfterFiling({ kind: "created", entry: { ...base, jobId: null } }, false), false);
  assert.equal(shouldScoreAfterFiling({ kind: "created", entry: { ...base, candidateId: null } }, false), false);
  assert.equal(isScorableEntry(base), true);
});

// ---------------------------------------------------------------------------
// 2-5. Through the filing core
// ---------------------------------------------------------------------------

async function fileWithDeferredScore(jobId: string, name: string, ranker: EntryRanker) {
  const job = openJob(jobId);
  const tasks: (() => Promise<void>)[] = [];
  const out = await fileApplication({
    job,
    workspaceId: W,
    name,
    email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.invalid`,
    locale: "en",
    sourceChannel: "apply",
    channelLabel: "conversational apply",
    answers: { skills: "Go, Postgres" },
    proof: "none",
    buildProfile: builder,
    sendAck: false,
    // The routes pass afterResponse(…, () => scoreFiledEntry(entry)); here the task is
    // captured so the test decides when "after the response" is.
    deferScore: (entry) => {
      tasks.push(async () => {
        await scoreFiledEntry(entry, { rank: ranker });
      });
    },
  });
  assert.equal(out.kind, "created");
  return { out, tasks, job };
}

test("a fresh filing schedules ONE deferred score; running it writes the score and the scored event, and NO decision", async () => {
  const calls: string[][] = [];
  const { out, tasks } = await fileWithDeferredScore("saf-fresh-job", "Ada Lovelace", fixedRanker(77.4, calls));
  assert.equal(tasks.length, 1, "exactly one score is scheduled");
  const before = getPipelineEntry(out.entry.id, W);
  assert.ok(before);
  assert.equal(before.matchScore, null, "nothing is scored on the request path — the response does not wait");
  const eventsBefore = listPipelineEventsForEntry(out.entry.id, 50, W).map((e) => e.kind);

  await tasks[0]();

  const afterRow = getPipelineEntry(out.entry.id, W);
  assert.ok(afterRow);
  assert.equal(afterRow.matchScore, 77, "the deterministic total, rounded, is on the card");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [before.candidateId], "only THIS entry's candidate was ranked");
  // Scoring only: the stage, the status and the approval gate are exactly as filed.
  assert.equal(afterRow.stage, before.stage);
  assert.equal(afterRow.status, before.status);
  assert.equal(afterRow.approvalKind ?? null, before.approvalKind ?? null);
  assert.equal(afterRow.approvalKind ?? null, null, "no approval / proposal was raised");
  const eventsAfter = listPipelineEventsForEntry(out.entry.id, 50, W).map((e) => e.kind);
  const added = eventsAfter.slice();
  for (const k of eventsBefore) added.splice(added.indexOf(k), 1);
  assert.deepEqual(added, ["scored"], "the ONLY new event is `scored` — no stage change, approval or decision");
});

test("CAS: a score a concurrent pass already wrote is neither clobbered nor double-logged", async () => {
  const { out, tasks } = await fileWithDeferredScore("saf-cas-job", "Grace Hopper", fixedRanker(12, []));
  assert.equal(setEntryMatchScore(out.entry.id, 88, W), true, "the pass wins the race");
  await tasks[0]();
  assert.equal(getPipelineEntry(out.entry.id, W)?.matchScore, 88, "the pass's score stands");
  const scored = listPipelineEventsForEntry(out.entry.id, 50, W).filter((e) => e.kind === "scored");
  assert.equal(scored.length, 0, "the losing write logs nothing");
});

test("a ranker failure never throws out of the task; the entry stays unscored for the pass", async () => {
  const failing: EntryRanker = async () => {
    throw new Error("python missing");
  };
  const { out, tasks } = await fileWithDeferredScore("saf-fail-job", "Alan Turing", failing);
  const origError = console.error;
  console.error = () => {};
  try {
    await tasks[0]();
  } finally {
    console.error = origError;
  }
  assert.equal(getPipelineEntry(out.entry.id, W)?.matchScore, null);
});

test("a duplicate application and a stub filing schedule nothing", async () => {
  const { job } = await fileWithDeferredScore("saf-dupe-job", "Edsger Dijkstra", fixedRanker(50, []));
  const tasks: (() => Promise<void>)[] = [];
  const repeat = await fileApplication({
    job,
    workspaceId: W,
    name: "Edsger Dijkstra",
    email: "edsger.dijkstra@example.invalid",
    locale: "en",
    sourceChannel: "apply",
    channelLabel: "conversational apply",
    answers: { skills: "" },
    proof: "none",
    buildProfile: builder,
    sendAck: false,
    deferScore: (entry) => {
      tasks.push(async () => {
        await scoreFiledEntry(entry);
      });
    },
  });
  assert.equal(repeat.kind, "duplicate");
  const stub = await fileApplication({
    job,
    workspaceId: W,
    name: "Barbara Liskov",
    email: "barbara@example.invalid",
    locale: "en",
    sourceChannel: "lead",
    channelLabel: "quick apply",
    proof: "channel",
    stub: { idPrefix: "lead", reason: "quick apply — no CV yet" },
    sendAck: false,
    deferScore: (entry) => {
      tasks.push(async () => {
        await scoreFiledEntry(entry);
      });
    },
  });
  assert.equal(stub.kind, "created");
  assert.equal(tasks.length, 0, "neither a repeat nor a stub is scored after filing");
});
