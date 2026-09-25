// The deep-dive's traces on the posting store (D.2): the score a re-match replaced
// (`previousTotal`, read from match_json `previous`), and a rationale reasoned before the
// seeker's last CV/preference edit — flagged on the summary (`reasoningStale`) and picked
// again by the deep-dive shortlist. unit-db.ts first: an isolated throwaway DB.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { cleanupUnitDb } from "../testing/unit-db.ts";
import type { RawPosting } from "../jobseeker/types.ts";
import { EMPTY_PREFERENCES } from "../jobseeker/types.ts";
import { ensureDb } from "./core.ts";
import { upsertJobseekerProfile } from "./jobseeker-profiles.ts";
import {
  getPostingSummary,
  listDeepDiveCandidates,
  listJobseekerPostings,
  setPostingMatch,
  setPostingReasoning,
  setPostingStructure,
  upsertPosting,
} from "./jobseeker-postings.ts";

after(() => cleanupUnitDb());

const T0 = "2026-09-20T08:00:00.000Z";
const T1 = "2026-09-20T09:00:00.000Z";
const T2 = "2026-09-20T10:00:00.000Z";
const T3 = "2026-09-20T11:00:00.000Z";

let seq = 0;
function raw(): RawPosting {
  seq += 1;
  return {
    externalKey: `rs-${seq}`,
    url: `https://jobs.example/rs/${seq}`,
    title: `Posting ${seq}`,
    company: "Example",
    location: "Praha",
    country: "cz",
    workMode: "hybrid",
    postedAt: null,
    salaryText: null,
    salary: null,
    bodyText: `Role ${seq}. Requirements: TypeScript.`,
    jsonld: null,
    lang: "en",
  };
}

/** A scored posting in `ws` with total `total`. */
function scored(ws: string, total: number, match: Record<string, unknown> = {}): string {
  const { id } = upsertPosting("src-rs", raw(), T0, ws);
  setPostingStructure(id, { title: "x" }, "deterministic", ws);
  setPostingMatch(id, { jobId: id, eligibility: [], ...match }, { total, fitTier: total >= 70 ? "strong" : "partial", version: "v", matchedAt: T0 }, ws);
  return id;
}

/** The workspace's seeker profile, with updated_at pinned (the store stamps the wall clock). */
function profileAt(ws: string, at: string): void {
  const p = upsertJobseekerProfile({ userId: null, profile: { displayName: "Seeker" }, preferences: EMPTY_PREFERENCES }, ws);
  ensureDb().prepare(`UPDATE jobseeker_profiles SET updated_at = ? WHERE id = ? AND workspace_id = ?`).run(at, p.id, ws);
}

test("previousTotal: projected from match_json `previous` on a scored row; null everywhere else", () => {
  const ws = "ws-prev";
  const moved = scored(ws, 39, { previous: { total: 71, fitTier: "strong", matchedAt: T0 } });
  const plain = scored(ws, 60);
  const junk = scored(ws, 50, { previous: { total: "71" } });
  const byId = new Map(listJobseekerPostings({}, ws).rows.map((r) => [r.id, r]));
  assert.equal(byId.get(moved)!.previousTotal, 71, "a 71 that became a 39 says so");
  assert.equal(byId.get(moved)!.matchTotal, 39);
  assert.equal(byId.get(plain)!.previousTotal, null);
  assert.equal(byId.get(junk)!.previousTotal, null, "an unreadable note is no note, never a throw");
  assert.equal(getPostingSummary(moved, ws)!.previousTotal, 71, "the one-posting read carries it too");
});

test("reasoningStale: a rationale reasoned before the profile's last change is flagged; one after it, or none, is not", () => {
  const ws = "ws-stale";
  const old = scored(ws, 80);
  const fresh = scored(ws, 80);
  const legacy = scored(ws, 80);
  const never = scored(ws, 80);
  setPostingReasoning(old, { reasoning: {}, source: "llm", at: T2, reasonedAt: T0 }, ws);
  setPostingReasoning(fresh, { reasoning: {}, source: "llm", at: T3, reasonedAt: T2 }, ws);
  // Written before `reasonedAt` existed: the dive's own `at` stands in for it.
  setPostingReasoning(legacy, { reasoning: {}, source: "llm", at: T0 }, ws);
  profileAt(ws, T1);

  const byId = new Map(listJobseekerPostings({}, ws).rows.map((r) => [r.id, r]));
  assert.equal(byId.get(old)!.reasoningStale, true, "reasoned from inputs read at T0, the profile moved at T1");
  assert.equal(byId.get(old)!.deepDived, true, "still shown: stale is a flag, not a deletion");
  assert.equal(byId.get(fresh)!.reasoningStale, false);
  assert.equal(byId.get(legacy)!.reasoningStale, true);
  assert.equal(byId.get(never)!.reasoningStale, false, "no rationale is not a stale one");
  assert.equal(getPostingSummary(old, ws)!.reasoningStale, true);
});

test("reasoningStale is false in a workspace with no profile (nothing to be stale against)", () => {
  const ws = "ws-stale-none";
  const id = scored(ws, 80);
  setPostingReasoning(id, { reasoning: {}, source: "llm", at: T0, reasonedAt: T0 }, ws);
  assert.equal(getPostingSummary(id, ws)!.reasoningStale, false);
});

test("a malformed reasoning payload does not break the list: the row reads stale, not a throw", () => {
  const ws = "ws-stale-junk";
  const id = scored(ws, 80);
  ensureDb().prepare(`UPDATE jobseeker_postings SET reasoning_json = ? WHERE id = ? AND workspace_id = ?`).run("{not json", id, ws);
  profileAt(ws, T1);
  const rows = listJobseekerPostings({}, ws).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reasoningStale, true);
  assert.deepEqual(
    listDeepDiveCandidates({ threshold: 0, limit: 5, profileUpdatedAt: T1 }, ws).map((p) => p.id),
    [id],
    "an unreadable rationale is owed a new one"
  );
});

test("listDeepDiveCandidates: given the profile time it re-picks stale rationales, after every never-dived row", () => {
  const ws = "ws-redive";
  const staleHigh = scored(ws, 95);
  const neverLow = scored(ws, 70);
  const neverHigh = scored(ws, 85);
  const current = scored(ws, 99);
  const below = scored(ws, 40);
  setPostingReasoning(staleHigh, { reasoning: {}, source: "llm", at: T0, reasonedAt: T0 }, ws);
  setPostingReasoning(current, { reasoning: {}, source: "llm", at: T2, reasonedAt: T2 }, ws);

  // Without the profile time: the old behaviour — only rows with no rationale.
  assert.deepEqual(listDeepDiveCandidates({ threshold: 65, limit: 10 }, ws).map((p) => p.id), [neverHigh, neverLow]);
  // With it: the stale rationale comes back, AFTER the never-dived rows; the current one
  // and the one below the threshold do not.
  assert.deepEqual(listDeepDiveCandidates({ threshold: 65, limit: 10, profileUpdatedAt: T1 }, ws).map((p) => p.id), [neverHigh, neverLow, staleHigh]);
  // The cap applies to the whole ordered list.
  assert.deepEqual(listDeepDiveCandidates({ threshold: 65, limit: 2, profileUpdatedAt: T1 }, ws).map((p) => p.id), [neverHigh, neverLow]);
  // Threshold 0 lets `below` in; the current rationale stays out whatever the threshold.
  const all = listDeepDiveCandidates({ threshold: 0, limit: 10, profileUpdatedAt: T1 }, ws).map((p) => p.id);
  assert.deepEqual(all, [neverHigh, neverLow, below, staleHigh]);
  assert.ok(!all.includes(current), "a rationale reasoned after the profile's last change is current");
});
